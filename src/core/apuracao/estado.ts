/**
 * Estado do motor por escrituração: o que foi capturado/aprendido do arquivo original
 * em `registrarOriginal` e o resultado do último recálculo (pendências).
 */
import type { Escrituracao } from '../modelo';
import type { PendenciaNaturezaReceita, RegraEstorno, ResumoApuracao } from './contrato';
import type { MapaNatureza, NaturezaOriginal } from './natureza';
import type { MapaPresumido } from './presumido';
import type { IdTributo } from './tributos';

export interface EstadoTributo {
  /** Enquadramentos de alíquota diferenciada do bloco M original. */
  aliquotasDiferenciadas: ReadonlyMap<bigint, string>;
  /** Insumos dos créditos originais, quando o bloco M tem divisão entre regimes. */
  dadosCreditoCompartilhado: readonly string[] | null;
  /** Notas (chave completa, `chaveNotaCompleta`) cujo ajuste M110/M510 é derivado da nota e recalculado. */
  docsVinculados: Set<string>;
  /** Número+data (`chaveNota`) das notas vinculadas: é por ele que se acha o M110 da nota. */
  vinculadosCurto: Set<string>;
  /** Número+data de ajustes/notas que não puderam ser ligados por haver mais de uma nota candidata → descrição. */
  ambiguos: Map<string, string>;
  /** Notas elegíveis a estorno que no original NÃO tinham ajuste: o motor não cria. */
  docsSemEstorno: Set<string>;
  /** Regras de estorno aprendidas neste arquivo. */
  regras: RegraEstorno[];
  /** NUM_CAMPO do M205/M605 → COD_REC do original. */
  codRec: Record<string, string>;
  /** Por CST: chave de natureza da receita aprendida. */
  naturezas: Record<string, MapaNatureza>;
  /** Por CST: M410/M810 do original. */
  naturezaOriginal: Record<string, NaturezaOriginal>;
  /** CSTs cuja divisão por natureza tem mais de uma explicação (nenhuma chave aceita). */
  naturezaAmbigua: string[];
  /** Tipo usado para crédito presumido ("06" agroindústria ou "07" outros) quando o original só ensina um. */
  tipoPresumido: string;
  /** O que o original ensina sobre crédito presumido: tipo (06/07) por alíquota e por alíquota+NAT_BC_CRED+CST. */
  presumido: MapaPresumido;
  /**
   * Créditos que o ORIGINAL deixou de descontar de propósito: M100/M500 com SLD_CRED > 0
   * enquanto ainda sobrava contribuição não cumulativa a recolher no M200/M600 (sinal de
   * crédito guardado para ressarcimento ou compensação). Por COD_CRED, em centavos.
   */
  retencaoOriginal: Record<string, { disponivel: number; descontado: number }>;
}

/** Fatos do arquivo ORIGINAL sobre saldo credor e ordem de uso (para `indiciosCriterios`). */
export interface FatosSaldoOriginal {
  /** 1100/1500 de períodos anteriores ao da escrituração. */
  anteriores: { tributo: string; per: string; codCred: string; usado: number; sobra: number }[];
  /** 1100/1500 do próprio período com saldo ao fim (crédito do mês guardado). */
  proprios: { tributo: string; codCred: string; saldo: number }[];
  /** Por tributo: usou crédito antigo enquanto sobrava do mês (ant) ou o contrário (mes). */
  ordem: { tributo: string; voto: 'anteriores-primeiro' | 'mes-primeiro' }[];
}

export interface EstadoApuracao {
  /** Fatos do original sobre saldo credor (indícios dos critérios). */
  fatosSaldo: FatosSaldoOriginal;
  resumoOriginal: ResumoApuracao;
  tributos: Record<IdTributo, EstadoTributo>;
  /** Receita por tipo calculada dos documentos originais (para o 0111 "ajustar-pelo-delta"). */
  receitaOriginal: { trib: number; nt: number; exp: number; cum: number };
  /** Campos do 0111 original (centavos): TRIB, NT, EXP, CUM, TOTAL. */
  original0111: [number, number, number, number, number] | null;
  /** Pendências de natureza da receita do último recálculo. */
  pendencias: PendenciaNaturezaReceita[];
}

const estados = new WeakMap<Escrituracao, EstadoApuracao>();

export function estadoDe(e: Escrituracao): EstadoApuracao | undefined {
  return estados.get(e);
}

export function guardarEstado(e: Escrituracao, s: EstadoApuracao): void {
  estados.set(e, s);
}
