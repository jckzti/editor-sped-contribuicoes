/**
 * Leituras puras da árvore (não alteram nada): somas de itens dos documentos e
 * uso de cadastros. Ficam aqui para que o estado de edição possa capturar o
 * "original" sem depender dos módulos que alteram a árvore.
 */
import { idx, leiaute, type Escrituracao, type Registro } from './modelo';
import { centavosRapido } from './util';

/** Totais do C100 derivados dos C170: [campo do C100, campo do C170]. */
export const DERIVADOS_C100: readonly (readonly [string, string])[] = [
  ['VL_MERC', 'VL_ITEM'],
  ['VL_BC_ICMS', 'VL_BC_ICMS'],
  ['VL_ICMS', 'VL_ICMS'],
  ['VL_BC_ICMS_ST', 'VL_BC_ICMS_ST'],
  ['VL_ICMS_ST', 'VL_ICMS_ST'],
  ['VL_IPI', 'VL_IPI'],
  ['VL_PIS', 'VL_PIS'],
  ['VL_COFINS', 'VL_COFINS'],
];
/** Nomes dos campos do C100 recalculados a partir dos itens (inclui VL_DOC). */
export const CAMPOS_C100_DERIVADOS = new Set([...DERIVADOS_C100.map((d) => d[0]), 'VL_DOC']);

const iC100 = DERIVADOS_C100.map(([c]) => idx('C100', c));
const iC170 = DERIVADOS_C100.map(([, c]) => idx('C170', c));
const iItem = idx('C170', 'VL_ITEM');
const iDescItem = idx('C170', 'VL_DESC');
const iIpi = idx('C170', 'VL_IPI');
const iSt = idx('C170', 'VL_ICMS_ST');
export const I_C100_VL_DOC = idx('C100', 'VL_DOC');
export { iC100 as I_C100_DERIVADOS };

/**
 * Somas dos itens de um C100, em centavos, na ordem de DERIVADOS_C100, seguidas
 * da base do VL_DOC: Σ(VL_ITEM + VL_IPI + VL_ICMS_ST) [− VL_DESC se `comDesconto`].
 */
export function somasC100(c100: Registro, comDesconto: boolean): number[] {
  const s = new Array<number>(DERIVADOS_C100.length + 1).fill(0);
  for (const it of c100.filhos) {
    if (it.reg !== 'C170') continue;
    const c = it.campos;
    for (let k = 0; k < iC170.length; k++) s[k] += centavosRapido(c[iC170[k]]);
    s[iC170.length] += centavosRapido(c[iItem]) + centavosRapido(c[iIpi]) + centavosRapido(c[iSt]) - (comDesconto ? centavosRapido(c[iDescItem]) : 0);
  }
  return s;
}

/** Valores atuais dos totais derivados do C100 (mesma ordem de `somasC100`). */
export function totaisC100(c100: Registro): number[] {
  return [...iC100.map((i) => centavosRapido(c100.campos[i])), centavosRapido(c100.campos[I_C100_VL_DOC])];
}

/** Totais do A100 derivados dos A170 (soma dos itens + resíduo do original): [campo do A100, campo do A170]. */
export const DERIVADOS_A100: readonly (readonly [string, string])[] = [
  ['VL_BC_PIS', 'VL_BC_PIS'],
  ['VL_PIS', 'VL_PIS'],
  ['VL_BC_COFINS', 'VL_BC_COFINS'],
  ['VL_COFINS', 'VL_COFINS'],
];
export const CAMPOS_A100_DERIVADOS = new Set(DERIVADOS_A100.map((d) => d[0]));
export const I_A100 = DERIVADOS_A100.map(([c]) => idx('A100', c));
const iA170 = DERIVADOS_A100.map(([, c]) => idx('A170', c));

/** Somas dos A170 de um A100, em centavos, na ordem de DERIVADOS_A100. */
export function somasA100(a100: Registro): number[] {
  const s = new Array<number>(DERIVADOS_A100.length).fill(0);
  for (const it of a100.filhos) {
    if (it.reg !== 'A170') continue;
    for (let k = 0; k < iA170.length; k++) s[k] += centavosRapido(it.campos[iA170[k]]);
  }
  return s;
}

/** Valores atuais dos totais derivados do A100 (ordem de `somasA100`). */
export function totaisA100(a100: Registro): number[] {
  return I_A100.map((i) => centavosRapido(a100.campos[i]));
}

const iC500Pis = idx('C500', 'VL_PIS');
const iC500Cofins = idx('C500', 'VL_COFINS');
const iC501Pis = idx('C501', 'VL_PIS');
const iC505Cofins = idx('C505', 'VL_COFINS');
export const I_C500 = { VL_PIS: iC500Pis, VL_COFINS: iC500Cofins };

