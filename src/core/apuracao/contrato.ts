/**
 * Contrato da apuração (bloco M e bloco 1) entre o motor de apuração e o resto do sistema.
 * Os tipos daqui são usados pelo orquestrador (`recalcular.ts`) e pela interface.
 */
import type { Aviso, Escrituracao } from '../modelo';
import type { NaturezasCnpj } from './natureza';

/** Regra de estorno automático de crédito (ajuste de redução M110/M510) gerado por nota de saída. */
export interface RegraEstorno {
  /** CFOP da nota de saída que gera o estorno (ex.: "5201" devolução de compra, "5927" perda). */
  cfop: string;
  /**
   * Como distribuir o estorno entre os tipos de crédito (M100/M500):
   * "rateio" = pela mesma proporção de receita usada no rateio dos créditos;
   * { codCred } = tudo em um tipo de crédito (ex.: "101").
   */
  distribuicao: 'rateio' | { codCred: string };
  /** Código do ajuste (tabela 4.3.8); "06" = estorno. */
  codAj: string;
  /** Texto do campo DESCR_AJ. */
  descricao: string;
  /** CNPJ (14 dígitos) a que a regra se aplica; ausente = qualquer CNPJ. As aprendidas sempre têm. */
  cnpj?: string;
  /**
   * Com distribuicao = "rateio": entre quais tipos de crédito ratear (ex.: ["101", "201"]).
   * Cada parcela usa a receita do grupo (1xx tributada, 2xx não tributada, 3xx exportação) do 0111.
   * Ausente = ["101", "201"].
   */
  codCreds?: string[];
}

/** Critérios da apuração que dependem do caso e são escolha explícita de quem faz o trabalho. */
export type IdCriterio = 'saldoCredor' | 'ordemUsoCredito' | 'receitaBruta0111' | 'preservarRetencaoCredito';

/** Escolhas dos critérios (ausente = ainda não escolhido). Ver `CRITERIOS` em `criterios.ts`. */
export interface EscolhasCriterios {
  saldoCredor?: 'encadear' | 'somente-mes';
  ordemUsoCredito?: 'anteriores-primeiro' | 'mes-primeiro' | 'tributados-primeiro';
  receitaBruta0111?: 'manter' | 'ajustar-pelo-delta';
  preservarRetencaoCredito?: boolean;
}

export interface ConfigApuracao {
  /**
   * CRITÉRIO (sem padrão; ausente = não escolhido). O que fazer quando os créditos superam os débitos do mês:
   * "encadear" = controlar o saldo nos registros 1100/1500 e descontar nos meses seguintes carregados;
   * "somente-mes" = registrar o saldo credor do mês (M100/M500 e 1100/1500) sem aproveitar adiante.
   *   Os 1100/1500 de períodos anteriores ficam como vieram; se um deles divergir do mês de origem
   *   carregado e recalculado, o recálculo dá erro `SALDO_CREDOR_DIVERGENTE` naquele mês.
   * Vale para todas as empresas; `criteriosPorCnpj[cnpj]` sobrepõe por empresa.
   */
  saldoCredor?: 'encadear' | 'somente-mes';
  /**
   * CRITÉRIO (sem padrão). Ao descontar créditos, quais usar primeiro:
   * "anteriores-primeiro" = 1100/1500 de períodos anteriores (do mais antigo), depois os do mês;
   * "mes-primeiro" = os do mês, depois os anteriores;
   * "tributados-primeiro" = créditos do grupo 100 (só descontáveis) de todos os períodos, do mais
   *   antigo ao mês, antes de tocar nos grupos 200/300 (ressarcíveis/compensáveis).
   * O que os originais mostram vem em `indiciosCriterios` (não é aplicado sozinho).
   */
  ordemUsoCredito?: 'anteriores-primeiro' | 'mes-primeiro' | 'tributados-primeiro';
  /**
   * CRITÉRIO (sem padrão; só exigido da empresa cujo original guardou crédito havendo
   * contribuição a recolher). true = manter a mesma proporção descontada no original;
   * false = descontar o máximo possível (e avisar `CREDITO_RETIDO`).
   */
  preservarRetencaoCredito?: boolean;
  /** Critérios escolhidos por empresa (CNPJ): sobrepõem os da sessão (campos acima). */
  criteriosPorCnpj?: Record<string, EscolhasCriterios>;
  /** CFOP → código da base de cálculo do crédito (NAT_BC_CRED) para itens de nota (C170). */
  cfopNatBc: Record<string, string>;
  /**
   * Estornos automáticos por CFOP de saída. Regras com `cnpj` (as aprendidas dos arquivos
   * por `aprenderConfig`) valem só para aquele CNPJ; regras sem `cnpj` valem para todos.
   * Precedência na apuração: regra aprendida no próprio arquivo > regra do mesmo CNPJ >
   * regra sem CNPJ. Regras de outro CNPJ são ignoradas.
   */
  estornos: RegraEstorno[];
  /**
   * CRITÉRIO (sem padrão). Receita bruta do registro 0111 (base do rateio proporcional):
   * "ajustar-pelo-delta" = soma/subtrai a variação de receita causada pelas edições, por tipo de
   *   receita; quando o 0111 muda, o recálculo avisa (`0111_AJUSTADO`, alerta) com antes e depois;
   * "manter" = fica como está no arquivo (o usuário pode editar); se a receita por tipo dos
   *   documentos mudou e o 0111 não acompanhou, avisa (`0111_DESATUALIZADO`, alerta).
   */
  receitaBruta0111?: 'manter' | 'ajustar-pelo-delta';
  /**
   * Natureza da receita (M410/M810) por CNPJ: chaves aprendidas dos arquivos originais e
   * definidas pelo usuário (`definirNaturezaReceita`). Preenchido por `aprenderConfig`;
   * pode ser persistido e devolvido em outra sessão.
   */
  naturezasReceita?: Record<string, NaturezasCnpj>;
}

export interface LinhaCreditoResumo {
  codCred: string;
  aliquota: string;
  /** Centavos. */
  base: number;
  credito: number;
  ajustesAcrescimo: number;
  ajustesReducao: number;
  disponivel: number;
  descontado: number;
  saldo: number;
}

export interface LinhaContribuicaoResumo {
  codCont: string;
  aliquota: string;
  receitaBruta: number;
  base: number;
  contribuicao: number;
}

export interface ResumoTributo {
  creditos: LinhaCreditoResumo[];
  contribuicoes: LinhaContribuicaoResumo[];
  /** Totais do M200/M600, em centavos. */
  contribuicaoNaoCumulativa: number;
  creditoDescontado: number;
  creditoDescontadoAnteriores: number;
  contribuicaoCumulativa: number;
  aRecolher: number;
  aRecolherNaoCumulativo: number;
  aRecolherCumulativo: number;
  /** Saldo credor ao fim do mês (soma dos SLD_CRED). */
  saldoCredor: number;
}

export interface ResumoApuracao {
  pis: ResumoTributo;
  cofins: ResumoTributo;
}

export interface ResultadoApuracao {
  escrituracaoId: string;
  /** false quando o arquivo tem registros que o motor não sabe apurar; nesse caso o bloco M fica como veio. */
  recalculada: boolean;
  avisos: Aviso[];
  resumo: ResumoApuracao;
}

/** Itens/receitas sem natureza da receita (M410/M810) definida, para a tela pedir ao usuário. */
export interface PendenciaNaturezaReceita {
  cst: string;
  chave: string;
  descricao: string;
  valor: number;
}
