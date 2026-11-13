import { describe, expect, it } from 'vitest';
import { criteriosDe, criteriosPendentes, definirCriterio, type ConfigApuracao } from '../core/apuracao';
import { inserirFilho, novoRegistro, type Escrituracao } from '../core/modelo';
import { configInicial } from '../core/sessao';
import { escolhasCompletas, escolhasParaCarregadas, exportarCriterios, importarCriterios, motivoNaoAplica, textoCriteriosUsados } from './criterios';

/** Escrituração mínima: 0000 → 0001 → 0110 (→ 0111 se pedido). */
function esc(cnpj: string, periodo: string, opcoes: { com0111?: boolean; alterada?: boolean } = {}): Escrituracao {
  const raiz = novoRegistro('0000');
  delete raiz.estado;
  const b0 = novoRegistro('0001');
  inserirFilho(raiz, b0);
  const r0110 = novoRegistro('0110', { COD_INC_TRIB: '1', IND_APRO_CRED: opcoes.com0111 ? '2' : '1' });
  inserirFilho(b0, r0110);
  if (opcoes.com0111) inserirFilho(r0110, novoRegistro('0111'));
  return {
    id: `${cnpj}-${periodo}`,
    nomeArquivo: `${periodo}.txt`,
    raiz,
    cnpj,
    nome: `Empresa ${cnpj.slice(0, 2)}`,
    dtIni: `01${periodo.slice(4)}${periodo.slice(0, 4)}`,
    dtFim: `28${periodo.slice(4)}${periodo.slice(0, 4)}`,
    periodo,
    assinaturaRemovida: false,
    quebraLinha: '\r\n',
    avisos: [],
    alterada: !!opcoes.alterada,
  };
}

const A = '11111111000111';
const B = '22222222000122';
const novaConfig = (): ConfigApuracao => configInicial();

describe('pendências (motor) vistas pela tela', () => {
  it('nada vem escolhido na configuração inicial', () => {
    const cfg = novaConfig();
    expect(cfg.saldoCredor).toBeUndefined();
    expect(criteriosPendentes(cfg, [esc(A, '202503')])[0].pendentes).toEqual(['saldoCredor', 'ordemUsoCredito', 'receitaBruta0111']);
  });

  it('a escolha é por empresa e definirCriterio devolve configuração nova', () => {
    let cfg = novaConfig();
    const antes = cfg;
    cfg = definirCriterio(cfg, A, 'saldoCredor', 'encadear');
    cfg = definirCriterio(cfg, A, 'ordemUsoCredito', 'tributados-primeiro');
    cfg = definirCriterio(cfg, A, 'receitaBruta0111', 'manter');
    expect(criteriosDe(antes, A)).toEqual({});
    expect(criteriosPendentes(cfg, [esc(A, '202503'), esc(B, '202503')]).map((p) => p.cnpj)).toEqual([B]);
  });

  it('confirmar só habilita com tudo o que é exigido respondido', () => {
    const exig = ['saldoCredor', 'ordemUsoCredito', 'receitaBruta0111'] as const;
    expect(escolhasCompletas({ saldoCredor: 'encadear', ordemUsoCredito: 'mes-primeiro' }, [...exig])).toBe(false);
    expect(escolhasCompletas({ saldoCredor: 'encadear', ordemUsoCredito: 'mes-primeiro', receitaBruta0111: 'manter' }, [...exig])).toBe(true);
  });

  it('o crédito guardado só é perguntado quando o original guardou crédito', () => {
    expect(motivoNaoAplica('preservarRetencaoCredito', [esc(A, '202503')])).toMatch(/nenhum mês/);
    expect(motivoNaoAplica('saldoCredor', [esc(A, '202503')])).toBeNull();
  });
});

describe('exportar e importar', () => {
  it('ida e volta mantém as escolhas por empresa', () => {
    const json = exportarCriterios({ [A]: { saldoCredor: 'encadear', ordemUsoCredito: 'mes-primeiro' } }, { [A]: 'Empresa A' }, new Date('2026-11-13T12:00:00Z'));
    const lido = importarCriterios(json);
    expect(lido.porCnpj[A]).toEqual({ saldoCredor: 'encadear', ordemUsoCredito: 'mes-primeiro' });
    expect(lido.avisos).toEqual([]);
  });

  it('descarta valor inválido com aviso e recusa arquivo de outro formato', () => {
    const lido = importarCriterios({ formato: 'sped-contrib-criterios', versao: 1, empresas: [{ cnpj: A, escolhas: { saldoCredor: 'qualquer', ordemUsoCredito: 'tributados-primeiro' } }] });
    expect(lido.porCnpj[A]).toEqual({ ordemUsoCredito: 'tributados-primeiro' });
    expect(lido.avisos).toHaveLength(1);
    expect(() => importarCriterios('{"formato":"sped-contrib-regras"}')).toThrow(/critérios/);
  });

  it('escolhas de outra empresa viram ponto de partida, com aviso para conferir', () => {
    const r = escolhasParaCarregadas([B], { porCnpj: { [A]: { saldoCredor: 'encadear' } }, nomes: { [A]: 'Empresa A' } });
    expect(r.porCnpj[B]).toEqual({ saldoCredor: 'encadear' });
    expect(r.avisos[0]).toMatch(/outra empresa \(Empresa A\)/);
  });

  it('importar não grava na configuração (só a confirmação grava)', () => {
    const cfg = novaConfig();
    importarCriterios(exportarCriterios({ [A]: { saldoCredor: 'encadear' } }, {}));
    expect(criteriosDe(cfg, A)).toEqual({});
  });
});

describe('criterios-usados.txt', () => {
  it('traz empresa, meses em ordem, escolhas e o que não se aplica', () => {
    let cfg = novaConfig();
    cfg = definirCriterio(cfg, A, 'saldoCredor', 'encadear');
    cfg = definirCriterio(cfg, A, 'ordemUsoCredito', 'anteriores-primeiro');
    const t = textoCriteriosUsados(cfg, [esc(A, '202504'), esc(A, '202503')], new Date('2026-11-13T12:00:00Z'));
    expect(t).toContain('Empresa: Empresa 11 — CNPJ 11.111.111/0001-11');
    expect(t).toContain('Meses: 03/2025, 04/2025');
    expect(t).toContain('Levar o saldo para os meses seguintes (1100/1500)');
    expect(t).toContain('Primeiro os créditos de meses anteriores');
    expect(t).toMatch(/Não se aplica: em nenhum mês o arquivo original guardou crédito/);
    expect(t.endsWith('\r\n')).toBe(true);
    const sem = textoCriteriosUsados(novaConfig(), [esc(B, '202503')]);
    expect(sem).toContain('Não escolhido: a apuração destes meses não foi recalculada');
  });
});
