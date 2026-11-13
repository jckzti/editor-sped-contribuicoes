/**
 * Conversão de XML de NF-e (nfeProc/NFe) e CT-e (cteProc/CTe) para os tipos do pacote
 * de importação. Funciona no navegador e no Node (fast-xml-parser).
 *
 * ATENÇÃO FISCAL — nota de TERCEIROS (entrada):
 * - o CFOP do XML é o do emitente (saída). É convertido para o de entrada só quando o
 *   par é inequívoco (`converterCfopEntrada`); nas vendas (5101/5102, 5401–5405...) a
 *   entrada depende de insumo × revenda: fica 1949/2949 provisório e pendente (ou segue
 *   `opcoes.finalidade`); sem par conhecido, idem. Nunca gera CFOP inexistente;
 * - a data de entrada é a de emissão, com pendência (o dhSaiEnt do XML é a saída do fornecedor);
 * - os CST de PIS/COFINS do XML também são os do emitente (de receita) e NÃO servem
 *   como CST de crédito. A entrada fica com CST "98", base, alíquota e valor zerados,
 *   e o item é marcado como pendente (`pendencias`) para o usuário definir a tributação
 *   por regra (ex.: "CFOP 1101 + NCM 4821 → CST 50, 1,65%/7,6%, base = valor − ICMS").
 * - ICMS e IPI são copiados do XML.
 * Para nota de emissão PRÓPRIA, CFOP e CST de PIS/COFINS do XML são mantidos.
 */
import { XMLParser } from 'fast-xml-parser';
import type { FreteImport, ItemImport, NotaImport, ParticipanteImport, TributoImport } from './importacao.tipos';
import { soDigitos } from './util';

type No = Record<string, unknown>;

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '@',
  removeNSPrefix: true,
  parseTagValue: false,
  parseAttributeValue: false,
  trimValues: true,
  isArray: (nome) => nome === 'det' || nome === 'dup' || nome === 'detPag' || nome === 'infQ' || nome === 'Comp',
});

/** Nota convertida do XML + pendências para a interface avisar. */
export interface NotaXml extends NotaImport {
  /** Mensagens do que precisa ser revisto (ex.: tributação de PIS/COFINS da entrada a definir). */
  pendencias: string[];
}

export interface FreteXml extends FreteImport {
  pendencias: string[];
}

function no(o: unknown, ...caminho: string[]): No | undefined {
  let atual: unknown = o;
  for (const c of caminho) {
    if (!atual || typeof atual !== 'object') return undefined;
    atual = (atual as No)[c];
  }
  return atual && typeof atual === 'object' ? (atual as No) : undefined;
}

function txt(o: No | undefined, campo: string): string {
  const v = o?.[campo];
  if (v === undefined || v === null) return '';
  if (typeof v === 'object') return String((v as No)['#text'] ?? '');
  return String(v);
}

/** O único filho de um nó com nome desconhecido (ex.: ICMS00, ICMS20, PISAliq...). */
function unicoFilho(o: No | undefined): No | undefined {
  if (!o) return undefined;
  for (const [k, v] of Object.entries(o)) if (!k.startsWith('@') && v && typeof v === 'object') return v as No;
  return undefined;
}

function data(dh: string): string {
  return /^\d{4}-\d{2}-\d{2}/.test(dh) ? dh.slice(0, 10) : '';
}

function participante(x: No | undefined, ender: string): ParticipanteImport {
  const e = no(x, ender);
  const doc = txt(x, 'CNPJ') || txt(x, 'CPF');
  const cPais = txt(e, 'cPais');
  return {
    cnpjCpf: doc || undefined,
    nome: txt(x, 'xNome'),
    ie: txt(x, 'IE') || undefined,
    codMunicipio: txt(e, 'cMun') || undefined,
    codPais: cPais && cPais !== '1058' ? cPais : doc ? '1058' : cPais || undefined,
    endereco: txt(e, 'xLgr') || undefined,
    numero: txt(e, 'nro') || undefined,
    complemento: txt(e, 'xCpl') || undefined,
    bairro: txt(e, 'xBairro') || undefined,
  };
}

