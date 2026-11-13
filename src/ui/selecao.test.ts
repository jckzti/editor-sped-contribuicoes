import { describe, expect, it } from 'vitest';
import { alternarSelecao, alternarTudo, indicesSelecionados, mesmoConjunto, selecaoTudo, selecaoVazia, selecionada, tamanhoSelecao } from './selecao';

const TOTAL = 10;
const clicar = (s = selecaoVazia(), i = 0, shift = false, total = TOTAL) => alternarSelecao(s, i, { shift, total });

describe('alternarSelecao', () => {
  it('clique simples soma às já marcadas, sem tecla modificadora', () => {
    let s = clicar(selecaoVazia(), 2);
    s = clicar(s, 5);
    s = clicar(s, 7);
    expect(indicesSelecionados(s, TOTAL)).toEqual([2, 5, 7]);
    expect(tamanhoSelecao(s, TOTAL)).toBe(3);
    s = clicar(s, 0);
    expect(tamanhoSelecao(s, TOTAL)).toBe(4);
  });

  it('segundo clique na mesma linha desmarca', () => {
    let s = clicar(selecaoVazia(), 3);
    s = clicar(s, 4);
    s = clicar(s, 3);
    expect(selecionada(s, 3)).toBe(false);
    expect(selecionada(s, 4)).toBe(true);
    expect(tamanhoSelecao(s, TOTAL)).toBe(1);
  });

  it('não altera a seleção recebida', () => {
    const antes = clicar(selecaoVazia(), 1);
    clicar(antes, 2);
    expect([...antes.indices]).toEqual([1]);
  });

  it('Shift + clique marca o intervalo desde a última linha clicada (nos dois sentidos)', () => {
    let s = clicar(selecaoVazia(), 2);
    s = clicar(s, 5, true);
    expect(indicesSelecionados(s, TOTAL)).toEqual([2, 3, 4, 5]);
    // a âncora passa a ser a última clicada: o próximo Shift parte da linha 5
    s = clicar(s, 8, true);
    expect(indicesSelecionados(s, TOTAL)).toEqual([2, 3, 4, 5, 6, 7, 8]);
    s = clicar(s, 1, true);
    expect(indicesSelecionados(s, TOTAL)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
  });

  it('Shift + clique soma ao que já estava marcado fora do intervalo', () => {
    let s = clicar(selecaoVazia(), 0);
    s = clicar(s, 8);
    s = clicar(s, 5, true);
    expect(indicesSelecionados(s, TOTAL)).toEqual([0, 5, 6, 7, 8]);
  });

  it('Shift + clique sem linha clicada antes age como clique simples', () => {
    const s = clicar(selecaoVazia(), 4, true);
    expect(indicesSelecionados(s, TOTAL)).toEqual([4]);
  });

  it('ignora índice fora da grade', () => {
    const s = selecaoVazia();
    expect(clicar(s, -1)).toBe(s);
    expect(clicar(s, TOTAL)).toBe(s);
  });

  it('o intervalo não passa do total de linhas', () => {
    let s = clicar(selecaoVazia(), 8);
    s = alternarSelecao({ ...s, ancora: 8 }, 9, { shift: true, total: 10 });
    expect(indicesSelecionados(s, 10)).toEqual([8, 9]);
  });
});

describe('seleção "tudo com exceções"', () => {
  it('desmarcar uma linha depois de "tudo" vira exceção, sem lista de linhas', () => {
    const total = 400_000;
    let s = selecaoTudo();
    expect(tamanhoSelecao(s, total)).toBe(total);
    s = alternarSelecao(s, 123_456, { total });
    expect(s.tudo).toBe(true);
    expect([...s.indices]).toEqual([123_456]);
    expect(selecionada(s, 123_456)).toBe(false);
    expect(selecionada(s, 123_457)).toBe(true);
    expect(tamanhoSelecao(s, total)).toBe(total - 1);
  });

  it('marcar de novo a exceção a devolve para a seleção', () => {
    const total = 400_000;
    let s = alternarSelecao(selecaoTudo(), 10, { total });
    s = alternarSelecao(s, 10, { total });
    expect(s.tudo).toBe(true);
    expect(s.indices.size).toBe(0);
    expect(tamanhoSelecao(s, total)).toBe(total);
  });

  it('Shift + clique em modo "tudo" só tira exceções, sem percorrer o intervalo', () => {
    const total = 400_000;
    let s = selecaoTudo();
    s = alternarSelecao(s, 100, { total }); // exceção 100
    s = alternarSelecao(s, 200_000, { total }); // exceção 200000 (âncora)
    s = alternarSelecao(s, 50, { total }); // exceção 50 (âncora)
    s = alternarSelecao(s, 150, { shift: true, total }); // marca 50..150: tira 50 e 100
    expect(s.tudo).toBe(true);
    expect([...s.indices]).toEqual([200_000]);
    expect(tamanhoSelecao(s, total)).toBe(total - 1);
  });

  it('com uma só linha, marcar e desmarcar alterna entre tudo e nada', () => {
    let s = clicar(selecaoVazia(), 0, false, 1);
    expect(tamanhoSelecao(s, 1)).toBe(1);
    s = alternarSelecao(s, 0, { total: 1 });
    expect(tamanhoSelecao(s, 1)).toBe(0);
    expect(s.tudo).toBe(false);
  });

  it('marcar todas as linhas à mão vira "tudo sem exceções" (permite salvar como regra)', () => {
    let s = selecaoVazia();
    for (let i = 0; i < 4; i++) s = clicar(s, i, false, 4);
    expect(s.tudo).toBe(true);
    expect(s.indices.size).toBe(0);
    expect(tamanhoSelecao(s, 4)).toBe(4);
  });

  it('desmarcar tudo à mão volta para vazia', () => {
    let s = selecaoTudo();
    for (let i = 0; i < 4; i++) s = clicar(s, i, false, 4);
    expect(s.tudo).toBe(false);
    expect(s.indices.size).toBe(0);
    expect(tamanhoSelecao(s, 4)).toBe(0);
  });
});

describe('alternarTudo (caixa do cabeçalho)', () => {
  it('marca tudo, e com tudo marcado limpa', () => {
    let s = alternarTudo(selecaoVazia(), TOTAL);
    expect(tamanhoSelecao(s, TOTAL)).toBe(TOTAL);
    s = alternarTudo(s, TOTAL);
    expect(tamanhoSelecao(s, TOTAL)).toBe(0);
  });

  it('com seleção parcial, marca tudo', () => {
    const parcial = clicar(selecaoVazia(), 3);
    expect(tamanhoSelecao(alternarTudo(parcial, TOTAL), TOTAL)).toBe(TOTAL);
  });

  it('sem linhas, não marca nada de verdade (tamanho zero)', () => {
    expect(tamanhoSelecao(alternarTudo(selecaoVazia(), 0), 0)).toBe(0);
  });
});

describe('mesmoConjunto', () => {
  const a = { n: 1 };
  const b = { n: 2 };
  it('mesmas linhas na mesma ordem: mesmo conjunto, mesmo com outro array', () => {
    expect(mesmoConjunto([a, b], [a, b])).toBe(true);
  });
  it('ordem, tamanho ou linhas diferentes: conjunto diferente', () => {
    expect(mesmoConjunto([a, b], [b, a])).toBe(false);
    expect(mesmoConjunto([a, b], [a])).toBe(false);
    expect(mesmoConjunto([a], [{ ...a }])).toBe(false);
  });
  it('com comparador próprio, objetos refeitos que apontam para o mesmo registro contam como iguais', () => {
    const reg = {};
    const antes = [{ reg, n: 1 }];
    const depois = [{ reg, n: 1 }];
    expect(mesmoConjunto(antes, depois)).toBe(false);
    expect(mesmoConjunto(antes, depois, (x, y) => x.reg === y.reg)).toBe(true);
  });
});
