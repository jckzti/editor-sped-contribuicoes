/**
 * Operações desfazíveis e histórico (desfazer/refazer).
 *
 * Uma operação = uma ação do usuário (editar campos, aplicar uma regra, importar um
 * pacote...), possivelmente sobre milhares de registros e várias escriturações.
 * Ao fim de cada operação, dentro dela (e portanto desfeitos junto), o motor refaz:
 * totais dos documentos afetados → cadastros → contadores. A apuração (bloco M) NÃO
 * entra aqui: é feita por `recalcular`, que a interface chama antes de gerar arquivos.
 *
 * O histórico tem teto de QUANTIDADE de operações e de MEMÓRIA estimada
 * (`definirLimiteHistorico`, `definirLimiteMemoriaHistorico`, `usoHistorico`). Ao
 * estourar, as operações mais ANTIGAS são descartadas (a mais recente nunca é) e o
 * histórico fica marcado como truncado, para a interface avisar até onde dá para desfazer.
 */
import { sincronizarCadastros } from './cadastros';
import { recontar } from './contadores';
import { estadoDe } from './estado';
import type { Aviso } from './modelo';
import {
  abrirTransacao,
  desfazerTransacao,
  fecharTransacao,
  refazerTransacao,
  transacaoAtual,
  transacaoVazia,
  type Transacao,
} from './mutacao';
import { atualizarTotais } from './totais';

export interface ResumoOperacao {
  id: number;
  descricao: string;
  /** Data/hora (ms desde 1970). */
  quando: number;
  /** Ids das escriturações tocadas. */
  escrituracoes: string[];
  /** Quantidade de campos alterados + registros incluídos/excluídos (inclui os automáticos). */
  mudancas: number;
  /** Memória estimada que a operação ocupa no histórico, em bytes. */
  bytesEstimados: number;
}

/** Uso do histórico, para a interface mostrar e avisar quando houver truncamento. */
export interface UsoHistorico {
  /** Operações guardadas (desfazer + refazer). */
  operacoes: number;
  /** Quantas ações dá para desfazer agora (tamanho da pilha de desfazer). */
  paraDesfazer: number;
  /** Quantas ações dá para refazer agora (0 = pilha de refazer vazia). */
  paraRefazer: number;
  /** Memória estimada do histórico, em bytes (ver as constantes BYTES_* em `mutacao.ts`). */
  bytesEstimados: number;
  limiteBytes: number;
  limiteOperacoes: number;
  /** Alguma operação foi descartada por falta de espaço: o desfazer não vai até o início. */
  truncado: boolean;
  /** Quantas operações foram descartadas desde o último `limparHistorico`. */
  descartadas: number;
  /** Por que houve descarte: teto de memória, teto de quantidade de ações, ou nenhum (null). */
  motivoTruncamento: 'memoria' | 'quantidade' | null;
  /**
   * A operação mais recente, sozinha, passa do teto de memória: ela foi mantida
   * (para não tirar o desfazer da ação que o usuário acabou de fazer) e o resto do
   * histórico foi esvaziado, refazer incluído.
   *
   * Atenção: isto descreve o momento do último descarte e não é atualizado pelo
   * desfazer/refazer. Para saber se dá para refazer AGORA, use `paraRefazer`: depois
   * de um `desfazer()` esta marca continua ligada e `paraRefazer` já vale 1.
   */
  umaOperacaoAcimaDoTeto: boolean;
}

interface Operacao extends ResumoOperacao {
  tx: Transacao;
  /** Avisos gerados ao sincronizar cadastros no fim da operação. */
  avisos: Aviso[];
}

const desfazerPilha: Operacao[] = [];
const refazerPilha: Operacao[] = [];
let proximoId = 1;
/** Máximo de operações guardadas (as mais antigas são descartadas). */
let limite = 200;
/**
 * Teto de memória estimada do histórico (padrão 150 MB).
 *
 * Medido: 60 meses carregados ocupam ~590 MB de árvore, mais até ~216 MB de
 * valores originais dos campos editados. Com 150 MB de histórico o total fica
 * em torno de 950 MB, que uma aba de navegador aguenta; com 300 MB passava de
 * 1,1 GB. Quem trabalha com um ano por vez (o recomendado) nunca chega perto.
 */
