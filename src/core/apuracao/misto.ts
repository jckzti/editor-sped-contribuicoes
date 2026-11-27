import { get, listar, type Escrituracao } from '../modelo';
import type { Fontes, OpReceita } from './fontes';
import type { Tributo } from './tributos';
import { aliqEsc, cent } from './util';

export function regimeMisto(e: Escrituracao): boolean {
  const r = listar(e, '0110')[0];
  return !!r && get(r, 'COD_INC_TRIB') === '3';
}

export function aliquotasDiferenciadas(e: Escrituracao, t: Tributo): Map<bigint, string> {
  const porAliquota = new Map<bigint, Set<string>>();
  for (const r of listar(e, t.M210)) {
    const aliquota = aliqEsc(get(r, `ALIQ_${t.sfx}`));
    const codigo = get(r, 'COD_CONT');
    if (codigo !== '02' && codigo !== '52') continue;
    const codigos = porAliquota.get(aliquota) ?? new Set<string>();
    codigos.add(codigo);
    porAliquota.set(aliquota, codigos);
  }
  const resultado = new Map<bigint, string>();
  for (const [aliquota, codigos] of porAliquota) {
    if (aliquota > 0n && codigos.size === 1) resultado.set(aliquota, [...codigos][0]);
  }
  return resultado;
}

export function codigoReceitaMista(op: Pick<OpReceita, 'cst' | 'aliq'>, t: Tributo, diferenciadas: ReadonlyMap<bigint, string>): string | undefined {
  if (op.cst === '02') return diferenciadas.get(op.aliq);
  if (op.cst !== '01') return undefined;
  if (op.aliq === t.aliqBasica) return '01';
  if (op.aliq === t.aliqBasicaCum) return '51';
  return undefined;
}

export function temBaseCompartilhada(e: Escrituracao, t: Tributo): boolean {
  return listar(e, t.M105).some((r) => cent(r, `VL_BC_${t.sfx}_CUM`) !== 0);
}

/** Compara os insumos que o motor usaria para refazer créditos e estornos. */
export function dadosCredito(f: Fontes): string[] {
  return [
    ...f.creditos.map((c) => JSON.stringify([c.origem, c.natBc, c.cst, c.cfop, c.base, String(c.aliq), c.importacao, c.quantidade])),
    ...f.estornos.map((r) => JSON.stringify([r.chave, r.cfop, r.valor, r.codCta])),
  ].sort();
}
