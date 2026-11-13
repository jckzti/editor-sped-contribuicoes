import { describe, expect, it } from 'vitest';
import { totaisVazios } from '../core/linhas';
import { brl, brlSinal, cnpjLegivel, codigoComDescricao, inteiro, intervaloPeriodos, periodoLegivel, plural, resumoTotais, totalDaColuna } from './formato';
import { colunasPadrao } from './celulas';

describe('formatação de valores', () => {
  it('mostra centavos em reais no padrão brasileiro', () => {
    expect(brl(0)).toBe('0,00');
    expect(brl(123456789)).toBe('1.234.567,89');
    expect(brl(-500)).toBe('-5,00');
  });

  it('mostra variação com sinal e travessão no zero', () => {
    expect(brlSinal(0)).toBe('—');
    expect(brlSinal(12345)).toBe('+123,45');
    expect(brlSinal(-12345)).toBe('−123,45');
  });

  it('agrupa milhares em inteiros', () => {
    expect(inteiro(6921)).toBe('6.921');
  });
});

describe('períodos', () => {
  it('converte AAAAMM e AAAA-MM para MM/AAAA', () => {
    expect(periodoLegivel('202401')).toBe('01/2024');
    expect(periodoLegivel('2024-12')).toBe('12/2024');
    expect(periodoLegivel('')).toBe('');
  });

  it('monta o intervalo carregado', () => {
    expect(intervaloPeriodos(['202403', '202401', '202412'])).toBe('01/2024 a 12/2024');
    expect(intervaloPeriodos(['202401'])).toBe('01/2024');
    expect(intervaloPeriodos([])).toBe('');
  });

  it('faz o plural de mês', () => {
    expect(plural(1, 'mês', 'meses')).toBe('1 mês');
    expect(plural(12, 'mês', 'meses')).toBe('12 meses');
  });
});

describe('códigos e documentos', () => {
  it('põe a descrição ao lado do código', () => {
    expect(codigoComDescricao({ '50': 'Operação com Direito a Crédito' }, '50')).toBe('50 — Operação com Direito a Crédito');
    expect(codigoComDescricao(undefined, '50')).toBe('50');
    expect(codigoComDescricao({}, '99')).toBe('99');
  });

  it('formata CNPJ e deixa passar o que não é CNPJ', () => {
    expect(cnpjLegivel('12345678000190')).toBe('12.345.678/0001-90');
    expect(cnpjLegivel('123')).toBe('123');
  });
});

describe('linha de totais da grade', () => {
  const t = { ...totaisVazios(), linhas: 10, valorItem: 1000, desconto: 100, basePis: 900, valorPis: 15, baseCofins: 900, valorCofins: 68, valorDocumento: 2000 };

  it('põe a contagem de linhas na primeira coluna', () => {
    expect(totalDaColuna('periodo', t, 'periodo')).toBe('10 linha(s)');
  });

  it('casa cada campo de valor com a soma certa', () => {
    expect(totalDaColuna('C170.VL_ITEM', t, 'periodo')).toBe('10,00');
    expect(totalDaColuna('C170.VL_DESC', t, 'periodo')).toBe('1,00');
    expect(totalDaColuna('C170.VL_BC_PIS', t, 'periodo')).toBe('9,00');
    expect(totalDaColuna('C170.VL_PIS', t, 'periodo')).toBe('0,15');
    expect(totalDaColuna('C170.VL_COFINS', t, 'periodo')).toBe('0,68');
    expect(totalDaColuna('C100.VL_DOC', t, 'periodo')).toBe('20,00');
    expect(totalDaColuna('F100.VL_OPER', t, 'periodo')).toBe('10,00');
  });

  it('deixa em branco as colunas sem total', () => {
    expect(totalDaColuna('C170.CFOP', t, 'periodo')).toBe('');
    expect(totalDaColuna('0150.NOME', t, 'periodo')).toBe('');
  });

  it('resume os totais da seleção', () => {
    expect(resumoTotais(t)).toBe('base de PIS R$ 9,00 · PIS R$ 0,15 · COFINS R$ 0,68');
  });
});

describe('colunas iniciais da grade', () => {
  it('todos os tipos têm colunas padrão existentes no catálogo', () => {
    for (const tipo of ['item', 'nota', 'frete', 'energia', 'f100'] as const) {
      const ids = colunasPadrao(tipo);
      expect(ids.length).toBeGreaterThan(5);
      expect(new Set(ids).size).toBe(ids.length);
    }
  });

  it('a grade de itens começa pelas colunas de PIS e COFINS do item', () => {
    const ids = colunasPadrao('item');
    for (const esperada of ['C170.CFOP', 'C170.CST_PIS', 'C170.VL_BC_PIS', 'C170.ALIQ_PIS', 'C170.VL_PIS', 'C170.CST_COFINS', 'C170.VL_COFINS']) {
      expect(ids).toContain(esperada);
    }
  });
});

describe('explicacaoTipoVazio', () => {
  it('diz que o arquivo não traz o registro e como incluir', async () => {
    const { explicacaoTipoVazio } = await import('./formato');
    expect(explicacaoTipoVazio('servico', 1)).toBe(
      'O arquivo carregado não traz notas de serviço (A100/A170, bloco A). Não é falha de leitura: esses registros não existem no arquivo original. Para incluir, use "Importar documentos".',
    );
    expect(explicacaoTipoVazio('imobAquisicao', 12)).toContain('Nenhum dos 12 arquivos carregados traz bens do imobilizado com crédito sobre a aquisição (F130).');
    expect(explicacaoTipoVazio('produto', 1)).toContain('Os cadastros são criados');
  });
});
