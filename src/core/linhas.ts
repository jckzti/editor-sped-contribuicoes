/**
 * Linhas para as grades da interface (itens, notas, fretes, energia, F100), catálogo de
 * colunas, leitura de valores sob demanda, filtro, ordenação e somas.
 *
 * Uma linha é um objeto leve com referências aos registros; os valores são lidos sob
 * demanda por `valor(linha, colunaId)` (O(1): cadastros indexados em Map por escrituração).
 * As listas de linhas ficam em cache por escrituração e são refeitas quando a estrutura
 * muda (inclusão/exclusão, desfazer...).
 */
import { cadastrosDe } from './cadastros';
import { gravarCache, lerCache } from './estado';
import { idx, leiaute, type Escrituracao, type Registro } from './modelo';
import tabelas from './tabelas.json';
import { centavosRapido, dataSpedParaNumero, dataUsuarioParaNumero, normalizarNumero, numeroEscalado, numeroRapido, periodoIso, spedParaBr, ufDoMunicipio } from './util';

export type TipoLinha = 'item' | 'nota' | 'frete' | 'energia' | 'f100';
export const TIPOS_LINHA: readonly TipoLinha[] = ['item', 'nota', 'frete', 'energia', 'f100'];

/**
 * Tipos de linha acrescentados depois (fora de `TipoLinha` para não quebrar os mapas
 * `Record<TipoLinha, …>` de quem já usa a API; a interface adota quando quiser):
 * - servico: item de nota de serviço (A170, documento A100, estabelecimento A010);
 * - imobDepreciacao: crédito sobre encargo de depreciação/amortização do imobilizado (F120);
 * - imobAquisicao: crédito sobre o valor de aquisição do imobilizado (F130).
 * São tipos separados porque F120 e F130 têm leiautes e regras de base diferentes.
 */
export type TipoLinhaDocumento = 'servico' | 'imobDepreciacao' | 'imobAquisicao';
export const TIPOS_LINHA_DOCUMENTO: readonly TipoLinhaDocumento[] = ['servico', 'imobDepreciacao', 'imobAquisicao'];
/** Cadastros: participante (0150) e produto/serviço (0200), sob o 0140 de cada estabelecimento. */
export type TipoLinhaCadastro = 'participante' | 'produto';
export const TIPOS_LINHA_CADASTRO: readonly TipoLinhaCadastro[] = ['participante', 'produto'];
/** Todos os tipos de linha. */
export type TipoLinhaTodos = TipoLinha | TipoLinhaDocumento | TipoLinhaCadastro;
export const TIPOS_LINHA_TODOS: readonly TipoLinhaTodos[] = [...TIPOS_LINHA, ...TIPOS_LINHA_DOCUMENTO, ...TIPOS_LINHA_CADASTRO];

/** Nome de cada tipo de linha, em linguagem de contador. */
export const ROTULO_TIPO_LINHA: Record<TipoLinhaTodos, string> = {
  item: 'Itens de nota',
  nota: 'Notas',
  frete: 'Fretes (CT-e)',
  energia: 'Energia, água e gás',
  f100: 'Outras operações (F100)',
  servico: 'Notas de serviço (itens)',
  imobDepreciacao: 'Imobilizado — crédito sobre depreciação (F120)',
  imobAquisicao: 'Imobilizado — crédito sobre aquisição (F130)',
  participante: 'Participantes (0150)',
  produto: 'Produtos e serviços (0200)',
};

/** Registro principal de cada tipo de linha. */
export const REG_PRINCIPAL: Record<TipoLinhaTodos, string> = {
  item: 'C170', nota: 'C100', frete: 'D100', energia: 'C500', f100: 'F100',
  servico: 'A170', imobDepreciacao: 'F120', imobAquisicao: 'F130', participante: '0150', produto: '0200',
};
/** Registros de PIS/COFINS pareados (frete e energia). */
export const REG_COMPLEMENTO: Partial<Record<TipoLinhaTodos, { pis: string; cofins: string }>> = {
  frete: { pis: 'D101', cofins: 'D105' },
  energia: { pis: 'C501', cofins: 'C505' },
};

/**
 * Uma linha da grade. Os valores NÃO ficam aqui: leia com `valor(linha, coluna)`.
 * - item: reg = C170, doc = C100 pai
 * - nota: reg = doc = C100
 * - frete: reg = doc = D100, pis/cofins = i-ésimo D101/D105 (pareados por posição)
 * - energia: reg = doc = C500, pis/cofins = i-ésimo C501/C505
 * - f100: reg = doc = F100
 * - servico: reg = A170, doc = A100 pai, est = A010
 * - imobDepreciacao / imobAquisicao: reg = doc = F120 / F130, est = F010
 * - participante / produto: reg = doc = 0150 / 0200, est = 0140 do estabelecimento
 *
 * O parâmetro de tipo mantém `Linha` (sem argumento) restrita aos tipos de `TipoLinha`;
 * `LinhaQualquer` aceita todos.
 */
export interface Linha<T extends TipoLinhaTodos = TipoLinha> {
  tipo: T;
  e: Escrituracao;
  reg: Registro;
  doc: Registro;
  /** Registro de estabelecimento do bloco (C010, D010, F010). */
  est: Registro | null;
  pis?: Registro;
  cofins?: Registro;
}

/** Linha de qualquer tipo (inclusive serviço, imobilizado e cadastros). */
export type LinhaQualquer = Linha<TipoLinhaTodos>;

export type TipoColuna = 'texto' | 'numero' | 'data' | 'codigo';
export type OrigemColuna = 'registro' | 'complemento' | 'documento' | 'participante' | 'produto' | 'escrituracao';

