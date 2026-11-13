/**
 * Apoio da grade: quais colunas mostrar por padrão, como descobrir se uma célula
 * foi editada (amarelo) ou é de um registro novo (verde), e o texto de cada célula.
 *
 * O destaque sai de `Registro.estado` e de `campoAlterado`/`valorOriginal` do modelo
 * (não lê `Registro.antes` direto: a representação pode mudar), cruzados com
 * `Coluna.registro`/`Coluna.campo`.
 */
import { coluna, colunas, valorExibicao, type Coluna, type LinhaQualquer, type TipoLinhaTodos } from '../core/linhas';
import { campoAlterado, idx, leiaute, valorOriginal, type Registro } from '../core/modelo';
import { spedParaBr } from '../core/util';
import { numeroLegivel, periodoLegivel } from './formato';
import type { EstadoCelula } from './Grade';

/** Colunas mostradas quando o usuário ainda não escolheu (as que o contador olha). */
const PADRAO: Partial<Record<TipoLinhaTodos, string[]>> = {
  item: [
    'periodo', 'C100.IND_OPER', 'C100.NUM_DOC', 'C100.DT_DOC', '0150.NOME',
    'C170.NUM_ITEM', 'C170.COD_ITEM', '0200.DESCR_ITEM', 'C170.CFOP', 'C170.VL_ITEM', 'C170.VL_DESC',
    'C170.CST_PIS', 'C170.VL_BC_PIS', 'C170.ALIQ_PIS', 'C170.VL_PIS',
    'C170.CST_COFINS', 'C170.VL_BC_COFINS', 'C170.ALIQ_COFINS', 'C170.VL_COFINS', 'C170.COD_CTA',
  ],
  nota: [
    'periodo', 'C100.IND_OPER', 'C100.COD_MOD', 'C100.NUM_DOC', 'C100.SER', 'C100.DT_DOC', 'C100.DT_E_S',
    '0150.NOME', 'C100.VL_DOC', 'C100.VL_MERC', 'C100.VL_DESC', 'C100.VL_PIS', 'C100.VL_COFINS', 'qtdItens',
  ],
  frete: [
    'periodo', 'D100.NUM_DOC', 'D100.DT_DOC', '0150.NOME', 'D100.VL_DOC',
    'D101.IND_NAT_FRT', 'D101.VL_ITEM', 'D101.CST_PIS', 'D101.NAT_BC_CRED', 'D101.VL_BC_PIS', 'D101.ALIQ_PIS', 'D101.VL_PIS',
    'D105.CST_COFINS', 'D105.VL_BC_COFINS', 'D105.ALIQ_COFINS', 'D105.VL_COFINS', 'D101.COD_CTA',
  ],
  energia: [
    'periodo', 'C500.NUM_DOC', 'C500.DT_DOC', '0150.NOME', 'C500.VL_DOC',
    'C501.VL_ITEM', 'C501.CST_PIS', 'C501.NAT_BC_CRED', 'C501.VL_BC_PIS', 'C501.ALIQ_PIS', 'C501.VL_PIS',
    'C505.CST_COFINS', 'C505.VL_BC_COFINS', 'C505.ALIQ_COFINS', 'C505.VL_COFINS', 'C501.COD_CTA',
  ],
  f100: [
    'periodo', 'F100.IND_OPER', 'F100.DT_OPER', '0150.NOME', 'F100.VL_OPER',
    'F100.CST_PIS', 'F100.VL_BC_PIS', 'F100.ALIQ_PIS', 'F100.VL_PIS',
    'F100.CST_COFINS', 'F100.VL_BC_COFINS', 'F100.ALIQ_COFINS', 'F100.VL_COFINS',
    'F100.NAT_BC_CRED', 'F100.COD_CTA', 'F100.DESC_DOC_OPER',
  ],
  servico: [
    'periodo', 'A100.IND_OPER', 'A100.NUM_DOC', 'A100.DT_DOC', '0150.NOME',
    'A170.NUM_ITEM', 'A170.COD_ITEM', '0200.DESCR_ITEM', 'A170.VL_ITEM', 'A170.VL_DESC', 'A170.NAT_BC_CRED',
    'A170.CST_PIS', 'A170.VL_BC_PIS', 'A170.ALIQ_PIS', 'A170.VL_PIS',
    'A170.CST_COFINS', 'A170.VL_BC_COFINS', 'A170.ALIQ_COFINS', 'A170.VL_COFINS', 'A170.COD_CTA',
  ],
  imobDepreciacao: [
    'periodo', 'F120.NAT_BC_CRED', 'F120.IDENT_BEM_IMOB', 'F120.DESC_BEM_IMOB', 'F120.VL_OPER_DEP', 'F120.PARC_OPER_NAO_BC_CRED',
    'F120.CST_PIS', 'F120.VL_BC_PIS', 'F120.ALIQ_PIS', 'F120.VL_PIS',
    'F120.CST_COFINS', 'F120.VL_BC_COFINS', 'F120.ALIQ_COFINS', 'F120.VL_COFINS', 'F120.COD_CTA',
  ],
  imobAquisicao: [
    'periodo', 'F130.NAT_BC_CRED', 'F130.IDENT_BEM_IMOB', 'F130.DESC_BEM_IMOB', 'F130.MES_OPER_AQUIS', 'F130.VL_OPER_AQUIS',
    'F130.PARC_OPER_NAO_BC_CRED', 'F130.VL_BC_CRED', 'F130.IND_NR_PARC',
    'F130.CST_PIS', 'F130.VL_BC_PIS', 'F130.ALIQ_PIS', 'F130.VL_PIS',
    'F130.CST_COFINS', 'F130.VL_BC_COFINS', 'F130.ALIQ_COFINS', 'F130.VL_COFINS',
  ],
  participante: ['periodo', '0150.COD_PART', '0150.NOME', '0150.CNPJ', '0150.CPF', '0150.IE', '0150.COD_MUN', 'ufParticipante', '0150.END', '0150.NUM', '0150.BAIRRO'],
  produto: ['periodo', '0200.COD_ITEM', '0200.DESCR_ITEM', '0200.TIPO_ITEM', '0200.COD_NCM', '0200.UNID_INV', '0200.COD_LST', '0200.EX_IPI', '0200.COD_GEN', '0200.ALIQ_ICMS', 'qtd0205', 'qtd0206', 'qtd0208'],
};