let limiteBytes = 150 * 1024 * 1024;
/** Soma de `bytesEstimados` das operações guardadas (desfazer + refazer). */
let bytesNoHistorico = 0;
let descartadas = 0;
let motivoTruncamento: 'memoria' | 'quantidade' | null = null;
let umaOperacaoAcimaDoTeto = false;
const ouvintes = new Set<() => void>();

function avisar(): void {
  for (const f of ouvintes) f();
}

/** Assina mudanças no histórico (para a interface habilitar botões). Devolve a função de cancelar. */
export function aoMudarHistorico(f: () => void): () => void {
  ouvintes.add(f);
  return () => ouvintes.delete(f);
}

/** Avisos de cadastro da última operação concluída (ex.: código sem 0150). */
let ultimosAvisos: Aviso[] = [];
export function avisosUltimaOperacao(): Aviso[] {
  return ultimosAvisos;
}

/** Refaz totais, cadastros e contadores das escriturações tocadas (dentro da transação atual). */
function derivar(tx: Transacao): Aviso[] {
  const avisos: Aviso[] = [];
  for (const e of [...tx.afetadas]) {
    atualizarTotais(e);
    avisos.push(...sincronizarCadastros(e));
    recontar(e);
  }
  return avisos;
}

function contar(tx: Transacao): number {
  return tx.cReg.length + tx.estrutura.length;
}

/**
 * Descarta as operações mais antigas até caber nos tetos de quantidade e de memória.
 * A operação mais recente nunca é descartada: se ela sozinha passar do teto, fica e o
 * resto do histórico é esvaziado (`umaOperacaoAcimaDoTeto`).
 */
function aparar(): void {
  umaOperacaoAcimaDoTeto = false;
  const porMemoria = () => bytesNoHistorico > limiteBytes;
  const estourou = () => porMemoria() || desfazerPilha.length > limite;
  while (desfazerPilha.length > 1 && estourou()) {
    motivoTruncamento = porMemoria() ? 'memoria' : 'quantidade';
    const velha = desfazerPilha.shift()!;
    bytesNoHistorico -= velha.bytesEstimados;
    descartadas++;
  }
  if (estourou() && refazerPilha.length) {
    // ainda estourado com uma única operação para desfazer: solta também o refazer
    motivoTruncamento = porMemoria() ? 'memoria' : 'quantidade';
    for (const op of refazerPilha) bytesNoHistorico -= op.bytesEstimados;
    descartadas += refazerPilha.length;
    refazerPilha.length = 0;
  }
  if (desfazerPilha.length === 1 && porMemoria()) umaOperacaoAcimaDoTeto = true;
}

/**
 * Executa `fn` como UMA operação desfazível. Chamadas aninhadas entram na operação
 * de fora. Se `fn` lançar erro, tudo o que ela alterou é desfeito e o erro é relançado.
 */
export function executar<T>(descricao: string, fn: () => T): T {
  const tx = abrirTransacao(descricao);
  if (!tx) return fn(); // aninhada
  try {
    const r = fn();
    const avisos = derivar(tx);
    fecharTransacao(tx);
    ultimosAvisos = avisos;
    if (!transacaoVazia(tx)) {
      desfazerPilha.push({
        id: proximoId++,
        descricao,
        quando: Date.now(),
        escrituracoes: [...tx.afetadas].map((e) => e.id),
        mudancas: contar(tx),
        bytesEstimados: tx.custoBytes,
        tx,
        avisos,
      });
      bytesNoHistorico += tx.custoBytes;
      for (const op of refazerPilha) bytesNoHistorico -= op.bytesEstimados;
      refazerPilha.length = 0;
      aparar();
      avisar();
    }
    return r;
  } catch (err) {
    fecharTransacao(tx);
    desfazerTransacao(tx);
    throw err;
  }
}

/**
 * Executa `fn` e desfaz tudo em seguida, sem deixar rastro no histórico nem marcar
 * escriturações como alteradas. Usado nas prévias: `fn` deve medir o efeito e devolvê-lo.
 * (Totais, cadastros e contadores não são refeitos na simulação.)
 */
export function simular<T>(fn: () => T): T {
  if (transacaoAtual()) throw new Error('Simulação não pode ser feita dentro de outra operação.');
  const tx = abrirTransacao('simulação')!;
  try {
    return fn();
  } finally {
    fecharTransacao(tx);
    desfazerTransacao(tx);
    for (const [e, a] of tx.alteradaAntes) {
      e.alterada = a;
      estadoDe(e).sujos.clear();
    }
  }
}

