import { describe, expect, it } from 'vitest';
import type { ResumoApuracao } from '../core/apuracao';
import type { Escrituracao, Registro } from '../core/modelo';
import { novoRegistro, set } from '../core/modelo';
import type { Linha } from '../core/linhas';
import type { UsoHistorico } from '../core/operacao';
import type { RelatorioRecalculo } from '../core/recalcular';
import { agruparAvisos, fraseHistorico, mesesNaoRecalculados, textoAviso } from './apuracaoUi';
import { alvosDasColunas, dicaDaCelula, estadoDaCelula, textoDaCelula } from './celulas';
import { codigosEmOrdem, numeroLegivel } from './formato';
import { opcoesDaColuna } from './filtros';
import { coluna } from '../core/linhas';

const uso = (m: Partial<UsoHistorico>): UsoHistorico => ({
  operacoes: 0,
  paraDesfazer: 0,
  paraRefazer: 0,
  bytesEstimados: 0,
  limiteBytes: 0,
  limiteOperacoes: 200,
  truncado: false,
  descartadas: 0,
  motivoTruncamento: null,
  umaOperacaoAcimaDoTeto: false,
  ...m,
});

describe('frase do histórico', () => {
  it('conta as ações que dá para desfazer', () => {
    expect(fraseHistorico(uso({}))).toBe('Nada a desfazer');
    expect(fraseHistorico(uso({ paraDesfazer: 1 }))).toBe('Desfazer disponível para a última ação');
    expect(fraseHistorico(uso({ paraDesfazer: 7 }))).toBe('Desfazer disponível para as últimas 7 ações');
  });

  it('avisa quando o histórico antigo foi descartado, com o motivo', () => {
    expect(fraseHistorico(uso({ paraDesfazer: 3, truncado: true, motivoTruncamento: 'memoria' }))).toBe(
      'Desfazer disponível para as últimas 3 ações (o histórico mais antigo foi descartado para economizar memória)',
    );
    expect(fraseHistorico(uso({ paraDesfazer: 200, truncado: true, motivoTruncamento: 'quantidade' }))).toContain('pelo limite de ações');
  });
});

const resumoVazio = {} as ResumoApuracao;
const rel = (m: Partial<RelatorioRecalculo>): RelatorioRecalculo => ({
  escrituracaoId: 'e1',
  nomeArquivo: 'a.txt',
  periodo: '2025-03',
  processada: true,
  avisos: [],
  contagens: {},
  totalLinhas: 0,
  alteracoesAutomaticas: 0,
  ...m,
});

describe('meses com apuração não recalculada', () => {
  it('lista o mês e o motivo (o registro que impediu)', () => {
    const erro = { nivel: 'erro' as const, codigo: 'APURACAO_REGISTRO_NAO_SUPORTADO', mensagem: 'Apuração não recalculada: ... (registro C175).' };
    const r = rel({ avisos: [erro], apuracao: { escrituracaoId: 'e1', recalculada: false, avisos: [erro], resumo: resumoVazio } });
    const ok = rel({ escrituracaoId: 'e2', apuracao: { escrituracaoId: 'e2', recalculada: true, avisos: [], resumo: resumoVazio } });
    const m = mesesNaoRecalculados([r, ok]);
    expect(m).toHaveLength(1);
    expect(m[0].periodo).toBe('2025-03');
    expect(m[0].motivos[0]).toContain('registro C175');
    expect(mesesNaoRecalculados(null)).toEqual([]);
  });

  it('agrupa os avisos por código, com título legível, sem repetir o motivo de não recalcular', () => {
    const erro = { nivel: 'erro' as const, codigo: 'APURACAO_REGISTRO_NAO_SUPORTADO', mensagem: 'não recalculada (registro C175)' };
    const estorno = { nivel: 'alerta' as const, codigo: 'ESTORNO_AUSENTE', mensagem: '2 notas com CFOP 5201 ...' };
    const retido = { nivel: 'alerta' as const, codigo: 'CREDITO_RETIDO', mensagem: 'PIS: no arquivo original ...' };
    const a = rel({ avisos: [erro], apuracao: { escrituracaoId: 'e1', recalculada: false, avisos: [erro], resumo: resumoVazio } });
    const b = rel({ escrituracaoId: 'e2', periodo: '2025-04', avisos: [estorno, retido] });
    const c = rel({ escrituracaoId: 'e3', periodo: '2025-05', avisos: [estorno] });
    const g = agruparAvisos([a, b, c]);
    expect(g.map((x) => x.codigo).sort()).toEqual(['CREDITO_RETIDO', 'ESTORNO_AUSENTE']);
    const est = g.find((x) => x.codigo === 'ESTORNO_AUSENTE')!;
    expect(est.titulo).toBe('Notas que talvez devessem ter estorno de crédito');
    expect(est.ocorrencias).toEqual([{ mensagem: estorno.mensagem, meses: ['04/2025', '05/2025'] }]);
    expect(g.find((x) => x.codigo === 'CREDITO_RETIDO')!.orientacao).toContain('reveja o critério');
  });
});

