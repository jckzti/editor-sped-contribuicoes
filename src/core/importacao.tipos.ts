/**
 * Formato único de importação de documentos para o editor ("pacote de importação").
 *
 * É o contrato entre o mundo de fora (planilhas, XML, PDF que o cliente manda,
 * convertidos pela skill `sped-importar-documentos`) e o editor. O editor só
 * precisa entender este JSON; a skill sabe transformar qualquer coisa nele.
 *
 * Convenções:
 * - Datas em ISO: "AAAA-MM-DD".
 * - Valores numéricos como number (ponto decimal) ou string ("1234.56" ou "1234,56").
 *   Dinheiro com 2 casas; alíquotas em percentual (1.65 = 1,65%).
 * - O editor não supõe alíquota de PIS/COFINS: quem monta o pacote informa (ou pergunta ao
 *   contador). Sem alíquota onde o CST exige, a linha entra zerada e pendente de tributação.
 * - CNPJ/CPF, chave e NCM só com dígitos.
 * - Campos opcionais ausentes são calculados ou deixados em branco pelo editor.
 */

export type Numero = number | string;

export interface PacoteImportacao {
  formato: 'sped-contrib-import';
  versao: 1;
  /** CNPJ (14 dígitos) do estabelecimento da escrituração que recebe os documentos. */
  cnpj: string;
  /** De onde os dados vieram (nome da planilha, pasta de XMLs...). Só informativo. */
  origem?: string;
  documentos: DocumentoImport[];
}

export type DocumentoImport = NotaImport | ItensEmNotaImport | FreteImport | EnergiaImport | OutraOperacaoImport | ServicoImport | ImobilizadoImport;

interface BaseDocumento {
  /**
   * Mês da escrituração que recebe o documento, "AAAA-MM". Se ausente, o editor
   * usa a data de entrada/saída (ou, na falta, a data do documento).
   */
  periodo?: string;
  /** Texto livre para rastrear a origem da linha (ex.: "planilha X, linha 12"). */
  referencia?: string;
}

export interface ParticipanteImport {
  /** CNPJ (14) ou CPF (11), só dígitos. Para exterior, deixar vazio e informar codPais. */
  cnpjCpf?: string;
  nome: string;
  ie?: string;
  /** Código IBGE do município (7 dígitos). */
  codMunicipio?: string;
  /** Código do país na tabela do BACEN; padrão "1058" (Brasil). */
  codPais?: string;
  endereco?: string;
  numero?: string;
  complemento?: string;
  bairro?: string;
  suframa?: string;
}

export interface TributoImport {
  /** CST de PIS/COFINS com 2 dígitos ("50", "01", "70"...). */
  cst: string;
  /** Base de cálculo. Se ausente e houver alíquota: valor do item menos desconto. */
  base?: Numero;
  /**
   * Alíquota em percentual (PIS 1.65, COFINS 7.6...). O editor NÃO supõe alíquota: com CST de crédito (50–66) ou de receita tributada (01/02) e sem alíquota, entra com alíquota e valor zerados e fica pendente (defina por regra).
   */
  aliquota?: Numero;
  /** Valor do tributo. Se ausente: base × alíquota. */
  valor?: Numero;
}

export interface ItemImport {
  /** Código do produto no cadastro do cliente (vira COD_ITEM / registro 0200). */
  codigo: string;
  descricao: string;
  /** NCM com 8 dígitos. */
  ncm?: string;
  /** Unidade de medida ("UN", "KG"...). */
  unidade: string;
  /**
   * Tipo do item (tabela do 0200): "00" revenda, "01" matéria-prima, "02" embalagem,
   * "03" em processo, "04" acabado, "05" subproduto, "06" produto intermediário,
   * "07" uso e consumo, "08" imobilizado, "09" serviços, "10" outros insumos, "99" outras.
   */
  tipoItem?: string;
  quantidade: Numero;
  /** Valor total do item (quantidade × unitário), antes de descontos. */
  valorItem: Numero;
  valorDesconto?: Numero;
  /** CFOP com 4 dígitos. */
  cfop: string;
  /** Código da natureza da operação (0400). Se ausente, fica em branco. */
  natOperacao?: { codigo: string; descricao?: string };
  icms?: { cst?: string; base?: Numero; aliquota?: Numero; valor?: Numero; baseSt?: Numero; aliquotaSt?: Numero; valorSt?: Numero };
  ipi?: { cst?: string; base?: Numero; aliquota?: Numero; valor?: Numero };
  pis: TributoImport;
  cofins: TributoImport;
  /** Código da conta contábil (0500). */
  contaContabil?: string;
}

