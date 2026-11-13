/**
 * Natureza da receita (M410/M810) das receitas não tributadas (CST 04–09).
 *
 * O C170 não tem campo de natureza da receita. O motor aprende, no arquivo original,
 * uma chave de agrupamento dos itens (COD_NAT, CFOP, COD_NAT+CFOP, NCM ou COD_ITEM)
 * cujos grupos somam exatamente os valores dos M410 (partição exata em centavos), e
 * guarda o mapeamento chave → NAT_REC por CNPJ, para valer nos outros meses carregados.
 */
import { get, listar, type Escrituracao } from '../modelo';
import type { PendenciaNaturezaReceita } from './contrato';
import type { OpReceita } from './fontes';
import type { IdTributo } from './tributos';
import { reais } from './util';

export type TipoChave = 'COD_NAT' | 'CFOP' | 'COD_NAT+CFOP' | 'NCM' | 'COD_ITEM';

/** Ordem de tentativa do aprendizado (da chave mais grossa para a mais fina). */
export const TIPOS_CHAVE: TipoChave[] = ['COD_NAT', 'CFOP', 'COD_NAT+CFOP', 'NCM', 'COD_ITEM'];

/** Chave padrão quando o CST não tinha M410 no original nem em outro mês. */
export const TIPO_CHAVE_PADRAO: TipoChave = 'NCM';

export interface MapaNatureza {
  tipoChave: TipoChave;
  /** Chave completa ("COD_NAT:6109001") → NAT_REC. */
  mapa: Record<string, string>;
}

/** Naturezas conhecidas de um CNPJ (aprendidas dos originais e definidas pelo usuário). */
export interface NaturezasCnpj {
  /** Por tributo e CST. */
  aprendido: Partial<Record<IdTributo, Record<string, MapaNatureza>>>;
  /** Definições manuais por CST: chave completa → NAT_REC (valem para PIS e Cofins). */
  manual: Record<string, Record<string, string>>;
}

/** Memória por CNPJ, compartilhada entre os meses carregados. */
const memoria = new Map<string, NaturezasCnpj>();

export function memoriaNaturezas(cnpj: string): NaturezasCnpj {
  let m = memoria.get(cnpj);
  if (!m) {
    m = { aprendido: {}, manual: {} };
    memoria.set(cnpj, m);
  }
  return m;
}

/** Só para testes: esquece tudo o que foi aprendido/definido. */
export function limparMemoriaNaturezas(): void {
  memoria.clear();
}

/** Mescla `origem` em `destino` sem sobrescrever o que já existe. */
export function mesclarNaturezas(destino: NaturezasCnpj, origem: NaturezasCnpj): void {
  for (const [trib, porCst] of Object.entries(origem.aprendido) as [IdTributo, Record<string, MapaNatureza>][]) {
    const d = (destino.aprendido[trib] ??= {});
    for (const [cst, m] of Object.entries(porCst)) {
      const atual = d[cst];
      if (!atual) d[cst] = { tipoChave: m.tipoChave, mapa: { ...m.mapa } };
      else if (atual.tipoChave === m.tipoChave) {
        for (const [k, v] of Object.entries(m.mapa)) if (!(k in atual.mapa)) atual.mapa[k] = v;
      }
    }
  }
  for (const [cst, mapa] of Object.entries(origem.manual)) {
    const d = (destino.manual[cst] ??= {});
    for (const [k, v] of Object.entries(mapa)) d[k] = v;
  }
}

/** COD_ITEM → NCM (registro 0200). */
export function mapaNcm(e: Escrituracao): Map<string, string> {
  const m = new Map<string, string>();
  for (const r of listar(e, '0200')) m.set(get(r, 'COD_ITEM'), get(r, 'COD_NCM'));
  return m;
}

/** Chave completa de uma operação para um tipo de chave. */
export function chaveDe(op: OpReceita, tipo: TipoChave, ncm: Map<string, string>): string {
  const doc = op.origem === 'C170';
  let v: string;
  switch (tipo) {
    case 'COD_NAT':
      v = doc ? op.codNat : op.origem;
      break;
    case 'CFOP':
      v = doc ? op.cfop : op.origem;
      break;
    case 'COD_NAT+CFOP':
      v = doc ? `${op.codNat}/${op.cfop}` : op.origem;
      break;
    case 'NCM':
      v = ncm.get(op.codItem) || (doc ? '' : op.origem);
      break;
    case 'COD_ITEM':
      v = op.codItem || op.origem;
      break;
  }
  return `${tipo}:${v}`;
}