describe('números e códigos na tela', () => {
  it('mostra valores do SPED com milhar e duas casas', () => {
    expect(numeroLegivel('2486,39')).toBe('2.486,39');
    expect(numeroLegivel('8320')).toBe('8.320,00');
    expect(numeroLegivel('7,6')).toBe('7,60');
    expect(numeroLegivel('1,6500')).toBe('1,6500');
    expect(numeroLegivel('0')).toBe('0,00');
    expect(numeroLegivel('1234567,8')).toBe('1.234.567,80');
    expect(numeroLegivel('')).toBe('');
    expect(numeroLegivel('abc')).toBe('abc');
  });

  it('põe os códigos em ordem (CST 01 antes do 49)', () => {
    expect(codigosEmOrdem({ '50': 'b', '01': 'a', '99': 'c', '09': 'x' }).map(([k]) => k)).toEqual(['01', '09', '50', '99']);
    const cst = opcoesDaColuna(coluna('item', 'C170.CST_PIS'))!.map((o) => o.codigo);
    expect(cst[0]).toBe('01');
    expect(cst.indexOf('01')).toBeLessThan(cst.indexOf('49'));
  });
});

describe('célula editada', () => {
  const linhaDe = (c170: Registro): Linha => ({ tipo: 'item', e: {} as Escrituracao, reg: c170, doc: novoRegistro('C100'), est: null });

  it('destaca pelo campoAlterado e mostra o valor original na dica', () => {
    const c170 = novoRegistro('C170', { VL_BC_PIS: '24347,98' });
    delete c170.estado; // como se viesse do arquivo
    const l = linhaDe(c170);
    const alvo = alvosDasColunas('item').get('C170.VL_BC_PIS');
    expect(estadoDaCelula(l, alvo)).toBe('normal');
    set(c170, 'VL_BC_PIS', '21027,8');
    expect(estadoDaCelula(l, alvo)).toBe('editada');
    expect(textoDaCelula(l, 'C170.VL_BC_PIS', alvo)).toBe('21.027,80');
    expect(dicaDaCelula(l, coluna('item', 'C170.VL_BC_PIS'), alvo)).toBe('Valor original no arquivo: 24.347,98');
    set(c170, 'VL_BC_PIS', '24347,98');
    expect(estadoDaCelula(l, alvo)).toBe('normal');
  });

  it('dá a descrição do código e marca registro incluído', () => {
    const c170 = novoRegistro('C170', { CST_PIS: '01' });
    const l = linhaDe(c170);
    const dica = dicaDaCelula(l, coluna('item', 'C170.CST_PIS'), alvosDasColunas('item').get('C170.CST_PIS'))!;
    expect(dica).toContain('Registro incluído');
    expect(dica).toContain('01 — ');
  });
});

describe('avisos do motor na prévia', () => {
  it('aceita texto ou objeto com mensagem', () => {
    expect(textoAviso('a base atual já exclui o ICMS em 3 itens')).toBe('a base atual já exclui o ICMS em 3 itens');
    expect(textoAviso({ nivel: 'alerta', codigo: 'X', mensagem: 'm' })).toBe('m');
  });
});
