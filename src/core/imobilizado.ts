/**
 * Bens do ativo imobilizado (F120 e F130): campos derivados conforme o Guia Prático.
 *
 * - F120 (crédito sobre encargo de depreciação/amortização): VL_BC_PIS = VL_BC_COFINS =
 *   VL_OPER_DEP − PARC_OPER_NAO_BC_CRED (guia, campos 09 e 13).
 * - F130 (crédito sobre o valor de aquisição): VL_BC_CRED = VL_OPER_AQUIS −
 *   PARC_OPER_NAO_BC_CRED (campo 09); base do mês VL_BC_PIS = VL_BC_COFINS = VL_BC_CRED ÷
 *   nº de meses do IND_NR_PARC (campos 12 e 16): 1 = integral, 2 = 12, 3 = 24, 4 = 48,
 *   5 = 6 meses. Com "9" (outra periodicidade em lei) o número de meses não está no
 *   arquivo: a base do mês é dado de entrada.
 * - Nos dois: VL_PIS = base × ALIQ_PIS ÷ 100 e VL_COFINS = base × ALIQ_COFINS ÷ 100.
 *
 * Só é recalculado o que depende do campo editado (registro não editado não muda).
 */
import { divArred, fmtCentavos, mulAliq } from './dec';
import { get, type Escrituracao, type Registro } from './modelo';
import { alterar } from './mutacao';
import { centavosRapido } from './util';

/** Nº de meses de apropriação por IND_NR_PARC (o "9" não tem número fixo). */
export const MESES_PARCELAS: Record<string, number> = { '1': 1, '2': 12, '3': 24, '4': 48, '5': 6 };

const c = (r: Registro, campo: string) => centavosRapido(get(r, campo));

/** Base total do crédito do F130 pelos dados de entrada (aquisição − parcela sem crédito). */
function baseTotalF130(r: Registro): number {
  return c(r, 'VL_OPER_AQUIS') - c(r, 'PARC_OPER_NAO_BC_CRED');
}

/**
 * Base de cálculo do mês (PIS e COFINS) pela regra do guia. NaN quando não dá para calcular
 * (F130 com parcelas "9" ou sem indicador).
 */
export function baseImobilizado(r: Registro): number {
  if (r.reg === 'F120') return c(r, 'VL_OPER_DEP') - c(r, 'PARC_OPER_NAO_BC_CRED');
  if (r.reg === 'F130') {
    const meses = MESES_PARCELAS[get(r, 'IND_NR_PARC')];
    if (!meses) return NaN;
    return Number(divArred(BigInt(baseTotalF130(r)), BigInt(meses)));
  }
  return NaN;
}

function gravar(e: Escrituracao, r: Registro, campo: string, v: number): number {
  if (!Number.isFinite(v)) return 0;
  const atual = get(r, campo);
  if (atual !== '' && centavosRapido(atual) === v) return 0;
  return alterar(e, r, campo, fmtCentavos(v)) ? 1 : 0;
}

const ENTRADAS: Record<string, Set<string>> = {
  F120: new Set(['VL_OPER_DEP', 'PARC_OPER_NAO_BC_CRED']),
  F130: new Set(['VL_OPER_AQUIS', 'PARC_OPER_NAO_BC_CRED', 'IND_NR_PARC', 'VL_BC_CRED']),
};

/**
 * Depois de editar `campo` de um F120/F130, refaz os campos que dependem dele. Devolve
 * quantos campos mudaram. Desfazível (usa `alterar`).
 */
export function recalcularImobilizado(e: Escrituracao, r: Registro, campo: string): number {
  if (r.reg !== 'F120' && r.reg !== 'F130') return 0;
  let n = 0;
  const entrada = ENTRADAS[r.reg].has(campo);
  if (entrada) {
    if (r.reg === 'F130' && campo !== 'VL_BC_CRED' && campo !== 'IND_NR_PARC') n += gravar(e, r, 'VL_BC_CRED', baseTotalF130(r));
    let base: number;
    if (r.reg === 'F120') base = baseImobilizado(r);
    else {
      const meses = MESES_PARCELAS[get(r, 'IND_NR_PARC')];
      base = meses ? Number(divArred(BigInt(c(r, 'VL_BC_CRED')), BigInt(meses))) : NaN;
    }
    n += gravar(e, r, 'VL_BC_PIS', base);
    n += gravar(e, r, 'VL_BC_COFINS', base);
  }
  if (entrada || campo === 'VL_BC_PIS' || campo === 'ALIQ_PIS') n += gravar(e, r, 'VL_PIS', mulAliq(c(r, 'VL_BC_PIS'), get(r, 'ALIQ_PIS')));
  if (entrada || campo === 'VL_BC_COFINS' || campo === 'ALIQ_COFINS') n += gravar(e, r, 'VL_COFINS', mulAliq(c(r, 'VL_BC_COFINS'), get(r, 'ALIQ_COFINS')));
  return n;
}

/** Diferenças entre os campos derivados e a regra do guia (para a verificação). */
export function conferirImobilizado(r: Registro): string[] {
  const out: string[] = [];
  const fmt = (v: number) => fmtCentavos(v);
  if (r.reg === 'F120') {
    const b = baseImobilizado(r);
    for (const campo of ['VL_BC_PIS', 'VL_BC_COFINS']) {
      if (c(r, campo) !== b) out.push(`${campo} = ${get(r, campo) || '0'}, mas encargo − parcela sem crédito = ${fmt(b)} (guia, F120 campos 09/13).`);
    }
  } else if (r.reg === 'F130') {
    const total = baseTotalF130(r);
    if (c(r, 'VL_BC_CRED') !== total) out.push(`VL_BC_CRED = ${get(r, 'VL_BC_CRED') || '0'}, mas aquisição − parcela sem crédito = ${fmt(total)} (guia, F130 campo 09).`);
    const meses = MESES_PARCELAS[get(r, 'IND_NR_PARC')];
    if (meses) {
      const b = Number(divArred(BigInt(c(r, 'VL_BC_CRED')), BigInt(meses)));
      for (const campo of ['VL_BC_PIS', 'VL_BC_COFINS']) {
        if (Math.abs(c(r, campo) - b) > 1) out.push(`${campo} = ${get(r, campo) || '0'}, mas base total ÷ ${meses} meses = ${fmt(b)} (guia, F130 campos 12/16).`);
      }
    }
  }
  return out;
}
