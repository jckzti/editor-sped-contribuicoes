/**
 * Primitivas de alteração da árvore com registro para desfazer.
 *
 * Cada transação estima quanta memória ocupa no histórico (`custoBytes`), para que
 * `operacao.ts` possa impor um teto. A estimativa é calibrada por medição (ver as
 * constantes BYTES_*): o custo de uma mudança de campo é dominado pelos quatro slots
 * de array guardados (registro, índice, valor antes, valor depois); os textos em si
 * continuam vivos na árvore (`campos`) e em `antes`, não no histórico.
 *
 * Toda alteração feita pelo motor passa por aqui (`alterar`, `inserir`, `remover`,
 * `registrarAcao`). Se houver uma transação aberta, a alteração é anotada nela;
 * sem transação (ex.: recálculo de totais e contadores em `recalcular`) a alteração
 * é só aplicada.
 *
 * As mudanças de campo ficam em arrays paralelos (registro, índice, de, para) para
 * caber em memória mesmo quando uma regra mexe em centenas de milhares de itens.
 */
import { idx, ordemRegistro, type Escrituracao, type Registro } from './modelo';
import { estadoDe, posicaoDeInsercao } from './estado';

export interface Transacao {
  descricao: string;
  /** Escriturações tocadas (para invalidar caches e recontar ao desfazer). */
  afetadas: Set<Escrituracao>;
  /** Valor de `e.alterada` antes da transação tocar a escrituração. */
  alteradaAntes: Map<Escrituracao, boolean>;
  // mudanças de campo, em paralelo
  cReg: Registro[];
  cIdx: number[];
  cDe: string[];
  cPara: string[];
  /** Mudanças de estrutura, na ordem em que ocorreram. */
  estrutura: { tipo: 'ins' | 'rem'; e: Escrituracao; r: Registro; pai: Registro; pos: number }[];
  /** Ações livres (ex.: ajuste de resíduo de total), com suas funções de desfazer/refazer. */
  acoes: { e: Escrituracao; desfazer: () => void; refazer: () => void }[];
  /** Memória estimada que esta transação ocupa no histórico, em bytes. */
  custoBytes: number;
}

/**
 * Custos estimados em bytes, medidos no Node 26 (x64) com `--expose-gc`:
 * uma regra sobre 55.368 itens (119.904 mudanças de campo) ocupou 5,3 MB de histórico,
 * ou seja ~46 B por mudança de campo.
 */
export const BYTES_POR_CAMPO = 48;
/** Entrada de inclusão/exclusão (o objeto da lista; a subárvore excluída é mantida viva pelo registro de exclusões, não pelo histórico). */
export const BYTES_POR_ESTRUTURA = 96;
/** Ação livre: duas closures. */
export const BYTES_POR_ACAO = 200;

let atual: Transacao | null = null;

export function transacaoAtual(): Transacao | null {
  return atual;
}

export function novaTransacao(descricao: string): Transacao {
  return { descricao, afetadas: new Set(), alteradaAntes: new Map(), cReg: [], cIdx: [], cDe: [], cPara: [], estrutura: [], acoes: [], custoBytes: 0 };
}

/** Abre uma transação (não aninha: se já houver uma, devolve null e as mudanças vão para a existente). */
export function abrirTransacao(descricao: string): Transacao | null {
  if (atual) return null;
  atual = novaTransacao(descricao);
  return atual;
}

export function fecharTransacao(t: Transacao): void {
  if (atual === t) atual = null;
}

export function transacaoVazia(t: Transacao): boolean {
  return t.cReg.length === 0 && t.estrutura.length === 0 && t.acoes.length === 0;
}

