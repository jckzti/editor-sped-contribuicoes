/**
 * Regras em lote: filtro + ações, salvas em JSON e reaplicadas em vários meses/clientes.
 *
 * Exemplo de regra: "Itens de entrada com CFOP 1101 e NCM 4821 → CST 50, PIS 1,65%,
 * COFINS 7,6%, base = valor − desconto − ICMS". A prévia mostra, sem alterar nada,
 * quantas linhas cada escrituração teria afetadas e a variação de base e valor de
 * PIS/COFINS; aplicar faz exatamente o mesmo (mesmo código) como uma operação desfazível.
 */
import {
  aplicarPlano,
  aplicarTributacaoSemOperacao,
  descreverRegistro,
  excluirLinhasSemOperacao,
  planejarEdicao,
  validarAcaoTributacao,
  type AcaoTributacao,
} from './edicao';
import { coluna, filtrar, leitor, linhaAnexada, linhasDe, somar, totaisVazios, validarFiltros, TIPOS_LINHA, TIPOS_LINHA_TODOS, type Busca, type Filtro, type LinhaQualquer, type TipoLinha, type TipoLinhaTodos, type Totais } from './linhas';
import type { Escrituracao } from './modelo';
import { executar, simular } from './operacao';
import { novoId, periodoIso } from './util';

/** Grava um valor em um campo ("CAMPO" ou "REG.CAMPO", como em `editarCampos`). */
export interface AcaoDefinirCampo {
  tipo: 'definirCampo';
  campo: string;
  valor: string;
}

/** Exclui as linhas (item: se a nota ficar vazia, exclui a nota, salvo `excluirNotaVazia: false`). */
export interface AcaoExcluir {
  tipo: 'excluir';
  excluirNotaVazia?: boolean;
}

export type Acao = AcaoTributacao | AcaoDefinirCampo | AcaoExcluir;

/**
 * Regra em lote. `Regra` (sem argumento) é restrita aos tipos de `TipoLinha`; as funções
 * deste módulo aceitam `Regra<TipoLinhaTodos>` (serviço, imobilizado e cadastros também).
 */
export interface Regra<T extends TipoLinhaTodos = TipoLinha> {
  id: string;
  nome: string;
  descricao?: string;
  tipoLinha: T;
  filtros: Filtro[];
  /** Busca textual livre adicional (opcional). */
  busca?: Busca;
  acoes: Acao[];
  ativa: boolean;
}

export interface DeltaTributos {
  /** Centavos. */
  basePis: number;
  valorPis: number;
  baseCofins: number;
  valorCofins: number;
}

export interface EfeitoEscrituracao {
  escrituracaoId: string;
  nomeArquivo: string;
  /** "AAAA-MM" */
  periodo: string;
  /** Linhas que atendem ao filtro (= afetadas). */
  linhas: number;
  /** Linhas excluídas pela regra. */
  excluidas: number;
  antes: Totais;
  depois: Totais;
  delta: DeltaTributos;
}

export interface AmostraLinha {
  escrituracaoId: string;
  periodo: string;
  documento: string;
  antes: Record<string, string>;
  /** Vazio se a linha foi excluída. */
  depois: Record<string, string>;
  excluida: boolean;
}

export interface ResultadoRegra {
  regraId?: string;
  nome: string;
  /** false na prévia (ou se houve erro de validação). */
  aplicada: boolean;
  linhas: number;
  excluidas: number;
  delta: DeltaTributos;
  porEscrituracao: EfeitoEscrituracao[];
  /** Primeiras linhas afetadas, antes/depois, nas colunas `colunasAmostra`. */
  amostra: AmostraLinha[];
  colunasAmostra: string[];
  /** Erros de validação da regra (nada foi feito). */
  erros: string[];
  avisos: string[];
}

