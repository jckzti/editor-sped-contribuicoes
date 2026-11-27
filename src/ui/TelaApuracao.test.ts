import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { expect, it } from 'vitest';
import type { ResumoApuracao, ResumoTributo } from '../core/apuracao/contrato';
import type { Escrituracao } from '../core/modelo';
import { TelaApuracao, type MesApuracao } from './TelaApuracao';

function mes(periodo: string, valor: number): MesApuracao {
  const tributo: ResumoTributo = {
    creditos: [], contribuicoes: [], contribuicaoNaoCumulativa: 0, contribuicaoCumulativa: valor,
    creditoDescontado: 0, creditoDescontadoAnteriores: 0, saldoCredor: 0, aRecolher: valor,
    aRecolherNaoCumulativo: 0, aRecolherCumulativo: valor,
  };
  const atual: ResumoApuracao = { pis: tributo, cofins: tributo };
  const escrituracao = { id: periodo, periodo, cnpj: '00000000000000' } as Escrituracao;
  return { atual, escrituracao };
}

it('abre o resumo do mês mais recente, com o valor daquele mês e a seleção marcada na tabela', () => {
  const html = renderToStaticMarkup(createElement(TelaApuracao, { meses: [mes('202610', 30000), mes('202608', 10000)], desatualizada: false }));
  const cartoes = html.split('data-tour="apuracao-quadro"')[1].split('Apuração por mês')[0];
  expect(cartoes).toContain('Resumo de 10/2026');
  expect(cartoes).toContain('300,00');
  expect(cartoes).not.toContain('400,00');
  expect(html).toMatch(/aria-pressed="true"[^>]*>10\/2026<\/button>/);
});

it('mostra o resumo sem botão de seleção quando só há um mês', () => {
  const html = renderToStaticMarkup(createElement(TelaApuracao, { meses: [mes('202608', 10000)], desatualizada: false }));
  expect(html).toContain('Resumo de 08/2026');
  expect(html).not.toContain('aria-pressed=');
});
