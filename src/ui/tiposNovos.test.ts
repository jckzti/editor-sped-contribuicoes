import { describe, expect, it } from 'vitest';
import { colunas, totaisVazios, TIPOS_LINHA_CADASTRO, TIPOS_LINHA_DOCUMENTO } from '../core/linhas';
import { formTributacaoVazio, formTributacaoVazia, montarAcaoTributacao, paraFormTributacao, resumirAcao } from './acoes';
import { COLUNAS_CALCULADAS, colunasPadrao, mesAnoLegivel } from './celulas';
import { ROTULO_TIPO, totalDaColuna } from './formato';

describe('tipos de linha novos (serviço, imobilizado, cadastros)', () => {
  it('cada tipo novo tem rótulo e colunas padrão que existem no catálogo do motor', () => {
    for (const t of [...TIPOS_LINHA_DOCUMENTO, ...TIPOS_LINHA_CADASTRO]) {
      expect(ROTULO_TIPO[t]).toBeTruthy();
      const ids = new Set(colunas(t).map((c) => c.id));
      const padrao = colunasPadrao(t);
      expect(padrao.length).toBeGreaterThan(5);
      expect(padrao.every((id) => ids.has(id))).toBe(true);
    }
  });

  it('as colunas calculadas do imobilizado existem e não incluem dado de entrada', () => {
    for (const t of ['imobDepreciacao', 'imobAquisicao'] as const) {
      const ids = new Set(colunas(t).map((c) => c.id));
      for (const id of Object.keys(COLUNAS_CALCULADAS[t]!)) expect(ids.has(id)).toBe(true);
    }
    expect(COLUNAS_CALCULADAS.imobDepreciacao!['F120.VL_OPER_DEP']).toBeUndefined();
    expect(COLUNAS_CALCULADAS.imobAquisicao!['F130.VL_BC_CRED']).toMatch(/aquisição − parcela/);
  });

  it('mês de aquisição MMAAAA aparece como MM/AAAA', () => {
    expect(mesAnoLegivel('032025')).toBe('03/2025');
    expect(mesAnoLegivel('')).toBe('');
  });

  it('o rodapé soma o encargo (F120) e a aquisição (F130) como valor do item', () => {
    const t = { ...totaisVazios(), valorItem: 4800000 };
    expect(totalDaColuna('F120.VL_OPER_DEP', t, 'periodo')).toBe('48.000,00');
    expect(totalDaColuna('F130.VL_OPER_AQUIS', t, 'periodo')).toBe('48.000,00');
  });
});

describe('origem do crédito (IND_ORIG_CRED) no formulário de tributação', () => {
  it('vai para a ação só quando escolhida, e volta no editor de regras', () => {
    expect(montarAcaoTributacao(formTributacaoVazio()).indOrigCred).toBeUndefined();
    const f = { ...formTributacaoVazio(), indOrigCred: '1' as const };
    expect(formTributacaoVazia(f)).toBe(false);
    const a = montarAcaoTributacao(f);
    expect(a.indOrigCred).toBe('1');
    expect(paraFormTributacao(a).indOrigCred).toBe('1');
    expect(resumirAcao('servico', a)).toContain('origem do crédito importação');
  });
});
