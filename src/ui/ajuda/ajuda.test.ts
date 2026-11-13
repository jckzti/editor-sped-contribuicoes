/**
 * Manual e tour: componentes desenham sem erro e as funções puras (busca, realce,
 * geometria do balão, memória do tour, novidades) fazem o que prometem.
 */
import { createElement } from 'react';
import { renderToString } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { buscarSecoes, normalizar, realcar, termosDaBusca } from './busca';
import { SECOES, SECOES_A_CONFERIR } from './conteudoManual';
import { ControleTour, passosNovidades } from './ControleTour';
import { CHAVE_TOUR, marcarVisto, situacaoTour, versaoVista, type Armazem } from './memoriaTour';
import { PASSOS_TOUR } from './passosTour';
import { posicionarBalao, recorte } from './posicao';
import { TelaManual } from './TelaManual';
import { interpretar } from './TextoRico';
import { BalaoTour, Tour } from './Tour';

const nada = () => {};

describe('componentes desenham sem erro', () => {
  it('TelaManual mostra todas as seções, com âncora própria', () => {
    const html = renderToString(createElement(TelaManual, { aoAbrirTour: nada }));
    for (const s of SECOES) expect(html).toContain(`id="manual-${s.id}"`);
    expect(html).toContain('Rever o tour guiado');
    expect(html).toContain('Buscar no manual');
  });

  it('BalaoTour desenha cada passo, com e sem dados', () => {
    PASSOS_TOUR.forEach((p, i) => {
      for (const temDados of [true, false]) {
        const html = renderToString(
          createElement(BalaoTour, { passo: p, indice: i, total: PASSOS_TOUR.length, temDados, destacado: false, aoVoltar: nada, aoAvancar: nada, aoPular: nada, aoAbrirManual: nada }),
        );
        expect(html).toContain(`${i + 1}<!-- --> de <!-- -->${PASSOS_TOUR.length}`);
        expect(html).toContain(i === PASSOS_TOUR.length - 1 ? 'Concluir' : 'Próximo');
        if (!temDados) expect(html).toContain('modo demonstrativo');
      }
    });
  });

  it('Tour e ControleTour não quebram fora do navegador', () => {
    expect(renderToString(createElement(Tour, { passos: PASSOS_TOUR, temDados: false, aoFechar: nada }))).toBe('');
    const html = renderToString(createElement(ControleTour, { temDados: false }));
    expect(html).toContain('Tour guiado');
    expect(html).toContain('data-tour="botao-tour"');
  });
});

describe('busca do manual', () => {
  it('ignora acento e maiúsculas e exige todas as palavras', () => {
    expect(normalizar('Apuração')).toBe('apuracao');
    expect(termosDaBusca('  Saldo  CREDOR saldo ')).toEqual(['saldo', 'credor']);
    const ids = buscarSecoes('saldo credor').map((s) => s.id);
    expect(ids).toContain('apuracao-saldo');
    expect(buscarSecoes('apuracao').length).toBeGreaterThan(0);
    expect(buscarSecoes('palavrainexistentexyz')).toEqual([]);
    expect(buscarSecoes('')).toHaveLength(SECOES.length);
  });

  it('acha códigos de aviso', () => {
    expect(buscarSecoes('CREDITO_RETIDO').map((s) => s.id)).toContain('avisos');
  });

  it('realça sem perder o texto original (com acento)', () => {
    const partes = realcar('Recalcular apuração agora', ['apuracao']);
    expect(partes.map((p) => p.texto).join('')).toBe('Recalcular apuração agora');
    expect(partes.find((p) => p.marca)?.texto).toBe('apuração');
  });
});

describe('marcação do texto', () => {
  it('negrito, código e link interno', () => {
    expect(interpretar('a **b** `c` [d](#regras) e')).toEqual([
      { tipo: 'texto', texto: 'a ' },
      { tipo: 'negrito', texto: 'b' },
      { tipo: 'texto', texto: ' ' },
      { tipo: 'codigo', texto: 'c' },
      { tipo: 'texto', texto: ' ' },
      { tipo: 'link', texto: 'd', alvo: 'regras' },
      { tipo: 'texto', texto: ' e' },
    ]);
  });
});