/** Nota fiscal inteira (NF-e modelo 55, NF modelo 01...) com seus itens: gera C100 + C170. */
export interface NotaImport extends BaseDocumento {
  tipo: 'nota';
  operacao: 'entrada' | 'saida';
  /** "propria" = emitida pela empresa; "terceiros" = emitida pelo fornecedor. */
  emissao: 'propria' | 'terceiros';
  /** Código do modelo: "55" NF-e, "01" NF, "65" NFC-e... Padrão "55". */
  modelo?: string;
  /** Situação do documento; padrão "00" (regular). */
  situacao?: string;
  serie?: string;
  numero: string;
  /** Chave de acesso com 44 dígitos. */
  chave?: string;
  dataDocumento: string;
  dataEntradaSaida?: string;
  participante: ParticipanteImport;
  /** "0" à vista, "1" a prazo, "9" sem pagamento. Padrão "1". */
  indPagamento?: string;
  /**
   * Tipo do frete (IND_FRT): "0" por conta do emitente, "1" por conta do destinatário,
   * "2" por conta de terceiros, "3" próprio por conta do remetente,
   * "4" próprio por conta do destinatário, "9" sem cobrança de frete. Padrão "9".
   */
  indFrete?: string;
  /** Totais do documento. O que faltar é somado a partir dos itens. */
  totais?: {
    documento?: Numero;
    mercadorias?: Numero;
    desconto?: Numero;
    frete?: Numero;
    seguro?: Numero;
    outrasDespesas?: Numero;
  };
  itens: ItemImport[];
}

/** Itens a acrescentar em uma nota que já existe na escrituração. */
export interface ItensEmNotaImport extends BaseDocumento {
  tipo: 'itens';
  /** Como achar a nota: pela chave (preferível) ou por número + série + CNPJ do participante. */
  nota: { chave?: string; numero?: string; serie?: string; cnpjCpfParticipante?: string };
  itens: ItemImport[];
}

/** Linha de crédito de PIS/COFINS de um frete ou conta de energia. */
export interface CreditoImport {
  /** Valor do item/parcela que dá direito a crédito. */
  valorItem: Numero;
  /** CST (o mesmo para PIS e COFINS). */
  cst: string;
  /** Código da base de cálculo do crédito (tabela 4.3.7): "03" serviços-insumo, "04" energia, "07" frete na venda, "14" transporte subcontratado... */
  natBcCred: string;
  /** Base de cálculo. Se ausente: valorItem. */
  base?: Numero;
  /** Alíquota de PIS em percentual. O editor NÃO supõe alíquota: com CST de crédito (50–66) ou de receita tributada (01/02) e sem alíquota, entra com alíquota e valor zerados e fica pendente (defina por regra). */
  aliquotaPis?: Numero;
  /** Alíquota de COFINS em percentual. Mesma regra: sem alíquota = zero e pendente. */
  aliquotaCofins?: Numero;
  contaContabil?: string;
}