export interface Coluna {
  /** Identificador estável, ex.: "C170.VL_ITEM", "C100.NUM_DOC", "0150.NOME", "periodo". */
  id: string;
  rotulo: string;
  tipo: TipoColuna;
  /** Pode ser editada na grade (campos dos registros da própria linha). */
  editavel: boolean;
  /** Largura sugerida em pixels. */
  largura?: number;
  origem: OrigemColuna;
  /** Registro e campo do leiaute de onde vem o valor (quando houver). */
  registro?: string;
  campo?: string;
  /** Casas decimais (colunas numéricas do leiaute). */
  casas?: number;
  /** Descrição longa (do leiaute) para dica de tela. */
  descricao?: string;
  /** Códigos válidos e seus significados (para listas de escolha). */
  valores?: Record<string, string>;
}

// ---------------------------------------------------------------------------
// Rótulos
// ---------------------------------------------------------------------------

const ROTULOS: Record<string, string> = {
  NUM_ITEM: 'Nº item', COD_ITEM: 'Cód. item', DESCR_COMPL: 'Descr. complementar', QTD: 'Quantidade', UNID: 'Unid.',
  VL_ITEM: 'Valor item', VL_DESC: 'Desconto', IND_MOV: 'Movim. física', CST_ICMS: 'CST ICMS', CFOP: 'CFOP', COD_NAT: 'Natureza operação',
  VL_BC_ICMS: 'Base ICMS', ALIQ_ICMS: 'Alíq. ICMS', VL_ICMS: 'Valor ICMS', VL_BC_ICMS_ST: 'Base ICMS ST', ALIQ_ST: 'Alíq. ICMS ST',
  VL_ICMS_ST: 'Valor ICMS ST', IND_APUR: 'Apuração IPI', CST_IPI: 'CST IPI', COD_ENQ: 'Enquadr. IPI', VL_BC_IPI: 'Base IPI',
  ALIQ_IPI: 'Alíq. IPI', VL_IPI: 'Valor IPI',
  CST_PIS: 'CST PIS', VL_BC_PIS: 'Base PIS', ALIQ_PIS: 'Alíq. PIS', QUANT_BC_PIS: 'Qtd. base PIS', ALIQ_PIS_QUANT: 'Alíq. PIS (R$)', VL_PIS: 'Valor PIS',
  CST_COFINS: 'CST COFINS', VL_BC_COFINS: 'Base COFINS', ALIQ_COFINS: 'Alíq. COFINS', QUANT_BC_COFINS: 'Qtd. base COFINS',
  ALIQ_COFINS_QUANT: 'Alíq. COFINS (R$)', VL_COFINS: 'Valor COFINS', COD_CTA: 'Conta contábil',
  IND_OPER: 'Operação', IND_EMIT: 'Emissão', COD_PART: 'Cód. participante', COD_MOD: 'Modelo', COD_SIT: 'Situação', SER: 'Série', SUB: 'Subsérie',
  NUM_DOC: 'Nº documento', CHV_NFE: 'Chave NF-e', DT_DOC: 'Data emissão', DT_E_S: 'Data entrada/saída', VL_DOC: 'Valor documento',
  IND_PGTO: 'Pagamento', VL_ABAT_NT: 'Abatimento não trib.', VL_MERC: 'Valor mercadorias', IND_FRT: 'Tipo frete', VL_FRT: 'Valor frete',
  VL_SEG: 'Seguro', VL_OUT_DA: 'Outras despesas', VL_PIS_ST: 'PIS ST', VL_COFINS_ST: 'COFINS ST',
  CHV_CTE: 'Chave CT-e', DT_A_P: 'Data aquisição', 'TP_CT-e': 'Tipo CT-e', CHV_CTE_REF: 'Chave CT-e ref.', VL_SERV: 'Valor serviço',
  VL_NT: 'Não tributado ICMS', COD_INF: 'Inf. complementar', IND_NAT_FRT: 'Natureza frete', NAT_BC_CRED: 'Nat. base crédito',
  DT_ENT: 'Data entrada', CHV_DOCe: 'Chave doc. eletrônico', DT_OPER: 'Data operação', VL_OPER: 'Valor operação',
  IND_ORIG_CRED: 'Origem crédito', COD_CCUS: 'Centro de custo', DESC_DOC_OPER: 'Descrição',
  CHV_NFSE: 'Chave/código NFS-e', DT_EXE_SERV: 'Data execução do serviço', VL_PIS_RET: 'PIS retido na fonte', VL_COFINS_RET: 'COFINS retida na fonte',
  VL_ISS: 'ISS', IDENT_BEM_IMOB: 'Identificação do bem', IND_UTIL_BEM_IMOB: 'Utilização do bem', VL_OPER_DEP: 'Encargo de depreciação/amortização',
  PARC_OPER_NAO_BC_CRED: 'Parcela sem direito a crédito', DESC_BEM_IMOB: 'Descrição do bem', MES_OPER_AQUIS: 'Mês/ano da aquisição',
  VL_OPER_AQUIS: 'Valor de aquisição', VL_BC_CRED: 'Base total do crédito', IND_NR_PARC: 'Parcelas (apropriação)',
  COD_PAIS: 'País', CNPJ: 'CNPJ', CPF: 'CPF', IE: 'Inscrição estadual', COD_MUN: 'Município (IBGE)', SUFRAMA: 'Inscrição Suframa', END: 'Endereço',
  NUM: 'Número', COMPL: 'Complemento', BAIRRO: 'Bairro', NOME: 'Nome', DESCR_ITEM: 'Descrição', COD_BARRA: 'Código de barras',
  COD_ANT_ITEM: 'Código anterior', UNID_INV: 'Unidade', TIPO_ITEM: 'Tipo do item', COD_NCM: 'NCM', EX_IPI: 'Exceção TIPI', COD_GEN: 'Gênero do item',
  COD_LST: 'Código do serviço (LC 116)',
};