/** Mesma semântica de `set()` do modelo, por índice (guarda o original em `antes`). */
function gravarIdx(r: Registro, i: number, valor: string): void {
  const v = r.campos[i] ?? '';
  if (v === valor) return;
  if (r.estado !== 'novo') {
    r.antes ??= {};
    if (!(i in r.antes)) r.antes[i] = v;
    else if (r.antes[i] === valor) delete r.antes[i];
    r.estado = Object.keys(r.antes).length ? 'editado' : undefined;
    if (!r.estado) delete r.antes;
  }
  while (r.campos.length <= i) r.campos.push('');
  r.campos[i] = valor;
}

/**
 * Primeira coisa a fazer em toda alteração: garante que o estado original da
 * escrituração já esteja capturado (resíduos de totais, uso de cadastros,
 * estabelecimentos vazios) ANTES de a árvore mudar, e anota a escrituração na
 * transação atual.
 */
function tocar(e: Escrituracao): void {
  estadoDe(e);
  if (atual && !atual.afetadas.has(e)) {
    atual.alteradaAntes.set(e, e.alterada);
    atual.afetadas.add(e);
  }
}

function marcarSujo(e: Escrituracao, r: Registro): void {
  if ((r.reg === 'C170' || r.reg === 'C501' || r.reg === 'C505' || r.reg === 'A170') && r.pai) estadoDe(e).sujos.add(r.pai);
}

/**
 * Altera um campo (por nome ou índice). Devolve true se mudou algo.
 * Marca a escrituração como alterada e o documento como "sujo" (totais a refazer).
 */
export function alterar(e: Escrituracao, r: Registro, campo: string | number, valor: string): boolean {
  const i = typeof campo === 'number' ? campo : idx(r.reg, campo);
  const de = r.campos[i] ?? '';
  if (de === valor) return false;
  tocar(e);
  gravarIdx(r, i, valor);
  const st = estadoDe(e);
  st.versaoValores++;
  if (r.reg[0] === '0') st.versao++; // cadastro mudou: índices precisam ser refeitos
  e.alterada = true;
  marcarSujo(e, r);
  if (atual) {
    atual.cReg.push(r);
    atual.cIdx.push(i);
    atual.cDe.push(de);
    atual.cPara.push(valor);
    atual.custoBytes += BYTES_POR_CAMPO;
  }
  return true;
}

/**
 * Insere `r` sob `pai`. Sem `pos`, usa a posição do arquivo original (se o registro já
 * existiu) ou a ordem do leiaute (depois dos irmãos do mesmo tipo).
 */
export function inserir(e: Escrituracao, pai: Registro, r: Registro, pos?: number): void {
  tocar(e);
  const p = pos ?? posicaoDeInsercao(pai, r, (reg) => ordemRegistro[reg] ?? Number.MAX_SAFE_INTEGER);
  pai.filhos.splice(p, 0, r);
  r.pai = pai;
  const st = estadoDe(e);
  st.excluidos.delete(r);
  st.versao++;
  e.alterada = true;
  marcarSujo(e, r);
  if (atual) {
    atual.estrutura.push({ tipo: 'ins', e, r, pai, pos: p });
    atual.custoBytes += BYTES_POR_ESTRUTURA;
  }
}

/** Remove o registro (com sua subárvore). */
export function remover(e: Escrituracao, r: Registro): void {
  const pai = r.pai;
  if (!pai) return;
  const pos = pai.filhos.indexOf(r);
  if (pos < 0) return;
  tocar(e);
  marcarSujo(e, r);
  pai.filhos.splice(pos, 1);
  r.pai = null;
  const st = estadoDe(e);
  if (r.estado !== 'novo') st.excluidos.set(r, pai);
  st.sujos.delete(r);
  st.versao++;
  e.alterada = true;
  if (atual) {
    atual.estrutura.push({ tipo: 'rem', e, r, pai, pos });
    atual.custoBytes += BYTES_POR_ESTRUTURA;
  }
}

/** Anota uma ação livre na transação (ex.: mudança de resíduo de total) e a executa. */
export function registrarAcao(e: Escrituracao, refazer: () => void, desfazer: () => void): void {
  tocar(e);
  refazer();
  e.alterada = true;
  if (atual) {
    atual.acoes.push({ e, desfazer, refazer });
    atual.custoBytes += BYTES_POR_ACAO;
  }
}