/** [ΣC501.VL_PIS, ΣC505.VL_COFINS] em centavos. */
export function somasC500(c500: Registro): number[] {
  let pis = 0;
  let cofins = 0;
  for (const f of c500.filhos) {
    if (f.reg === 'C501') pis += centavosRapido(f.campos[iC501Pis]);
    else if (f.reg === 'C505') cofins += centavosRapido(f.campos[iC505Cofins]);
  }
  return [pis, cofins];
}

export function totaisC500(c500: Registro): number[] {
  return [centavosRapido(c500.campos[iC500Pis]), centavosRapido(c500.campos[iC500Cofins])];
}

/**
 * Decide, pelos dados do próprio arquivo, se o VL_DOC das notas desconta o VL_DESC
 * dos itens. Há ERPs que usam o VL_DESC do C170 para outra coisa (ex.: ICMS excluído
 * da base de PIS/COFINS) e não o descontam do VL_DOC. Ganha a fórmula que bate com
 * mais notas; empate (ou nenhuma nota) = desconta, como manda o leiaute.
 */
export function detectarVlDocComDesconto(e: Escrituracao): boolean {
  let com = 0;
  let sem = 0;
  const iFrt = idx('C100', 'VL_FRT');
  const iSeg = idx('C100', 'VL_SEG');
  const iOut = idx('C100', 'VL_OUT_DA');
  const iDesc = idx('C100', 'VL_DESC');
  for (const c010 of blocoFilhos(e, 'C001', 'C010')) {
    for (const c100 of c010.filhos) {
      if (c100.reg !== 'C100' || !c100.filhos.some((f) => f.reg === 'C170')) continue;
      const c = c100.campos;
      const extra = centavosRapido(c[iFrt]) + centavosRapido(c[iSeg]) + centavosRapido(c[iOut]) - centavosRapido(c[iDesc]);
      const vlDoc = centavosRapido(c[I_C100_VL_DOC]);
      const sCom = somasC100(c100, true)[DERIVADOS_C100.length] + extra;
      const sSem = somasC100(c100, false)[DERIVADOS_C100.length] + extra;
      if (sCom === vlDoc) com++;
      if (sSem === vlDoc) sem++;
    }
  }
  return com >= sem;
}

/**
 * Fórmula do VL_DOC por nota: true = desconta o VL_DESC dos itens, false = não desconta.
 * Só entram as notas em que UMA das fórmulas fecha; nas demais (as duas fecham ou nenhuma)
 * vale a fórmula do arquivo (`detectarVlDocComDesconto`). Num ERP que mistura as duas
 * (ex.: por tipo de nota), cada nota editada continua com a fórmula que fechava nela.
 */
export function detectarVlDocPorNota(e: Escrituracao): Map<Registro, boolean> {
  const out = new Map<Registro, boolean>();
  const iFrt = idx('C100', 'VL_FRT');
  const iSeg = idx('C100', 'VL_SEG');
  const iOut = idx('C100', 'VL_OUT_DA');
  const iDesc = idx('C100', 'VL_DESC');
  for (const c010 of blocoFilhos(e, 'C001', 'C010')) {
    for (const c100 of c010.filhos) {
      if (c100.reg !== 'C100' || !c100.filhos.some((f) => f.reg === 'C170')) continue;
      const c = c100.campos;
      const extra = centavosRapido(c[iFrt]) + centavosRapido(c[iSeg]) + centavosRapido(c[iOut]) - centavosRapido(c[iDesc]);
      const vlDoc = centavosRapido(c[I_C100_VL_DOC]);
      const com = somasC100(c100, true)[DERIVADOS_C100.length] + extra === vlDoc;
      const sem = somasC100(c100, false)[DERIVADOS_C100.length] + extra === vlDoc;
      if (com !== sem) out.set(c100, com);
    }
  }
  return out;
}

const iIcmsItem = idx('C170', 'VL_ICMS');

/**
 * O ERP grava o ICMS do item no VL_DESC do C170? (maioria dos itens com ICMS tem
 * VL_DESC = VL_ICMS, com pelo menos 3 itens). Há ERPs que usam o VL_DESC para levar a
 * exclusão do ICMS da base de PIS/COFINS; nesse caso "valor − desconto − ICMS" tiraria o
 * ICMS duas vezes.
 */
export function detectarDescontoEhIcms(e: Escrituracao): boolean {
  let comIcms = 0;
  let igual = 0;
  for (const c010 of blocoFilhos(e, 'C001', 'C010')) {
    for (const c100 of c010.filhos) {
      if (c100.reg !== 'C100') continue;
      for (const it of c100.filhos) {
        if (it.reg !== 'C170') continue;
        const icms = centavosRapido(it.campos[iIcmsItem]);
        if (!(icms > 0)) continue;
        comIcms++;
        if (centavosRapido(it.campos[iDescItem]) === icms) igual++;
      }
    }
  }
  return igual >= 3 && igual * 2 > comIcms;
}