/** Rótulos específicos por registro (prevalecem sobre os genéricos). */
const ROTULOS_REG: Record<string, string> = {
  'C100.IND_OPER': 'Operação (0=entrada, 1=saída)',
  'C100.IND_EMIT': 'Emissão (0=própria, 1=terceiros)',
  'C100.NUM_DOC': 'Nº nota',
  'C100.VL_DOC': 'Valor nota',
  'C100.VL_PIS': 'PIS da nota',
  'C100.VL_COFINS': 'COFINS da nota',
  'C100.VL_DESC': 'Desconto da nota',
  'C100.VL_BC_ICMS': 'Base ICMS da nota',
  'C100.VL_ICMS': 'ICMS da nota',
  'C100.VL_IPI': 'IPI da nota',
  'D100.IND_EMIT': 'Emissão (0=própria, 1=terceiros)',
  'D100.NUM_DOC': 'Nº CT-e',
  'D100.COD_CTA': 'Conta contábil (doc.)',
  'D100.VL_DESC': 'Desconto (doc.)',
  'C500.VL_PIS': 'PIS do documento',
  'C500.VL_COFINS': 'COFINS do documento',
  'C500.VL_ICMS': 'ICMS do documento',
  'F100.IND_OPER': 'Tipo operação (0=crédito, 1/2=receita)',
  'D105.IND_NAT_FRT': 'Natureza frete (COFINS)',
  'D105.VL_ITEM': 'Valor item (COFINS)',
  'D105.NAT_BC_CRED': 'Nat. base crédito (COFINS)',
  'D105.COD_CTA': 'Conta contábil (COFINS)',
  'C505.VL_ITEM': 'Valor item (COFINS)',
  'C505.NAT_BC_CRED': 'Nat. base crédito (COFINS)',
  'C505.COD_CTA': 'Conta contábil (COFINS)',
  'D101.COD_CTA': 'Conta contábil',
  '0150.NOME': 'Participante',
  '0150.CNPJ_CPF': 'CNPJ/CPF participante',
  '0150.UF': 'UF participante',
  '0150.IE': 'IE participante',
  '0150.COD_MUN': 'Município participante',
  '0200.DESCR_ITEM': 'Descrição produto',
  '0200.COD_NCM': 'NCM',
  '0200.TIPO_ITEM': 'Tipo do item',
  '0200.UNID_INV': 'Unid. cadastro',
  'A100.IND_OPER': 'Operação (0=contratado, 1=prestado)',
  'A100.IND_EMIT': 'Emissão (0=própria, 1=terceiros)',
  'A100.NUM_DOC': 'Nº NFS-e',
  'A100.VL_DOC': 'Valor da nota de serviço',
  'A100.VL_DESC': 'Desconto (doc.)',
  'A100.VL_BC_PIS': 'Base PIS (doc.)',
  'A100.VL_PIS': 'PIS da nota',
  'A100.VL_BC_COFINS': 'Base COFINS (doc.)',
  'A100.VL_COFINS': 'COFINS da nota',
  'F120.NAT_BC_CRED': 'Nat. base crédito (09 depreciação, 11 amortização)',
  'F130.NAT_BC_CRED': 'Nat. base crédito (10 aquisição)',
  'F130.VL_BC_PIS': 'Base PIS do mês',
  'F130.VL_BC_COFINS': 'Base COFINS do mês',
};

const CST: Record<string, string> = tabelas.cst as Record<string, string>;
const VALORES_EXTRA: Record<string, Record<string, string>> = {
  CST_PIS: CST,
  CST_COFINS: CST,
  NAT_BC_CRED: tabelas.natBcCred as Record<string, string>,
  COD_SIT: tabelas.codSit as Record<string, string>,
};

const NUMERICOS_SEM_DEC = new Set(['NUM_ITEM', 'NUM_DOC']);

function tipoDoCampo(reg: string, campo: string): { tipo: TipoColuna; casas?: number } {
  const def = leiaute.registros[reg]?.campos.find((c) => c.nome === campo);
  if (!def) return { tipo: 'texto' };
  if (campo.startsWith('DT_')) return { tipo: 'data' };
  if (def.tipo === 'N') {
    if (def.dec !== null && def.dec !== undefined) return { tipo: 'numero', casas: def.dec };
    if (NUMERICOS_SEM_DEC.has(campo)) return { tipo: 'numero', casas: 0 };
    return { tipo: 'codigo' };
  }
  if (def.valores || campo.startsWith('COD_') || campo.startsWith('IND_') || campo.startsWith('CST_') || campo === 'UNID' || campo === 'SER' || campo === 'SUB' || campo === 'NAT_BC_CRED') return { tipo: 'codigo' };
  return { tipo: 'texto' };
}

function largura(tipo: TipoColuna, campo: string): number {
  if (campo.startsWith('CHV_')) return 330;
  if (campo === 'NOME' || campo.startsWith('DESCR') || campo === 'DESC_DOC_OPER') return 240;
  if (tipo === 'numero') return 110;
  if (tipo === 'data') return 95;
  if (tipo === 'codigo') return campo === 'COD_CTA' || campo === 'COD_ITEM' ? 130 : 80;
  return 160;
}

function colunaCampo(reg: string, campo: string, origem: OrigemColuna, editavel: boolean): Coluna {
  const def = leiaute.registros[reg]?.campos.find((c) => c.nome === campo);
  const { tipo, casas } = tipoDoCampo(reg, campo);
  const id = `${reg}.${campo}`;
  return {
    id,
    rotulo: ROTULOS_REG[id] ?? ROTULOS[campo] ?? def?.descricao ?? campo,
    tipo,
    editavel,
    largura: largura(tipo, campo),
    origem,
    registro: reg,
    campo,
    casas,
    descricao: def?.descricao,
    valores: VALORES_EXTRA[campo] ?? def?.valores,
  };
}

