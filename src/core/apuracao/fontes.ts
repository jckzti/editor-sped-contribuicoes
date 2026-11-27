/**
 * Extração das operações dos blocos A, C, D e F que alimentam a apuração de um tributo:
 * linhas de crédito (CST 50–66), receitas (CST 01–09) e notas de saída que geram
 * estorno de crédito (CST 49 com tributo destacado).
 */
import { paraEscala } from '../dec';
import { get, listar, type Escrituracao, type Registro } from '../modelo';
import { PIS, type Tributo } from './tributos';
import { codigoReceitaMista, regimeMisto } from './misto';
import { aliqEsc, cent, SITUACOES_FORA } from './util';

export interface OpCredito {
  /** Registro de origem (C170, C501, D101, F100...). */
  origem: string;
  reg: Registro;
  cst: string;
  natBc: string;
  base: number;
  aliq: bigint;
  importacao: boolean;
  /** Base em quantidade (alíquota em reais): não suportado. */
  quantidade: boolean;
  cfop: string;
}

export interface OpReceita {
  origem: string;
  reg: Registro;
  doc: Registro | null;
  cst: string;
  base: number;
  aliq: bigint;
  /** Receita bruta da operação (VL_ITEM / VL_OPER). */
  receita: number;
  codCta: string;
  codNat: string;
  cfop: string;
  codItem: string;
  quantidade: boolean;
}

/** Nota de saída com itens CST 49 e tributo destacado: candidata a estorno de crédito. */
export interface NotaEstorno {
  /** Chave completa da nota (estabelecimento, modelo, série, número, data e chave da NF-e): ver `chaveNotaCompleta`. */
  chave: string;
  /** Número + data (`chaveNota`): é só o que o M110/M510 guarda (NUM_DOC e DT_REF). */
  curto: string;
  serie: string;
  numDoc: string;
  dtDoc: string;
  cfop: string;
  valor: number;
  codCta: string;
  doc: Registro;
}

export interface Fontes {
  creditos: OpCredito[];
  receitas: OpReceita[];
  estornos: NotaEstorno[];
  /** CFOPs de itens C170 com CST de crédito sem NAT_BC_CRED conhecido. */
  cfopsSemNatureza: Set<string>;
  /** Registros de origem efetivamente usados (para avisos de "não conferido"). */
  origens: Set<string>;
}

export const CST_CREDITO = new Set([
  '50', '51', '52', '53', '54', '55', '56', '60', '61', '62', '63', '64', '65', '66',
]);
export const CST_RECEITA = new Set(['01', '02', '03', '04', '05', '06', '07', '08', '09']);

/** Chave que liga uma nota a um ajuste M110: número sem zeros à esquerda + data (é o que o M110 tem). */
export function chaveNota(numDoc: string, data: string): string {
  return `${numDoc.replace(/^0+(?=.)/, '')}|${data}`;
}

/**
 * Chave que identifica a nota (C100): estabelecimento (C010), modelo, série, número, data
 * e, quando houver, a chave da NF-e. Duas notas de séries ou filiais diferentes com o mesmo
 * número e data não se confundem.
 */
export function chaveNotaCompleta(doc: Registro): string {
  const estab = doc.pai?.reg === 'C010' ? doc.pai.campos[1] ?? '' : '';
  const serie = get(doc, 'SER').replace(/^0+(?=.)/, '');
  return [estab, get(doc, 'COD_MOD'), serie, chaveNota(get(doc, 'NUM_DOC'), get(doc, 'DT_DOC')), get(doc, 'CHV_NFE')].join('|');
}

function temQuantidade(r: Registro, t: Tributo, temCampos: boolean): boolean {
  if (!temCampos) return false;
  return paraEscala(get(r, `QUANT_BC_${t.sfx}`), 3) !== 0n || paraEscala(get(r, `ALIQ_${t.sfx}_QUANT`), 4) !== 0n;
}

function docValido(doc: Registro | null): boolean {
  return !!doc && !SITUACOES_FORA.has(get(doc, 'COD_SIT'));
}

