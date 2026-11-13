/**
 * Regra de seleção de linhas da grade (pura, sem React).
 *
 * Para "selecionar tudo" em 400 mil linhas guarda-se `tudo: true` com as exceções
 * desmarcadas, em vez de 400 mil números. Desmarcar uma linha depois de "tudo" vira
 * exceção; nada aqui monta lista com o total de linhas, exceto marcar um intervalo
 * com Shift quando a seleção não está em modo "tudo" (cresce só com o intervalo).
 */

export interface SelecaoLinhas {
  tudo: boolean;
  /** Se `tudo` for falso: linhas marcadas. Se for verdadeiro: linhas desmarcadas. */
  indices: Set<number>;
  /** Última linha clicada, para o Shift + clique. */
  ancora?: number;
}

export const selecaoVazia = (): SelecaoLinhas => ({ tudo: false, indices: new Set() });

export const selecaoTudo = (): SelecaoLinhas => ({ tudo: true, indices: new Set() });

export function selecionada(s: SelecaoLinhas, i: number): boolean {
  return s.tudo !== s.indices.has(i);
}

export function tamanhoSelecao(s: SelecaoLinhas, total: number): number {
  return s.tudo ? total - s.indices.size : s.indices.size;
}

/** Índices selecionados, em ordem. Materializa a lista: use só ao aplicar a edição. */
export function indicesSelecionados(s: SelecaoLinhas, total: number): number[] {
  if (!s.tudo) return [...s.indices].sort((a, b) => a - b);
  const out: number[] = [];
  for (let i = 0; i < total; i++) if (!s.indices.has(i)) out.push(i);
  return out;
}

export interface OpcoesAlternar {
  /** Shift + clique: marca o intervalo desde a última linha clicada. */
  shift?: boolean;
  /** Quantidade de linhas da grade (limita o intervalo e normaliza "tudo"/"nada"). */
  total: number;
}

/**
 * Efeito de um clique numa linha, sem tecla modificadora:
 *  - clique simples: marca a linha, ou desmarca se já estava marcada (soma às outras);
 *  - Shift + clique: marca todas as linhas entre a última clicada e esta;
 *  - sem âncora (nenhuma linha clicada antes), o Shift + clique age como clique simples.
 *
 * Devolve uma seleção nova; a recebida não é alterada.
 */
export function alternarSelecao(s: SelecaoLinhas, indice: number, { shift = false, total }: OpcoesAlternar): SelecaoLinhas {
  if (indice < 0 || indice >= total) return s;
  const indices = new Set(s.indices);

  if (shift && s.ancora !== undefined) {
    const de = Math.max(0, Math.min(s.ancora, indice));
    const ate = Math.min(total - 1, Math.max(s.ancora, indice));
    if (s.tudo) {
      // marcar = tirar das exceções; só olha as exceções, não o intervalo inteiro
      for (const k of s.indices) if (k >= de && k <= ate) indices.delete(k);
    } else {
      for (let k = de; k <= ate; k++) indices.add(k);
    }
  } else if (indices.has(indice)) {
    indices.delete(indice);
  } else {
    indices.add(indice);
  }

  return normalizar({ tudo: s.tudo, indices, ancora: indice }, total);
}

/** Todas marcadas vira "tudo sem exceções" (o que permite "salvar como regra"); nenhuma, vazia. */
function normalizar(s: SelecaoLinhas, total: number): SelecaoLinhas {
  if (total > 0 && s.indices.size === total) return { tudo: !s.tudo, indices: new Set(), ancora: s.ancora };
  return s;
}

/** Caixa do cabeçalho: se tudo já está marcado, limpa; senão, marca tudo o que está filtrado. */
export function alternarTudo(s: SelecaoLinhas, total: number): SelecaoLinhas {
  const todas = total > 0 && tamanhoSelecao(s, total) === total;
  return todas ? selecaoVazia() : selecaoTudo();
}

/**
 * Duas listas de linhas são "o mesmo conjunto, na mesma ordem" quando têm o mesmo
 * tamanho e, em cada posição, a mesma linha. Só assim os índices da seleção continuam
 * valendo depois de uma nova renderização. `igual` diz quando duas linhas são a mesma
 * (por padrão, a mesma identidade): o sistema refaz os objetos de linha a cada
 * alteração, então quem usa compara os registros do arquivo que a linha aponta.
 */
export function mesmoConjunto<T>(a: readonly T[], b: readonly T[], igual: (x: T, y: T) => boolean = Object.is): boolean {
  if (a === b) return true;
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) if (!igual(a[i], b[i])) return false;
  return true;
}
