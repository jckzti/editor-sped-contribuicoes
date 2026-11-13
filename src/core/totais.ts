/**
 * Totais dos documentos derivados dos itens.
 *
 * Regra: total = soma atual dos itens + resíduo, onde resíduo = total original − soma
 * original dos itens (capturado na abertura). Assim uma diferença que já existia no
 * arquivo é preservada e um documento não editado não muda.
 *
 * - C100: VL_MERC, VL_BC_ICMS, VL_ICMS, VL_BC_ICMS_ST, VL_ICMS_ST, VL_IPI, VL_PIS, VL_COFINS
 *   e VL_DOC (base: Σ VL_ITEM + VL_IPI + VL_ICMS_ST, menos VL_DESC dos itens se o arquivo
 *   o desconta — detectado na abertura). VL_DESC do C100 não é recalculado.
 * - C500: VL_PIS = Σ C501.VL_PIS + resíduo; VL_COFINS = Σ C505.VL_COFINS + resíduo.
 * - A100: VL_BC_PIS, VL_PIS, VL_BC_COFINS, VL_COFINS = Σ A170 + resíduo (guia: VL_PIS e VL_COFINS
 *   devem ser a soma dos A170). VL_DOC, VL_DESC, retenções e ISS do A100 são dados de entrada.
 * - D100: não tem total derivado dos D101/D105.
 */
import { fmtCentavos } from './dec';
import { estadoDe, vlDocComDescontoDe } from './estado';
import { DERIVADOS_A100, DERIVADOS_C100, I_A100, I_C100_DERIVADOS, I_C100_VL_DOC, I_C500, somasA100, somasC100, somasC500 } from './leituras';
import { type Escrituracao, type Registro } from './modelo';
import { alterar, registrarAcao } from './mutacao';
import { centavosRapido } from './util';

const I_C100 = [...I_C100_DERIVADOS, I_C100_VL_DOC];
const I_C500_LISTA = [I_C500.VL_PIS, I_C500.VL_COFINS];

function gravarSeDiferente(e: Escrituracao, r: Registro, i: number, centavos: number): boolean {
  // total com texto não numérico nos itens/documento (NaN): não mexe (a verificação aponta NUMERO_INVALIDO)
  if (!Number.isFinite(centavos)) return false;
  if (centavosRapido(r.campos[i]) === centavos) return false;
  return alterar(e, r, i, fmtCentavos(centavos));
}

/** Refaz os totais de um documento (C100 ou C500). Devolve quantos campos mudaram. */
export function atualizarTotaisDocumento(e: Escrituracao, doc: Registro): number {
  const st = estadoDe(e);
  let n = 0;
  if (doc.reg === 'C100') {
    const somas = somasC100(doc, vlDocComDescontoDe(e, doc));
    const res = residuoC100(e, doc);
    for (let k = 0; k < I_C100.length; k++) if (gravarSeDiferente(e, doc, I_C100[k], somas[k] + res[k])) n++;
  } else if (doc.reg === 'C500') {
    const somas = somasC500(doc);
    const res = residuoC500(e, doc);
    for (let k = 0; k < 2; k++) if (gravarSeDiferente(e, doc, I_C500_LISTA[k], somas[k] + res[k])) n++;
  } else if (doc.reg === 'A100') {
    const somas = somasA100(doc);
    const res = residuoA100(e, doc);
    for (let k = 0; k < I_A100.length; k++) if (gravarSeDiferente(e, doc, I_A100[k], somas[k] + res[k])) n++;
  }
  return n;
}

/** Resíduos do A100 (zerados para documento novo). */
export function residuoA100(e: Escrituracao, doc: Registro): number[] {
  const st = estadoDe(e);
  let r = st.residuosA100.get(doc);
  if (!r) st.residuosA100.set(doc, (r = new Array(I_A100.length).fill(0)));
  return r;
}

/** Resíduos do C100 (cria zerados para documento novo). */
export function residuoC100(e: Escrituracao, doc: Registro): number[] {
  const st = estadoDe(e);
  let r = st.residuosC100.get(doc);
  if (!r) st.residuosC100.set(doc, (r = new Array(I_C100.length).fill(0)));
  return r;
}

export function residuoC500(e: Escrituracao, doc: Registro): number[] {
  const st = estadoDe(e);
  let r = st.residuosC500.get(doc);
  if (!r) st.residuosC500.set(doc, (r = [0, 0]));
  return r;
}

/**
 * O usuário editou diretamente um total derivado (ex.: C100.VL_DOC): ajusta o resíduo
 * para que o novo valor seja mantido nos recálculos seguintes. Desfazível.
 */
export function ajustarResiduoPorEdicao(e: Escrituracao, doc: Registro, campo: string, novoCentavos: number): void {
  const st = estadoDe(e);
  if (doc.reg === 'C100') {
    const k = campo === 'VL_DOC' ? I_C100.length - 1 : DERIVADOS_C100.findIndex(([c]) => c === campo);
    if (k < 0) return;
    const res = residuoC100(e, doc);
    const antes = res[k];
    const novo = novoCentavos - somasC100(doc, vlDocComDescontoDe(e, doc))[k];
    registrarAcao(e, () => (res[k] = novo), () => (res[k] = antes));
  } else if (doc.reg === 'C500') {
    const k = campo === 'VL_PIS' ? 0 : campo === 'VL_COFINS' ? 1 : -1;
    if (k < 0) return;
    const res = residuoC500(e, doc);
    const antes = res[k];
    const novo = novoCentavos - somasC500(doc)[k];
    registrarAcao(e, () => (res[k] = novo), () => (res[k] = antes));
  } else if (doc.reg === 'A100') {
    const k = DERIVADOS_A100.findIndex(([c]) => c === campo);
    if (k < 0) return;
    const res = residuoA100(e, doc);
    const antes = res[k];
    const novo = novoCentavos - somasA100(doc)[k];
    registrarAcao(e, () => (res[k] = novo), () => (res[k] = antes));
  }
}

/** Define os resíduos de um documento novo a partir dos totais informados (ex.: importação). */
export function fixarResiduosAtuais(e: Escrituracao, doc: Registro): void {
  const st = estadoDe(e);
  if (doc.reg === 'C100') {
    const s = somasC100(doc, vlDocComDescontoDe(e, doc));
    st.residuosC100.set(doc, I_C100.map((i, k) => centavosRapido(doc.campos[i]) - s[k]));
  } else if (doc.reg === 'C500') {
    const s = somasC500(doc);
    st.residuosC500.set(doc, I_C500_LISTA.map((i, k) => centavosRapido(doc.campos[i]) - s[k]));
  }
}

/**
 * Refaz os totais dos documentos marcados como "sujos" (ou de todos, com `todos`).
 * Devolve quantos campos mudaram.
 */
export function atualizarTotais(e: Escrituracao, todos = false): number {
  const st = estadoDe(e);
  let n = 0;
  if (todos) {
    for (const bloco of e.raiz.filhos) {
      if (bloco.reg === 'A001') {
        for (const a010 of bloco.filhos) for (const doc of a010.filhos) if (doc.reg === 'A100') n += atualizarTotaisDocumento(e, doc);
        continue;
      }
      if (bloco.reg !== 'C001') continue;
      for (const c010 of bloco.filhos) for (const doc of c010.filhos) if (doc.reg === 'C100' || doc.reg === 'C500') n += atualizarTotaisDocumento(e, doc);
    }
    st.sujos.clear();
    return n;
  }
  const sujos = [...st.sujos];
  st.sujos.clear();
  for (const doc of sujos) if (doc.pai) n += atualizarTotaisDocumento(e, doc);
  return n;
}