/** Receitas analíticas de NFC-e e do resumo diário de transporte, por tributo. */
function* receitasAnaliticas(e: Escrituracao, t: Tributo) {
  for (const doc of listar(e, 'C100')) {
    if (!docValido(doc) || get(doc, 'COD_MOD') !== '65') continue;
    for (const reg of doc.filhos) {
      if (reg.reg === 'C175') yield { doc, reg, valor: cent(reg, 'VL_OPR'), cfop: get(reg, 'CFOP'), quantidade: temQuantidade(reg, t, true) };
    }
  }
  const filho = t.id === 'pis' ? 'D201' : 'D205';
  for (const doc of listar(e, 'D200')) {
    if (!docValido(doc)) continue;
    for (const reg of doc.filhos) {
      if (reg.reg === filho) yield { doc, reg, valor: cent(reg, 'VL_ITEM'), cfop: get(doc, 'CFOP'), quantidade: false };
    }
  }
}

export function extrairFontes(e: Escrituracao, t: Tributo, cfopNatBc: Record<string, string>): Fontes {
  const f: Fontes = { creditos: [], receitas: [], estornos: [], cfopsSemNatureza: new Set(), origens: new Set() };
  const s = t.sfx;

  const credito = (origem: string, reg: Registro, natBc: string, importacao: boolean, cfop: string, quant: boolean) => {
    f.origens.add(origem);
    f.creditos.push({
      origem,
      reg,
      cst: get(reg, `CST_${s}`),
      natBc,
      base: cent(reg, `VL_BC_${s}`),
      aliq: aliqEsc(get(reg, `ALIQ_${s}`)),
      importacao,
      quantidade: quant,
      cfop,
    });
  };
  const receita = (
    origem: string,
    reg: Registro,
    doc: Registro | null,
    vlReceita: number,
    extra: { codNat?: string; cfop?: string; codItem?: string },
    quant: boolean,
  ) => {
    f.origens.add(origem);
    f.receitas.push({
      origem,
      reg,
      doc,
      cst: get(reg, `CST_${s}`),
      base: cent(reg, `VL_BC_${s}`),
      aliq: aliqEsc(get(reg, `ALIQ_${s}`)),
      receita: vlReceita,
      codCta: get(reg, 'COD_CTA'),
      codNat: extra.codNat ?? '',
      cfop: extra.cfop ?? '',
      codItem: extra.codItem ?? '',
      quantidade: quant,
    });
  };

  // C100/C170 — notas fiscais (itens)
  for (const doc of listar(e, 'C100')) {
    if (!docValido(doc)) continue;
    let estorno: NotaEstorno | null = null;
    for (const it of doc.filhos) {
      if (it.reg !== 'C170') continue;
      const cst = get(it, `CST_${s}`);
      const cfop = get(it, 'CFOP');
      const quant = temQuantidade(it, t, true);
      if (CST_CREDITO.has(cst)) {
        const nat = cfopNatBc[cfop];
        if (!nat) f.cfopsSemNatureza.add(cfop);
        credito('C170', it, nat ?? '', cfop.startsWith('3'), cfop, quant);
      } else if (CST_RECEITA.has(cst)) {
        receita('C170', it, doc, cent(it, 'VL_ITEM'), { codNat: get(it, 'COD_NAT'), cfop, codItem: get(it, 'COD_ITEM') }, quant);
      } else if (cst === '49' && get(doc, 'IND_OPER') === '1') {
        const v = cent(it, `VL_${s}`);
        if (v > 0) {
          if (!estorno) {
            estorno = {
              chave: chaveNotaCompleta(doc),
              curto: chaveNota(get(doc, 'NUM_DOC'), get(doc, 'DT_DOC')),
              serie: get(doc, 'SER'),
              numDoc: get(doc, 'NUM_DOC'),
              dtDoc: get(doc, 'DT_DOC'),
              cfop,
              valor: 0,
              codCta: get(it, 'COD_CTA'),
              doc,
            };
          }
          estorno.valor += v;
        }
      }
    }
    if (estorno) f.estornos.push(estorno);
  }

  for (const { doc, reg, valor, cfop, quantidade } of receitasAnaliticas(e, t)) {
    const cst = get(reg, `CST_${s}`);
    if (CST_RECEITA.has(cst) || quantidade) receita(reg.reg, reg, doc, valor, { cfop }, quantidade);
  }

  // C500/C501 (C505) — energia, água, gás, comunicação (aquisições)
  // D100/D101 (D105) — conhecimentos de transporte (aquisições)
  // D500/D501 (D505) — serviços de comunicação (aquisições)
  for (const [pai, filho] of [
    ['C500', t.C501],
    ['D100', t.D101],
    ['D500', t.D501],
  ] as const) {
    for (const doc of listar(e, pai)) {
      if (!docValido(doc)) continue;
      for (const it of doc.filhos) {
        if (it.reg !== filho) continue;
        if (CST_CREDITO.has(get(it, `CST_${s}`))) credito(filho, it, get(it, 'NAT_BC_CRED'), false, '', false);
      }
    }
  }

  // F100 — demais documentos e operações
  for (const r of listar(e, 'F100')) {
    const cst = get(r, `CST_${s}`);
    if (CST_CREDITO.has(cst)) {
      credito('F100', r, get(r, 'NAT_BC_CRED'), get(r, 'IND_ORIG_CRED') === '1', '', false);
    } else if (CST_RECEITA.has(cst)) {
      receita('F100', r, null, cent(r, 'VL_OPER'), { codItem: get(r, 'COD_ITEM') }, false);
    }
  }

  // F120 / F130 — bens do ativo imobilizado (depreciação / valor de aquisição)
  for (const reg of ['F120', 'F130']) {
    for (const r of listar(e, reg)) {
      if (CST_CREDITO.has(get(r, `CST_${s}`))) credito(reg, r, get(r, 'NAT_BC_CRED'), get(r, 'IND_ORIG_CRED') === '1', '', false);
    }
  }

  // A100/A170 — serviços (ISS)
  for (const doc of listar(e, 'A100')) {
    if (!docValido(doc)) continue;
    for (const it of doc.filhos) {
      if (it.reg !== 'A170') continue;
      const cst = get(it, `CST_${s}`);
      if (CST_CREDITO.has(cst)) {
        credito('A170', it, get(it, 'NAT_BC_CRED'), get(it, 'IND_ORIG_CRED') === '1', '', false);
      } else if (CST_RECEITA.has(cst)) {
        receita('A170', it, doc, cent(it, 'VL_ITEM'), { codItem: get(it, 'COD_ITEM') }, false);
      }
    }
  }

  return f;
}

