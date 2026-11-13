/**
 * Ponte entre o formulário de filtros da tela e o tipo `Filtro` do motor.
 *
 * O formulário guarda tudo como texto (é o que o usuário digita); aqui ele é
 * convertido para o filtro do motor, validado e resumido em português.
 * Funções puras, testadas em `filtros.test.ts`.
 */
import { coluna, OPERADORES, type Coluna, type Filtro, type Operador, type TipoLinhaTodos } from '../core/linhas';
import { spedParaBr } from '../core/util';
import { codigosEmOrdem } from './formato';

/** Um filtro como está no formulário (tudo texto). */
export interface FormFiltro {
  /** Identificador único na lista (para a chave do React). */
  id: string;
  coluna: string;
  op: Operador;
  valor: string;
  /** Limite superior do operador "entre". */
  valor2: string;
}

let sequencia = 0;

export function novoFormFiltro(colunaId: string, op: Operador = 'igual'): FormFiltro {
  return { id: `f${++sequencia}`, coluna: colunaId, op, valor: '', valor2: '' };
}

/** Operadores que não pedem valor. */
export const OPERADORES_SEM_VALOR: Operador[] = ['vazio', 'naoVazio'];

/** Operadores oferecidos para a coluna (números e datas não ganham "contém"/"começa com"). */
export function operadoresDaColuna(col: Coluna | undefined): Operador[] {
  const todos = Object.keys(OPERADORES) as Operador[];
  if (!col) return todos;
  if (col.tipo === 'numero' || col.tipo === 'data') return todos.filter((o) => o !== 'contem' && o !== 'comeca');
  return todos;
}

/** O filtro está preenchido o bastante para valer? */
export function filtroCompleto(f: FormFiltro): boolean {
  if (!f.coluna) return false;
  if (OPERADORES_SEM_VALOR.includes(f.op)) return true;
  if (f.op === 'entre') return f.valor.trim() !== '' && f.valor2.trim() !== '';
  if (f.op === 'em') return listaDeValores(f.valor).length > 0;
  return f.valor.trim() !== '';
}

/** "50, 60 , 70" → ["50", "60", "70"]. */
export function listaDeValores(texto: string): string[] {
  return texto
    .split(/[,;\n]/)
    .map((s) => s.trim())
    .filter((s) => s !== '');
}

/** Converte um filtro do formulário para o filtro do motor. */
export function montarFiltro(f: FormFiltro): Filtro {
  if (f.op === 'em') return { coluna: f.coluna, op: 'em', valores: listaDeValores(f.valor) };
  if (f.op === 'entre') return { coluna: f.coluna, op: 'entre', valor: f.valor.trim(), valor2: f.valor2.trim() };
  if (OPERADORES_SEM_VALOR.includes(f.op)) return { coluna: f.coluna, op: f.op };
  return { coluna: f.coluna, op: f.op, valor: f.valor.trim() };
}

/** Converte a lista do formulário, descartando os filtros incompletos. */
export function montarFiltros(formularios: FormFiltro[]): Filtro[] {
  return formularios.filter(filtroCompleto).map(montarFiltro);
}

/** Converte um filtro do motor de volta para o formulário (ao editar uma regra salva). */
export function paraFormFiltro(f: Filtro): FormFiltro {
  return {
    id: `f${++sequencia}`,
    coluna: f.coluna,
    op: f.op,
    valor: f.op === 'em' ? (f.valores ?? []).join(', ') : f.valor === undefined ? '' : String(f.valor),
    valor2: f.valor2 === undefined ? '' : String(f.valor2),
  };
}

function valorLegivel(col: Coluna | undefined, v: string | number | undefined): string {
  const s = v === undefined ? '' : String(v);
  if (col?.tipo === 'data' && /^\d{8}$/.test(s)) return spedParaBr(s);
  return s;
}

/** Um filtro em português: `Base PIS maior que 0`. */
export function resumirFiltro(tipo: TipoLinhaTodos, f: Filtro): string {
  const col = coluna(tipo, f.coluna);
  const rotulo = col?.rotulo ?? f.coluna;
  const op = OPERADORES[f.op] ?? f.op;
  if (OPERADORES_SEM_VALOR.includes(f.op)) return `${rotulo} ${op}`;
  if (f.op === 'em') return `${rotulo} ${op}: ${(f.valores ?? []).join(', ')}`;
  if (f.op === 'entre') return `${rotulo} ${op} ${valorLegivel(col, f.valor)} e ${valorLegivel(col, f.valor2)}`;
  return `${rotulo} ${op} ${valorLegivel(col, f.valor)}`;
}

/** Todos os filtros em uma frase ("e" entre eles); vazio = "todas as linhas". */
export function resumirFiltros(tipo: TipoLinhaTodos, filtros: Filtro[], busca?: string): string {
  const partes = (filtros ?? []).map((f) => resumirFiltro(tipo, f));
  if (busca?.trim()) partes.push(`texto contém "${busca.trim()}"`);
  return partes.length ? partes.join(' e ') : 'todas as linhas';
}

/** Códigos válidos da coluna (CST, NAT_BC_CRED, COD_SIT...) para montar lista de escolha. */
export function opcoesDaColuna(col: Coluna | undefined): { codigo: string; descricao: string }[] | null {
  if (!col?.valores) return null;
  return codigosEmOrdem(col.valores).map(([codigo, descricao]) => ({ codigo, descricao }));
}