/**
 * Colunas que o sistema RECALCULA no imobilizado (regra do Guia Prático), com a regra em
 * português. As demais colunas do F120/F130 são dado de entrada: editar uma delas refaz
 * as calculadas na hora.
 */
export const COLUNAS_CALCULADAS: Partial<Record<TipoLinhaTodos, Record<string, string>>> = {
  imobDepreciacao: {
    'F120.VL_BC_PIS': 'encargo de depreciação do mês − parcela sem direito a crédito',
    'F120.VL_BC_COFINS': 'encargo de depreciação do mês − parcela sem direito a crédito',
    'F120.VL_PIS': 'base × alíquota',
    'F120.VL_COFINS': 'base × alíquota',
  },
  imobAquisicao: {
    'F130.VL_BC_CRED': 'valor de aquisição − parcela sem direito a crédito',
    'F130.VL_BC_PIS': 'base do crédito ÷ número de meses do IND_NR_PARC (1 = 1, 2 = 12, 3 = 24, 4 = 48, 5 = 6); com IND_NR_PARC 9 é digitada',
    'F130.VL_BC_COFINS': 'base do crédito ÷ número de meses do IND_NR_PARC (1 = 1, 2 = 12, 3 = 24, 4 = 48, 5 = 6); com IND_NR_PARC 9 é digitada',
    'F130.VL_PIS': 'base do mês × alíquota',
    'F130.VL_COFINS': 'base do mês × alíquota',
  },
};

/** Ids das colunas iniciais do tipo (só as que existem de fato no catálogo). */
export function colunasPadrao(tipo: TipoLinhaTodos): string[] {
  const existentes = new Set(colunas(tipo).map((c) => c.id));
  const ids = (PADRAO[tipo] ?? []).filter((id) => existentes.has(id));
  return ids.length ? ids : colunas(tipo).slice(0, 20).map((c) => c.id);
}

/** Posição do campo no registro da coluna (null quando a coluna não vem de um registro da linha). */
export interface AlvoColuna {
  registro: string;
  campo: string;
  i: number;
  origem: Coluna['origem'];
  /** Casas decimais do campo no leiaute (null = não é valor decimal). */
  dec: number | null;
}

const cacheAlvos = new Map<TipoLinhaTodos, Map<string, AlvoColuna | null>>();