const COLUNAS_AMOSTRA: Record<TipoLinhaTodos, string[]> = {
  item: ['C100.NUM_DOC', 'C170.NUM_ITEM', 'C170.COD_ITEM', 'C170.CFOP', 'C170.VL_ITEM', 'C170.CST_PIS', 'C170.VL_BC_PIS', 'C170.ALIQ_PIS', 'C170.VL_PIS', 'C170.CST_COFINS', 'C170.VL_BC_COFINS', 'C170.ALIQ_COFINS', 'C170.VL_COFINS', 'C170.COD_CTA'],
  nota: [],
  frete: ['D100.NUM_DOC', 'D101.IND_NAT_FRT', 'D101.VL_ITEM', 'D101.CST_PIS', 'D101.NAT_BC_CRED', 'D101.VL_BC_PIS', 'D101.ALIQ_PIS', 'D101.VL_PIS', 'D105.CST_COFINS', 'D105.VL_BC_COFINS', 'D105.ALIQ_COFINS', 'D105.VL_COFINS'],
  energia: ['C500.NUM_DOC', 'C501.VL_ITEM', 'C501.CST_PIS', 'C501.NAT_BC_CRED', 'C501.VL_BC_PIS', 'C501.ALIQ_PIS', 'C501.VL_PIS', 'C505.CST_COFINS', 'C505.VL_BC_COFINS', 'C505.ALIQ_COFINS', 'C505.VL_COFINS'],
  f100: ['F100.IND_OPER', 'F100.DT_OPER', 'F100.VL_OPER', 'F100.CST_PIS', 'F100.VL_BC_PIS', 'F100.ALIQ_PIS', 'F100.VL_PIS', 'F100.CST_COFINS', 'F100.VL_BC_COFINS', 'F100.ALIQ_COFINS', 'F100.VL_COFINS', 'F100.NAT_BC_CRED'],
  servico: ['A100.NUM_DOC', 'A100.IND_OPER', 'A170.NUM_ITEM', 'A170.COD_ITEM', 'A170.VL_ITEM', 'A170.NAT_BC_CRED', 'A170.CST_PIS', 'A170.VL_BC_PIS', 'A170.ALIQ_PIS', 'A170.VL_PIS', 'A170.CST_COFINS', 'A170.VL_BC_COFINS', 'A170.ALIQ_COFINS', 'A170.VL_COFINS', 'A170.COD_CTA'],
  imobDepreciacao: ['F120.NAT_BC_CRED', 'F120.IDENT_BEM_IMOB', 'F120.VL_OPER_DEP', 'F120.PARC_OPER_NAO_BC_CRED', 'F120.CST_PIS', 'F120.VL_BC_PIS', 'F120.ALIQ_PIS', 'F120.VL_PIS', 'F120.CST_COFINS', 'F120.VL_BC_COFINS', 'F120.ALIQ_COFINS', 'F120.VL_COFINS'],
  imobAquisicao: ['F130.IDENT_BEM_IMOB', 'F130.VL_OPER_AQUIS', 'F130.PARC_OPER_NAO_BC_CRED', 'F130.VL_BC_CRED', 'F130.IND_NR_PARC', 'F130.CST_PIS', 'F130.VL_BC_PIS', 'F130.ALIQ_PIS', 'F130.VL_PIS', 'F130.CST_COFINS', 'F130.VL_BC_COFINS', 'F130.ALIQ_COFINS', 'F130.VL_COFINS'],
  participante: ['0150.COD_PART', '0150.NOME', '0150.CNPJ', '0150.CPF', '0150.IE', '0150.COD_MUN'],
  produto: ['0200.COD_ITEM', '0200.DESCR_ITEM', '0200.UNID_INV', '0200.TIPO_ITEM', '0200.COD_NCM', '0200.COD_LST', '0200.ALIQ_ICMS'],
};
COLUNAS_AMOSTRA.nota = COLUNAS_AMOSTRA.item;