function camposDe(reg: string): string[] {
  return leiaute.registros[reg].campos.slice(1).map((c) => c.nome);
}

// ---------------------------------------------------------------------------
// Catálogo de colunas e leitores
// ---------------------------------------------------------------------------

type Leitor = (l: LinhaQualquer) => string;

interface Catalogo {
  colunas: Coluna[];
  porId: Map<string, Coluna>;
  leitores: Map<string, Leitor>;
}

const catalogos = new Map<TipoLinhaTodos, Catalogo>();

function cadDe(l: LinhaQualquer) {
  return cadastrosDe(l.e, l.est?.campos[1] ?? '');
}

function participanteDe(l: LinhaQualquer): Registro | undefined {
  const cod = l.doc.campos[idx(l.doc.reg, 'COD_PART')];
  return cod ? cadDe(l).part.get(cod) : undefined;
}

function produtoDe(l: LinhaQualquer): Registro | undefined {
  const cod = l.reg.campos[idx(l.reg.reg, 'COD_ITEM')];
  return cod ? cadDe(l).item.get(cod) : undefined;
}

const I150 = { NOME: idx('0150', 'NOME'), CNPJ: idx('0150', 'CNPJ'), CPF: idx('0150', 'CPF'), IE: idx('0150', 'IE'), COD_MUN: idx('0150', 'COD_MUN') };

function construirCatalogo(tipo: TipoLinhaTodos): Catalogo {
  const colunas: Coluna[] = [];
  const leitores = new Map<string, Leitor>();
  const add = (c: Coluna, f: Leitor) => {
    colunas.push(c);
    leitores.set(c.id, f);
  };
  const principal = REG_PRINCIPAL[tipo];
  const comp = REG_COMPLEMENTO[tipo];

  // escrituração
  add({ id: 'periodo', rotulo: 'Período', tipo: 'codigo', editavel: false, largura: 80, origem: 'escrituracao' }, (l) => periodoIso(l.e.periodo));
  const cadastro = tipo === 'participante' || tipo === 'produto';
  const iCnpj0140 = idx('0140', 'CNPJ');
  add({ id: 'cnpjEstab', rotulo: 'CNPJ estabelecimento', tipo: 'codigo', editavel: false, largura: 130, origem: 'escrituracao' }, (l) =>
    l.est?.reg === '0140' ? l.est.campos[iCnpj0140] ?? '' : l.est?.campos[1] ?? '',
  );

  // documento (para itens: campos da nota; para serviços: campos da NFS-e)
  if (tipo === 'item' || tipo === 'servico') {
    const reg = tipo === 'item' ? 'C100' : 'A100';
    const campos =
      tipo === 'item'
        ? ['IND_OPER', 'IND_EMIT', 'COD_MOD', 'COD_SIT', 'NUM_DOC', 'SER', 'CHV_NFE', 'DT_DOC', 'DT_E_S', 'VL_DOC', 'COD_PART']
        : ['IND_OPER', 'IND_EMIT', 'COD_SIT', 'NUM_DOC', 'SER', 'CHV_NFSE', 'DT_DOC', 'DT_EXE_SERV', 'VL_DOC', 'COD_PART'];
    for (const campo of campos) {
      const i = idx(reg, campo);
      add(colunaCampo(reg, campo, 'documento', false), (l) => l.doc.campos[i] ?? '');
    }
  }

  // participante (documentos que têm COD_PART)
  if (!cadastro && tipo !== 'imobDepreciacao' && tipo !== 'imobAquisicao') {
    add({ id: '0150.CNPJ_CPF', rotulo: ROTULOS_REG['0150.CNPJ_CPF'], tipo: 'codigo', editavel: false, largura: 130, origem: 'participante', registro: '0150' }, (l) => {
      const p = participanteDe(l);
      return p ? p.campos[I150.CNPJ] || p.campos[I150.CPF] || '' : '';
    });
    add({ ...colunaCampo('0150', 'NOME', 'participante', false), largura: 240 }, (l) => participanteDe(l)?.campos[I150.NOME] ?? '');
    add({ id: '0150.UF', rotulo: ROTULOS_REG['0150.UF'], tipo: 'codigo', editavel: false, largura: 50, origem: 'participante', registro: '0150' }, (l) => {
      const p = participanteDe(l);
      return p ? ufDoMunicipio(p.campos[I150.COD_MUN] ?? '') : '';
    });
    add(colunaCampo('0150', 'IE', 'participante', false), (l) => participanteDe(l)?.campos[I150.IE] ?? '');
  }

  // registro principal (no cadastro, o código não é editável: renomear exigiria mexer em todos os documentos)
  for (const campo of camposDe(principal)) {
    const i = idx(principal, campo);
    const editavel = !(cadastro && (campo === 'COD_PART' || campo === 'COD_ITEM'));
    add(colunaCampo(principal, campo, 'registro', editavel), (l) => l.reg.campos[i] ?? '');
  }

  // complementos PIS/COFINS
  if (comp) {
    for (const campo of camposDe(comp.pis)) {
      const i = idx(comp.pis, campo);
      add(colunaCampo(comp.pis, campo, 'complemento', true), (l) => l.pis?.campos[i] ?? '');
    }
    for (const campo of camposDe(comp.cofins)) {
      const i = idx(comp.cofins, campo);
      add(colunaCampo(comp.cofins, campo, 'complemento', true), (l) => l.cofins?.campos[i] ?? '');
    }
  }

  // produto
  if (tipo === 'item' || tipo === 'f100' || tipo === 'servico') {
    for (const campo of ['DESCR_ITEM', 'COD_NCM', 'TIPO_ITEM', 'UNID_INV']) {
      const i = idx('0200', campo);
      add(colunaCampo('0200', campo, 'produto', false), (l) => produtoDe(l)?.campos[i] ?? '');
    }
  }

  // participante: UF pelo município
  if (tipo === 'participante') {
    const iMun = idx('0150', 'COD_MUN');
    add({ id: 'ufParticipante', rotulo: 'UF', tipo: 'codigo', editavel: false, largura: 50, origem: 'registro' }, (l) => ufDoMunicipio(l.reg.campos[iMun] ?? ''));
  }
  // produto: registros filhos (alteração de descrição 0205, código ANP 0206, código de grupo/marca 0208)
  if (tipo === 'produto') {
    for (const [reg, rotulo] of [
      ['0205', 'Alterações de descrição (0205)'],
      ['0206', 'Código ANP (0206)'],
      ['0208', 'Grupo/marca comercial (0208)'],
    ] as const) {
      add({ id: `qtd${reg}`, rotulo, tipo: 'numero', editavel: false, largura: 90, origem: 'registro', casas: 0 }, (l) => {
        let n = 0;
        for (const f of l.reg.filhos) if (f.reg === reg) n++;
        return String(n);
      });
    }
  }

  // nota: quantidade de itens
  if (tipo === 'nota') {
    add({ id: 'qtdItens', rotulo: 'Qtd. itens', tipo: 'numero', editavel: false, largura: 70, origem: 'registro', casas: 0 }, (l) => {
      let n = 0;
      for (const f of l.reg.filhos) if (f.reg === 'C170') n++;
      return String(n);
    });
  }
  return { colunas, porId: new Map(colunas.map((c) => [c.id, c])), leitores };
}