/**
 * De-para explícito (operações internas, 5xxx → 1xxx; as interestaduais 6xxx → 2xxx usam o
 * mesmo par trocando o primeiro dígito) do CFOP de saída do fornecedor para o CFOP de
 * entrada do destinatário, só onde o par é inequívoco na Tabela de CFOP (Convênio s/nº de
 * 1970, Anexo). Quem não está aqui fica pendente: o editor não inventa CFOP.
 */
const PARES_CFOP: Record<string, string> = {
  // industrialização por encomenda e conta e ordem
  '5124': '1124', '5125': '1125',
  '5901': '1901', '5902': '1902', '5903': '1903', '5924': '1924', '5925': '1925',
  // combustíveis e lubrificantes (o destino já está no CFOP do fornecedor)
  '5651': '1651', '5652': '1652', '5653': '1653', '5654': '1651', '5655': '1652', '5656': '1653',
  // remessas e retornos
  '5905': '1905', '5906': '1906', '5907': '1907', '5908': '1908', '5909': '1909',
  '5910': '1910', '5911': '1911', '5912': '1912', '5913': '1913', '5914': '1914', '5915': '1915', '5916': '1916',
  '5917': '1917', '5918': '1918', '5919': '1919', '5920': '1920', '5921': '1921', '5922': '1922', '5923': '1923',
  // serviço tributado pelo ISSQN; outras saídas
  '5933': '1933', '5949': '1949',
};

/**
 * Vendas em que o CFOP de entrada depende do que o COMPRADOR faz com a mercadoria
 * (industrialização/insumo × comercialização/revenda): a escolha é do usuário, por regra.
 */
const VENDAS_INSUMO_REVENDA: Record<string, [insumo: string, revenda: string]> = {
  '5101': ['1101', '1102'], '5102': ['1101', '1102'], '5103': ['1101', '1102'], '5104': ['1101', '1102'],
  '5105': ['1101', '1102'], '5106': ['1101', '1102'],
  '5401': ['1401', '1403'], '5402': ['1401', '1403'], '5403': ['1401', '1403'], '5405': ['1401', '1403'],
};

export type ConversaoCfop =
  | { situacao: 'convertido'; cfop: string }
  | { situacao: 'insumo-ou-revenda'; insumo: string; revenda: string }
  | { situacao: 'sem-par' };

/** Como converter o CFOP de saída do fornecedor (5/6xxx) para o de entrada da empresa. */
export function converterCfopEntrada(cfop: string): ConversaoCfop {
  const uf = cfop[0];
  if (uf !== '5' && uf !== '6') return { situacao: 'sem-par' };
  const interno = '5' + cfop.slice(1);
  const ent = uf === '5' ? '1' : '2';
  const par = PARES_CFOP[interno];
  if (par) return { situacao: 'convertido', cfop: ent + par.slice(1) };
  const v = VENDAS_INSUMO_REVENDA[interno];
  if (v) return { situacao: 'insumo-ou-revenda', insumo: ent + v[0].slice(1), revenda: ent + v[1].slice(1) };
  return { situacao: 'sem-par' };
}

/**
 * CFOP de saída do emitente → CFOP de entrada do destinatário, quando o par é inequívoco
 * (ver `converterCfopEntrada`). Sem par conhecido (ou insumo × revenda), devolve "" — não
 * existe mais a troca cega do primeiro dígito (5405 → 1405 não existe).
 */
export function cfopEntradaCorrespondente(cfop: string): string {
  const c = converterCfopEntrada(cfop);
  return c.situacao === 'convertido' ? c.cfop : '';
}

/** Escolha do usuário para as vendas insumo × revenda (`opcoes.finalidade` de `xmlNfeParaNota`). */
export type FinalidadeCompra = 'insumo' | 'revenda';

/** CFOP provisório de entrada (pendente) quando não há par ou a escolha insumo × revenda não foi feita. */
const CFOP_PENDENTE: Record<string, string> = { '5': '1949', '6': '2949' };

function tributoXml(imp: No | undefined, grupo: 'PIS' | 'COFINS'): TributoImport {
  const g = unicoFilho(no(imp, grupo));
  const cst = txt(g, 'CST') || '99';
  const base = txt(g, 'vBC');
  const aliq = txt(g, grupo === 'PIS' ? 'pPIS' : 'pCOFINS');
  const valor = txt(g, grupo === 'PIS' ? 'vPIS' : 'vCOFINS');
  return { cst, base: base || (aliq ? undefined : '0'), aliquota: aliq || (base ? undefined : '0'), valor: valor || '0' };
}

