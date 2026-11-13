/**
 * Formatação para a tela (pt-BR) e textos de apoio: valores em reais, períodos,
 * códigos com descrição das tabelas oficiais e a linha de totais da grade.
 *
 * Tudo aqui é função pura, para poder ser testado sem navegador.
 */
import type { Totais } from '../core/linhas';
import tabelas from '../core/tabelas.json';

const fmt2 = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmt0 = new Intl.NumberFormat('pt-BR');

/** Centavos → "1.234,56". */
export function brl(centavos: number): string {
  return fmt2.format(centavos / 100);
}

/** Centavos → "+1.234,56" / "−1.234,56" / "—" quando for zero. */
export function brlSinal(centavos: number): string {
  if (!centavos) return '—';
  return (centavos > 0 ? '+' : '−') + fmt2.format(Math.abs(centavos) / 100);
}

/** Inteiro com separador de milhar ("6.921"). */
export function inteiro(n: number): string {
  return fmt0.format(n);
}

/**
 * Número como vem do SPED ("2486,39", "8320", "7,6") → como o contador lê
 * ("2.486,39", "8.320,00", "7,60"): milhar com ponto e pelo menos duas casas.
 * Texto que não for número volta como veio.
 */
export function numeroLegivel(v: string): string {
  if (!/^-?\d+(,\d+)?$/.test(v)) return v;
  const neg = v.startsWith('-');
  const [int, dec = ''] = (neg ? v.slice(1) : v).split(',');
  const milhar = int.replace(/^0+(?=\d)/, '').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${neg ? '-' : ''}${milhar},${dec.padEnd(2, '0')}`;
}

/** "202401" ou "2024-01" → "01/2024". */
export function periodoLegivel(p: string): string {
  if (!p) return '';
  if (p.includes('-')) {
    const [ano, mes] = p.split('-');
    return `${mes}/${ano}`;
  }
  return p.length === 6 ? `${p.slice(4)}/${p.slice(0, 4)}` : p;
}

/** "01/2024 a 12/2024" (um só mês devolve só ele). */
export function intervaloPeriodos(periodos: string[]): string {
  if (!periodos.length) return '';
  const ord = [...periodos].sort();
  const a = periodoLegivel(ord[0]);
  const b = periodoLegivel(ord[ord.length - 1]);
  return a === b ? a : `${a} a ${b}`;
}

/** Plural simples: `plural(2, 'mês', 'meses')` → "2 meses". */
export function plural(n: number, singular: string, plural_: string): string {
  return `${inteiro(n)} ${n === 1 ? singular : plural_}`;
}

/** CNPJ só com dígitos → "12.345.678/0001-90" (devolve como veio se não tiver 14 dígitos). */
export function cnpjLegivel(c: string): string {
  if (!/^\d{14}$/.test(c)) return c;
  return `${c.slice(0, 2)}.${c.slice(2, 5)}.${c.slice(5, 8)}/${c.slice(8, 12)}-${c.slice(12)}`;
}

const CST = tabelas.cst as Record<string, string>;
const NAT_BC = tabelas.natBcCred as Record<string, string>;
const COD_CRED = tabelas.codCred as Record<string, string>;

/** "50 — Operação com Direito a Crédito..." (só o código quando não houver descrição). */
export function codigoComDescricao(valores: Record<string, string> | undefined, cod: string): string {
  const d = valores?.[cod];
  return d ? `${cod} — ${d}` : cod;
}

export function descricaoCst(cod: string): string {
  return CST[cod] ?? '';
}

export function descricaoNatBcCred(cod: string): string {
  return NAT_BC[cod] ?? '';
}

export function descricaoCodCred(cod: string): string {
  return COD_CRED[cod] ?? '';
}

/**
 * Entradas de uma tabela de códigos em ordem de código. `Object.entries` põe as chaves
 * que parecem inteiros ("49", "50") antes das com zero à esquerda ("01"), o que deixava
 * o CST 01 no fim da lista.
 */
export function codigosEmOrdem(tabela: Record<string, string>): [string, string][] {
  return Object.entries(tabela).sort(([a], [b]) => (a.length - b.length) || a.localeCompare(b));
}

export const TABELA_CST = CST;
export const TABELA_NAT_BC_CRED = NAT_BC;

/** Rótulo do tipo de linha, como o contador chama. */
export const ROTULO_TIPO: Record<string, string> = {
  item: 'Itens de nota',
  nota: 'Notas',
  frete: 'Fretes (CT-e)',
  energia: 'Energia, água e gás',
  f100: 'Outras operações (F100)',
  servico: 'Serviços (NFS-e)',
  imobDepreciacao: 'Imobilizado: depreciação (F120)',
  imobAquisicao: 'Imobilizado: aquisição (F130)',
  participante: 'Participantes (0150)',
  produto: 'Produtos e serviços (0200)',
};

/**
 * Texto da célula de totais do rodapé da grade: casa o campo da coluna com a soma
 * correspondente de `somar()`. A primeira coluna recebe a contagem de linhas.
 */
export function totalDaColuna(colunaId: string, t: Totais, primeiraColunaId: string): string {
  if (colunaId === primeiraColunaId) return `${inteiro(t.linhas)} linha(s)`;
  const campo = colunaId.includes('.') ? colunaId.slice(colunaId.indexOf('.') + 1) : colunaId;
  switch (campo) {
    case 'VL_ITEM':
    case 'VL_OPER':
    case 'VL_MERC':
    case 'VL_OPER_DEP':
    case 'VL_OPER_AQUIS':
      return brl(t.valorItem);
    case 'VL_DESC':
      return brl(t.desconto);
    case 'VL_BC_PIS':
      return brl(t.basePis);
    case 'VL_PIS':
      return brl(t.valorPis);
    case 'VL_BC_COFINS':
      return brl(t.baseCofins);
    case 'VL_COFINS':
      return brl(t.valorCofins);
    case 'VL_DOC':
      return brl(t.valorDocumento);
    default:
      return '';
  }
}

/** Resumo curto dos totais de uma seleção, para o painel de ação em lote. */
export function resumoTotais(t: Totais): string {
  return `base de PIS R$ ${brl(t.basePis)} · PIS R$ ${brl(t.valorPis)} · COFINS R$ ${brl(t.valorCofins)}`;
}

/** Registros do arquivo que alimentam cada tipo de linha, para explicar uma grade vazia. */
const REGISTROS_DO_TIPO: Record<string, string> = {
  item: 'itens de nota (C170)',
  nota: 'notas fiscais (C100)',
  frete: 'conhecimentos de transporte (D100)',
  energia: 'contas de energia, água ou gás (C500)',
  f100: 'outras operações (F100)',
  servico: 'notas de serviço (A100/A170, bloco A)',
  imobDepreciacao: 'bens do imobilizado com crédito sobre a depreciação (F120)',
  imobAquisicao: 'bens do imobilizado com crédito sobre a aquisição (F130)',
  participante: 'participantes (0150)',
  produto: 'produtos e serviços (0200)',
};

/**
 * Texto da grade quando o tipo de linha não tem nenhuma linha nos arquivos carregados.
 * Deixa claro que nada se perdeu (o arquivo simplesmente não traz esses registros) e
 * como incluí-los, para a pessoa não achar que o editor deixou de ler alguma coisa.
 */
export function explicacaoTipoVazio(tipo: string, meses: number): string {
  const oQue = REGISTROS_DO_TIPO[tipo] ?? `linhas do tipo "${ROTULO_TIPO[tipo] ?? tipo}"`;
  const onde = meses === 1 ? 'O arquivo carregado não traz' : `Nenhum dos ${meses} arquivos carregados traz`;
  const cadastro = tipo === 'participante' || tipo === 'produto';
  const comoIncluir = cadastro
    ? 'Os cadastros são criados quando um documento que precisa deles é importado.'
    : 'Não é falha de leitura: esses registros não existem no arquivo original. Para incluir, use "Importar documentos".';
  return `${onde} ${oQue}. ${comoIncluir}`;
}
