/**
 * Tipo do crédito presumido (Tabela 4.3.6): x06 = presumido da agroindústria, x07 = outros
 * créditos presumidos (guia, M100 campo 02). Os documentos não dizem qual é: o motor aprende
 * do arquivo original (M100/M500 tipo 06/07 e seus M105) qual tipo cada alíquota (e cada
 * combinação alíquota + NAT_BC_CRED + CST) usa. Se o original tem os dois tipos e a operação
 * não se encaixa em um só, o recálculo é recusado (não adivinha).
 */
import { filhosDe, get, listar, type Escrituracao } from '../modelo';
import type { Tributo } from './tributos';
import { aliqEsc } from './util';

export interface MapaPresumido {
  /** Tipos (06/07) presentes no original. */
  tipos: string[];
  /** Alíquota (escala 10^4, texto) → tipos. */
  porAliq: Record<string, string[]>;
  /** "alíquota|NAT_BC_CRED|CST" → tipos. */
  porChave: Record<string, string[]>;
}

const juntar = (m: Record<string, string[]>, k: string, v: string) => {
  const l = (m[k] ??= []);
  if (!l.includes(v)) l.push(v);
};

export function aprenderPresumido(e: Escrituracao, t: Tributo): MapaPresumido {
  const mapa: MapaPresumido = { tipos: [], porAliq: {}, porChave: {} };
  for (const m100 of listar(e, t.M100)) {
    const tipo = get(m100, 'COD_CRED').slice(1);
    if (tipo !== '06' && tipo !== '07') continue;
    if (!mapa.tipos.includes(tipo)) mapa.tipos.push(tipo);
    const aliq = aliqEsc(get(m100, `ALIQ_${t.sfx}`)).toString();
    juntar(mapa.porAliq, aliq, tipo);
    for (const m105 of filhosDe(m100, t.M105)) juntar(mapa.porChave, `${aliq}|${get(m105, 'NAT_BC_CRED')}|${get(m105, `CST_${t.sfx}`)}`, tipo);
  }
  return mapa;
}

/**
 * Tipo (06/07) de uma operação de crédito presumido pelo que o original ensina.
 * Sem presumido no original: "07" (outros) e `suposto` = true. null = não dá para decidir.
 */
export function tipoPresumidoDe(m: MapaPresumido, op: { aliq: bigint; natBc: string; cst: string }): { tipo: string; suposto: boolean } | null {
  if (!m.tipos.length) return { tipo: '07', suposto: true };
  if (m.tipos.length === 1) return { tipo: m.tipos[0], suposto: false };
  const aliq = op.aliq.toString();
  const porChave = m.porChave[`${aliq}|${op.natBc}|${op.cst}`];
  if (porChave?.length === 1) return { tipo: porChave[0], suposto: false };
  const porAliq = m.porAliq[aliq];
  if (porAliq?.length === 1 && !porChave) return { tipo: porAliq[0], suposto: false };
  return null;
}