/** Mapa colunaId → registro/campo/índice, usado para o destaque e para a edição. */
export function alvosDasColunas(tipo: TipoLinhaTodos): Map<string, AlvoColuna | null> {
  let m = cacheAlvos.get(tipo);
  if (m) return m;
  m = new Map();
  for (const c of colunas(tipo)) {
    if (!c.registro || !c.campo || (c.origem !== 'registro' && c.origem !== 'complemento' && c.origem !== 'documento')) {
      m.set(c.id, null);
      continue;
    }
    try {
      const i = idx(c.registro, c.campo);
      const def = leiaute.registros[c.registro]?.campos[i];
      m.set(c.id, { registro: c.registro, campo: c.campo, i, origem: c.origem, dec: def?.tipo === 'N' && def.dec ? def.dec : null });
    } catch {
      m.set(c.id, null);
    }
  }
  cacheAlvos.set(tipo, m);
  return m;
}

/** O registro da linha de onde a coluna lê (undefined quando a linha não o tem). */
export function registroDaColuna(l: LinhaQualquer, alvo: AlvoColuna): Registro | undefined {
  if (l.reg.reg === alvo.registro) return l.reg;
  if (l.doc.reg === alvo.registro) return l.doc;
  if (l.pis?.reg === alvo.registro) return l.pis;
  if (l.cofins?.reg === alvo.registro) return l.cofins;
  return undefined;
}

/** Destaque da célula: amarelo em campo editado, verde em registro incluído. */
export function estadoDaCelula(l: LinhaQualquer, alvo: AlvoColuna | null | undefined): EstadoCelula {
  if (!alvo) return 'normal';
  const r = registroDaColuna(l, alvo);
  if (!r) return 'normal';
  if (r.estado === 'novo') return 'nova';
  if (campoAlterado(r, alvo.i)) return 'editada';
  return 'normal';
}

/** Texto do campo como o contador lê: valor com milhar e duas casas, data DD/MM/AAAA. */
function legivel(valor: string, alvo: AlvoColuna | null | undefined): string {
  if (alvo?.dec) return numeroLegivel(valor);
  if (alvo?.campo.startsWith('DT_') && /^\d{8}$/.test(valor)) return spedParaBr(valor);
  if (alvo?.campo === 'MES_OPER_AQUIS') return mesAnoLegivel(valor);
  return valor;
}

/** MMAAAA (F130 MES_OPER_AQUIS) → "MM/AAAA"; outro formato volta como veio. */
export function mesAnoLegivel(v: string): string {
  return /^\d{6}$/.test(v) ? `${v.slice(0, 2)}/${v.slice(2)}` : v;
}

/** Texto exibido na célula. */
export function textoDaCelula(l: LinhaQualquer, colunaId: string, alvo: AlvoColuna | null | undefined): string {
  if (colunaId === 'periodo') return periodoLegivel(valorExibicao(l, colunaId));
  const v = valorExibicao(l, colunaId);
  if (alvo?.campo === 'MES_OPER_AQUIS') return mesAnoLegivel(v);
  return alvo?.dec ? numeroLegivel(v) : v;
}

/**
 * Dica (title) da célula: o valor original quando o campo foi editado, e a descrição
 * do código quando a coluna é de uma tabela (CST, indicador de operação...).
 */
export function dicaDaCelula(l: LinhaQualquer, col: Coluna | undefined, alvo: AlvoColuna | null | undefined): string | undefined {
  const partes: string[] = [];
  if (alvo) {
    const r = registroDaColuna(l, alvo);
    if (r && campoAlterado(r, alvo.i)) {
      const orig = valorOriginal(r, alvo.i);
      partes.push(`Valor original no arquivo: ${orig === '' ? '(vazio)' : legivel(orig, alvo)}`);
    } else if (r?.estado === 'novo') partes.push('Registro incluído (não existia no arquivo original)');
  }
  if (col?.valores) {
    const v = valorExibicao(l, col.id);
    const d = col.valores[v];
    if (d) partes.push(`${v} — ${d}`);
  }
  return partes.length ? partes.join('\n') : undefined;
}

/** Destaque da linha inteira. */
export function estadoDaLinha(l: LinhaQualquer): 'normal' | 'nova' | 'editada' {
  const regs = [l.reg, l.pis, l.cofins];
  if (regs.some((r) => r?.estado === 'novo')) return 'nova';
  if (regs.some((r) => r?.estado === 'editado')) return 'editada';
  return 'normal';
}

/** Chave "REG.CAMPO" para `editarCampos` a partir da coluna (null se não for editável). */
export function chaveDeEdicao(tipo: TipoLinhaTodos, colunaId: string): string | null {
  const col = coluna(tipo, colunaId);
  if (!col?.editavel || !col.registro || !col.campo) return null;
  return `${col.registro}.${col.campo}`;
}