function catalogo(tipo: TipoLinhaTodos): Catalogo {
  let c = catalogos.get(tipo);
  if (!c) catalogos.set(tipo, (c = construirCatalogo(tipo)));
  return c;
}

/** Catálogo de colunas do tipo de linha (na ordem sugerida para a grade). */
export function colunas(tipo: TipoLinhaTodos): Coluna[] {
  return catalogo(tipo).colunas;
}

/** Uma coluna pelo id (undefined se não existir para o tipo). */
export function coluna(tipo: TipoLinhaTodos, id: string): Coluna | undefined {
  return catalogo(tipo).porId.get(id);
}

/** Função de leitura de uma coluna (para laços quentes: evita procurar a coluna a cada linha). */
export function leitor(tipo: TipoLinhaTodos, id: string): (l: LinhaQualquer) => string {
  const f = catalogo(tipo).leitores.get(id);
  if (!f) throw new Error(`Coluna "${id}" não existe nas linhas do tipo ${tipo}.`);
  return f;
}

/** Valor bruto (texto do arquivo) da coluna na linha. */
export function valor(l: LinhaQualquer, colunaId: string): string {
  return leitor(l.tipo, colunaId)(l);
}

/** Valor para exibir: datas em DD/MM/AAAA; o resto como no arquivo. */
export function valorExibicao(l: LinhaQualquer, colunaId: string): string {
  const v = valor(l, colunaId);
  const c = coluna(l.tipo, colunaId);
  return c?.tipo === 'data' ? spedParaBr(v) : v;
}

// ---------------------------------------------------------------------------
// Montagem das linhas
// ---------------------------------------------------------------------------

function blocos(e: Escrituracao, abertura: string): Registro[] {
  return e.raiz.filhos.filter((b) => b.reg === abertura);
}

function pares(tipo: TipoLinha, e: Escrituracao, doc: Registro, est: Registro, out: LinhaQualquer[], pisReg: string, cofinsReg: string): void {
  const pis: Registro[] = [];
  const cofins: Registro[] = [];
  for (const f of doc.filhos) {
    if (f.reg === pisReg) pis.push(f);
    else if (f.reg === cofinsReg) cofins.push(f);
  }
  const n = Math.max(pis.length, cofins.length, 1);
  for (let k = 0; k < n; k++) out.push({ tipo, e, reg: doc, doc, est, pis: pis[k], cofins: cofins[k] });
}

function montar(e: Escrituracao, tipo: TipoLinhaTodos): LinhaQualquer[] {
  const out: LinhaQualquer[] = [];
  switch (tipo) {
    case 'item':
    case 'nota':
    case 'energia':
      for (const b of blocos(e, 'C001'))
        for (const est of b.filhos) {
          if (est.reg !== 'C010') continue;
          for (const doc of est.filhos) {
            if (tipo === 'energia') {
              if (doc.reg === 'C500') pares(tipo, e, doc, est, out, 'C501', 'C505');
            } else if (doc.reg === 'C100') {
              if (tipo === 'nota') out.push({ tipo, e, reg: doc, doc, est });
              else for (const it of doc.filhos) if (it.reg === 'C170') out.push({ tipo, e, reg: it, doc, est });
            }
          }
        }
      break;
    case 'frete':
      for (const b of blocos(e, 'D001'))
        for (const est of b.filhos) if (est.reg === 'D010') for (const doc of est.filhos) if (doc.reg === 'D100') pares(tipo, e, doc, est, out, 'D101', 'D105');
      break;
    case 'f100':
    case 'imobDepreciacao':
    case 'imobAquisicao': {
      const reg = REG_PRINCIPAL[tipo];
      for (const b of blocos(e, 'F001'))
        for (const est of b.filhos) if (est.reg === 'F010') for (const doc of est.filhos) if (doc.reg === reg) out.push({ tipo, e, reg: doc, doc, est });
      break;
    }
    case 'servico':
      for (const b of blocos(e, 'A001'))
        for (const est of b.filhos) {
          if (est.reg !== 'A010') continue;
          for (const doc of est.filhos) if (doc.reg === 'A100') for (const it of doc.filhos) if (it.reg === 'A170') out.push({ tipo, e, reg: it, doc, est });
        }
      break;
    case 'participante':
    case 'produto': {
      const reg = REG_PRINCIPAL[tipo];
      for (const b of blocos(e, '0001'))
        for (const est of b.filhos) if (est.reg === '0140') for (const r of est.filhos) if (r.reg === reg) out.push({ tipo, e, reg: r, doc: r, est });
      break;
    }
  }
  return out;
}

