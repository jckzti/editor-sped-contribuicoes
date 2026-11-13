/**
 * O que o tour guarda no navegador: SÓ a versão do roteiro que a pessoa já viu.
 * Nenhum dado de cliente. Sem armazenamento (navegação privada), o tour funciona,
 * só não lembra que já foi visto.
 */

export const CHAVE_TOUR = 'sped-contrib.tour';

export type SituacaoTour = 'primeira-vez' | 'novidades' | 'em-dia';

/** Armazenamento mínimo (o `localStorage` cumpre; os testes passam um falso). */
export interface Armazem {
  getItem(chave: string): string | null;
  setItem(chave: string, valor: string): void;
}

function armazemPadrao(): Armazem | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

/** Versão do tour já vista (0 = nunca viu). */
export function versaoVista(armazem: Armazem | null = armazemPadrao()): number {
  try {
    const bruto = armazem?.getItem(CHAVE_TOUR);
    if (!bruto) return 0;
    const v = (JSON.parse(bruto) as { versaoVista?: unknown }).versaoVista;
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 0;
  } catch {
    return 0;
  }
}

export function marcarVisto(versao: number, armazem: Armazem | null = armazemPadrao()): void {
  try {
    armazem?.setItem(CHAVE_TOUR, JSON.stringify({ versaoVista: versao }));
  } catch {
    /* navegação privada ou armazenamento cheio: o tour funciona sem isso */
  }
}

/**
 * Primeira visita → o tour abre sozinho. Viu uma versão anterior → só o convite
 * "O sistema mudou". Viu a atual → nada.
 */
export function situacaoTour(versaoAtual: number, armazem: Armazem | null = armazemPadrao()): SituacaoTour {
  const vista = versaoVista(armazem);
  if (vista === 0) return 'primeira-vez';
  return vista < versaoAtual ? 'novidades' : 'em-dia';
}
