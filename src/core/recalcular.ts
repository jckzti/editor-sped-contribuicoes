/**
 * Orquestrador do recálculo: para cada escrituração alterada (ou todas):
 * totais dos documentos → cadastros → apuração (todas as escriturações juntas, pois o
 * saldo credor encadeia meses) → contadores.
 *
 * Recalcular duas vezes seguidas não muda nada; recalcular uma escrituração não editada
 * a deixa byte a byte igual ao original (desde que a apuração também não a altere).
 * As mudanças feitas aqui não entram no histórico de desfazer (são derivadas).
 */
import { recalcularApuracao, resumoApuracao, type ConfigApuracao, type ResultadoApuracao, type ResumoApuracao } from './apuracao';
import { sincronizarCadastros } from './cadastros';
import { recontar } from './contadores';
import type { Aviso, Escrituracao } from './modelo';
import { transacaoAtual } from './mutacao';
import { atualizarTotais } from './totais';
import { periodoIso } from './util';

/** Função de apuração injetável (padrão: `recalcularApuracao`). null = não apurar. */
export type FuncaoApuracao = (escrituracoes: Escrituracao[], config: ConfigApuracao) => ResultadoApuracao[] | null;

/** Apuração que não faz nada (para testes e para recalcular só documentos/contadores). */
export const apuracaoNula: FuncaoApuracao = () => null;

export interface OpcoesRecalculo {
  /** Recalcular todas as escriturações, não só as alteradas. */
  todas?: boolean;
  /** Função de apuração (injeção). Padrão: `recalcularApuracao` do motor de apuração. */
  apuracao?: FuncaoApuracao;
  /** Função de resumo da apuração (padrão: `resumoApuracao`). */
  resumo?: (e: Escrituracao) => ResumoApuracao;
}

export interface RelatorioRecalculo {
  escrituracaoId: string;
  nomeArquivo: string;
  /** "AAAA-MM" */
  periodo: string;
  /** Teve totais/cadastros recalculados (era alterada ou `todas`). */
  processada: boolean;
  avisos: Aviso[];
  /** Resultado da apuração desta escrituração (ausente se a apuração não rodou). */
  apuracao?: ResultadoApuracao;
  /** Resumo do bloco M depois do recálculo (ausente se indisponível). */
  resumo?: ResumoApuracao;
  /** Linhas por tipo de registro. */
  contagens: Record<string, number>;
  totalLinhas: number;
  /** Campos alterados automaticamente neste recálculo (totais + contadores). */
  alteracoesAutomaticas: number;
}

function ehNaoImplementado(err: unknown): boolean {
  return /não implementad/i.test(String((err as Error)?.message ?? err));
}

/**
 * Recalcula as escriturações e devolve um relatório por escrituração envolvida.
 * Não pode ser chamado durante uma operação.
 */
export function recalcular(escrituracoes: Escrituracao[], config: ConfigApuracao, opcoes: OpcoesRecalculo = {}): RelatorioRecalculo[] {
  if (transacaoAtual()) throw new Error('recalcular não pode ser chamado dentro de uma operação.');
  const alvo = opcoes.todas ? escrituracoes : escrituracoes.filter((e) => e.alterada);
  const rel = new Map<Escrituracao, RelatorioRecalculo>();
  const relDe = (e: Escrituracao): RelatorioRecalculo => {
    let r = rel.get(e);
    if (!r) {
      r = { escrituracaoId: e.id, nomeArquivo: e.nomeArquivo, periodo: periodoIso(e.periodo), processada: false, avisos: [], contagens: {}, totalLinhas: 0, alteracoesAutomaticas: 0 };
      rel.set(e, r);
    }
    return r;
  };

  // 1) totais e cadastros
  for (const e of alvo) {
    const r = relDe(e);
    r.processada = true;
    r.alteracoesAutomaticas += atualizarTotais(e, true);
    r.avisos.push(...sincronizarCadastros(e));
  }

  // 2) apuração de todas juntas (encadeamento do saldo credor entre meses)
  let apuradas: Escrituracao[] = [];
  let apuracaoDisponivel = false;
  if (alvo.length) {
    const fn = opcoes.apuracao ?? recalcularApuracao;
    try {
      const resultados = fn(escrituracoes, config);
      if (resultados) {
        apuracaoDisponivel = true;
        apuradas = escrituracoes;
        for (const ra of resultados) {
          const e = escrituracoes.find((x) => x.id === ra.escrituracaoId);
          if (!e) continue;
          const r = relDe(e);
          r.apuracao = ra;
          r.avisos.push(...ra.avisos);
        }
      }
    } catch (err) {
      for (const e of alvo) {
        relDe(e).avisos.push(
          ehNaoImplementado(err)
            ? { nivel: 'alerta', codigo: 'APURACAO_INDISPONIVEL', mensagem: 'O motor de apuração (bloco M) ainda não está disponível: o bloco M ficou como no arquivo original.' }
            : { nivel: 'erro', codigo: 'APURACAO_ERRO', mensagem: `Erro ao recalcular a apuração: ${(err as Error).message ?? String(err)}. O bloco M pode estar inconsistente.` },
        );
      }
    }
  }

  // 3) contadores (de quem foi processado ou apurado)
  const resumo = opcoes.resumo ?? resumoApuracao;
  for (const e of new Set([...alvo, ...apuradas])) {
    const r = relDe(e);
    const c = recontar(e);
    r.contagens = c.porTipo;
    r.totalLinhas = c.totalLinhas;
    r.alteracoesAutomaticas += c.alteracoes;
    if (apuracaoDisponivel || opcoes.resumo) {
      try {
        r.resumo = resumo(e);
      } catch {
        /* resumo indisponível */
      }
    }
  }
  return [...rel.values()];
}
