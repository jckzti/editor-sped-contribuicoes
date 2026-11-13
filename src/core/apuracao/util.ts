/**
 * Utilitários do motor de apuração: leitura/gravação numérica preservando o formato
 * do arquivo, inserção ordenada de registros e conversões de período.
 */
import { centavos, deEscala, fmtCentavos, paraEscala } from '../dec';
import { get, inserirFilho, novoRegistro, set, type Registro } from '../modelo';

/** Valor do campo em centavos (vazio = 0). */
export function cent(r: Registro, campo: string): number {
  return centavos(get(r, campo));
}

/** Alíquota percentual em escala 10^4 ("1,65" → 16500n). */
export function aliqEsc(s: string): bigint {
  return paraEscala(s, 4);
}

/** Alíquota em escala 10^4 → texto do SPED ("1,65", "7,6", "0"). */
export function fmtAliq(v: bigint): string {
  return deEscala(v, 4);
}

/**
 * Grava um valor em centavos só se o valor numérico mudou: "0,00" e "0" valem o mesmo,
 * e o registro não deve ficar marcado como editado por diferença de formato.
 */
export function setCent(r: Registro, campo: string, v: number): void {
  const atual = get(r, campo);
  if (atual !== '' && centavos(atual) === v) return;
  set(r, campo, fmtCentavos(v));
}

/** Grava texto se diferente (o `set` do modelo já ignora valor igual). */
export function setTexto(r: Registro, campo: string, v: string): void {
  if (get(r, campo) !== v) set(r, campo, v);
}

/** Grava uma alíquota só se o valor numérico mudou. */
export function setAliq(r: Registro, campo: string, v: bigint): void {
  const atual = get(r, campo);
  if (atual !== '' && aliqEsc(atual) === v) return;
  set(r, campo, fmtAliq(v));
}

/**
 * Insere `filho` sob `pai` em ordem pela `chave`, entre os irmãos do mesmo tipo
 * (antes do primeiro irmão de chave maior). Sem irmão maior, usa `inserirFilho`.
 */
export function inserirOrdenado(pai: Registro, filho: Registro, chave: (r: Registro) => string): void {
  const k = chave(filho);
  const i = pai.filhos.findIndex((f) => f.reg === filho.reg && chave(f) > k);
  if (i < 0) {
    inserirFilho(pai, filho);
    return;
  }
  filho.pai = pai;
  pai.filhos.splice(i, 0, filho);
}

/** Cria registro novo com valores por nome. */
export function criar(reg: string, valores: Record<string, string>): Registro {
  return novoRegistro(reg, valores);
}

/** "AAAAMM" → "MMAAAA" (formato de PER_APU_CRED). */
export function perApu(periodo: string): string {
  return periodo.slice(4, 6) + periodo.slice(0, 4);
}

/** "MMAAAA" → "AAAAMM" (para ordenar). */
export function perOrd(perApuCred: string): string {
  const s = perApuCred.replace(/\D/g, '');
  if (s.length !== 6) return s;
  return s.slice(2, 6) + s.slice(0, 2);
}

/** Mês seguinte de "AAAAMM". */
export function proximoPeriodo(periodo: string): string {
  let a = Number(periodo.slice(0, 4));
  let m = Number(periodo.slice(4, 6)) + 1;
  if (m > 12) {
    m = 1;
    a++;
  }
  return `${a}${String(m).padStart(2, '0')}`;
}

/** Valor em reais legível para mensagens ("1.234,56"). */
export function reais(c: number): string {
  const s = fmtCentavos(Math.abs(c));
  const [i, d = ''] = s.split(',');
  const inteiro = i.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return (c < 0 ? '-' : '') + inteiro + ',' + d.padEnd(2, '0');
}

/** Soma por chave. */
export function somar<K>(m: Map<K, number>, k: K, v: number): void {
  m.set(k, (m.get(k) ?? 0) + v);
}

/** Acrescenta `v` à lista da chave `k`. */
export function agrupar<K, V>(m: Map<K, V[]>, k: K, v: V): void {
  const l = m.get(k);
  if (l) l.push(v);
  else m.set(k, [v]);
}

/** Situações de documento que não entram na apuração (cancelado, denegado, inutilizado). */
export const SITUACOES_FORA = new Set(['02', '03', '04', '05']);