/** Conhecimento de transporte (CT-e modelo 57 e similares): gera D100 + D101 + D105. */
export interface FreteImport extends BaseDocumento {
  tipo: 'frete';
  /**
   * "entrada" = a empresa contratou o transporte (caso normal de crédito, inclusive
   * no frete da própria venda); "saida" = a empresa é a transportadora e prestou o serviço.
   */
  operacao: 'entrada' | 'saida';
  emissao: 'propria' | 'terceiros';
  /** Padrão "57" (CT-e). */
  modelo?: string;
  situacao?: string;
  serie?: string;
  subserie?: string;
  numero: string;
  chave?: string;
  dataDocumento: string;
  /** Data da aquisição/prestação. */
  dataEntradaSaida?: string;
  participante: ParticipanteImport;
  valorDocumento: Numero;
  valorDesconto?: Numero;
  /** IND_FRT. Padrão "1". */
  indFrete?: string;
  valorServico?: Numero;
  icms?: { base?: Numero; valor?: Numero; naoTributado?: Numero };
  /**
   * Natureza do frete (IND_NAT_FRT): "0" venda com ônus do vendedor, "1" venda com ônus do
   * adquirente, "2" compra de bens com crédito, "3" compra de bens sem crédito,
   * "4" transferência de acabados, "5" transferência de não acabados, "9" outras.
   */
  natFrete: string;
  creditos: CreditoImport[];
  contaContabil?: string;
}

/** Conta de energia elétrica, água ou gás: gera C500 + C501 + C505. */
export interface EnergiaImport extends BaseDocumento {
  tipo: 'energia';
  /** "06" energia (papel), "55"/"66" eletrônica, "28" gás, "29" água. Padrão "06". */
  modelo?: string;
  situacao?: string;
  serie?: string;
  subserie?: string;
  numero: string;
  chave?: string;
  dataDocumento: string;
  dataEntrada: string;
  participante: ParticipanteImport;
  valorDocumento: Numero;
  valorIcms?: Numero;
  creditos: CreditoImport[];
}

/** Operação sem documento fiscal específico (aluguel, receita financeira, leasing...): gera F100. */
export interface OutraOperacaoImport extends BaseDocumento {
  tipo: 'f100';
  /** "0" entrada com direito a crédito, "1" receita tributada, "2" receita não tributada. */
  indOper: '0' | '1' | '2';
  participante?: ParticipanteImport;
  /** Código do item no cadastro (0200), se houver. */
  codItem?: string;
  data: string;
  valor: Numero;
  pis: TributoImport;
  cofins: TributoImport;
  /** Código da base do crédito (tabela 4.3.7), obrigatório quando indOper = "0". */
  natBcCred?: string;
  /** Origem do crédito: "0" mercado interno, "1" importação. */
  indOrigCred?: string;
  contaContabil?: string;
  centroCusto?: string;
  descricao?: string;
}

/** Item de nota de serviço (vira A170; o código vira 0200 com tipo "09" serviços, se não existir). */
export interface ItemServicoImport {
  /** Código do serviço no cadastro do cliente (COD_ITEM / registro 0200; até 60 caracteres). */
  codigo: string;
  /** Descrição do serviço (DESCR_ITEM do 0200, só se o item for criado). */
  descricao: string;
  /**
   * Código do serviço na lista da LC 116/2003 (COD_LST do 0200), ex.: "17.01". Só é gravado
   * quando o 0200 é criado pela importação. Se o código do item já existir no cadastro, o
   * 0200 existente NÃO é alterado; se o COD_LST dele for diferente, a importação avisa.
   */
  codigoServico?: string;
  /** Unidade (UNID_INV do 0200; até 6 caracteres). Opcional para serviço. */
  unidade?: string;
  /** Descrição complementar como consta no documento (DESCR_COMPL do A170). */
  descricaoComplementar?: string;
  /** Valor total do item. */
  valorItem: Numero;
  /** Desconto comercial / exclusão da base de PIS e COFINS (VL_DESC do A170). */
  valorDesconto?: Numero;
  /**
   * Código da base de cálculo do crédito (tabela 4.3.7; ex.: "03" serviços utilizados como
   * insumo). Obrigatório quando o CST de PIS ou de COFINS for de crédito (50 a 66). Só em
   * serviço contratado: no prestado é recusado (guia, A170 campo 07).
   */
  natBcCred?: string;
  /**
   * Origem do crédito: "0" mercado interno (padrão no serviço contratado), "1" importação
   * (o guia exige o A120, que a importação não cria: avisa). Só em serviço contratado.
   */
  indOrigCred?: '0' | '1';
  /**
   * PIS e COFINS do item. Serviço contratado usa CST de crédito (50 a 66) ou sem crédito
   * (70 a 99); prestado usa CST de receita (01 a 09) ou 49/99. Base ausente com alíquota:
   * valor do item − desconto. Alíquota com no máximo 2 casas (leiaute do A170; mais casas é
   * recusado). Sem alíquota onde o CST exige, entra zerada e pendente (o editor não supõe).
   */
  pis: TributoImport;
  cofins: TributoImport;
  /** Código da conta contábil (0500). */
  contaContabil?: string;
  /** Centro de custo (COD_CCUS). */
  centroCusto?: string;
}