/**
 * Linhas de um tipo em uma escrituração, em ordem de arquivo. O array devolvido é
 * reaproveitado (mesma identidade) até a estrutura da escrituração mudar.
 */
export function linhasDe<T extends TipoLinhaTodos>(e: Escrituracao, tipo: T): Linha<T>[] {
  const chave = 'linhas:' + tipo;
  return (lerCache<LinhaQualquer[]>(e, chave) ?? gravarCache(e, chave, montar(e, tipo))) as Linha<T>[];
}

/** Linhas de várias escriturações juntas (ordem das escriturações recebidas). */
export function linhasDeTodas<T extends TipoLinhaTodos>(escrituracoes: Escrituracao[], tipo: T): Linha<T>[] {
  const out: Linha<T>[] = [];
  for (const e of escrituracoes) {
    const ls = linhasDe(e, tipo);
    for (let i = 0; i < ls.length; i++) out.push(ls[i]);
  }
  return out;
}

/** A linha ainda está na árvore? (false se o registro, o documento ou o par foram excluídos) */
export function linhaAnexada(l: LinhaQualquer): boolean {
  const presa = (r: Registro | undefined) => {
    if (!r) return true;
    let p: Registro | null = r;
    while (p.pai) p = p.pai;
    return p === l.e.raiz;
  };
  return presa(l.reg) && presa(l.pis) && presa(l.cofins);
}

// ---------------------------------------------------------------------------
// Filtro
// ---------------------------------------------------------------------------

export type Operador = 'igual' | 'diferente' | 'contem' | 'comeca' | 'em' | 'entre' | 'maior' | 'menor' | 'vazio' | 'naoVazio';

export const OPERADORES: Record<Operador, string> = {
  igual: 'igual a',
  diferente: 'diferente de',
  contem: 'contém',
  comeca: 'começa com',
  em: 'está na lista',
  entre: 'entre',
  maior: 'maior que',
  menor: 'menor que',
  vazio: 'está vazio',
  naoVazio: 'não está vazio',
};

/**
 * Condição sobre uma coluna. Números aceitam "1.234,56", "1234.56" ou number; datas
 * aceitam "DD/MM/AAAA", "AAAA-MM-DD" ou "DDMMAAAA". Em `entre`, os limites são inclusivos.
 * `maior`/`menor` são estritos. Texto compara sem diferenciar maiúsculas.
 */
export interface Filtro {
  coluna: string;
  op: Operador;
  valor?: string | number;
  /** Limite superior do `entre`. */
  valor2?: string | number;
  /** Lista do operador `em`. */
  valores?: (string | number)[];
}

/** Busca textual livre: linha passa se ALGUMA das colunas contém o texto (sem diferenciar maiúsculas). */
export interface Busca {
  texto: string;
  /** Colunas onde buscar (padrão: todas as colunas de texto e código). */
  colunas?: string[];
}

type Predicado = (l: LinhaQualquer) => boolean;

function chaveComparacao(tipo: TipoColuna, v: string | number | undefined): number | string {
  if (v === undefined || v === null) return tipo === 'texto' || tipo === 'codigo' ? '' : NaN;
  if (tipo === 'numero') {
    // comparação exata em inteiros escalados (ver `numeroEscalado`), não em ponto flutuante
    const n = normalizarNumero(v);
    return n === null ? NaN : numeroEscalado(n);
  }
  if (tipo === 'data') return dataUsuarioParaNumero(v);
  return tipo === 'texto' ? String(v).trim().toUpperCase() : String(v).trim();
}

function compilarFiltro(tipoLinha: TipoLinhaTodos, f: Filtro): Predicado {
  const col = coluna(tipoLinha, f.coluna);
  if (!col) throw new Error(`Filtro: coluna "${f.coluna}" não existe nas linhas do tipo ${tipoLinha}.`);
  const ler = leitor(tipoLinha, f.coluna);
  const t = col.tipo;
  if (f.op === 'vazio') return (l) => ler(l) === '';
  if (f.op === 'naoVazio') return (l) => ler(l) !== '';

  if (t === 'numero' || t === 'data') {
    const conv = t === 'numero' ? numeroEscalado : dataSpedParaNumero;
    const a = chaveComparacao(t, f.valor) as number;
    const b = chaveComparacao(t, f.valor2) as number;
    switch (f.op) {
      case 'igual':
        return (l) => conv(ler(l)) === a;
      case 'diferente':
        return (l) => conv(ler(l)) !== a;
      case 'maior':
        return (l) => conv(ler(l)) > a;
      case 'menor':
        return (l) => conv(ler(l)) < a;
      case 'entre':
        return (l) => {
          const v = conv(ler(l));
          return v >= a && v <= b;
        };
      case 'em': {
        const s = new Set((f.valores ?? []).map((x) => chaveComparacao(t, x) as number));
        return (l) => s.has(conv(ler(l)));
      }
      case 'contem': {
        const q = String(f.valor ?? '');
        return (l) => ler(l).includes(q);
      }
      case 'comeca': {
        const q = String(f.valor ?? '');
        return (l) => ler(l).startsWith(q);
      }
    }
  }
  // texto e código
  const maiusc = t === 'texto';
  const norm = (s: string) => (maiusc ? s.toUpperCase() : s);
  const q = chaveComparacao(t, f.valor) as string;
  switch (f.op) {
    case 'igual':
      return (l) => norm(ler(l)) === q;
    case 'diferente':
      return (l) => norm(ler(l)) !== q;
    case 'contem': {
      const qu = q.toUpperCase();
      return (l) => {
        const v = ler(l);
        return v.includes(q) || v.toUpperCase().includes(qu);
      };
    }
    case 'comeca': {
      const qu = q.toUpperCase();
      return (l) => {
        const v = ler(l);
        return v.startsWith(q) || v.toUpperCase().startsWith(qu);
      };
    }
    case 'em': {
      const s = new Set((f.valores ?? []).map((x) => chaveComparacao(t, x) as string));
      return (l) => s.has(norm(ler(l)));
    }
    case 'maior':
      return (l) => norm(ler(l)) > q;
    case 'menor':
      return (l) => norm(ler(l)) < q;
    case 'entre': {
      const q2 = chaveComparacao(t, f.valor2) as string;
      return (l) => {
        const v = norm(ler(l));
        return v >= q && v <= q2;
      };
    }
  }
  throw new Error(`Operador desconhecido: ${String(f.op)}`);
}