const PENDENTE: TributoImport = { cst: '98', base: '0', aliquota: '0', valor: '0' };

function raizNFe(doc: No): No {
  const nfe = no(doc, 'nfeProc', 'NFe') ?? no(doc, 'NFe');
  const inf = no(nfe, 'infNFe');
  if (!inf) throw new Error('XML não é uma NF-e (não encontrei NFe/infNFe).');
  return inf;
}

/**
 * Converte o XML de uma NF-e em `NotaImport`, decidindo entrada/saída e emissão
 * própria/terceiros pelo CNPJ da empresa (14 dígitos).
 * - Emitente = empresa: emissão própria; operação pelo tpNF (0 entrada, 1 saída);
 *   participante = destinatário.
 * - Destinatário = empresa: emissão de terceiros; tpNF 1 → entrada (tpNF 0 → saída,
 *   ex.: nota de entrada emitida pelo fornecedor em devolução); participante = emitente.
 * Lança erro se a empresa não for emitente nem destinatária.
 */
export function xmlNfeParaNota(xmlTexto: string, cnpjEmpresa: string, opcoes: { finalidade?: FinalidadeCompra } = {}): NotaXml {
  const doc = parser.parse(xmlTexto) as No;
  const inf = raizNFe(doc);
  const ide = no(inf, 'ide');
  const emit = no(inf, 'emit');
  const dest = no(inf, 'dest');
  const cnpj = soDigitos(cnpjEmpresa);
  const cnpjEmit = txt(emit, 'CNPJ') || txt(emit, 'CPF');
  const cnpjDest = txt(dest, 'CNPJ') || txt(dest, 'CPF');
  let emissao: 'propria' | 'terceiros';
  if (cnpjEmit === cnpj) emissao = 'propria';
  else if (cnpjDest === cnpj) emissao = 'terceiros';
  else throw new Error(`O CNPJ ${cnpj} não é emitente (${cnpjEmit}) nem destinatário (${cnpjDest}) desta NF-e.`);
  const tpNF = txt(ide, 'tpNF');
  const operacao: 'entrada' | 'saida' = emissao === 'propria' ? (tpNF === '0' ? 'entrada' : 'saida') : tpNF === '0' ? 'saida' : 'entrada';
  const entradaTerceiros = emissao === 'terceiros' && operacao === 'entrada';
  const pendencias: string[] = [];

  const chave = soDigitos(txt(inf, '@Id')) || txt(no(doc, 'nfeProc', 'protNFe', 'infProt'), 'chNFe');
  const dets = (inf['det'] as No[] | undefined) ?? [];
  /** CFOP do fornecedor → CFOP provisório, por motivo (para a pendência). */
  const cfopsPendentes = { escolha: new Map<string, ConversaoCfop>(), semPar: new Map<string, string>() };
  const converter = (cfopXml: string): string => {
    const c = converterCfopEntrada(cfopXml);
    if (c.situacao === 'convertido') return c.cfop;
    if (c.situacao === 'insumo-ou-revenda') {
      if (opcoes.finalidade) return opcoes.finalidade === 'insumo' ? c.insumo : c.revenda;
      cfopsPendentes.escolha.set(cfopXml, c);
    }
    const provisorio = CFOP_PENDENTE[cfopXml[0]] ?? '';
    if (c.situacao === 'sem-par') cfopsPendentes.semPar.set(cfopXml, provisorio);
    return provisorio || cfopXml;
  };
  const itens: ItemImport[] = dets.map((det) => {
    const prod = no(det, 'prod');
    const imp = no(det, 'imposto');
    const icms = unicoFilho(no(imp, 'ICMS'));
    const ipiTrib = no(imp, 'IPI', 'IPITrib');
    const ipiNt = no(imp, 'IPI', 'IPINT');
    const cfopXml = txt(prod, 'CFOP');
    const cfop = entradaTerceiros ? converter(cfopXml) : cfopXml;
    const orig = txt(icms, 'orig');
    const cstIcms = txt(icms, 'CST') || txt(icms, 'CSOSN');
    let pis = tributoXml(imp, 'PIS');
    let cofins = tributoXml(imp, 'COFINS');
    if (entradaTerceiros) {
      pis = { ...PENDENTE };
      cofins = { ...PENDENTE };
    }
    return {
      codigo: txt(prod, 'cProd'),
      descricao: txt(prod, 'xProd'),
      ncm: txt(prod, 'NCM') || undefined,
      unidade: txt(prod, 'uCom').slice(0, 6),
      quantidade: txt(prod, 'qCom') || '0',
      valorItem: txt(prod, 'vProd') || '0',
      valorDesconto: txt(prod, 'vDesc') || undefined,
      cfop,
      icms: icms
        ? {
            cst: cstIcms ? (cstIcms.length === 2 ? (orig || '0') + cstIcms : cstIcms) : undefined,
            base: txt(icms, 'vBC') || undefined,
            aliquota: txt(icms, 'pICMS') || undefined,
            valor: txt(icms, 'vICMS') || undefined,
            baseSt: txt(icms, 'vBCST') || undefined,
            aliquotaSt: txt(icms, 'pICMSST') || undefined,
            valorSt: txt(icms, 'vICMSST') || undefined,
          }
        : undefined,
      ipi: ipiTrib
        ? { cst: txt(ipiTrib, 'CST') || undefined, base: txt(ipiTrib, 'vBC') || undefined, aliquota: txt(ipiTrib, 'pIPI') || undefined, valor: txt(ipiTrib, 'vIPI') || undefined }
        : ipiNt
          ? { cst: txt(ipiNt, 'CST') || undefined }
          : undefined,
      pis,
      cofins,
    };
  });
  if (entradaTerceiros && itens.length) {
    pendencias.push(
      `Nota de entrada de terceiros: os ${itens.length} item(ns) ficaram com CST 98 e base zero em PIS/COFINS. O CST do XML é o do emitente (saída) e não vale como crédito: defina a tributação por regra.`,
    );
    for (const [orig, c] of cfopsPendentes.escolha) {
      if (c.situacao !== 'insumo-ou-revenda') continue;
      pendencias.push(
        `CFOP ${orig} do fornecedor (venda): a entrada depende do uso da mercadoria — ${c.insumo} (industrialização/insumo) ou ${c.revenda} (comercialização/revenda). ` +
          `Lançado provisoriamente como ${CFOP_PENDENTE[orig[0]]} (outra entrada, sem crédito); defina o CFOP por regra.`,
      );
    }
    for (const [orig, prov] of cfopsPendentes.semPar) {
      pendencias.push(`CFOP ${orig} do fornecedor sem CFOP de entrada correspondente conhecido: lançado provisoriamente como ${prov || orig}; defina o CFOP de entrada por regra.`);
    }
  }
  const tot = no(inf, 'total', 'ICMSTot');
  const modFrete = txt(no(inf, 'transp'), 'modFrete');
  const temDup = !!no(inf, 'cobr') && Array.isArray(no(inf, 'cobr')?.['dup']);
  const detPag = (no(inf, 'pag')?.['detPag'] as No[] | undefined) ?? [];
  const semPagamento = detPag.length > 0 && detPag.every((p) => txt(p, 'tPag') === '90');
  const indPagIde = txt(ide, 'indPag');
  const indPagamento = semPagamento ? '9' : indPagIde === '0' || indPagIde === '1' ? indPagIde : temDup ? '1' : '0';
  const dEmi = data(txt(ide, 'dhEmi') || txt(ide, 'dEmi'));
  // Em nota de terceiros, dhSaiEnt é a data de SAÍDA do fornecedor, não a de entrada na empresa:
  // usa a de emissão como padrão e deixa pendência visível.
  const dSaiEnt = emissao === 'terceiros' && operacao === 'entrada' ? dEmi : data(txt(ide, 'dhSaiEnt') || txt(ide, 'dSaiEnt'));
  if (emissao === 'terceiros' && operacao === 'entrada' && dEmi) {
    pendencias.push(`Data de entrada não informada; usada a de emissão (${dEmi.slice(8, 10)}/${dEmi.slice(5, 7)}/${dEmi.slice(0, 4)}). Confira a data em que a mercadoria entrou (ela define o mês da escrituração).`);
  }
  return {
    tipo: 'nota',
    operacao,
    emissao,
    modelo: txt(ide, 'mod') || '55',
    situacao: '00',
    serie: txt(ide, 'serie') || undefined,
    numero: txt(ide, 'nNF'),
    chave: chave || undefined,
    dataDocumento: dEmi,
    dataEntradaSaida: dSaiEnt || undefined,
    participante: emissao === 'propria' ? participante(dest, 'enderDest') : participante(emit, 'enderEmit'),
    indPagamento,
    indFrete: ['0', '1', '2', '3', '4', '9'].includes(modFrete) ? modFrete : '9',
    totais: {
      documento: txt(tot, 'vNF') || undefined,
      mercadorias: txt(tot, 'vProd') || undefined,
      desconto: txt(tot, 'vDesc') || undefined,
      frete: txt(tot, 'vFrete') || undefined,
      seguro: txt(tot, 'vSeg') || undefined,
      outrasDespesas: txt(tot, 'vOutro') || undefined,
    },
    itens,
    referencia: `XML NF-e ${chave}`,
    pendencias,
  };
}