/** Cria uma regra com id novo (campos ausentes com valores padrão). */
export function novaRegra<T extends TipoLinhaTodos = TipoLinha>(parcial: Partial<Regra<T>> & Pick<Regra<T>, 'nome' | 'tipoLinha'>): Regra<T> {
  return { id: novoId('r'), filtros: [], acoes: [], ativa: true, ...parcial };
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

/** Erros de uma lista de ações (vazio = ok). */
export function validarAcoes(tipo: TipoLinhaTodos, acoes: Acao[]): string[] {
  const erros: string[] = [];
  if (!Array.isArray(acoes) || !acoes.length) return ['A regra não tem ações.'];
  acoes.forEach((a, k) => {
    const p = `Ação ${k + 1}: `;
    if (!a || typeof a !== 'object') return erros.push(p + 'inválida.');
    switch (a.tipo) {
      case 'tributacao':
        if (tipo === 'participante' || tipo === 'produto') erros.push(p + 'alterar tributação não se aplica a cadastros.');
        for (const m of validarAcaoTributacao(a)) erros.push(p + m);
        break;
      case 'definirCampo': {
        if (!a.campo) erros.push(p + 'informe o campo.');
        else if (!campoExisteNoTipo(tipo, a.campo)) erros.push(p + `o campo "${a.campo}" não existe nas linhas do tipo ${tipo}.`);
        if (typeof a.valor !== 'string' && typeof a.valor !== 'number') erros.push(p + 'informe o valor.');
        break;
      }
      case 'excluir':
        break;
      default:
        erros.push(p + `tipo de ação "${(a as { tipo?: string }).tipo ?? ''}" desconhecido.`);
    }
  });
  return erros;
}

function candidatosCampo(campo: string): string[] {
  return campo.includes('.') ? [campo] : ['C170', 'D100', 'D101', 'D105', 'C500', 'C501', 'C505', 'F100', 'C100', 'A170', 'A100', 'F120', 'F130', '0150', '0200'].map((r) => `${r}.${campo}`);
}

function campoExisteNoTipo(tipo: TipoLinhaTodos, campo: string): boolean {
  const tipos: TipoLinhaTodos[] = tipo === 'nota' ? ['nota', 'item'] : [tipo];
  return candidatosCampo(campo).some((id) =>
    tipos.some((t) => {
      const c = coluna(t, id);
      return !!c && (c.origem === 'registro' || c.origem === 'complemento' || c.origem === 'documento');
    }),
  );
}

/** Erros de uma regra (vazio = ok). */
export function validarRegra(r: Regra<TipoLinhaTodos>): string[] {
  const erros: string[] = [];
  if (!r || typeof r !== 'object') return ['Regra inválida.'];
  if (!r.nome?.trim()) erros.push('A regra precisa de um nome.');
  if (!TIPOS_LINHA_TODOS.includes(r.tipoLinha)) return [...erros, `Tipo de linha "${String(r.tipoLinha)}" desconhecido.`];
  erros.push(...validarFiltros(r.tipoLinha, r.filtros ?? []));
  erros.push(...validarAcoes(r.tipoLinha, r.acoes));
  return erros;
}

// ---------------------------------------------------------------------------
// Execução
// ---------------------------------------------------------------------------

/** Aplica as ações às linhas (sem abrir operação). */
function executarAcoes(linhas: LinhaQualquer[], acoes: Acao[], avisos: string[]): void {
  for (const a of acoes) {
    const vivas = linhas.filter(linhaAnexada);
    switch (a.tipo) {
      case 'tributacao': {
        const r = aplicarTributacaoSemOperacao(vivas, a);
        if (r.erros.length) throw new Error(r.erros.join(' '));
        for (const m of r.avisos) if (!avisos.includes(m)) avisos.push(m);
        break;
      }
      case 'definirCampo': {
        const alvos = vivas.flatMap((l) => (l.tipo === 'nota' && !a.campo.startsWith('C100.') && !coluna('nota', 'C100.' + a.campo) ? itensDaNota(l) : [l]));
        const { erros, plano } = planejarEdicao(alvos, { [a.campo]: a.valor });
        if (erros.length) {
          // valor inválido: aborta; campo ausente em parte das linhas (ex.: frete sem D105): ignora essas
          const invalidos = erros.filter((e) => !/não tem registro|não existe nesta linha/.test(e.mensagem));
          if (invalidos.length) throw new Error(invalidos[0].mensagem);
          avisos.push(`${erros.length} linha(s) sem o campo ${a.campo} foram ignoradas.`);
        }
        aplicarPlano(plano);
        break;
      }
      case 'excluir': {
        const r = excluirLinhasSemOperacao(vivas, { excluirNotaVazia: a.excluirNotaVazia });
        if (r.recusados?.length) avisos.push(`${r.recusados.length} cadastro(s) em uso não foram excluídos: ${r.recusados.slice(0, 5).join(' ')}${r.recusados.length > 5 ? '…' : ''}`);
        break;
      }
    }
  }
}

function itensDaNota(l: LinhaQualquer): LinhaQualquer[] {
  return l.reg.filhos.filter((f) => f.reg === 'C170').map((it) => ({ tipo: 'item' as const, e: l.e, reg: it, doc: l.reg, est: l.est }));
}

/** Linhas de medição: notas viram seus itens (bases e valores de PIS/COFINS estão nos itens). */
function linhasDeMedida(linhas: LinhaQualquer[]): LinhaQualquer[] {
  return linhas.flatMap((l) => (l.tipo === 'nota' ? itensDaNota(l) : [l]));
}

function delta(a: Totais, d: Totais): DeltaTributos {
  return { basePis: d.basePis - a.basePis, valorPis: d.valorPis - a.valorPis, baseCofins: d.baseCofins - a.baseCofins, valorCofins: d.valorCofins - a.valorCofins };
}

function capturar(l: LinhaQualquer, cols: string[]): Record<string, string> {
  const tipo = l.tipo;
  const out: Record<string, string> = {};
  for (const c of cols) if (coluna(tipo, c)) out[c] = leitor(tipo, c)(l);
  return out;
}

/** Executa as ações medindo o efeito por escrituração (usado pela prévia e pela aplicação). */
function medirEExecutar(grupos: Map<Escrituracao, LinhaQualquer[]>, acoes: Acao[], nome: string, tamanhoAmostra: number): ResultadoRegra {
  const res: ResultadoRegra = {
    nome,
    aplicada: false,
    linhas: 0,
    excluidas: 0,
    delta: { basePis: 0, valorPis: 0, baseCofins: 0, valorCofins: 0 },
    porEscrituracao: [],
    amostra: [],
    colunasAmostra: [],
    erros: [],
    avisos: [],
  };
  const primeiro = [...grupos.values()].find((g) => g.length)?.[0];
  const tipo = primeiro?.tipo ?? 'item';
  const cols = [...COLUNAS_AMOSTRA[tipo]];
  const tipoMedida: TipoLinhaTodos = tipo === 'nota' ? 'item' : tipo;
  for (const a of acoes) {
    if (a.tipo !== 'definirCampo') continue;
    const id = candidatosCampo(a.campo).find((c) => coluna(tipoMedida, c));
    if (id && !cols.includes(id)) cols.push(id);
  }
  res.colunasAmostra = cols;
  const medidas = new Map<Escrituracao, { linhas: LinhaQualquer[]; medida: LinhaQualquer[]; antes: Totais }>();
  const amostra: { l: LinhaQualquer; e: Escrituracao; antes: Record<string, string> }[] = [];
  for (const [e, linhas] of grupos) {
    const medida = linhasDeMedida(linhas);
    medidas.set(e, { linhas, medida, antes: somar(medida) });
    for (const l of medida) {
      if (amostra.length >= tamanhoAmostra) break;
      amostra.push({ l, e, antes: capturar(l, cols) });
    }
  }
  executarAcoes([...grupos.values()].flat(), acoes, res.avisos);
  for (const [e, m] of medidas) {
    const vivas = m.medida.filter(linhaAnexada);
    const depois = vivas.length ? somar(vivas) : totaisVazios();
    const excluidas = m.linhas.filter((l) => !linhaAnexada(l)).length;
    const d = delta(m.antes, depois);
    res.porEscrituracao.push({ escrituracaoId: e.id, nomeArquivo: e.nomeArquivo, periodo: periodoIso(e.periodo), linhas: m.linhas.length, excluidas, antes: m.antes, depois, delta: d });
    res.linhas += m.linhas.length;
    res.excluidas += excluidas;
    res.delta.basePis += d.basePis;
    res.delta.valorPis += d.valorPis;
    res.delta.baseCofins += d.baseCofins;
    res.delta.valorCofins += d.valorCofins;
  }
  res.amostra = amostra.map(({ l, e, antes }) => {
    const viva = linhaAnexada(l);
    return { escrituracaoId: e.id, periodo: periodoIso(e.periodo), documento: descreverRegistro(l.reg), antes, depois: viva ? capturar(l, cols) : {}, excluida: !viva };
  });
  return res;
}

function agrupar(linhas: LinhaQualquer[]): Map<Escrituracao, LinhaQualquer[]> {
  const g = new Map<Escrituracao, LinhaQualquer[]>();
  for (const l of linhas) {
    let a = g.get(l.e);
    if (!a) g.set(l.e, (a = []));
    a.push(l);
  }
  return g;
}

/** Linhas que a regra alcança em cada escrituração (inclui escriturações sem nenhuma linha). */
export function linhasDaRegra(escrituracoes: Escrituracao[], regra: Regra<TipoLinhaTodos>): Map<Escrituracao, LinhaQualquer[]> {
  const g = new Map<Escrituracao, LinhaQualquer[]>();
  for (const e of escrituracoes) g.set(e, filtrar<LinhaQualquer>(linhasDe(e, regra.tipoLinha), regra.filtros ?? [], regra.busca));
  return g;
}

function falha(nome: string, erros: string[], regraId?: string): ResultadoRegra {
  return { regraId, nome, aplicada: false, linhas: 0, excluidas: 0, delta: { basePis: 0, valorPis: 0, baseCofins: 0, valorCofins: 0 }, porEscrituracao: [], amostra: [], colunasAmostra: [], erros, avisos: [] };
}

/** Prévia: o que a regra faria em cada escrituração, SEM alterar nada. */
export function previsualizarRegra(escrituracoes: Escrituracao[], regra: Regra<TipoLinhaTodos>, tamanhoAmostra = 20): ResultadoRegra {
  const erros = validarRegra(regra);
  if (erros.length) return falha(regra.nome, erros, regra.id);
  try {
    const r = simular(() => medirEExecutar(linhasDaRegra(escrituracoes, regra), regra.acoes, regra.nome, tamanhoAmostra));
    return { ...r, regraId: regra.id };
  } catch (err) {
    return falha(regra.nome, [(err as Error).message], regra.id);
  }
}

/** Aplica a regra em todas as escrituracões como UMA operação desfazível. */
export function aplicarRegra(escrituracoes: Escrituracao[], regra: Regra<TipoLinhaTodos>, tamanhoAmostra = 20): ResultadoRegra {
  const erros = validarRegra(regra);
  if (erros.length) return falha(regra.nome, erros, regra.id);
  try {
    const r = executar(`Regra "${regra.nome}"`, () => medirEExecutar(linhasDaRegra(escrituracoes, regra), regra.acoes, regra.nome, tamanhoAmostra));
    return { ...r, regraId: regra.id, aplicada: true };
  } catch (err) {
    return falha(regra.nome, [(err as Error).message], regra.id);
  }
}

/** Aplica as regras ATIVAS em ordem; cada uma é uma operação desfazível. */
export function aplicarRegras(escrituracoes: Escrituracao[], regras: Regra<TipoLinhaTodos>[]): ResultadoRegra[] {
  return regras.filter((r) => r.ativa).map((r) => aplicarRegra(escrituracoes, r));
}

/** Prévia de ações sobre a seleção da grade (sem alterar nada). */
export function previsualizarAcoes(linhas: LinhaQualquer[], acoes: Acao[], tamanhoAmostra = 20): ResultadoRegra {
  if (!linhas.length) return falha('Seleção', ['Nenhuma linha selecionada.']);
  const erros = validarAcoes(linhas[0].tipo, acoes);
  if (erros.length) return falha('Seleção', erros);
  try {
    return simular(() => medirEExecutar(agrupar(linhas), acoes, 'Seleção', tamanhoAmostra));
  } catch (err) {
    return falha('Seleção', [(err as Error).message]);
  }
}

/** Aplica ações diretamente nas linhas selecionadas na grade (UMA operação desfazível). */
export function aplicarAcoes(linhas: LinhaQualquer[], acoes: Acao[], descricao?: string, tamanhoAmostra = 20): ResultadoRegra {
  if (!linhas.length) return falha('Seleção', ['Nenhuma linha selecionada.']);
  const erros = validarAcoes(linhas[0].tipo, acoes);
  if (erros.length) return falha('Seleção', erros);
  try {
    const r = executar(descricao ?? `Ações em ${linhas.length} linha(s) selecionada(s)`, () => medirEExecutar(agrupar(linhas), acoes, 'Seleção', tamanhoAmostra));
    return { ...r, aplicada: true };
  } catch (err) {
    return falha('Seleção', [(err as Error).message]);
  }
}

// ---------------------------------------------------------------------------
// Arquivo de regras
// ---------------------------------------------------------------------------

export interface ArquivoRegras {
  formato: 'sped-contrib-regras';
  versao: 1;
  /** ISO 8601 */
  exportadoEm: string;
  regras: Regra<TipoLinhaTodos>[];
}

/** Serializa regras para salvar em arquivo (.json). */
export function exportarRegras(regras: Regra<TipoLinhaTodos>[]): string {
  const arq: ArquivoRegras = { formato: 'sped-contrib-regras', versao: 1, exportadoEm: new Date().toISOString(), regras };
  return JSON.stringify(arq, null, 2);
}

/**
 * Lê um arquivo de regras (texto JSON ou objeto já lido). Lança erro com as mensagens
 * se o arquivo ou alguma regra for inválida. Regras sem id recebem um novo.
 */
export function importarRegras(json: string | unknown): Regra[];
/** Com `{ todosOsTipos: true }`, aceita também regras de serviço, imobilizado e cadastros. */
export function importarRegras(json: string | unknown, opcoes: { todosOsTipos: true }): Regra<TipoLinhaTodos>[];
export function importarRegras(json: string | unknown, opcoes: { todosOsTipos?: boolean } = {}): Regra<TipoLinhaTodos>[] {
  let dados: unknown = json;
  if (typeof json === 'string') {
    try {
      dados = JSON.parse(json);
    } catch {
      throw new Error('O arquivo de regras não é um JSON válido.');
    }
  }
  const arq = dados as Partial<ArquivoRegras>;
  if (!arq || arq.formato !== 'sped-contrib-regras') throw new Error('Arquivo não é de regras do editor (formato "sped-contrib-regras").');
  if (arq.versao !== 1) throw new Error(`Versão ${String(arq.versao)} do arquivo de regras não suportada.`);
  if (!Array.isArray(arq.regras)) throw new Error('O arquivo de regras não tem a lista "regras".');
  const erros: string[] = [];
  const regras = arq.regras.map((r, i) => {
    const regra: Regra<TipoLinhaTodos> = { ...r, id: r.id || novoId('r'), filtros: r.filtros ?? [], ativa: r.ativa ?? true };
    if (!opcoes.todosOsTipos && !(TIPOS_LINHA as readonly string[]).includes(regra.tipoLinha)) {
      erros.push(`Regra ${i + 1} (${r.nome ?? 'sem nome'}): tipo de linha "${regra.tipoLinha}" exige importarRegras(json, { todosOsTipos: true }).`);
    }
    for (const m of validarRegra(regra)) erros.push(`Regra ${i + 1} (${r.nome ?? 'sem nome'}): ${m}`);
    return regra;
  });
  if (erros.length) throw new Error(erros.join('\n'));
  return regras;
}