/**
 * Receita bruta por tipo (para o ajuste do 0111 pelo delta), a partir das operações de venda e prestação:
 * tributada MI = CST 01/02/03/05 em CFOP 5/6; não tributada MI = CST 04/06/07/08/09 em CFOP 5/6;
 * exportação = CFOP 7. Serviço prestado (A170 de A100 com IND_OPER 1) entra como mercado
 * interno (o A170 não tem CFOP para identificar exportação de serviço).
 */
export function receitaPorTipo(e: Escrituracao, diferenciadas: ReadonlyMap<bigint, string> = new Map()): { trib: number; nt: number; exp: number; cum: number } {
  const out = { trib: 0, nt: 0, exp: 0, cum: 0 };
  const misto = regimeMisto(e);
  const somar = (r: Registro, v: number, cfop: string) => {
    const cst = get(r, 'CST_PIS');
    const codigo = misto ? codigoReceitaMista({ cst, aliq: aliqEsc(get(r, 'ALIQ_PIS')) }, PIS, diferenciadas) : undefined;
    if (codigo === '51' || codigo === '52') out.cum += v;
    else if (cfop.startsWith('7')) out.exp += v;
    else if (!cfop || /^[56]/.test(cfop)) {
      if (['01', '02', '03', '05'].includes(cst)) out.trib += v;
      else if (['04', '06', '07', '08', '09'].includes(cst)) out.nt += v;
    }
  };
  for (const doc of listar(e, 'C100')) {
    if (!docValido(doc)) continue;
    for (const it of doc.filhos) {
      if (it.reg !== 'C170') continue;
      const cfop = get(it, 'CFOP');
      if (/^[567]/.test(cfop)) somar(it, cent(it, 'VL_ITEM'), cfop);
    }
  }
  for (const doc of listar(e, 'A100')) {
    if (!docValido(doc) || get(doc, 'IND_OPER') !== '1') continue;
    for (const it of doc.filhos) {
      if (it.reg !== 'A170') continue;
      somar(it, cent(it, 'VL_ITEM'), '');
    }
  }
  for (const { reg, valor, cfop } of receitasAnaliticas(e, PIS)) {
    if (/^[567]/.test(cfop)) somar(reg, valor, cfop);
  }
  if (misto) for (const r of listar(e, 'F100')) {
    if (['01', '02'].includes(get(r, 'CST_PIS'))) somar(r, cent(r, 'VL_OPER'), '');
  }
  return out;
}
