/**
 * Montagem de registros novos a partir dos tipos do pacote de importação
 * (usado pela importação e pela inclusão de item em nota existente).
 */
import { contaExiste, garantirItem, garantirNatureza, garantirUnidade } from './cadastros';
import { fmtCentavos, mulAliq } from './dec';
import type { ItemImport, Numero, TributoImport } from './importacao.tipos';
import { idx, novoRegistro, type Escrituracao, type Registro } from './modelo';
import { inserir } from './mutacao';
import { centavosRapido, paraTextoSped } from './util';

/** Número do pacote → texto do SPED com até `casas` decimais ("" se ausente; lança se inválido). */
export function num(v: Numero | undefined | null, casas: number, campo: string): string {
  if (v === undefined || v === null || v === '') return '';
  const t = paraTextoSped(v, casas);
  if (t === null) throw new Error(`${campo}: "${String(v)}" não é um número válido.`);
  return t;
}

/** Como `num`, mas ausente vale "0". */
export function num0(v: Numero | undefined | null, casas: number, campo: string): string {
  return num(v, casas, campo) || '0';
}

/** Dinheiro do pacote → centavos (ausente = 0). */
export function cent(v: Numero | undefined | null, campo: string): number {
  return centavosRapido(num(v, 2, campo));
}

/** CSTs de PIS/COFINS que geram crédito (entradas). */
export function cstCredito(cst: string): boolean {
  const n = Number(cst);
  return n >= 50 && n <= 66;
}

/** CSTs de receita/débito (saídas tributadas ou não: 01 a 09). */
export function cstReceita(cst: string): boolean {
  const n = Number(cst);
  return n >= 1 && n <= 9;
}

/**
 * Campos de PIS ou COFINS a partir do pacote.
 * - base ausente e alíquota presente: valor do item − desconto;
 * - valor ausente: base × alíquota (meio para cima);
 * - sem alíquota nem base: tudo "0" (ex.: CST 70, 98).
 */
export function camposTributo(t: TributoImport, valorItem: number, desconto: number, nome: string): { cst: string; base: string; aliq: string; valor: string } {
  const cst = (t.cst ?? '').padStart(2, '0');
  const aliq = num(t.aliquota, 4, `Alíquota de ${nome}`);
  let base = num(t.base, 2, `Base de ${nome}`);
  if (!base && aliq) base = fmtCentavos(valorItem - desconto);
  let valor = num(t.valor, 2, `Valor de ${nome}`);
  if (!valor) valor = base && aliq ? fmtCentavos(mulAliq(centavosRapido(base), aliq)) : '0';
  return { cst, base: base || '0', aliq: aliq || '0', valor };
}

/**
 * Cria um C170 a partir de um item do pacote, garantindo os cadastros (0200, 0190, 0400)
 * no estabelecimento do documento, e o insere no C100. Não refaz totais (isso é feito
 * no fim da operação). Avisos de cadastro vão para `avisos`.
 */
export function incluirC170(e: Escrituracao, c100: Registro, cnpjEstab: string, it: ItemImport, numItem: number, avisos: string[]): Registro {
  garantirItem(e, cnpjEstab, it, avisos);
  const codNat = garantirNatureza(e, cnpjEstab, it.natOperacao, avisos);
  const vlItem = cent(it.valorItem, 'Valor do item');
  const vlDesc = cent(it.valorDesconto, 'Desconto do item');
  const pis = camposTributo(it.pis, vlItem, vlDesc, 'PIS');
  const cofins = camposTributo(it.cofins, vlItem, vlDesc, 'COFINS');
  const icms = it.icms ?? {};
  const ipi = it.ipi ?? {};
  let cstIcms = (icms.cst ?? '').trim();
  if (cstIcms.length === 2) cstIcms = '0' + cstIcms;
  const conta = (it.contaContabil ?? '').trim();
  if (conta && !contaExiste(e, conta)) avisos.push(`Item ${it.codigo}: conta contábil ${conta} não existe no plano de contas (0500).`);
  const unid = it.unidade.trim();
  const r = novoRegistro('C170', {
    NUM_ITEM: String(numItem),
    COD_ITEM: it.codigo.trim(),
    DESCR_COMPL: '',
    QTD: num0(it.quantidade, 5, 'Quantidade'),
    UNID: unid,
    VL_ITEM: fmtCentavos(vlItem),
    VL_DESC: fmtCentavos(vlDesc),
    IND_MOV: '0',
    CST_ICMS: cstIcms,
    CFOP: it.cfop.trim(),
    COD_NAT: codNat,
    VL_BC_ICMS: num0(icms.base, 2, 'Base ICMS'),
    ALIQ_ICMS: num0(icms.aliquota, 2, 'Alíquota ICMS'),
    VL_ICMS: num0(icms.valor, 2, 'Valor ICMS'),
    VL_BC_ICMS_ST: num0(icms.baseSt, 2, 'Base ICMS ST'),
    ALIQ_ST: num0(icms.aliquotaSt, 2, 'Alíquota ICMS ST'),
    VL_ICMS_ST: num0(icms.valorSt, 2, 'Valor ICMS ST'),
    IND_APUR: '0',
    CST_IPI: (ipi.cst ?? '').trim(),
    COD_ENQ: '',
    VL_BC_IPI: num0(ipi.base, 2, 'Base IPI'),
    ALIQ_IPI: num0(ipi.aliquota, 2, 'Alíquota IPI'),
    VL_IPI: num0(ipi.valor, 2, 'Valor IPI'),
    CST_PIS: pis.cst,
    VL_BC_PIS: pis.base,
    ALIQ_PIS: pis.aliq,
    VL_PIS: pis.valor,
    CST_COFINS: cofins.cst,
    VL_BC_COFINS: cofins.base,
    ALIQ_COFINS: cofins.aliq,
    VL_COFINS: cofins.valor,
    COD_CTA: conta,
  });
  // a unidade do item na nota pode diferir da do cadastro (0200): garante as duas
  garantirUnidade(e, cnpjEstab, unid);
  inserir(e, c100, r);
  return r;
}

/** Maior NUM_ITEM entre os C170 da nota. */
export function maiorNumItem(c100: Registro): number {
  const i = idx('C170', 'NUM_ITEM');
  let m = 0;
  for (const f of c100.filhos) if (f.reg === 'C170') m = Math.max(m, Number(f.campos[i]) || 0);
  return m;
}