/** Filhos `reg` dos registros de abertura `abertura` (ex.: todos os C010 sob C001). */
export function blocoFilhos(e: Escrituracao, abertura: string, reg: string): Registro[] {
  const out: Registro[] = [];
  for (const b of e.raiz.filhos) {
    if (b.reg !== abertura) continue;
    for (const f of b.filhos) if (f.reg === reg) out.push(f);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Uso de cadastros
// ---------------------------------------------------------------------------

export type TipoCadastro = 'part' | 'item' | 'unid' | 'nat';

/** Códigos usados por estabelecimento (CNPJ do x010) e no arquivo todo (contas). */
export interface UsoCadastros {
  /** CNPJ do estabelecimento → tipo → códigos. */
  porEstab: Map<string, Record<TipoCadastro, Set<string>>>;
  /** Uso fora de um estabelecimento (blocos M, 1...): protege o cadastro em todos os estabelecimentos. */
  global: Record<TipoCadastro, Set<string>>;
  /** COD_CTA usados em qualquer registro (0500 é do arquivo inteiro). */
  contas: Set<string>;
}

/** Registros que DEFINEM os cadastros (não contam como uso). */
const DEFINE: Record<string, string> = { '0150': 'COD_PART', '0200': 'COD_ITEM', '0190': 'UNID', '0400': 'COD_NAT', '0500': 'COD_CTA' };
const CAMPO_TIPO: Record<string, TipoCadastro | 'cta'> = { COD_PART: 'part', COD_ITEM: 'item', UNID: 'unid', UNID_INV: 'unid', COD_NAT: 'nat', COD_CTA: 'cta' };

/** reg → lista de [índice do campo, tipo] das referências a cadastro. */
const refsPorReg: Record<string, [number, TipoCadastro | 'cta'][]> = {};
for (const [reg, def] of Object.entries(leiaute.registros)) {
  const lista: [number, TipoCadastro | 'cta'][] = [];
  def.campos.forEach((c, i) => {
    const t = CAMPO_TIPO[c.nome];
    if (t && DEFINE[reg] !== c.nome) lista.push([i, t]);
  });
  if (lista.length) refsPorReg[reg] = lista;
}

export function novoUsoTipo(): Record<TipoCadastro, Set<string>> {
  return { part: new Set(), item: new Set(), unid: new Set(), nat: new Set() };
}

/** Registros de identificação de estabelecimento nos blocos de documentos. */
const X010 = new Set(['A010', 'C010', 'D010', 'F010', 'I010', 'P010']);

/**
 * Levanta todos os códigos de cadastro usados nos documentos (fora do bloco 0).
 * Se `incluir0200` for true, inclui também o uso de unidades pelos 0200 (UNID_INV).
 */
export function usoCadastros(e: Escrituracao, incluir0200 = false): UsoCadastros {
  const uso: UsoCadastros = { porEstab: new Map(), global: novoUsoTipo(), contas: new Set() };
  const visita = (r: Registro, alvo: Record<TipoCadastro, Set<string>>) => {
    const refs = refsPorReg[r.reg];
    if (refs) {
      for (const [i, t] of refs) {
        const v = r.campos[i];
        if (!v) continue;
        if (t === 'cta') uso.contas.add(v);
        else alvo[t].add(v);
      }
    }
    for (const f of r.filhos) visita(f, alvo);
  };
  for (const bloco of e.raiz.filhos) {
    if (bloco.reg === '0001') {
      // bloco 0: só contas (0500 não é uso) e, se pedido, UNID_INV dos 0200
      for (const r0 of bloco.filhos) {
        if (r0.reg === '0140') {
          const cnpj = r0.campos[idx('0140', 'CNPJ')] ?? '';
          const alvo = mapaEstab(uso, cnpj);
          for (const cad of r0.filhos) {
            if (cad.reg === '0200' && incluir0200) {
              const u = cad.campos[idx('0200', 'UNID_INV')];
              if (u) alvo.unid.add(u);
            }
          }
        }
      }
      continue;
    }
    for (const f of bloco.filhos) {
      if (X010.has(f.reg)) visita(f, mapaEstab(uso, f.campos[1] ?? ''));
      else visita(f, uso.global);
    }
  }
  return uso;
}

export function mapaEstab(uso: UsoCadastros, cnpj: string): Record<TipoCadastro, Set<string>> {
  let m = uso.porEstab.get(cnpj);
  if (!m) uso.porEstab.set(cnpj, (m = novoUsoTipo()));
  return m;
}

/** O código está em uso no estabelecimento (ou globalmente)? */
export function emUso(uso: UsoCadastros, cnpj: string, tipo: TipoCadastro, cod: string): boolean {
  return !!uso.porEstab.get(cnpj)?.[tipo].has(cod) || uso.global[tipo].has(cod);
}
