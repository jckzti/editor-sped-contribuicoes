import { describe, expect, it } from 'vitest';
import { formTributacaoVazia, formTributacaoVazio, montarAcaoTributacao, paraFormTributacao, resumirAcao, resumirAcoes, resumirRegra } from './acoes';
import { novaRegra } from '../core/regras';

describe('montagem da ação de tributação', () => {
  it('formulário em branco não altera nada', () => {
    const f = formTributacaoVazio();
    expect(formTributacaoVazia(f)).toBe(true);
    expect(montarAcaoTributacao(f)).toEqual({ tipo: 'tributacao' });
  });

  it('manda só o que foi preenchido', () => {
    const f = { ...formTributacaoVazio(), cstPis: '50', cstCofins: '50', aliqPis: '1,65', aliqCofins: '7,6' };
    expect(montarAcaoTributacao(f)).toEqual({ tipo: 'tributacao', cstPis: '50', cstCofins: '50', aliqPis: '1,65', aliqCofins: '7,6' });
  });

  it('traduz o modo da base', () => {
    const f = { ...formTributacaoVazio(), modoBase: 'valor-item-menos-desconto-menos-icms' as const };
    expect(montarAcaoTributacao(f).base).toBe('valor-item-menos-desconto-menos-icms');
  });

  it('base fixa vai como objeto com o valor', () => {
    const f = { ...formTributacaoVazio(), modoBase: 'fixo' as const, baseValor: ' 1.234,56 ' };
    expect(montarAcaoTributacao(f).base).toEqual({ valor: '1.234,56' });
  });

  it('"manter" não manda base nenhuma', () => {
    expect(montarAcaoTributacao(formTributacaoVazio()).base).toBeUndefined();
  });

  it('traduz as três opções de recalcular o valor', () => {
    expect(montarAcaoTributacao({ ...formTributacaoVazio(), recalcular: 'padrao' }).recalcularValor).toBeUndefined();
    expect(montarAcaoTributacao({ ...formTributacaoVazio(), recalcular: 'sempre' }).recalcularValor).toBe(true);
    expect(montarAcaoTributacao({ ...formTributacaoVazio(), recalcular: 'nunca' }).recalcularValor).toBe(false);
  });

  it('vai e volta do formulário sem perder nada', () => {
    const f = {
      ...formTributacaoVazio(),
      cstPis: '50',
      cstCofins: '50',
      aliqPis: '1,65',
      aliqCofins: '7,6',
      modoBase: 'valor-item-menos-desconto' as const,
      natBcCred: '13',
      conta: '1.1.01',
      recalcular: 'sempre' as const,
      zerarSemCredito: true,
    };
    expect(paraFormTributacao(montarAcaoTributacao(f))).toEqual(f);
  });

  it('entende o atalho "cst" (mesmo CST para PIS e COFINS)', () => {
    const f = paraFormTributacao({ tipo: 'tributacao', cst: '70' });
    expect(f.cstPis).toBe('70');
    expect(f.cstCofins).toBe('70');
  });
});

describe('resumo das ações em português', () => {
  it('resume a tributação com CST único', () => {
    const texto = resumirAcao('item', { tipo: 'tributacao', cst: '50', aliqPis: '1,65', aliqCofins: '7,6', base: 'valor-item-menos-desconto' });
    expect(texto).toBe('alterar tributação: CST 50, alíquota PIS 1,65%, alíquota COFINS 7,6%, base = valor do item menos o desconto');
  });

  it('separa os CST quando são diferentes', () => {
    expect(resumirAcao('item', { tipo: 'tributacao', cstPis: '50', cstCofins: '51' })).toBe('alterar tributação: CST PIS 50, CST COFINS 51');
  });

  it('resume definir campo pelo rótulo fiscal', () => {
    expect(resumirAcao('item', { tipo: 'definirCampo', campo: 'C170.COD_CTA', valor: '1.1.01' })).toBe('definir Conta contábil = "1.1.01"');
  });

  it('resume a exclusão dizendo o que acontece com a nota', () => {
    expect(resumirAcao('item', { tipo: 'excluir' })).toMatch(/notas que ficarem sem item/);
    expect(resumirAcao('item', { tipo: 'excluir', excluirNotaVazia: false })).toMatch(/mantendo notas sem item/);
  });

  it('junta várias ações com ponto e vírgula', () => {
    const texto = resumirAcoes('item', [{ tipo: 'tributacao', cst: '50' }, { tipo: 'definirCampo', campo: 'C170.COD_CTA', valor: '9' }]);
    expect(texto).toBe('alterar tributação: CST 50; definir Conta contábil = "9"');
  });

  it('diz quando não há ação', () => {
    expect(resumirAcoes('item', [])).toBe('nenhuma ação');
  });
});

describe('resumo da regra inteira', () => {
  it('monta "tipo: onde filtro → ações"', () => {
    const r = novaRegra({
      nome: 'Crédito de insumo',
      tipoLinha: 'item',
      filtros: [{ coluna: 'C170.CFOP', op: 'igual', valor: '1101' }],
      acoes: [{ tipo: 'tributacao', cst: '50', aliqPis: '1,65' }],
    });
    expect(resumirRegra(r)).toBe('Itens de nota: onde CFOP igual a 1101 → alterar tributação: CST 50, alíquota PIS 1,65%');
  });

  it('regra sem filtro diz que vale para todas as linhas', () => {
    const r = novaRegra({ nome: 'Tudo', tipoLinha: 'frete', acoes: [{ tipo: 'excluir' }] });
    expect(resumirRegra(r)).toContain('onde todas as linhas →');
  });
});
