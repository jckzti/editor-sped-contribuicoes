import { describe, expect, it } from 'vitest';
import { filtroCompleto, listaDeValores, montarFiltro, montarFiltros, novoFormFiltro, opcoesDaColuna, operadoresDaColuna, paraFormFiltro, resumirFiltro, resumirFiltros } from './filtros';
import { coluna } from '../core/linhas';

describe('montagem de filtro a partir do formulário', () => {
  it('monta igualdade simples aparando espaços', () => {
    const f = { ...novoFormFiltro('C170.CFOP'), valor: ' 1101 ' };
    expect(montarFiltro(f)).toEqual({ coluna: 'C170.CFOP', op: 'igual', valor: '1101' });
  });

  it('monta a lista do operador "em" separando por vírgula', () => {
    const f = { ...novoFormFiltro('C170.CST_PIS', 'em'), valor: '50, 51 ,70' };
    expect(montarFiltro(f)).toEqual({ coluna: 'C170.CST_PIS', op: 'em', valores: ['50', '51', '70'] });
  });

  it('monta o "entre" com os dois limites', () => {
    const f = { ...novoFormFiltro('C170.VL_ITEM', 'entre'), valor: '100', valor2: '500' };
    expect(montarFiltro(f)).toEqual({ coluna: 'C170.VL_ITEM', op: 'entre', valor: '100', valor2: '500' });
  });

  it('não manda valor nos operadores de vazio', () => {
    expect(montarFiltro(novoFormFiltro('C170.COD_CTA', 'vazio'))).toEqual({ coluna: 'C170.COD_CTA', op: 'vazio' });
  });

  it('descarta filtros incompletos', () => {
    const fs = [
      { ...novoFormFiltro('C170.CFOP'), valor: '1101' },
      novoFormFiltro('C170.CST_PIS'),
      { ...novoFormFiltro('C170.VL_ITEM', 'entre'), valor: '10' },
      novoFormFiltro('C170.COD_CTA', 'naoVazio'),
    ];
    expect(montarFiltros(fs)).toEqual([
      { coluna: 'C170.CFOP', op: 'igual', valor: '1101' },
      { coluna: 'C170.COD_CTA', op: 'naoVazio' },
    ]);
  });

  it('reconhece o que está completo', () => {
    expect(filtroCompleto(novoFormFiltro('C170.CFOP'))).toBe(false);
    expect(filtroCompleto({ ...novoFormFiltro('C170.CFOP'), valor: '1101' })).toBe(true);
    expect(filtroCompleto({ ...novoFormFiltro('C170.CFOP', 'em'), valor: ' , ' })).toBe(false);
    expect(filtroCompleto(novoFormFiltro('C170.CFOP', 'vazio'))).toBe(true);
  });

  it('separa a lista por vírgula, ponto e vírgula ou linha', () => {
    expect(listaDeValores('50;51\n70, 73 ,')).toEqual(['50', '51', '70', '73']);
  });

  it('volta do filtro do motor para o formulário', () => {
    const f = paraFormFiltro({ coluna: 'C170.CST_PIS', op: 'em', valores: ['50', '51'] });
    expect(f.coluna).toBe('C170.CST_PIS');
    expect(f.op).toBe('em');
    expect(f.valor).toBe('50, 51');
    const g = paraFormFiltro({ coluna: 'C170.VL_ITEM', op: 'entre', valor: 1, valor2: 2 });
    expect(g.valor).toBe('1');
    expect(g.valor2).toBe('2');
  });
});

describe('operadores oferecidos', () => {
  it('não oferece "contém" em coluna numérica', () => {
    const ops = operadoresDaColuna(coluna('item', 'C170.VL_ITEM'));
    expect(ops).not.toContain('contem');
    expect(ops).toContain('entre');
  });

  it('oferece "contém" em coluna de texto', () => {
    expect(operadoresDaColuna(coluna('item', '0150.NOME'))).toContain('contem');
  });
});

describe('resumo dos filtros em português', () => {
  it('usa o rótulo fiscal da coluna e o nome do operador', () => {
    expect(resumirFiltro('item', { coluna: 'C170.CFOP', op: 'igual', valor: '1101' })).toBe('CFOP igual a 1101');
    expect(resumirFiltro('item', { coluna: 'C170.CST_PIS', op: 'em', valores: ['50', '51'] })).toBe('CST PIS está na lista: 50, 51');
    expect(resumirFiltro('item', { coluna: 'C170.COD_CTA', op: 'vazio' })).toBe('Conta contábil está vazio');
  });

  it('mostra data no formato brasileiro', () => {
    expect(resumirFiltro('item', { coluna: 'C100.DT_DOC', op: 'maior', valor: '01012024' })).toContain('01/01/2024');
  });

  it('junta os filtros com "e" e inclui a busca livre', () => {
    const texto = resumirFiltros('item', [
      { coluna: 'C170.CFOP', op: 'igual', valor: '1101' },
      { coluna: 'C170.VL_ITEM', op: 'maior', valor: '0' },
    ], 'parafuso');
    expect(texto).toBe('CFOP igual a 1101 e Valor item maior que 0 e texto contém "parafuso"');
  });

  it('sem filtro nenhum diz que são todas as linhas', () => {
    expect(resumirFiltros('item', [])).toBe('todas as linhas');
  });
});

describe('opções de código da coluna', () => {
  it('traz os CST com descrição', () => {
    const o = opcoesDaColuna(coluna('item', 'C170.CST_PIS'));
    expect(o).not.toBeNull();
    expect(o!.find((x) => x.codigo === '50')?.descricao).toMatch(/Crédito/i);
  });

  it('devolve null em coluna sem tabela de códigos', () => {
    expect(opcoesDaColuna(coluna('item', 'C170.VL_ITEM'))).toBeNull();
  });
});