/**
 * Converte o XML de um CT-e em `FreteImport` (aquisição de frete pela empresa).
 * A empresa precisa ser a tomadora (remetente, destinatário, expedidor, recebedor ou
 * "outros" indicado em toma3/toma4); CT-e emitido pela própria empresa é recusado. O crédito fica
 * pendente: CST 98, base zero e natureza do frete "9" (o usuário define por regra).
 */
export function xmlCteParaFrete(xmlTexto: string, cnpjEmpresa: string): FreteXml {
  const doc = parser.parse(xmlTexto) as No;
  const cte = no(doc, 'cteProc', 'CTe') ?? no(doc, 'CTe');
  const inf = no(cte, 'infCte');
  if (!inf) throw new Error('XML não é um CT-e (não encontrei CTe/infCte).');
  const ide = no(inf, 'ide');
  const emit = no(inf, 'emit');
  const cnpj = soDigitos(cnpjEmpresa);
  const papeis: Record<string, string> = { '0': 'rem', '1': 'exped', '2': 'receb', '3': 'dest' };
  const toma = no(ide, 'toma3') ?? no(ide, 'toma03') ?? no(ide, 'toma4') ?? no(ide, 'toma04');
  const codToma = txt(toma, 'toma');
  const tomador = codToma === '4' ? toma : no(inf, papeis[codToma] ?? '');
  const docTomador = txt(tomador, 'CNPJ') || txt(tomador, 'CPF');
  if (txt(emit, 'CNPJ') === cnpj) throw new Error('CT-e emitido pela própria empresa é prestação de serviço de transporte (registro D200), não aquisição (D100): não suportado.');
  if (docTomador !== cnpj) throw new Error(`O CNPJ ${cnpj} não é o tomador (${docTomador || 'não identificado'}) deste CT-e.`);
  const emissao = 'terceiros' as const;
  const chave = soDigitos(txt(inf, '@Id')) || txt(no(doc, 'cteProc', 'protCTe', 'infProt'), 'chCTe');
  const vPrest = no(inf, 'vPrest');
  const icms = unicoFilho(no(inf, 'imp', 'ICMS'));
  const valor = txt(vPrest, 'vTPrest') || '0';
  return {
    tipo: 'frete',
    operacao: 'entrada',
    emissao,
    modelo: txt(ide, 'mod') || '57',
    situacao: '00',
    serie: txt(ide, 'serie') || undefined,
    numero: txt(ide, 'nCT'),
    chave: chave || undefined,
    dataDocumento: data(txt(ide, 'dhEmi')),
    participante: participante(emit, 'enderEmit'),
    valorDocumento: valor,
    valorServico: valor,
    icms: { base: txt(icms, 'vBC') || undefined, valor: txt(icms, 'vICMS') || undefined },
    natFrete: '9',
    creditos: [{ valorItem: valor, cst: '98', natBcCred: '', base: '0', aliquotaPis: '0', aliquotaCofins: '0' }],
    referencia: `XML CT-e ${chave}`,
    pendencias: ['CT-e importado com CST 98, base zero e natureza do frete "9": defina a natureza e a tributação do crédito por regra.'],
  };
}