/** Valida filtros (coluna e operador) e devolve mensagens de erro em português. */
export function validarFiltros(tipo: TipoLinhaTodos, filtros: Filtro[]): string[] {
  const erros: string[] = [];
  for (const f of filtros) {
    if (!coluna(tipo, f.coluna)) erros.push(`Coluna "${f.coluna}" não existe nas linhas do tipo ${tipo}.`);
    if (!(f.op in OPERADORES)) erros.push(`Operador "${f.op}" desconhecido.`);
    if (f.op === 'em' && !Array.isArray(f.valores)) erros.push(`Filtro "em" na coluna ${f.coluna} precisa da lista "valores".`);
  }
  return erros;
}

/**
 * Filtra linhas (todas devem ser do mesmo tipo). Todos os filtros precisam ser atendidos
 * (E lógico); a busca textual, se houver, também. Devolve um array novo.
 */
export function filtrar<L extends LinhaQualquer>(linhas: L[], filtros: Filtro[], busca?: Busca | string): L[] {
  if (!linhas.length) return [];
  const tipo = linhas[0].tipo;
  const preds = filtros.map((f) => compilarFiltro(tipo, f));
  const b = typeof busca === 'string' ? { texto: busca } : busca;
  const texto = b?.texto.trim() ?? '';
  if (texto) {
    const ids = b?.colunas ?? colunas(tipo).filter((c) => c.tipo === 'texto' || c.tipo === 'codigo').map((c) => c.id);
    const lers = ids.map((id) => leitor(tipo, id));
    const qu = texto.toUpperCase();
    preds.push((l) => {
      for (let k = 0; k < lers.length; k++) {
        const v = lers[k](l);
        if (v && (v.includes(texto) || v.toUpperCase().includes(qu))) return true;
      }
      return false;
    });
  }
  if (!preds.length) return linhas.slice();
  const out: L[] = [];
  const n = preds.length;
  outer: for (let i = 0; i < linhas.length; i++) {
    const l = linhas[i];
    for (let k = 0; k < n; k++) if (!preds[k](l)) continue outer;
    out.push(l);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Ordenação
// ---------------------------------------------------------------------------

export interface Ordenacao {
  coluna: string;
  /** true = decrescente. */
  desc?: boolean;
}

/** Ordena (estável) por uma ou mais colunas, comparando números e datas pelo valor. Devolve array novo. */
export function ordenar<L extends LinhaQualquer>(linhas: L[], criterios: Ordenacao[]): L[] {
  if (!linhas.length || !criterios.length) return linhas.slice();
  const tipo = linhas[0].tipo;
  const n = linhas.length;
  const chaves = criterios.map((c) => {
    const col = coluna(tipo, c.coluna);
    if (!col) throw new Error(`Ordenação: coluna "${c.coluna}" não existe.`);
    const ler = leitor(tipo, c.coluna);
    if (col.tipo === 'numero' || col.tipo === 'data') {
      const arr = new Float64Array(n);
      const conv = col.tipo === 'numero' ? numeroRapido : dataSpedParaNumero;
      for (let i = 0; i < n; i++) {
        const v = conv(ler(linhas[i]));
        arr[i] = Number.isNaN(v) ? -Infinity : v;
      }
      return { num: arr, txt: null as string[] | null, sinal: c.desc ? -1 : 1 };
    }
    const arr = new Array<string>(n);
    for (let i = 0; i < n; i++) arr[i] = col.tipo === 'texto' ? ler(linhas[i]).toUpperCase() : ler(linhas[i]);
    return { num: null as Float64Array | null, txt: arr, sinal: c.desc ? -1 : 1 };
  });
  const ordem = new Uint32Array(n);
  for (let i = 0; i < n; i++) ordem[i] = i;
  const arr = Array.from(ordem);
  arr.sort((a, b) => {
    for (const k of chaves) {
      let d = 0;
      if (k.num) d = k.num[a] - k.num[b];
      else {
        const x = k.txt![a];
        const y = k.txt![b];
        d = x < y ? -1 : x > y ? 1 : 0;
      }
      if (d) return d * k.sinal;
    }
    return a - b;
  });
  return arr.map((i) => linhas[i]);
}

// ---------------------------------------------------------------------------
// Somas (rodapé / seleção)
// ---------------------------------------------------------------------------

/** Somas em centavos. */
export interface Totais {
  linhas: number;
  /**
   * Valor do item (C170/A170.VL_ITEM, D101/C501.VL_ITEM, F100.VL_OPER; nota: VL_MERC;
   * F120: encargo de depreciação; F130: valor de aquisição). Cadastros só contam linhas.
   */
  valorItem: number;
  desconto: number;
  basePis: number;
  valorPis: number;
  baseCofins: number;
  valorCofins: number;
  /** Nota: VL_DOC; frete/energia: VL_DOC do documento (contado uma vez por documento). */
  valorDocumento: number;
}

export function totaisVazios(): Totais {
  return { linhas: 0, valorItem: 0, desconto: 0, basePis: 0, valorPis: 0, baseCofins: 0, valorCofins: 0, valorDocumento: 0 };
}

const IC170 = {
  item: idx('C170', 'VL_ITEM'), desc: idx('C170', 'VL_DESC'),
  bp: idx('C170', 'VL_BC_PIS'), vp: idx('C170', 'VL_PIS'), bc: idx('C170', 'VL_BC_COFINS'), vc: idx('C170', 'VL_COFINS'),
};
const IF100 = { item: idx('F100', 'VL_OPER'), bp: idx('F100', 'VL_BC_PIS'), vp: idx('F100', 'VL_PIS'), bc: idx('F100', 'VL_BC_COFINS'), vc: idx('F100', 'VL_COFINS') };
const IPAR = {
  D101: { item: idx('D101', 'VL_ITEM'), b: idx('D101', 'VL_BC_PIS'), v: idx('D101', 'VL_PIS') },
  D105: { b: idx('D105', 'VL_BC_COFINS'), v: idx('D105', 'VL_COFINS') },
  C501: { item: idx('C501', 'VL_ITEM'), b: idx('C501', 'VL_BC_PIS'), v: idx('C501', 'VL_PIS') },
  C505: { b: idx('C505', 'VL_BC_COFINS'), v: idx('C505', 'VL_COFINS') },
};
const IA170 = {
  item: idx('A170', 'VL_ITEM'), desc: idx('A170', 'VL_DESC'),
  bp: idx('A170', 'VL_BC_PIS'), vp: idx('A170', 'VL_PIS'), bc: idx('A170', 'VL_BC_COFINS'), vc: idx('A170', 'VL_COFINS'),
};
const IF120 = { item: idx('F120', 'VL_OPER_DEP'), bp: idx('F120', 'VL_BC_PIS'), vp: idx('F120', 'VL_PIS'), bc: idx('F120', 'VL_BC_COFINS'), vc: idx('F120', 'VL_COFINS') };
const IF130 = { item: idx('F130', 'VL_OPER_AQUIS'), bp: idx('F130', 'VL_BC_PIS'), vp: idx('F130', 'VL_PIS'), bc: idx('F130', 'VL_BC_COFINS'), vc: idx('F130', 'VL_COFINS') };
const IC100 = { merc: idx('C100', 'VL_MERC'), desc: idx('C100', 'VL_DESC'), doc: idx('C100', 'VL_DOC'), vp: idx('C100', 'VL_PIS'), vc: idx('C100', 'VL_COFINS') };

/** Soma valores, bases e tributos de um conjunto de linhas (do mesmo tipo ou não). */
export function somar(linhas: Iterable<LinhaQualquer>): Totais {
  const t = totaisVazios();
  const docsVistos = new Set<Registro>();
  for (const l of linhas) {
    t.linhas++;
    const c = l.reg.campos;
    switch (l.tipo) {
      case 'item':
        t.valorItem += centavosRapido(c[IC170.item]);
        t.desconto += centavosRapido(c[IC170.desc]);
        t.basePis += centavosRapido(c[IC170.bp]);
        t.valorPis += centavosRapido(c[IC170.vp]);
        t.baseCofins += centavosRapido(c[IC170.bc]);
        t.valorCofins += centavosRapido(c[IC170.vc]);
        break;
      case 'nota':
        t.valorItem += centavosRapido(c[IC100.merc]);
        t.desconto += centavosRapido(c[IC100.desc]);
        t.valorDocumento += centavosRapido(c[IC100.doc]);
        t.valorPis += centavosRapido(c[IC100.vp]);
        t.valorCofins += centavosRapido(c[IC100.vc]);
        for (const it of l.reg.filhos) {
          if (it.reg !== 'C170') continue;
          t.basePis += centavosRapido(it.campos[IC170.bp]);
          t.baseCofins += centavosRapido(it.campos[IC170.bc]);
        }
        break;
      case 'f100':
      case 'imobDepreciacao':
      case 'imobAquisicao': {
        const ix = l.tipo === 'f100' ? IF100 : l.tipo === 'imobDepreciacao' ? IF120 : IF130;
        t.valorItem += centavosRapido(c[ix.item]);
        t.basePis += centavosRapido(c[ix.bp]);
        t.valorPis += centavosRapido(c[ix.vp]);
        t.baseCofins += centavosRapido(c[ix.bc]);
        t.valorCofins += centavosRapido(c[ix.vc]);
        break;
      }
      case 'servico':
        t.valorItem += centavosRapido(c[IA170.item]);
        t.desconto += centavosRapido(c[IA170.desc]);
        t.basePis += centavosRapido(c[IA170.bp]);
        t.valorPis += centavosRapido(c[IA170.vp]);
        t.baseCofins += centavosRapido(c[IA170.bc]);
        t.valorCofins += centavosRapido(c[IA170.vc]);
        break;
      case 'frete':
      case 'energia': {
        const p = l.tipo === 'frete' ? IPAR.D101 : IPAR.C501;
        const q = l.tipo === 'frete' ? IPAR.D105 : IPAR.C505;
        if (l.pis) {
          t.valorItem += centavosRapido(l.pis.campos[p.item]);
          t.basePis += centavosRapido(l.pis.campos[p.b]);
          t.valorPis += centavosRapido(l.pis.campos[p.v]);
        }
        if (l.cofins) {
          t.baseCofins += centavosRapido(l.cofins.campos[q.b]);
          t.valorCofins += centavosRapido(l.cofins.campos[q.v]);
        }
        if (!docsVistos.has(l.doc)) {
          docsVistos.add(l.doc);
          t.valorDocumento += centavosRapido(l.doc.campos[idx(l.doc.reg, 'VL_DOC')]);
        }
        break;
      }
    }
  }
  return t;
}
