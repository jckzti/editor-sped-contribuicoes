/**
 * Busca no manual (funções puras): sem acento, sem maiúsculas, todas as palavras
 * precisam aparecer na seção.
 */
import { SECOES, textoDaSecao, type Secao } from './conteudoManual';

/** "Apuração" → "apuracao". */
export function normalizar(t: string): string {
  return t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
}

/** Palavras da busca (normalizadas, sem repetição, ignorando vazias). */
export function termosDaBusca(busca: string): string[] {
  return [...new Set(normalizar(busca).split(/\s+/).filter(Boolean))];
}

const indice = new Map<string, string>();
function textoNormalizado(s: Secao): string {
  let t = indice.get(s.id);
  if (t === undefined) {
    t = normalizar(textoDaSecao(s));
    indice.set(s.id, t);
  }
  return t;
}

/** Seções em que todas as palavras aparecem (busca vazia = todas). */
export function buscarSecoes(busca: string, secoes: Secao[] = SECOES): Secao[] {
  const termos = termosDaBusca(busca);
  if (!termos.length) return secoes;
  return secoes.filter((s) => {
    const t = secoes === SECOES ? textoNormalizado(s) : normalizar(textoDaSecao(s));
    return termos.every((w) => t.includes(w));
  });
}

/**
 * Corta o texto em pedaços marcando onde há termo da busca (comparação sem acento,
 * mas devolvendo o texto original). Usado para o realce <mark>.
 */
export function realcar(texto: string, termos: string[]): { texto: string; marca: boolean }[] {
  if (!termos.length || !texto) return [{ texto, marca: false }];
  // normalizar pode mudar o tamanho (letra + acento combinante); mapeia posição a posição
  const base: string[] = [];
  const origem: number[] = [];
  for (let i = 0; i < texto.length; i++) {
    const n = normalizar(texto[i]);
    for (const c of n) {
      base.push(c);
      origem.push(i);
    }
  }
  const norm = base.join('');
  const marcado = new Array<boolean>(texto.length).fill(false);
  for (const termo of termos) {
    let de = 0;
    for (;;) {
      const k = norm.indexOf(termo, de);
      if (k < 0) break;
      for (let j = k; j < k + termo.length; j++) marcado[origem[j]] = true;
      de = k + 1;
    }
  }
  const out: { texto: string; marca: boolean }[] = [];
  for (let i = 0; i < texto.length; i++) {
    const ult = out[out.length - 1];
    if (ult && ult.marca === marcado[i]) ult.texto += texto[i];
    else out.push({ texto: texto[i], marca: marcado[i] });
  }
  return out;
}