/** Desfaz a última operação. Devolve o resumo dela, ou null se não havia o que desfazer. */
export function desfazer(): ResumoOperacao | null {
  if (transacaoAtual()) throw new Error('Não é possível desfazer durante uma operação.');
  const op = desfazerPilha.pop();
  if (!op) return null;
  desfazerTransacao(op.tx);
  // contadores refletem a árvore atual (ex.: bloco M recalculado depois da operação)
  for (const e of op.tx.afetadas) {
    recontar(e);
    estadoDe(e).sujos.clear();
  }
  refazerPilha.push(op);
  avisar();
  return resumo(op);
}

/** Refaz a última operação desfeita. */
export function refazer(): ResumoOperacao | null {
  if (transacaoAtual()) throw new Error('Não é possível refazer durante uma operação.');
  const op = refazerPilha.pop();
  if (!op) return null;
  refazerTransacao(op.tx);
  for (const e of op.tx.afetadas) {
    recontar(e);
    estadoDe(e).sujos.clear();
  }
  desfazerPilha.push(op);
  avisar();
  return resumo(op);
}

function resumo(op: Operacao): ResumoOperacao {
  const { tx: _tx, avisos: _a, ...r } = op;
  return r;
}

export function podeDesfazer(): boolean {
  return desfazerPilha.length > 0;
}

export function podeRefazer(): boolean {
  return refazerPilha.length > 0;
}

/** Histórico para a tela (mais recente por último). */
export function historico(): { desfazer: ResumoOperacao[]; refazer: ResumoOperacao[] } {
  return { desfazer: desfazerPilha.map(resumo), refazer: refazerPilha.map(resumo).reverse() };
}

/** Esvazia o histórico (ex.: ao fechar escriturações). */
export function limparHistorico(): void {
  desfazerPilha.length = 0;
  refazerPilha.length = 0;
  bytesNoHistorico = 0;
  descartadas = 0;
  motivoTruncamento = null;
  umaOperacaoAcimaDoTeto = false;
  avisar();
}

/** Altera o número máximo de operações guardadas (descarta as mais antigas se precisar). */
export function definirLimiteHistorico(n: number): void {
  limite = Math.max(1, n);
  aparar();
  avisar();
}

/**
 * Altera o teto de memória estimada do histórico, em bytes (padrão 150 MB), descartando
 * na hora as operações mais antigas que não couberem. Mínimo de 1 MB.
 */
export function definirLimiteMemoriaHistorico(bytes: number): void {
  limiteBytes = Math.max(1024 * 1024, bytes);
  aparar();
  avisar();
}

/**
 * Quanto o histórico está ocupando (estimativa) e se já houve truncamento.
 *
 * Atenção: isto mede só o histórico. A memória de uma edição em lote é dominada pelos
 * valores originais guardados em cada registro (`Registro.antes`, do modelo) e pelos
 * novos valores dos campos, que continuam na árvore e NÃO são liberados ao truncar o
 * histórico (medido: ~520 B por registro editado, contra ~46 B por campo no histórico).
 *
 * Dá para montar a frase do rodapé só com este retorno, sem chamar `historico()`:
 *
 * ```ts
 * const u = usoHistorico();
 * let frase = u.paraDesfazer ? `Desfazer disponível para as últimas ${u.paraDesfazer} ações` : 'Nada a desfazer';
 * if (u.truncado) {
 *   frase += u.motivoTruncamento === 'memoria'
 *     ? ' (o histórico mais antigo foi descartado para economizar memória)'
 *     : ' (o histórico mais antigo foi descartado pelo limite de ações)';
 * }
 * ```
 */
export function usoHistorico(): UsoHistorico {
  return {
    operacoes: desfazerPilha.length + refazerPilha.length,
    paraDesfazer: desfazerPilha.length,
    paraRefazer: refazerPilha.length,
    bytesEstimados: bytesNoHistorico,
    limiteBytes,
    limiteOperacoes: limite,
    truncado: descartadas > 0,
    descartadas,
    motivoTruncamento,
    umaOperacaoAcimaDoTeto,
  };
}