/** Tipo de chave contido numa chave completa ("COD_NAT:123" → "COD_NAT"). */
export function tipoDaChave(chave: string): TipoChave | null {
  const t = chave.slice(0, chave.indexOf(':'));
  return (TIPOS_CHAVE as string[]).includes(t) ? (t as TipoChave) : null;
}

/**
 * Partição exata: atribui cada grupo a uma natureza de modo que as somas batam.
 * Busca em profundidade com poda e limite de nós (o problema é NP-difícil em geral).
 */
export function particionar(grupos: [string, number][], alvos: [string, number][], limiteNos = 200_000): Record<string, string> | null {
  const somaG = grupos.reduce((s, [, v]) => s + v, 0);
  const somaA = alvos.reduce((s, [, v]) => s + v, 0);
  if (somaG !== somaA || alvos.length === 0) return null;
  if (grupos.some(([, v]) => v < 0) || alvos.some(([, v]) => v < 0)) return null;
  const out: Record<string, string> = {};
  const maior = [...alvos].sort((a, b) => b[1] - a[1])[0][0];
  const ativos = grupos.filter(([k, v]) => {
    if (v === 0) out[k] = maior;
    return v !== 0;
  });
  ativos.sort((a, b) => b[1] - a[1]);
  const resto = alvos.map(([, v]) => v);
  let nos = 0;
  const visita = (i: number): boolean => {
    if (i === ativos.length) return resto.every((r) => r === 0);
    if (++nos > limiteNos) return false;
    const v = ativos[i][1];
    const tentados = new Set<number>();
    for (let j = 0; j < resto.length; j++) {
      if (resto[j] < v || tentados.has(resto[j])) continue;
      tentados.add(resto[j]); // alvos com o mesmo saldo são equivalentes
      resto[j] -= v;
      out[ativos[i][0]] = alvos[j][0];
      if (visita(i + 1)) return true;
      resto[j] += v;
    }
    return false;
  };
  return visita(0) ? out : null;
}

/**
 * Conta as partições exatas (até 2: o que importa é saber se é única). Diferente de
 * `particionar`, não trata como equivalentes duas naturezas com o mesmo saldo (trocar os
 * grupos entre elas é outra resposta). Grupos de valor zero não entram (não dizem nada).
 * `esgotou` = o limite de nós acabou antes de decidir (tratar como não única).
 */
export function contarParticoes(
  grupos: [string, number][],
  alvos: [string, number][],
  limiteNos = 200_000,
): { n: 0 | 1 | 2; solucao: Record<string, string> | null; esgotou: boolean } {
  const somaG = grupos.reduce((s, [, v]) => s + v, 0);
  const somaA = alvos.reduce((s, [, v]) => s + v, 0);
  if (somaG !== somaA || !alvos.length || grupos.some(([, v]) => v < 0) || alvos.some(([, v]) => v < 0)) {
    return { n: 0, solucao: null, esgotou: false };
  }
  const ativos = grupos.filter(([, v]) => v !== 0).sort((a, b) => b[1] - a[1]);
  const resto = alvos.map(([, v]) => v);
  const atual: Record<string, string> = {};
  let solucao: Record<string, string> | null = null;
  let n = 0;
  let nos = 0;
  let esgotou = false;
  const visita = (i: number): void => {
    if (n >= 2 || esgotou) return;
    if (i === ativos.length) {
      if (resto.every((r) => r === 0)) {
        n++;
        if (!solucao) solucao = { ...atual };
      }
      return;
    }
    if (++nos > limiteNos) {
      esgotou = true;
      return;
    }
    const v = ativos[i][1];
    for (let j = 0; j < resto.length && n < 2 && !esgotou; j++) {
      if (resto[j] < v) continue;
      resto[j] -= v;
      atual[ativos[i][0]] = alvos[j][0];
      visita(i + 1);
      resto[j] += v;
    }
  };
  visita(0);
  return { n: n as 0 | 1 | 2, solucao, esgotou };
}

/**
 * Tenta aprender a chave que explica os M410 de um CST. Só aceita uma chave cuja partição
 * seja ÚNICA: se os grupos de uma chave podem ser divididos entre as naturezas de mais de
 * um jeito, a coincidência de somas não prova nada (`info.ambigua` = true) e a chave não é
 * aprendida; a receita fica como pendência para o usuário quando mudar.
 */