function aposEstrutura(e: Escrituracao, r: Registro, pai: Registro): void {
  const st = estadoDe(e);
  if (r.pai) st.excluidos.delete(r);
  else if (r.estado !== 'novo') st.excluidos.set(r, pai);
  st.versao++;
  e.alterada = true;
}

/** Desfaz uma transação inteira (ordem inversa). Não pode haver transação aberta. */
export function desfazerTransacao(t: Transacao): void {
  for (let k = t.acoes.length - 1; k >= 0; k--) t.acoes[k].desfazer();
  for (let k = t.estrutura.length - 1; k >= 0; k--) {
    const m = t.estrutura[k];
    if (m.tipo === 'ins') {
      const i = m.pai.filhos.indexOf(m.r);
      if (i >= 0) m.pai.filhos.splice(i, 1);
      m.r.pai = null;
    } else {
      m.pai.filhos.splice(Math.min(m.pos, m.pai.filhos.length), 0, m.r);
      m.r.pai = m.pai;
    }
    aposEstrutura(m.e, m.r, m.pai);
  }
  for (let k = t.cReg.length - 1; k >= 0; k--) gravarIdx(t.cReg[k], t.cIdx[k], t.cDe[k]);
  for (const e of t.afetadas) {
    const st = estadoDe(e);
    st.versao++;
    st.versaoValores++;
    e.alterada = true;
  }
}

/** Refaz uma transação desfeita (ordem direta). */
export function refazerTransacao(t: Transacao): void {
  for (let k = 0; k < t.cReg.length; k++) gravarIdx(t.cReg[k], t.cIdx[k], t.cPara[k]);
  for (const m of t.estrutura) {
    if (m.tipo === 'ins') {
      m.pai.filhos.splice(Math.min(m.pos, m.pai.filhos.length), 0, m.r);
      m.r.pai = m.pai;
    } else {
      const i = m.pai.filhos.indexOf(m.r);
      if (i >= 0) m.pai.filhos.splice(i, 1);
      m.r.pai = null;
    }
    aposEstrutura(m.e, m.r, m.pai);
  }
  for (const a of t.acoes) a.refazer();
  for (const e of t.afetadas) {
    const st = estadoDe(e);
    st.versao++;
    st.versaoValores++;
    e.alterada = true;
  }
}

/** Marca da transação atual para desfazer parcialmente (ex.: um documento da importação que falhou). */
export interface PontoSalvamento {
  t: Transacao;
  campos: number;
  estrutura: number;
  acoes: number;
}

export function pontoDeSalvamento(): PontoSalvamento | null {
  if (!atual) return null;
  return { t: atual, campos: atual.cReg.length, estrutura: atual.estrutura.length, acoes: atual.acoes.length };
}

/** Desfaz o que foi feito na transação depois do ponto (as mudanças saem da transação). */
export function voltarAte(p: PontoSalvamento | null): void {
  if (!p) return;
  const t = p.t;
  const parcial = novaTransacao('parcial');
  parcial.afetadas = t.afetadas;
  parcial.alteradaAntes = t.alteradaAntes;
  parcial.cReg = t.cReg.splice(p.campos);
  parcial.cIdx = t.cIdx.splice(p.campos);
  parcial.cDe = t.cDe.splice(p.campos);
  parcial.cPara = t.cPara.splice(p.campos);
  parcial.estrutura = t.estrutura.splice(p.estrutura);
  parcial.acoes = t.acoes.splice(p.acoes);
  parcial.custoBytes = parcial.cReg.length * BYTES_POR_CAMPO + parcial.estrutura.length * BYTES_POR_ESTRUTURA + parcial.acoes.length * BYTES_POR_ACAO;
  t.custoBytes -= parcial.custoBytes;
  desfazerTransacao(parcial);
}