/** Campos comuns da nota fiscal de serviço (regular ou cancelada). */
interface ServicoBase extends BaseDocumento {
  tipo: 'servico';
  /** "contratado" = serviço tomado pelo estabelecimento (IND_OPER 0); "prestado" = serviço prestado (1). */
  operacao: 'contratado' | 'prestado';
  /** "propria" = emitida pelo estabelecimento; "terceiros" = emitida pelo prestador. */
  emissao: 'propria' | 'terceiros';
  /** Série (até 20 caracteres). */
  serie?: string;
  /** Subsérie (até 20 caracteres). */
  subserie?: string;
  /** Número do documento (até 60 caracteres; "SN" se não houver). */
  numero: string;
  /** Chave ou código de verificação da NFS-e (CHV_NFSE; até 60 caracteres). */
  chave?: string;
  dataDocumento: string;
  /**
   * Data de execução/conclusão do serviço (DT_EXE_SERV). Se ausente, fica em branco.
   * Escolha da escrituração (sem `periodo`): a do mês da data de execução; se nenhuma
   * escrituração carregada cobre essa data, a do mês da emissão (o guia aceita que qualquer
   * uma das duas esteja no período). Com `periodo`, vale o período informado.
   */
  dataExecucao?: string;
  /**
   * Prestador (contratado) ou tomador (prestado). Obrigatório no serviço contratado (guia,
   * A100 campo 04); opcional no prestado a consumidor final.
   */
  participante?: ParticipanteImport;
  /** "0" à vista, "1" a prazo (padrão), "9" sem pagamento. */
  indPagamento?: '0' | '1' | '9';
  /** Valor total do documento. Se ausente: soma dos itens − desconto. */
  valorDocumento?: Numero;
  /** Desconto total do documento. Se ausente: soma dos descontos dos itens. */
  valorDesconto?: Numero;
  /**
   * PIS retido na fonte (VL_PIS_RET). Aceito no contratado e no prestado; é só informativo:
   * não entra na apuração (guia, A100 campo 19; a retenção que deduz vai no F600).
   */
  pisRetido?: Numero;
  /** COFINS retida na fonte (VL_COFINS_RET). Mesma regra do `pisRetido` (guia, A100 campo 20). */
  cofinsRetido?: Numero;
  /** Valor do ISS. */
  valorIss?: Numero;
}

/** Nota de serviço regular: ao menos um item (o guia exige ao menos um A170). */
export interface ServicoRegularImport extends ServicoBase {
  /** "00" regular (padrão). */
  situacao?: '00';
  itens: ItemServicoImport[];
}

/** Nota de serviço cancelada: sem itens (se vierem, são ignorados com aviso). */
export interface ServicoCanceladoImport extends ServicoBase {
  situacao: '02';
  itens?: ItemServicoImport[];
}

/**
 * Nota fiscal de serviço (NFS-e municipal ou documento internacional equivalente):
 * gera A100 + A170 no estabelecimento (cria A010 se faltar). Serve para serviço contratado
 * (crédito sobre serviço usado como insumo) e para serviço prestado (receita).
 */
export type ServicoImport = ServicoRegularImport | ServicoCanceladoImport;