export function aprenderNatureza(
  ops: OpReceita[],
  alvos: [string, number][],
  ncm: Map<string, string>,
  info?: { ambigua?: boolean },
): MapaNatureza | null {
  for (const tipo of TIPOS_CHAVE) {
    const g = new Map<string, number>();
    for (const op of ops) {
      const k = chaveDe(op, tipo, ncm);
      g.set(k, (g.get(k) ?? 0) + op.receita);
    }
    const r = contarParticoes([...g.entries()], alvos);
    if (r.n === 1 && !r.esgotou) return { tipoChave: tipo, mapa: r.solucao! };
    if (r.n > 0 || r.esgotou) if (info) info.ambigua = true;
  }
  return null;
}

/** M410 do original, por CST, para os casos em que nenhuma chave explicou a divisão. */
export interface NaturezaOriginal {
  totais: [string, number][];
  total: number;
}

export interface ContextoNatureza {
  cst: string;
  tipoChave: TipoChave;
  /** NAT_REC da chave, se conhecida. */
  buscar(chave: string): string | undefined;
  /** Há mapeamento (aprendido ou manual) para este CST. */
  temMapa: boolean;
  original?: NaturezaOriginal;
  ncm: Map<string, string>;
}

export interface ResultadoNatureza {
  linhas: Map<string, number>;
  pendencias: PendenciaNaturezaReceita[];
}

function rotulo(chave: string): string {
  const i = chave.indexOf(':');
  return `${chave.slice(0, i)} ${chave.slice(i + 1) || '(vazio)'}`;
}

/** Distribui a receita de um CST entre as naturezas (M410). */
export function distribuirNatureza(ops: OpReceita[], ctx: ContextoNatureza): ResultadoNatureza {
  const linhas = new Map<string, number>();
  const pendencias: PendenciaNaturezaReceita[] = [];
  const add = (nat: string, v: number) => linhas.set(nat, (linhas.get(nat) ?? 0) + v);
  const orig = ctx.original;
  const reserva = orig && orig.totais.length === 1 ? orig.totais[0][0] : '999';
  const total = ops.reduce((s, o) => s + o.receita, 0);

  if (!ctx.temMapa && orig) {
    // Nenhuma chave explicou o original: mantém as proporções só se o total não mudou.
    const chaveCst = `CST:${ctx.cst}`;
    const definida = ctx.buscar(chaveCst);
    if (total === orig.total) {
      for (const [n, v] of orig.totais) add(n, v);
    } else if (total > orig.total) {
      for (const [n, v] of orig.totais) add(n, v);
      const delta = total - orig.total;
      add(definida ?? reserva, delta);
      if (!definida) {
        pendencias.push({
          cst: ctx.cst,
          chave: chaveCst,
          descricao: `CST ${ctx.cst}: acréscimo de R$ ${reais(delta)} na receita sem natureza conhecida (a divisão original não pôde ser explicada pelos itens)`,
          valor: delta,
        });
      }
    } else {
      add(definida ?? reserva, total);
      if (!definida) {
        pendencias.push({
          cst: ctx.cst,
          chave: chaveCst,
          descricao: `CST ${ctx.cst}: receita alterada (R$ ${reais(total)}) e a divisão original por natureza não pôde ser explicada pelos itens`,
          valor: total,
        });
      }
    }
    return { linhas, pendencias };
  }

  const grupos = new Map<string, { valor: number; itens: number }>();
  for (const op of ops) {
    const k = chaveDe(op, ctx.tipoChave, ctx.ncm);
    const g = grupos.get(k) ?? { valor: 0, itens: 0 };
    g.valor += op.receita;
    g.itens++;
    grupos.set(k, g);
  }
  for (const [k, g] of grupos) {
    const nat = ctx.buscar(k);
    if (nat) {
      add(nat, g.valor);
      continue;
    }
    add(reserva, g.valor);
    if (g.valor !== 0) {
      pendencias.push({
        cst: ctx.cst,
        chave: k,
        descricao: `CST ${ctx.cst} — ${rotulo(k)}: ${g.itens} item(ns), R$ ${reais(g.valor)} sem natureza da receita conhecida (lançado em ${reserva})`,
        valor: g.valor,
      });
    }
  }
  return { linhas, pendencias };
}