describe('posição do balão', () => {
  const tela = { width: 800, height: 600 };
  const balao = { width: 380, height: 180 };
  const dentro = (p: { top: number; left: number }) =>
    p.top >= 0 && p.left >= 0 && p.top + balao.height <= tela.height && p.left + balao.width <= tela.width;

  it('sem alvo, no centro', () => {
    expect(posicionarBalao(null, balao, tela)).toEqual({ top: 210, left: 210, lado: 'centro' });
  });

  it('prefere embaixo e cai para cima perto do rodapé', () => {
    expect(posicionarBalao({ top: 40, left: 700, width: 90, height: 30 }, balao, tela).lado).toBe('baixo');
    expect(posicionarBalao({ top: 540, left: 10, width: 90, height: 30 }, balao, tela).lado).toBe('cima');
  });

  it('nunca sai da tela, para qualquer alvo', () => {
    let semente = 7;
    const aleatorio = () => ((semente = (semente * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < 2000; i++) {
      const w = aleatorio() * 900;
      const h = aleatorio() * 700;
      const alvo = recorte({ top: aleatorio() * 700 - 50, left: aleatorio() * 900 - 50, width: w, height: h }, tela);
      expect(dentro(posicionarBalao(alvo, balao, tela))).toBe(true);
    }
  });

  it('recorte fica dentro da tela', () => {
    expect(recorte({ top: -20, left: -20, width: 100, height: 100 }, tela)).toEqual({ top: 0, left: 0, width: 86, height: 86 });
  });
});

describe('memória do tour', () => {
  const falso = (): Armazem & { dados: Map<string, string> } => {
    const dados = new Map<string, string>();
    return { dados, getItem: (k) => dados.get(k) ?? null, setItem: (k, v) => void dados.set(k, v) };
  };

  it('primeira vez → visto → versão nova = novidades', () => {
    const a = falso();
    expect(situacaoTour(1, a)).toBe('primeira-vez');
    marcarVisto(1, a);
    expect(situacaoTour(1, a)).toBe('em-dia');
    expect(situacaoTour(2, a)).toBe('novidades');
    expect(versaoVista(a)).toBe(1);
  });

  it('guarda só a versão vista', () => {
    const a = falso();
    marcarVisto(3, a);
    expect([...a.dados.entries()]).toEqual([[CHAVE_TOUR, '{"versaoVista":3}']]);
  });

  it('valor estragado ou armazenamento indisponível não quebra', () => {
    const a = falso();
    a.dados.set(CHAVE_TOUR, '{oops');
    expect(situacaoTour(1, a)).toBe('primeira-vez');
    const quebrado: Armazem = {
      getItem: () => {
        throw new Error('bloqueado');
      },
      setItem: () => {
        throw new Error('bloqueado');
      },
    };
    expect(situacaoTour(1, quebrado)).toBe('primeira-vez');
    expect(() => marcarVisto(1, quebrado)).not.toThrow();
    expect(situacaoTour(1, null)).toBe('primeira-vez');
  });
});

describe('o que há de novo', () => {
  it('junta as novidades das versões não vistas', () => {
    const novidades = { 2: { resumo: 'A.', passos: ['filtrar'] }, 3: { resumo: 'B.', passos: ['baixar'] } };
    const p = passosNovidades(1, 3, novidades);
    expect(p.map((x) => x.id)).toEqual(['novidades', 'filtrar', 'baixar']);
    expect(p[0].texto).toBe('A. B.');
    expect(passosNovidades(2, 3, novidades).map((x) => x.id)).toEqual(['novidades', 'baixar']);
  });

  it('sem registro de novidades, mostra o tour inteiro', () => {
    expect(passosNovidades(1, 2, {})).toBe(PASSOS_TOUR);
  });
});

it('lista de seções a conferir na integração está coerente', () => {
  for (const s of SECOES_A_CONFERIR) expect(SECOES.some((x) => x.id === s.id)).toBe(true);
});
