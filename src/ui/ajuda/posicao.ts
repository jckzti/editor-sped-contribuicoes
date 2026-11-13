/**
 * Geometria do tour (funções puras, testadas em `ajuda.test.ts`): onde desenhar o
 * recorte em volta do elemento e onde pôr o balão sem sair da tela.
 */

export interface Retangulo {
  top: number;
  left: number;
  width: number;
  height: number;
}

export interface Tamanho {
  width: number;
  height: number;
}

export type Lado = 'baixo' | 'cima' | 'direita' | 'esquerda' | 'dentro' | 'centro';

export interface PosicaoBalao {
  top: number;
  left: number;
  lado: Lado;
}

/** Folga entre o recorte e o elemento destacado. */
export const FOLGA_RECORTE = 6;
/** Distância entre o recorte e o balão. */
const DISTANCIA = 10;

const limitar = (v: number, min: number, max: number) => Math.max(min, Math.min(v, Math.max(min, max)));

/** Recorte (com folga) em volta do elemento, cortado nas bordas da tela. */
export function recorte(alvo: Retangulo, tela: Tamanho, folga = FOLGA_RECORTE): Retangulo {
  const top = Math.max(0, alvo.top - folga);
  const left = Math.max(0, alvo.left - folga);
  const bottom = Math.min(tela.height, alvo.top + alvo.height + folga);
  const right = Math.min(tela.width, alvo.left + alvo.width + folga);
  return { top, left, width: Math.max(0, right - left), height: Math.max(0, bottom - top) };
}

/**
 * Posição do balão: abaixo do recorte, se couber; senão acima, à direita, à esquerda;
 * se nada couber (elemento quase do tamanho da tela), por dentro, na parte de baixo.
 * Sem alvo, no centro. O resultado sempre fica inteiro dentro da tela (com margem),
 * desde que o balão caiba nela.
 */
export function posicionarBalao(alvo: Retangulo | null, balao: Tamanho, tela: Tamanho, margem = 12): PosicaoBalao {
  const maxLeft = tela.width - balao.width - margem;
  const maxTop = tela.height - balao.height - margem;
  if (!alvo) {
    return { top: limitar((tela.height - balao.height) / 2, margem, maxTop), left: limitar((tela.width - balao.width) / 2, margem, maxLeft), lado: 'centro' };
  }
  const centroX = limitar(alvo.left + alvo.width / 2 - balao.width / 2, margem, maxLeft);
  const centroY = limitar(alvo.top + alvo.height / 2 - balao.height / 2, margem, maxTop);
  const abaixo = alvo.top + alvo.height + DISTANCIA;
  if (abaixo + balao.height <= tela.height - margem) return { top: limitar(abaixo, margem, maxTop), left: centroX, lado: 'baixo' };
  const acima = alvo.top - DISTANCIA - balao.height;
  if (acima >= margem) return { top: limitar(acima, margem, maxTop), left: centroX, lado: 'cima' };
  const direita = alvo.left + alvo.width + DISTANCIA;
  if (direita + balao.width <= tela.width - margem) return { top: centroY, left: limitar(direita, margem, maxLeft), lado: 'direita' };
  const esquerda = alvo.left - DISTANCIA - balao.width;
  if (esquerda >= margem) return { top: centroY, left: limitar(esquerda, margem, maxLeft), lado: 'esquerda' };
  return { top: limitar(tela.height - balao.height - margem * 2, margem, maxTop), left: centroX, lado: 'dentro' };
}

/** O elemento está (ao menos em parte) fora da área visível? */
export function foraDaTela(alvo: Retangulo, tela: Tamanho): boolean {
  return alvo.top < 0 || alvo.left < 0 || alvo.top + alvo.height > tela.height || alvo.left + alvo.width > tela.width;
}