/** Campos comuns do bem do imobilizado (F120 e F130). */
interface ImobilizadoBase extends BaseDocumento {
  tipo: 'imobilizado';
  /** Obrigatório: o bem não tem data de documento ("AAAA-MM"). */
  periodo: string;
  /**
   * Identificação do bem (IDENT_BEM_IMOB): "01" edificações e benfeitorias em imóveis próprios,
   * "02" em imóveis de terceiros, "03" instalações, "04" máquinas, "05" equipamentos,
   * "06" veículos, "99" outros.
   */
  identificacaoBem: string;
  /** Origem do bem: "0" mercado interno (padrão), "1" importação. */
  indOrigCred?: '0' | '1';
  /**
   * Utilização (IND_UTIL_BEM_IMOB): "1" produção de bens destinados à venda, "2" prestação de
   * serviços, "3" locação a terceiros, "9" outros (sem direito a crédito).
   */
  utilizacao: '1' | '2' | '3' | '9';
  /** Parcela sem direito a crédito, excluída da base (PARC_OPER_NAO_BC_CRED). Padrão 0. */
  parcelaSemCredito?: Numero;
  /**
   * PIS e COFINS (CST de crédito 50 a 66, ou sem crédito); alíquota até 4 casas. A BASE é
   * sempre a da regra do guia: `pis.base`/`cofins.base` informados não são usados (se
   * diferirem da regra, a importação avisa). `valor` também é recalculado (base × alíquota).
   * Sem alíquota onde o CST exige, entra zerada e pendente (o editor não supõe).
   */
  pis: TributoImport;
  cofins: TributoImport;
  contaContabil?: string;
  centroCusto?: string;
  /** Descrição do bem ou grupo de bens (DESC_BEM_IMOB). */
  descricao?: string;
}

/** F120: crédito sobre o encargo de depreciação/amortização do mês. Base = encargo − parcela sem crédito. */
export interface ImobilizadoDepreciacaoImport extends ImobilizadoBase {
  modalidade: 'depreciacao';
  /** "09" depreciação (padrão) ou "11" amortização. */
  natBcCred?: '09' | '11';
  /** Encargo de depreciação/amortização do mês (VL_OPER_DEP). */
  valorEncargo: Numero;
}

/**
 * F130: crédito sobre o valor de aquisição. Base total = aquisição − parcela sem crédito;
 * base do mês = base total ÷ nº de meses das `parcelas`.
 */
export interface ImobilizadoAquisicaoImport extends ImobilizadoBase {
  modalidade: 'aquisicao';
  /** Sempre "10" (pode omitir). */
  natBcCred?: '10';
  /** Mês/ano da aquisição, "AAAA-MM" (vazio para grupo de bens com datas diversas). */
  mesAquisicao?: string;
  /** Valor de aquisição (VL_OPER_AQUIS). */
  valorAquisicao: Numero;
  /**
   * Nº de parcelas (IND_NR_PARC): "1" integral, "2" 12 meses, "3" 24, "4" 48,
   * "5" 6 meses (embalagens de bebidas frias), "9" outra periodicidade (exige `baseMes`).
   */
  parcelas: '1' | '2' | '3' | '4' | '5' | '9';
  /** Base do mês, obrigatória quando `parcelas` = "9" (o número de meses não está no leiaute). */
  baseMes?: Numero;
}

/**
 * Bem do ativo imobilizado com crédito de PIS/COFINS: gera F120 (`modalidade: 'depreciacao'`)
 * ou F130 (`'aquisicao'`) sob o F010.
 */
export type ImobilizadoImport = ImobilizadoDepreciacaoImport | ImobilizadoAquisicaoImport;

/** Resultado de uma importação, por documento. */
export interface ResultadoImportacao {
  incluidos: number;
  /** `indice` é a posição do documento em `documentos`, começando em 0. */
  ignorados: { indice: number; referencia?: string; motivo: string }[];
  /** Quantos documentos foram para cada escrituração (id → quantidade). */
  porEscrituracao: Record<string, number>;
}
