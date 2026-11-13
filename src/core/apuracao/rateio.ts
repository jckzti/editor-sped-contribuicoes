/**
 * Rateio proporcional dos créditos comuns (CST 53–56 e 63–66) pela receita bruta do 0111
 * e determinação do código do tipo de crédito (Tabela 4.3.6).
 */
import { ratearPartes } from '../dec';

/** Grupo de receita: 1 = tributada no mercado interno, 2 = não tributada no MI, 3 = exportação. */
export type Grupo = 1 | 2 | 3;

export interface Receitas0111 {
  /** REC_BRU_NCUM_TRIB_MI */
  1: number;
  /** REC_BRU_NCUM_NT_MI */
  2: number;
  /** REC_BRU_NCUM_EXP */
  3: number;
}

/** Grupos de receita a que o CST de crédito se vincula (guia, M100 campo 02 e M105 campo 07). */
export function gruposDoCst(cst: string): Grupo[] {
  const n = Number(cst);
  const d = n >= 60 ? n - 60 : n - 50;
  switch (d) {
    case 0:
      return [1];
    case 1:
      return [2];
    case 2:
      return [3];
    case 3:
      return [1, 2];
    case 4:
      return [1, 3];
    case 5:
      return [2, 3];
    case 6:
      return [1, 2, 3];
    default:
      return [];
  }
}

/** CST vinculado a mais de um tipo de receita (exige rateio ou apropriação direta). */
export function cstComum(cst: string): boolean {
  return gruposDoCst(cst).length > 1;
}

/**
 * Parcela da base de cada grupo, proporcional à receita do grupo, com soma das parcelas
 * igual ao total (maior resto; ver `ratearPartes`). Com dois grupos dá o mesmo que
 * arredondar cada parcela meio para cima, como na amostra (2.342.708,39 → 2.307.164,18 +
 * 35.544,21). Devolve null quando o denominador é zero (sem receita nos grupos do CST).
 */
export function ratearPorGrupos(total: number, grupos: Grupo[], rec: Receitas0111): Map<Grupo, number> | null {
  const out = new Map<Grupo, number>();
  if (grupos.length === 1) {
    out.set(grupos[0], total);
    return out;
  }
  const denom = grupos.reduce((s, g) => s + rec[g], 0);
  if (denom <= 0) return null;
  const parcelas = ratearPartes(total, grupos.map((g) => rec[g]));
  grupos.forEach((g, i) => out.set(g, parcelas[i]));
  return out;
}

/**
 * Tipo do crédito (2 últimos dígitos do COD_CRED):
 * 08 importação (CFOP 3xxx ou IND_ORIG_CRED = 1); 06/07 crédito presumido (CST 60–66);
 * 01 alíquota básica; 02 alíquotas diferenciadas.
 */
export function tipoCredito(op: { cst: string; aliq: bigint; importacao: boolean }, aliqBasica: bigint, tipoPresumido: string): string {
  if (op.importacao) return '08';
  if (Number(op.cst) >= 60) return tipoPresumido;
  return op.aliq === aliqBasica ? '01' : '02';
}

/** Grupo de receita (1/2/3) de um COD_CRED ("101" → 1). */
export function grupoDoCodCred(codCred: string): Grupo | null {
  const g = Number(codCred[0]);
  return g === 1 || g === 2 || g === 3 ? g : null;
}
