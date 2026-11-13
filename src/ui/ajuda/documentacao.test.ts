/**
 * Testes que FALHAM quando o tour ou o manual ficam para trás do sistema.
 * Cada falha diz o que fazer. Regra completa em CLAUDE.md (raiz do projeto).
 *
 * Para regravar o carimbo depois de revisar tour e manual:
 *   ATUALIZAR_CARIMBO=1 npx vitest run src/ui/ajuda/documentacao.test.ts
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { TIPOS_LINHA_TODOS } from '../../core/linhas';
import { MODOS_BASE } from '../acoes';
import { CRITERIOS } from '../../core/apuracao';
import { ROTULO_TIPO } from '../formato';
import { CARIMBO } from './carimbo';
import { COBERTURA, ORIENTACAO_CRITERIOS, SECOES, VERSAO_MANUAL, textoDaSecao, type Mencao } from './conteudoManual';
import { ANCORAS_PENDENTES } from './integracao';
import { NOVIDADES, PASSOS_TOUR, VERSAO_TOUR } from './passosTour';
import {
  abasDoApp,
  ancoraExiste,
  ancorasNoCodigo,
  chavesConfigApuracao,
  codigosDeAviso,
  digitalRoteiro,
  opcoesDasTelas,
  RAIZ_SRC,
  superficie,
} from './superficie';

const secao = (id: string) => SECOES.find((s) => s.id === id);
const norm = (t: string) => t.toLowerCase().replace(/\s+/g, ' ');
const textoManual = norm(SECOES.map(textoDaSecao).join('\n'));

function conferirMencao(oQue: string, m: Mencao | undefined): string | null {
  if (!m) return `${oQue}: sem entrada em COBERTURA (src/ui/ajuda/conteudoManual.ts).`;
  const s = secao(m.secao);
  if (!s) return `${oQue}: COBERTURA aponta para a seção "${m.secao}", que não existe.`;
  if (!norm(textoDaSecao(s)).includes(norm(m.termo))) return `${oQue}: a seção "${m.secao}" do manual não menciona "${m.termo}".`;
  return null;
}

// ---------------------------------------------------------------------------
describe('tour: âncoras e roteiro', () => {
  const achadas = ancorasNoCodigo();
  const pendentes = new Set(ANCORAS_PENDENTES.map((a) => a.ancora));

  it('toda âncora do tour existe como data-tour em src/ui (ou está na lista de pendentes da integração)', () => {
    const faltando: string[] = [];
    for (const p of PASSOS_TOUR) for (const a of p.ancoras) if (!ancoraExiste(a, achadas) && !pendentes.has(a)) faltando.push(`${p.id} → data-tour="${a}"`);
    expect(
      faltando,
      'Passos do tour apontam para âncoras que não existem em nenhum componente de src/ui. Ponha data-tour="..." no elemento certo ou corrija src/ui/ajuda/passosTour.ts (e suba VERSAO_TOUR).',
    ).toEqual([]);
  });

  it('âncora pendente que já está no código sai da lista de pendentes', () => {
    const jaPostas = ANCORAS_PENDENTES.filter((a) => ancoraExiste(a.ancora, achadas)).map((a) => a.ancora);
    expect(jaPostas, 'Estas âncoras já estão no código: tire-as de ANCORAS_PENDENTES em src/ui/ajuda/integracao.ts.').toEqual([]);
  });

  it('depois que o App tem a aba Manual, não sobra âncora pendente (a integração terminou)', () => {
    if (!abasDoApp().some((a) => a.id === 'manual')) return;
    expect(
      ANCORAS_PENDENTES.map((a) => `${a.ancora} (${a.arquivo})`),
      'A aba Manual já está no App: ponha os data-tour que faltam (src/ui/ajuda/INTEGRACAO.md) e esvazie ANCORAS_PENDENTES.',
    ).toEqual([]);
  });

  it('pendentes são usadas pelo tour e estão no roteiro de integração', () => {
    const usadas = new Set(PASSOS_TOUR.flatMap((p) => p.ancoras));
    const md = readFileSync(join(RAIZ_SRC, 'ui/ajuda/INTEGRACAO.md'), 'utf-8');
    for (const a of ANCORAS_PENDENTES) {
      expect(usadas.has(a.ancora), `ANCORAS_PENDENTES tem "${a.ancora}", que nenhum passo usa: tire da lista.`).toBe(true);
      expect(md.includes(`data-tour="${a.ancora}"`) || (a.ancora.startsWith('aba-') && md.includes('aba-${')), `INTEGRACAO.md não explica onde pôr data-tour="${a.ancora}".`).toBe(true);
    }
  });

  it('passos: ids únicos, seção do manual existente, texto curto', () => {
    const ids = PASSOS_TOUR.map((p) => p.id);
    expect(new Set(ids).size, 'Há id de passo repetido em passosTour.ts.').toBe(ids.length);
    for (const p of PASSOS_TOUR) {
      if (p.secaoManual) expect(secao(p.secaoManual), `Passo ${p.id}: secaoManual "${p.secaoManual}" não existe no manual.`).toBeTruthy();
      expect(p.texto.length, `Passo ${p.id}: texto longo demais para um balão (máx. 320 caracteres).`).toBeLessThanOrEqual(320);
    }
  });

  it('o roteiro cobre o primeiro uso de ponta a ponta, na ordem', () => {
    const ordem = ['carregar', 'tipo-linha', 'filtrar', 'selecionar-tudo', 'alterar-tributacao', 'previa', 'salvar-regra', 'cadastros', 'criterios', 'recalcular', 'antes-depois', 'conferencia', 'baixar', 'manual'];
    const pos = ordem.map((id) => PASSOS_TOUR.findIndex((p) => p.id === id));
    expect(pos.every((i) => i >= 0), `Faltam passos essenciais: ${ordem.filter((_, k) => pos[k] < 0).join(', ')}.`).toBe(true);
    expect([...pos].sort((a, b) => a - b)).toEqual(pos);
  });

  it('toda versão do tour acima da 1 tem novidades registradas', () => {
    for (let v = 2; v <= VERSAO_TOUR; v++) {
      const n = NOVIDADES[v];
      expect(n, `VERSAO_TOUR = ${VERSAO_TOUR}, mas NOVIDADES[${v}] não existe em passosTour.ts: escreva o resumo e os passos que mudaram (é o que o convite "O sistema mudou" mostra).`).toBeTruthy();
      for (const id of n!.passos) expect(PASSOS_TOUR.some((p) => p.id === id), `NOVIDADES[${v}] cita o passo "${id}", que não existe.`).toBe(true);
    }
  });
});

// ---------------------------------------------------------------------------
describe('manual: cobre o que o sistema expõe', () => {
  it('seções com id único e links internos válidos', () => {
    const ids = SECOES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
    const quebrados: string[] = [];
    const todos = SECOES.flatMap((s) =>
      s.blocos.flatMap((b) => (b.tipo === 'tabela' ? [...b.cabecalho, ...b.linhas.flat()] : b.tipo === 'lista' || b.tipo === 'passos' ? b.itens : [b.texto])).map((t) => [s.id, t] as const),
    );
    for (const [de, t] of todos) for (const m of t.matchAll(/\]\(#([a-z0-9-]+)\)/g)) if (!secao(m[1])) quebrados.push(`${de} → #${m[1]}`);
    expect(quebrados, 'Links internos do manual para seções que não existem.').toEqual([]);
  });

  it('toda aba do App tem seção no manual', () => {
    const erros = abasDoApp()
      .map((a) => conferirMencao(`Aba "${a.rotulo}" (${a.id})`, COBERTURA.abas[a.id]) ?? (norm(COBERTURA.abas[a.id].termo) === norm(a.rotulo) ? null : `Aba ${a.id}: o rótulo na tela é "${a.rotulo}", o manual diz "${COBERTURA.abas[a.id].termo}".`))
      .filter(Boolean);
    expect(erros, 'Atualize o manual (src/ui/ajuda/conteudoManual.ts).').toEqual([]);
  });

  it('todo tipo de linha do motor (TIPOS_LINHA_TODOS) tem rótulo na tela e seção no manual com esse rótulo', () => {
    const erros = TIPOS_LINHA_TODOS.map((t) => {
      if (!ROTULO_TIPO[t]) return `Tipo ${t} do motor sem rótulo na tela (ROTULO_TIPO em src/ui/formato.ts).`;
      const m = COBERTURA.tiposLinha[t];
      return conferirMencao(`Tipo de linha ${t}`, m) ?? (m.termo === ROTULO_TIPO[t] ? null : `Tipo ${t}: a tela diz "${ROTULO_TIPO[t]}", o manual diz "${m.termo}".`);
    }).filter(Boolean);
    expect(erros, 'Tipo de linha novo ou rótulo mudado: escreva ou ajuste a seção e registre em COBERTURA.tiposLinha (conteudoManual.ts).').toEqual([]);
  });

  it('todo modo de base tem explicação com o rótulo da tela', () => {
    const erros = MODOS_BASE.map((m) => {
      const c = COBERTURA.modosBase[m.valor];
      return conferirMencao(`Modo de base ${m.valor}`, c) ?? (c.termo === m.rotulo ? null : `Modo ${m.valor}: a tela diz "${m.rotulo}", o manual diz "${c.termo}".`);
    }).filter(Boolean);
    expect(erros, 'Atualize a seção edicao-lote do manual.').toEqual([]);
  });

  it('toda ação em lote tem explicação', () => {
    const erros = Object.entries(COBERTURA.acoes).map(([k, m]) => conferirMencao(`Ação ${k}`, m)).filter(Boolean);
    expect(erros).toEqual([]);
  });

  it('toda chave de ConfigApuracao tem explicação', () => {
    const cobertura = COBERTURA.configApuracao as Record<string, Mencao>;
    const erros = chavesConfigApuracao().map((k) => conferirMencao(`Opção da apuração ${k}`, cobertura[k])).filter(Boolean);
    expect(erros, 'Explique a opção no manual e registre em COBERTURA.configApuracao.').toEqual([]);
  });

  it('todo critério da apuração (pergunta e respostas) está no manual com o texto da tela', () => {
    const s = secao('apuracao-criterios');
    expect(s, 'Falta a seção apuracao-criterios no manual.').toBeTruthy();
    const t = norm(textoDaSecao(s!));
    const faltam = CRITERIOS.flatMap((c) => [c.pergunta, ...c.opcoes.map((o) => o.rotulo)]).filter((x) => !t.includes(norm(x)));
    expect(faltam, 'A seção apuracao-criterios não tem estes textos da rotina Critérios da apuração.').toEqual([]);
  });

  it('os quatro critérios e todos os valores de resposta estão no mapa de cobertura e têm orientação', () => {
    const daTela = Object.fromEntries(CRITERIOS.map((c) => [c.id, c.opcoes.map((o) => String(o.valor)).sort()]));
    const doMapa = Object.fromEntries(Object.entries(COBERTURA.criterios).map(([id, c]) => [id, [...c.valores].sort()]));
    expect(doMapa, 'COBERTURA.criterios (conteudoManual.ts) difere dos critérios da tela (CRITERIOS em src/core/apuracao/criterios.ts).').toEqual(daTela);
    for (const c of CRITERIOS) {
      expect(secao(COBERTURA.criterios[c.id].secao), `Critério ${c.id}: seção inexistente.`).toBeTruthy();
      for (const o of c.opcoes) {
        expect(ORIENTACAO_CRITERIOS[c.id]?.quando[String(o.valor)], `Falta "quando costuma fazer sentido" para ${c.id} = ${String(o.valor)} em ORIENTACAO_CRITERIOS.`).toBeTruthy();
      }
    }
  });

  it('toda opção de lista das telas aparece no manual com o mesmo texto', () => {
    const faltam = opcoesDasTelas()
      .filter((o) => !textoManual.includes(norm(o.rotulo)))
      .map((o) => `${o.arquivo}: <option value="${o.valor}">${o.rotulo}</option>`);
    expect(faltam, 'Estas opções aparecem na tela e não no manual (ou o texto mudou): atualize o manual.').toEqual([]);
  });

  it('todo código de aviso conhecido está explicado no manual', () => {
    const faltam = codigosDeAviso().filter((c) => {
      const s = secao(COBERTURA.avisos[c] ?? '');
      return !s || !textoDaSecao(s).includes(c);
    });
    expect(faltam, 'Códigos de aviso sem explicação: acrescente na seção "avisos" de conteudoManual.ts e em COBERTURA.avisos.').toEqual([]);
  });

  it('o manual não explica aviso que não existe mais', () => {
    const existem = new Set(codigosDeAviso());
    const sobram = Object.keys(COBERTURA.avisos).filter((c) => !existem.has(c));
    expect(sobram, 'Estes códigos não existem mais no código: tire-os do manual e de COBERTURA.avisos.').toEqual([]);
  });
});

// ---------------------------------------------------------------------------
describe('carimbo: a revisão do tour e do manual acompanha a interface', () => {
  const atual = { versaoTour: VERSAO_TOUR, versaoManual: VERSAO_MANUAL, roteiro: digitalRoteiro(), superficie: superficie() };
  const entrou = atual.superficie.filter((l) => !CARIMBO.superficie.includes(l));
  const saiu = CARIMBO.superficie.filter((l) => !atual.superficie.includes(l));
  const superficieMudou = entrou.length > 0 || saiu.length > 0;
  const roteiroMudou = atual.roteiro !== CARIMBO.roteiro;
  const comoRegravar = 'ATUALIZAR_CARIMBO=1 npx vitest run src/ui/ajuda/documentacao.test.ts';

  if (process.env.ATUALIZAR_CARIMBO) {
    it('regrava o carimbo', () => {
      if (superficieMudou && VERSAO_MANUAL <= CARIMBO.versaoManual) {
        throw new Error(`A interface mudou e VERSAO_MANUAL não subiu (${VERSAO_MANUAL}). Revise o manual, suba VERSAO_MANUAL em conteudoManual.ts e rode de novo.`);
      }
      if (roteiroMudou && VERSAO_TOUR <= CARIMBO.versaoTour) {
        throw new Error(`O roteiro do tour mudou e VERSAO_TOUR não subiu (${VERSAO_TOUR}). Suba VERSAO_TOUR e registre NOVIDADES em passosTour.ts.`);
      }
      const corpo = [
        `// Gerado por \`${comoRegravar}\`. Não edite à mão.`,
        `// Revisão: tour v${atual.versaoTour}, manual v${atual.versaoManual}.`,
        `export const CARIMBO = {`,
        `  versaoTour: ${atual.versaoTour},`,
        `  versaoManual: ${atual.versaoManual},`,
        `  roteiro: '${atual.roteiro}',`,
        `  superficie: [`,
        ...atual.superficie.map((l) => `    ${JSON.stringify(l)},`),
        `  ] as string[],`,
        `};`,
        '',
      ].join('\n');
      writeFileSync(join(RAIZ_SRC, 'ui/ajuda/carimbo.ts'), corpo, 'utf-8');
    });
    return;
  }

  it('a interface é a mesma que o manual revisou', () => {
    if (!superficieMudou) return;
    const lista = [...entrou.map((l) => `  + ${l}`), ...saiu.map((l) => `  - ${l}`)].join('\n');
    throw new Error(
      `A interface mudou desde a última revisão do tour e do manual:\n${lista}\n\n` +
        'Faça, nesta mesma alteração:\n' +
        '  1. Atualize as seções do manual que falam disso (src/ui/ajuda/conteudoManual.ts) e suba VERSAO_MANUAL.\n' +
        '  2. Se algum passo do tour cita o que mudou, atualize src/ui/ajuda/passosTour.ts, suba VERSAO_TOUR e registre NOVIDADES.\n' +
        '  3. Se for o caso, README.md e skill/sped-importar-documentos/SKILL.md.\n' +
        `  4. Regrave o carimbo: ${comoRegravar}`,
    );
  });

  it('o roteiro do tour mudou junto com a versão', () => {
    if (!roteiroMudou) return;
    throw new Error(
      VERSAO_TOUR <= CARIMBO.versaoTour
        ? `O roteiro do tour (passosTour.ts) mudou, mas VERSAO_TOUR continua ${VERSAO_TOUR}: quem já viu o tour não vai receber o convite "O sistema mudou". Suba VERSAO_TOUR, registre NOVIDADES[${VERSAO_TOUR + 1}] e rode: ${comoRegravar}`
        : `VERSAO_TOUR subiu para ${VERSAO_TOUR}: regrave o carimbo com ${comoRegravar}`,
    );
  });

  it('as versões do carimbo são as atuais', () => {
    expect(
      { versaoTour: CARIMBO.versaoTour, versaoManual: CARIMBO.versaoManual },
      `As versões mudaram e o carimbo não foi regravado: ${comoRegravar}`,
    ).toEqual({ versaoTour: VERSAO_TOUR, versaoManual: VERSAO_MANUAL });
  });
});
