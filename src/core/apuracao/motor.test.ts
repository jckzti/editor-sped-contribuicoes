/**
 * Testes unitários do motor de apuração com árvores mínimas (sem arquivo de amostra).
 */
import { beforeEach, describe, expect, it } from 'vitest';
import { centavos } from '../dec';
import { escreverTexto } from '../escritor';
import { filhosDe, get, inserirFilho, listar, novoRegistro, set, type Escrituracao, type Registro } from '../modelo';
import { aprenderConfig, configPadrao, criteriosExigidos, indiciosCriterios, recalcularApuracao, registrarOriginal, type ConfigApuracao } from './index';
import { aprenderNatureza, contarParticoes, limparMemoriaNaturezas, particionar } from './natureza';
import { gruposDoCst, ratearPorGrupos } from './rateio';
import { COFINS, PIS, type Tributo } from './tributos';

beforeEach(() => limparMemoriaNaturezas());

/** Configuração com os critérios escolhidos (não há padrão): os que os testes antigos assumiam. */
const cfgP = (): ConfigApuracao => ({ ...configPadrao(), saldoCredor: 'somente-mes', ordemUsoCredito: 'anteriores-primeiro', receitaBruta0111: 'manter', preservarRetencaoCredito: false });

/** Registro "original" (sem marca de novo) com filhos. */
function r(reg: string, valores: Record<string, string>, ...filhos: Registro[]): Registro {
  const x = novoRegistro(reg, valores);
  delete x.estado;
  for (const f of filhos) inserirFilho(x, f);
  return x;
}

function item(cst: string, base: string, cfop: string, extra: Record<string, string> = {}): Registro {
  const aliqP = ['50', '51', '52', '53', '54', '55', '56', '01'].includes(cst) ? '1,65' : '0';
  const aliqC = aliqP === '0' ? '0' : '7,6';
  return r('C170', {
    NUM_ITEM: '1',
    COD_ITEM: 'X',
    VL_ITEM: base,
    CFOP: cfop,
    CST_PIS: cst,
    VL_BC_PIS: base,
    ALIQ_PIS: aliqP,
    VL_PIS: '0',
    CST_COFINS: cst,
    VL_BC_COFINS: base,
    ALIQ_COFINS: aliqC,
    VL_COFINS: '0',
    COD_CTA: '1.1',
    ...extra,
  });
}

function nota(indOper: '0' | '1', num: string, ...itens: Registro[]): Registro {
  return r('C100', { IND_OPER: indOper, IND_EMIT: indOper === '1' ? '0' : '1', COD_MOD: '55', COD_SIT: '00', NUM_DOC: num, DT_DOC: '10012025' }, ...itens);
}

interface Opcoes {
  rec?: [string, string, string];
  notas?: Registro[];
  blocoF?: Registro[];
  blocoD?: Registro[];
  blocoA?: Registro[];
  m200?: Record<string, string>;
  bloco1?: Registro[];
  extraC010?: Registro[];
  incTrib?: string;
}

function escrituracao(o: Opcoes): Escrituracao {
  const [trib, nt, exp] = o.rec ?? ['5000', '3000', '2000'];
  const total = String(Number(trib) + Number(nt) + Number(exp));
  const m200Campos = { VL_TOT_CONT_NC_PER: '0', VL_TOT_CRED_DESC: '0', VL_TOT_CRED_DESC_ANT: '0', VL_TOT_CONT_NC_DEV: '0', VL_RET_NC: '0', VL_OUT_DED_NC: '0', VL_CONT_NC_REC: '0', VL_TOT_CONT_CUM_PER: '0', VL_RET_CUM: '0', VL_OUT_DED_CUM: '0', VL_CONT_CUM_REC: '0', VL_TOT_CONT_REC: '0', ...o.m200 };
  const raiz = r(
    '0000',
    { DT_INI: '01012025', DT_FIN: '31012025', CNPJ: '11111111000191' },
    r('0001', { IND_MOV: '0' }, r('0110', { COD_INC_TRIB: o.incTrib ?? '1', IND_APRO_CRED: '2', COD_TIPO_CONT: '1' }, r('0111', { REC_BRU_NCUM_TRIB_MI: trib, REC_BRU_NCUM_NT_MI: nt, REC_BRU_NCUM_EXP: exp, REC_BRU_CUM: '0', REC_BRU_TOTAL: total }))),
    r('A001', { IND_MOV: o.blocoA ? '0' : '1' }, ...(o.blocoA ? [r('A010', { CNPJ: '11111111000191' }, ...o.blocoA)] : [])),
    r('C001', { IND_MOV: '0' }, r('C010', { CNPJ: '11111111000191', IND_ESCRI: '2' }, ...(o.notas ?? []), ...(o.extraC010 ?? []))),
    r('D001', { IND_MOV: o.blocoD ? '0' : '1' }, ...(o.blocoD ? [r('D010', { CNPJ: '11111111000191' }, ...o.blocoD)] : [])),
    r('F001', { IND_MOV: o.blocoF ? '0' : '1' }, ...(o.blocoF ? [r('F010', { CNPJ: '11111111000191' }, ...o.blocoF)] : [])),
    r('M001', { IND_MOV: '0' }, r('M200', m200Campos), r('M600', m200Campos)),
    r('1001', { IND_MOV: o.bloco1?.length ? '0' : '1' }, ...(o.bloco1 ?? [])),
  );
  const e: Escrituracao = {
    id: 't',
    nomeArquivo: 't.txt',
    raiz,
    cnpj: '11111111000191',
    nome: 'Teste',
    dtIni: '01012025',
    dtFim: '31012025',
    periodo: '202501',
    assinaturaRemovida: false,
    quebraLinha: '\n',
    avisos: [],
    alterada: false,
  };
  registrarOriginal(e);
  return e;
}

const c = (r: Registro, campo: string) => centavos(get(r, campo));
const m100 = (e: Escrituracao, t: Tributo, cc: string) => listar(e, t.M100).find((x) => get(x, 'COD_CRED') === cc)!;
const m105 = (e: Escrituracao, t: Tributo, cc: string) =>
  Object.fromEntries(filhosDe(m100(e, t, cc), t.M105).map((x) => [get(x, `CST_${t.sfx}`), c(x, `VL_BC_${t.sfx}`)]));

describe('rateio proporcional por CST (50–56)', () => {
  it('grupos de receita de cada CST', () => {
    expect(['50', '51', '52', '53', '54', '55', '56', '60', '63', '66'].map(gruposDoCst)).toEqual([
      [1], [2], [3], [1, 2], [1, 3], [2, 3], [1, 2, 3], [1], [1, 2], [1, 2, 3],
    ]);
  });

  it('M105/M100 por CST com receitas 5.000 / 3.000 / 2.000', () => {
    const itens = ['50', '51', '52', '53', '54', '55', '56'].map((cst) => item(cst, '1000', '1102'));
    const e = escrituracao({ notas: [nota('0', '1', ...itens), nota('1', '2', item('01', '100000', '5102'))] });
    const [res] = recalcularApuracao([e], cfgP());
    expect(res.recalculada).toBe(true);
    for (const t of [PIS, COFINS]) {
      expect(listar(e, t.M100).map((x) => get(x, 'COD_CRED'))).toEqual(['101', '201', '301']);
      // CST 54: 1000 × 5/7 = 714,2857 → 714,29 e 1000 × 2/7 = 285,7143 → 285,71
      expect(m105(e, t, '101')).toEqual({ '50': 100000, '53': 62500, '54': 71429, '56': 50000 });
      expect(m105(e, t, '201')).toEqual({ '51': 100000, '53': 37500, '55': 60000, '56': 30000 });
      expect(m105(e, t, '301')).toEqual({ '52': 100000, '54': 28571, '55': 40000, '56': 20000 });
      for (const [cc, base] of [['101', 283929], ['201', 227500], ['301', 188571]] as const) {
        expect(c(m100(e, t, cc), `VL_BC_${t.sfx}`)).toBe(base);
      }
      // M105 repete o total da linha (NAT, CST) sob cada M100
      const l53 = filhosDe(m100(e, t, '201'), t.M105).find((x) => get(x, `CST_${t.sfx}`) === '53')!;
      expect([c(l53, `VL_BC_${t.sfx}_TOT`), c(l53, `VL_BC_${t.sfx}_CUM`), c(l53, `VL_BC_${t.sfx}_NC`)]).toEqual([100000, 0, 100000]);
    }
    // 2.839,29 × 1,65% = 46,848 → 46,85
    expect(c(m100(e, PIS, '101'), 'VL_CRED')).toBe(4685);
    // desconto na ordem 101, 201, 301 (débito 1.650,00 cobre tudo)
    expect(listar(e, PIS.M100).map((x) => get(x, 'IND_DESC_CRED'))).toEqual(['0', '0', '0']);
  });

  it('arredondamento: soma das parcelas = total (maior resto); com 2 grupos = meio para cima', () => {
    // achado 12 da revisão: parcelas arredondadas isoladamente somavam mais que o total
    expect(ratearPorGrupos(3, [1, 2], { 1: 1, 2: 1, 3: 0 })).toEqual(new Map([[1, 2], [2, 1]]));
    expect(ratearPorGrupos(5, [1, 2], { 1: 100, 2: 100, 3: 0 })).toEqual(new Map([[1, 3], [2, 2]]));
    expect([...ratearPorGrupos(100, [1, 2, 3], { 1: 1, 2: 1, 3: 1 })!.values()]).toEqual([34, 33, 33]);
    expect(ratearPorGrupos(234270839, [1, 2], { 1: 1242451770, 2: 19141232, 3: 0 })).toEqual(
      new Map([[1, 230716418], [2, 3554421]]),
    );
    expect(ratearPorGrupos(100, [1, 2], { 1: 0, 2: 0, 3: 5 })).toBeNull();
    // base 10,00 × 1,65% = 0,165 → 0,17
    const e = escrituracao({ notas: [nota('0', '1', item('50', '10', '1102')), nota('1', '2', item('01', '100', '5102'))] });
    recalcularApuracao([e], cfgP());
    expect(c(m100(e, PIS, '101'), 'VL_CRED')).toBe(17);
  });
});

describe('ordem de uso dos créditos e saldo credor', () => {
  // débito PIS 300,00 (18.181,82 × 1,65%); crédito do mês 200,00 (12.121,21 × 1,65%);
  // crédito de 12/2024 com saldo 400,00 (500 apurado − 100 já descontado)
  const montar = (m200: Record<string, string> = {}) =>
    escrituracao({
      notas: [nota('0', '1', item('50', '12121,21', '1102')), nota('1', '2', item('01', '18181,82', '5102'))],
      m200,
      bloco1: [
        r('1100', {
          PER_APU_CRED: '122024', ORIG_CRED: '01', CNPJ_SUC: '', COD_CRED: '101', VL_CRED_APU: '500', VL_CRED_EXT_APU: '0', VL_TOT_CRED_APU: '500',
          VL_CRED_DESC_PA_ANT: '100', VL_CRED_PER_PA_ANT: '0', VL_CRED_DCOMP_PA_ANT: '0', SD_CRED_DISP_EFD: '400', VL_CRED_DESC_EFD: '0',
          VL_CRED_PER_EFD: '0', VL_CRED_DCOMP_EFD: '0', VL_CRED_TRANS: '0', VL_CRED_OUT: '0', SLD_CRED_FIM: '400',
        }),
      ],
    });
  const linha1100 = (e: Escrituracao) => listar(e, '1100').map((x) => x.campos.slice(1).join('|'));

  it('anteriores primeiro: usa o crédito de 12/2024 e guarda o do mês em 1100', () => {
    const e = montar();
    const cfg = { ...cfgP(), ordemUsoCredito: 'anteriores-primeiro' as const };
    recalcularApuracao([e], cfg);
    const m101 = m100(e, PIS, '101');
    expect([get(m101, 'IND_DESC_CRED'), c(m101, 'VL_CRED_DESC'), c(m101, 'SLD_CRED')]).toEqual(['1', 0, 20000]);
    const m200 = listar(e, 'M200')[0];
    expect([c(m200, 'VL_TOT_CONT_NC_PER'), c(m200, 'VL_TOT_CRED_DESC'), c(m200, 'VL_TOT_CRED_DESC_ANT'), c(m200, 'VL_TOT_CONT_REC')]).toEqual([30000, 0, 30000, 0]);
    expect(linha1100(e)).toEqual([
      '122024|01||101|500|0|500|100|0|0|400|300|0|0|0|0|100',
      '012025|01||101|200|0|200|0|0|0|200|0|0|0|0|0|200',
    ]);
    expect(listar(e, 'M205')).toEqual([]);
  });

  it('mês primeiro: usa o crédito do mês e completa com o de 12/2024', () => {
    const e = montar();
    recalcularApuracao([e], { ...cfgP(), ordemUsoCredito: 'mes-primeiro' });
    const m101 = m100(e, PIS, '101');
    expect([get(m101, 'IND_DESC_CRED'), c(m101, 'VL_CRED_DESC'), c(m101, 'SLD_CRED')]).toEqual(['0', 20000, 0]);
    const m200 = listar(e, 'M200')[0];
    expect([c(m200, 'VL_TOT_CRED_DESC'), c(m200, 'VL_TOT_CRED_DESC_ANT'), c(m200, 'VL_TOT_CONT_NC_DEV')]).toEqual([20000, 10000, 0]);
    expect(linha1100(e)).toEqual(['122024|01||101|500|0|500|100|0|0|400|100|0|0|0|0|300']);
  });

  it('a ordem de uso que o original seguiu vira indício (não é aplicada sozinha)', () => {
    const e = montar();
    recalcularApuracao([e], { ...cfgP(), ordemUsoCredito: 'mes-primeiro' });
    registrarOriginal(e); // o resultado passa a ser o "original"
    expect(indiciosCriterios([e])[e.cnpj].ordemUsoCredito?.valor).toBe('mes-primeiro');
    expect(aprenderConfig([e]).ordemUsoCredito).toBeUndefined();
    recalcularApuracao([e], { ...cfgP(), ordemUsoCredito: 'anteriores-primeiro' });
    registrarOriginal(e);
    const ind = indiciosCriterios([e])[e.cnpj];
    expect(ind.ordemUsoCredito?.valor).toBe('anteriores-primeiro');
    expect(ind.ordemUsoCredito?.evidencia).toMatch(/usou crédito de períodos anteriores/);
    expect(ind.saldoCredor?.valor).toBe('encadear');
  });

  it('retenção do M200 é dado de entrada e limita o desconto (a recolher não fica negativo)', () => {
    const e = montar({ VL_RET_NC: '250' });
    recalcularApuracao([e], { ...cfgP(), ordemUsoCredito: 'mes-primeiro' });
    const m200 = listar(e, 'M200')[0];
    expect(m200.campos.slice(1, 9).map(centavos)).toEqual([30000, 5000, 0, 25000, 25000, 0, 0, 0]);
    expect(c(m100(e, PIS, '101'), 'SLD_CRED')).toBe(15000);
    expect(linha1100(e)[0]).toBe('122024|01||101|500|0|500|100|0|0|400|0|0|0|0|0|400');
  });

  it('crédito retido no original: avisa e, com preservarRetencaoCredito, escala a proporção', () => {
    // crédito do mês: base 10.000,00 × 1,65% = 165,00; débito muito maior (sempre sobra a recolher)
    const entrada = item('50', '10000', '1102');
    const e = escrituracao({ notas: [nota('0', '1', entrada), nota('1', '2', item('01', '1000000', '5102'))] });
    recalcularApuracao([e], cfgP());
    const m101 = m100(e, PIS, '101');
    expect(c(m101, 'VL_CRED_DISP')).toBe(16500);
    // reescreve o "original": a empresa descontou só 40% e guardou 60%, havendo contribuição a recolher
    set(m101, 'IND_DESC_CRED', '1');
    set(m101, 'VL_CRED_DESC', '66');
    set(m101, 'SLD_CRED', '99');
    const m200 = listar(e, 'M200')[0];
    set(m200, 'VL_TOT_CRED_DESC', '66');
    expect(c(m200, 'VL_CONT_NC_REC')).toBeGreaterThan(0);
    registrarOriginal(e);
    // critério de retenção: só exigido desta empresa (o original reteve); sem escolher, recusa
    expect(criteriosExigidos([e])).toContain('preservarRetencaoCredito');
    const { preservarRetencaoCredito: _, ...semRetencao } = cfgP();
    const [pend] = recalcularApuracao([e], semRetencao);
    expect([pend.recalculada, pend.avisos[0].codigo]).toEqual([false, 'CRITERIOS_PENDENTES']);
    expect(pend.avisos[0].mensagem).toContain('preservarRetencaoCredito');
    expect(indiciosCriterios([e])[e.cnpj].preservarRetencaoCredito?.valor).toBe(true);
    // dobra a base do crédito: disponível vai a 330,00
    set(entrada, 'VL_BC_PIS', '20000');
    set(entrada, 'VL_BC_COFINS', '20000');

    const [comPreservacao] = recalcularApuracao([e], { ...cfgP(), preservarRetencaoCredito: true });
    expect(c(m101, 'VL_CRED_DISP')).toBe(33000);
    expect(c(m101, 'VL_CRED_DESC')).toBe(13200); // 40% de 330,00
    expect(c(m101, 'SLD_CRED')).toBe(19800);
    expect(get(m101, 'IND_DESC_CRED')).toBe('1');
    expect(c(listar(e, 'M200')[0], 'VL_TOT_CRED_DESC')).toBe(13200);
    expect(listar(e, '1100')[0].campos.slice(1).join('|')).toBe('012025|01||101|330|0|330|132|0|0|198|0|0|0|0|0|198');
    expect(comPreservacao.avisos.filter((a) => a.codigo === 'CREDITO_RETIDO')).toEqual([]);

    const [semPreservacao] = recalcularApuracao([e], cfgP());
    expect(c(m101, 'VL_CRED_DESC')).toBe(33000);
    expect(c(m101, 'SLD_CRED')).toBe(0);
    expect(get(m101, 'IND_DESC_CRED')).toBe('0');
    expect(listar(e, '1100')).toEqual([]);
    const aviso = semPreservacao.avisos.find((a) => a.codigo === 'CREDITO_RETIDO' && a.mensagem.startsWith('PIS'))!;
    expect(aviso.nivel).toBe('alerta');
    expect(aviso.mensagem).toContain('o crédito 101 tinha R$ 99,00 guardados');
    expect(aviso.mensagem).toContain('passou a descontar R$ 330,00 desse crédito (antes: R$ 66,00)');
  });

  it('M205 é criado com o código padrão quando passa a haver valor a recolher', () => {
    const e = escrituracao({ notas: [nota('1', '2', item('01', '1000', '5102'))] });
    recalcularApuracao([e], cfgP());
    expect(listar(e, 'M205').map((x) => x.campos.slice(1).join('|'))).toEqual(['08|691201|16,5']);
    expect(listar(e, 'M605').map((x) => x.campos.slice(1).join('|'))).toEqual(['08|585601|76']);
  });
});

describe('aviso de estorno ausente', () => {
  it('consolida por CFOP, lista no máximo 10 notas e resume o resto', () => {
    const perda = (num: string) => {
      const i = item('49', '100', '5927', { VL_PIS: '1,65', VL_COFINS: '7,6', ALIQ_PIS: '1,65', ALIQ_COFINS: '7,6' });
      return nota('1', num, i);
    };
    const notas = Array.from({ length: 12 }, (_, k) => perda(String(101 + k)));
    const e = escrituracao({ notas: [nota('0', '1', item('50', '10000', '1102')), nota('1', '2', item('01', '1000000', '5102')), ...notas] });
    const cfg = { ...cfgP(), estornos: [{ cfop: '5927', distribuicao: { codCred: '101' }, codAj: '06', descricao: 'Estorno' }] };
    const [res] = recalcularApuracao([e], cfg);
    expect(res.recalculada).toBe(true);
    const aviso = res.avisos.find((a) => a.codigo === 'ESTORNO_AUSENTE')!;
    expect(aviso.nivel).toBe('alerta');
    expect(aviso.mensagem).toBe(
      '12 notas com CFOP 5927 teriam estorno de crédito pela regra do arquivo, mas não têm ajuste no original; ' +
        'o sistema manteve sem ajuste. Confira se o estorno deveria existir. ' +
        'Notas: 101 (CFOP 5927), 102 (CFOP 5927), 103 (CFOP 5927), 104 (CFOP 5927), 105 (CFOP 5927), ' +
        '106 (CFOP 5927), 107 (CFOP 5927), 108 (CFOP 5927), 109 (CFOP 5927), 110 (CFOP 5927) e outras 2.',
    );
    // nenhum ajuste criado e o crédito segue inteiro
    expect(listar(e, 'M110')).toEqual([]);
    expect(c(m100(e, PIS, '101'), 'VL_AJUS_REDUC')).toBe(0);
  });

  it('não avisa quando a nota é nova (aí o ajuste é criado)', () => {
    const e = escrituracao({ notas: [nota('0', '1', item('50', '10000', '1102')), nota('1', '2', item('01', '1000000', '5102'))] });
    const cfg = { ...cfgP(), estornos: [{ cfop: '5927', distribuicao: { codCred: '101' }, codAj: '06', descricao: 'Estorno' }] };
    const c010 = listar(e, 'C010')[0];
    inserirFilho(c010, nota('1', '555', item('49', '100', '5927', { VL_PIS: '1,65', VL_COFINS: '7,6', ALIQ_PIS: '1,65', ALIQ_COFINS: '7,6' })));
    const [res] = recalcularApuracao([e], cfg);
    expect(res.avisos.filter((a) => a.codigo === 'ESTORNO_AUSENTE')).toEqual([]);
    expect(listar(e, 'M110').map((x) => x.campos.slice(1).join('|'))).toEqual(['0|1,65|06|555|Estorno|10012025']);
    expect(c(m100(e, PIS, '101'), 'VL_AJUS_REDUC')).toBe(165);
  });
});

describe('fontes além da amostra e recusa segura', () => {
  it('F120, F130, A170, D501 e F100 entram como linhas de crédito (não conferido)', () => {
    const e = escrituracao({
      notas: [nota('1', '2', item('01', '100000', '5102'))],
      blocoF: [
        r('F100', { IND_OPER: '0', VL_OPER: '100', CST_PIS: '50', VL_BC_PIS: '100', ALIQ_PIS: '1,65', VL_PIS: '1,65', CST_COFINS: '50', VL_BC_COFINS: '100', ALIQ_COFINS: '7,6', VL_COFINS: '7,6', NAT_BC_CRED: '05', IND_ORIG_CRED: '0' }),
        r('F120', { NAT_BC_CRED: '09', IND_ORIG_CRED: '0', CST_PIS: '50', VL_BC_PIS: '200', ALIQ_PIS: '1,65', CST_COFINS: '50', VL_BC_COFINS: '200', ALIQ_COFINS: '7,6' }),
        r('F130', { NAT_BC_CRED: '10', IND_ORIG_CRED: '1', CST_PIS: '50', VL_BC_PIS: '300', ALIQ_PIS: '2,1', CST_COFINS: '50', VL_BC_COFINS: '300', ALIQ_COFINS: '9,65' }),
      ],
      blocoA: [r('A100', { IND_OPER: '0', COD_SIT: '00', NUM_DOC: '9' }, r('A170', { NUM_ITEM: '1', VL_ITEM: '400', NAT_BC_CRED: '03', IND_ORIG_CRED: '0', CST_PIS: '50', VL_BC_PIS: '400', ALIQ_PIS: '1,65', CST_COFINS: '50', VL_BC_COFINS: '400', ALIQ_COFINS: '7,6' }))],
      blocoD: [r('D500', { IND_OPER: '0', COD_SIT: '00', NUM_DOC: '7' }, r('D501', { CST_PIS: '50', VL_ITEM: '500', NAT_BC_CRED: '04', VL_BC_PIS: '500', ALIQ_PIS: '1,65' }), r('D505', { CST_COFINS: '50', VL_ITEM: '500', NAT_BC_CRED: '04', VL_BC_COFINS: '500', ALIQ_COFINS: '7,6' }))],
    });
    const [res] = recalcularApuracao([e], cfgP());
    expect(res.recalculada).toBe(true);
    expect(listar(e, 'M100').map((x) => `${get(x, 'COD_CRED')}@${get(x, 'ALIQ_PIS')}:${get(x, 'VL_BC_PIS')}`)).toEqual(['101@1,65:1200', '108@2,1:300']);
    expect(filhosDe(m100(e, PIS, '101'), 'M105').map((x) => `${get(x, 'NAT_BC_CRED')}:${get(x, 'VL_BC_PIS')}`)).toEqual(['03:400', '04:500', '05:100', '09:200']);
    expect(res.avisos.find((a) => a.codigo === 'APURACAO_NAO_CONFERIDA')?.mensagem).toMatch(/F120.*|registro A170/);
  });

  it('recusa quando há registro que o motor não apura, sem tocar no bloco M', () => {
    const e = escrituracao({
      notas: [nota('1', '2', item('01', '1000', '5102'))],
      extraC010: [r('C180', { COD_MOD: '55' })],
    });
    const antes = escreverTexto(e);
    const [res] = recalcularApuracao([e], cfgP());
    expect(res.recalculada).toBe(false);
    expect(res.avisos.map((a) => a.codigo)).toContain('APURACAO_REGISTRO_NAO_SUPORTADO');
    expect(res.avisos[0].mensagem).toMatch(/C180/);
    expect(escreverTexto(e)).toBe(antes);
  });

  it('recusa regime cumulativo e CFOP de crédito fora da tabela', () => {
    const cum = escrituracao({ incTrib: '2', notas: [nota('1', '2', item('01', '1000', '5102'))] });
    expect(recalcularApuracao([cum], cfgP())[0].recalculada).toBe(false);
    const cfop = escrituracao({ notas: [nota('0', '1', item('50', '1000', '1949'))] });
    const [res] = recalcularApuracao([cfop], cfgP());
    expect(res.recalculada).toBe(false);
    expect(res.avisos.map((a) => a.mensagem).join()).toMatch(/1949/);
    const cfg = cfgP();
    cfg.cfopNatBc['1949'] = '13';
    expect(recalcularApuracao([cfop], cfg)[0].recalculada).toBe(true);
  });
});

describe('receita bruta do 0111', () => {
  it('"manter" não mexe (e avisa que ficou desatualizado); "ajustar-pelo-delta" soma a variação, avisa e é idempotente', () => {
    const venda = item('01', '1000', '5102');
    const exp = item('08', '200', '7101');
    const e = escrituracao({ notas: [nota('1', '2', venda, exp)] });
    set(venda, 'VL_ITEM', '1500');
    set(exp, 'VL_ITEM', '0');
    const r0111 = () => listar(e, '0111')[0].campos.slice(1).join('|');
    // achado 4 da revisão: no modo "manter" a proporção antiga do rateio tem de ser avisada
    const [m] = recalcularApuracao([e], { ...cfgP(), receitaBruta0111: 'manter' });
    expect(r0111()).toBe('5000|3000|2000|0|10000');
    const desat = m.avisos.find((a) => a.codigo === '0111_DESATUALIZADO')!;
    expect(desat.nivel).toBe('alerta');
    expect(desat.mensagem).toContain('proporção ANTIGA');
    expect(desat.mensagem).toContain('tributada no mercado interno R$ 5.500,00');
    expect(configPadrao().receitaBruta0111).toBeUndefined(); // sem padrão
    const cfg = { ...cfgP(), receitaBruta0111: 'ajustar-pelo-delta' as const };
    const [a] = recalcularApuracao([e], cfg);
    expect(r0111()).toBe('5500|3000|1800|0|10300');
    const aj = a.avisos.find((x) => x.codigo === '0111_AJUSTADO')!;
    expect(aj.nivel).toBe('alerta');
    expect(aj.mensagem).toContain('tributada no mercado interno R$ 5.000,00 → R$ 5.500,00');
    expect(aj.mensagem).toContain('de exportação R$ 2.000,00 → R$ 1.800,00');
    recalcularApuracao([e], cfg);
    expect(r0111()).toBe('5500|3000|1800|0|10300');
    // 0111 já corrigido à mão no modo "manter": sem aviso de desatualizado
    const [m2] = recalcularApuracao([e], { ...cfgP(), receitaBruta0111: 'manter' });
    expect(m2.avisos.some((x) => x.codigo === '0111_DESATUALIZADO')).toBe(false);
  });
});

describe('natureza da receita: partição exata', () => {
  it('acha a atribuição de grupos às naturezas', () => {
    expect(particionar([['a', 5], ['b', 3], ['c', 2]], [['x', 7], ['y', 3]])).toEqual({ a: 'x', c: 'x', b: 'y' });
    expect(particionar([['a', 5], ['b', 4]], [['x', 7], ['y', 2]])).toBeNull();
    expect(particionar([['a', 1]], [['x', 2]])).toBeNull();
  });
});

// ============================================================================
// Regressão da revisão fiscal de 13/11/2026 (achados numerados como no relatório)
// ============================================================================

/** Mesmo CNPJ, outro mês (AAAAMM), com id próprio. */
function noMes(e: Escrituracao, periodo: string): Escrituracao {
  const a = periodo.slice(0, 4);
  const m = periodo.slice(4, 6);
  const ult = new Date(Date.UTC(Number(a), Number(m), 0)).getUTCDate();
  e.periodo = periodo;
  e.dtIni = `01${m}${a}`;
  e.dtFim = `${ult}${m}${a}`;
  e.id = `t-${periodo}`;
  return e;
}

const r1100 = (per: string, cc: string, apu: string, descPaAnt: string) => {
  const sd = String(Number(apu) - Number(descPaAnt));
  return r('1100', {
    PER_APU_CRED: per, ORIG_CRED: '01', CNPJ_SUC: '', COD_CRED: cc, VL_CRED_APU: apu, VL_CRED_EXT_APU: '0', VL_TOT_CRED_APU: apu,
    VL_CRED_DESC_PA_ANT: descPaAnt, VL_CRED_PER_PA_ANT: '0', VL_CRED_DCOMP_PA_ANT: '0', SD_CRED_DISP_EFD: sd, VL_CRED_DESC_EFD: '0',
    VL_CRED_PER_EFD: '0', VL_CRED_DCOMP_EFD: '0', VL_CRED_TRANS: '0', VL_CRED_OUT: '0', SLD_CRED_FIM: sd,
  });
};

describe('revisão fiscal — apuração (testes sintéticos)', () => {
  it('achado 2: sem padrão; em "somente-mes" o 1100 trazido que diverge do mês anterior recalculado é ERRO', () => {
    expect(configPadrao().saldoCredor).toBeUndefined();
    // janeiro: crédito 165,00, débito 99,00 → saldo 66,00 (1100 012025)
    const jan = escrituracao({ notas: [nota('0', '1', item('50', '10000', '1102')), nota('1', '2', item('01', '6000', '5102'))] });
    // fevereiro: traz o 1100 de 01/2025 com saldo 135,00 (desconto anterior 30 em vez de 99) e tem débito de 165,00
    const fev = noMes(
      escrituracao({ notas: [nota('1', '3', item('01', '10000', '5102'))], bloco1: [r1100('012025', '101', '165', '30')] }),
      '202502',
    );
    const [, rf] = recalcularApuracao([jan, fev], { ...cfgP(), saldoCredor: 'somente-mes' });
    const erro = rf.avisos.find((a) => a.codigo === 'SALDO_CREDOR_DIVERGENTE')!;
    expect(erro.nivel).toBe('erro');
    expect(erro.mensagem).toContain('R$ 135,00');
    expect(erro.mensagem).toContain('sobram R$ 66,00');
    expect(erro.mensagem).toContain('crédito que não existe');
    expect(erro.mensagem).toContain('encadear');
    // encadeando: fevereiro usa só os 66,00 que existem
    const [, re] = recalcularApuracao([jan, fev], { ...cfgP(), saldoCredor: 'encadear' });
    expect(re.avisos.some((a) => a.codigo === 'SALDO_CREDOR_DIVERGENTE')).toBe(false);
    expect(c(listar(fev, 'M200')[0], 'VL_TOT_CRED_DESC_ANT')).toBe(6600);
    expect(c(listar(fev, 'M200')[0], 'VL_CONT_NC_REC')).toBe(16500 - 6600);
    // e um 1100 coerente não dá erro no modo "somente-mes"
    const [, ok] = recalcularApuracao([jan, fev], { ...cfgP(), saldoCredor: 'somente-mes' });
    expect(ok.avisos.some((a) => a.codigo === 'SALDO_CREDOR_DIVERGENTE')).toBe(false);
  });

  it('achado 2: "somente-mes" avisa quando o mês seguinte não traz o saldo que o anterior deixou', () => {
    const jan = escrituracao({ notas: [nota('0', '1', item('50', '10000', '1102')), nota('1', '2', item('01', '6000', '5102'))] });
    const fev = noMes(escrituracao({ notas: [nota('1', '3', item('01', '10000', '5102'))] }), '202502');
    const [, rf] = recalcularApuracao([jan, fev], { ...cfgP(), saldoCredor: 'somente-mes' });
    expect(rf.avisos.find((a) => a.codigo === 'SALDO_CREDOR_NAO_LEVADO')?.nivel).toBe('alerta');
  });

  it('achado 5: tipo do crédito presumido (106 × 107) vem do original; indecidível = recusa', () => {
    const agro = (base: string) => item('60', base, '1101', { ALIQ_PIS: '0,5775', ALIQ_COFINS: '2,66' });
    const outros = (base: string) => item('60', base, '1101', { ALIQ_PIS: '0,825', ALIQ_COFINS: '3,8' });
    const e = escrituracao({ notas: [nota('0', '1', agro('10000'), outros('20000')), nota('1', '2', item('01', '1000', '5102'))] });
    recalcularApuracao([e], cfgP());
    // o "original" do ERP: agroindústria em 106, o resto em 107
    for (const [reg, al] of [['M100', 'ALIQ_PIS'], ['M500', 'ALIQ_COFINS']] as const) {
      for (const m of listar(e, reg)) if (['0,5775', '2,66'].includes(get(m, al))) set(m, 'COD_CRED', '106');
    }
    registrarOriginal(e);
    const tipos = () => listar(e, 'M100').map((m) => `${get(m, 'COD_CRED')}@${get(m, 'ALIQ_PIS')}`).sort();
    const antes = tipos();
    expect(antes).toEqual(['106@0,5775', '107@0,825']);
    const [res] = recalcularApuracao([e], cfgP());
    expect(res.recalculada).toBe(true);
    expect(tipos()).toEqual(antes);
    expect(listar(e, 'M500').map((m) => get(m, 'COD_CRED')).sort()).toEqual(['106', '107']);
    // presumido numa alíquota que o original não ensina: recusa, sem mexer no bloco M
    inserirFilho(listar(e, 'C100')[0], item('60', '5000', '1101', { NUM_ITEM: '9', ALIQ_PIS: '1', ALIQ_COFINS: '4' }));
    const texto = escreverTexto(e);
    const [rec] = recalcularApuracao([e], cfgP());
    expect(rec.recalculada).toBe(false);
    expect(rec.avisos.map((a) => a.codigo)).toContain('APURACAO_PRESUMIDO_AMBIGUO');
    expect(escreverTexto(e)).toBe(texto);
  });

  it('achado 6: crédito comum (CST 53) sem receita no 0111 para ratear = recusa, não descarte', () => {
    const e = escrituracao({ rec: ['0', '0', '5000'], notas: [nota('0', '1', item('53', '10000', '1102')), nota('1', '2', item('08', '5000', '7101'))] });
    const texto = escreverTexto(e);
    const [res] = recalcularApuracao([e], cfgP());
    expect(res.recalculada).toBe(false);
    const a = res.avisos.find((x) => x.codigo === 'APURACAO_RATEIO_SEM_RECEITA')!;
    expect(a.nivel).toBe('erro');
    expect(a.mensagem).toContain('CST 53');
    expect(escreverTexto(e)).toBe(texto);
  });

  it('achado 7: natureza da receita só é aprendida com partição ÚNICA', () => {
    // a=5, b=5 em x=5, y=5: duas respostas (a→x ou a→y); particionar devolvia a primeira
    expect(contarParticoes([['a', 5], ['b', 5]], [['x', 5], ['y', 5]]).n).toBe(2);
    expect(contarParticoes([['a', 5], ['b', 3], ['c', 2]], [['x', 7], ['y', 3]]).n).toBe(1);
    const op = (codItem: string, receita: number) => ({ origem: 'C170', codItem, receita, codNat: '', cfop: '5102' }) as never;
    const info: { ambigua?: boolean } = {};
    expect(aprenderNatureza([op('A', 500), op('B', 500)], [['908', 500], ['909', 500]], new Map(), info)).toBeNull();
    expect(info.ambigua).toBe(true);
    const unica = aprenderNatureza([op('A', 700), op('B', 300)], [['908', 700], ['909', 300]], new Map());
    expect(unica?.mapa).toEqual({ 'COD_ITEM:A': '908', 'COD_ITEM:B': '909' });
  });

  it('achado 9: 1100 do próprio mês soma TODOS os M100 do COD_CRED (campos 06 e 09)', () => {
    // 102 a 0,65% (650,00) e a 1,1% (1.100,00); débito 990,00 → usa 650 + 340, sobra 760 no de 1,1%
    const e = escrituracao({
      notas: [
        nota('0', '1', item('50', '100000', '1102', { ALIQ_PIS: '0,65', ALIQ_COFINS: '3' }), item('50', '100000', '1102', { NUM_ITEM: '2', ALIQ_PIS: '1,1', ALIQ_COFINS: '5' })),
        nota('1', '2', item('01', '60000', '5102')),
      ],
    });
    recalcularApuracao([e], cfgP());
    const l = listar(e, '1100').map((x) => [get(x, 'COD_CRED'), c(x, 'VL_CRED_APU'), c(x, 'VL_CRED_DESC_PA_ANT'), c(x, 'SD_CRED_DISP_EFD')]);
    expect(l).toEqual([['102', 175000, 99000, 76000]]);
  });

  it('achado 13: "tributados-primeiro" consome o grupo 100 de todos os períodos antes do 200/300', () => {
    // débito 300,00; crédito do mês 101 = 200,00; crédito antigo 201 (ressarcível) com saldo 400,00
    const montar = () =>
      escrituracao({
        notas: [nota('0', '1', item('50', '12121,21', '1102')), nota('1', '2', item('01', '18181,82', '5102'))],
        bloco1: [r1100('122024', '201', '500', '100')],
      });
    const a = montar();
    recalcularApuracao([a], { ...cfgP(), ordemUsoCredito: 'anteriores-primeiro' });
    expect(c(m100(a, PIS, '101'), 'VL_CRED_DESC')).toBe(0); // usou o 201 antigo e guardou o 101 (só descontável)
    const t = montar();
    recalcularApuracao([t], { ...cfgP(), ordemUsoCredito: 'tributados-primeiro' });
    expect(c(m100(t, PIS, '101'), 'VL_CRED_DESC')).toBe(20000);
    const ant = listar(t, '1100').find((x) => get(x, 'PER_APU_CRED') === '122024')!;
    expect([c(ant, 'VL_CRED_DESC_EFD'), c(ant, 'SLD_CRED_FIM')]).toEqual([10000, 30000]);
    expect(configPadrao().ordemUsoCredito).toBeUndefined(); // sem padrão
  });

  it('achado 16: original com crédito 105 (embalagens) é recusado; 102 novo é avisado', () => {
    const e = escrituracao({ notas: [nota('1', '2', item('01', '1000', '5102'))] });
    const m105 = r('M100', { COD_CRED: '105', IND_CRED_ORI: '0', VL_BC_PIS: '0', ALIQ_PIS: '1,1', VL_CRED: '0', VL_AJUS_ACRES: '0', VL_AJUS_REDUC: '0', VL_CRED_DIF: '0', VL_CRED_DISP: '0', IND_DESC_CRED: '0', VL_CRED_DESC: '0', SLD_CRED: '0' });
    inserirFilho(listar(e, 'M001')[0], m105);
    const [res] = recalcularApuracao([e], cfgP());
    expect(res.recalculada).toBe(false);
    expect(res.avisos.find((a) => a.codigo === 'APURACAO_TIPO_CREDITO')?.mensagem).toContain('105');
    const n2 = escrituracao({ notas: [nota('1', '2', item('01', '1000', '5102'))] });
    inserirFilho(listar(n2, 'C010')[0], nota('0', '9', item('50', '1000', '1102', { ALIQ_PIS: '1,1', ALIQ_COFINS: '5' })));
    const [r2] = recalcularApuracao([n2], cfgP());
    expect(r2.recalculada).toBe(true);
    expect(r2.avisos.find((a) => a.codigo === 'CREDITO_ALIQ_DIFERENCIADA_NOVO')?.mensagem).toContain('105/205/305');
  });

  it('achado 18: regra de estorno de outro CNPJ não vale; a do mesmo CNPJ vale', () => {
    const montar = () => {
      const e = escrituracao({ notas: [nota('0', '1', item('50', '10000', '1102')), nota('1', '2', item('01', '1000000', '5102'))] });
      inserirFilho(listar(e, 'C010')[0], nota('1', '555', item('49', '100', '5927', { VL_PIS: '1,65', VL_COFINS: '7,6', ALIQ_PIS: '1,65', ALIQ_COFINS: '7,6' })));
      return e;
    };
    const regra = (cnpj?: string) => ({ cfop: '5927', distribuicao: { codCred: '101' }, codAj: '06', descricao: 'Estorno', ...(cnpj ? { cnpj } : {}) });
    const outro = montar();
    recalcularApuracao([outro], { ...cfgP(), estornos: [regra('99999999000199')] });
    expect(listar(outro, 'M110')).toEqual([]);
    const mesmo = montar();
    recalcularApuracao([mesmo], { ...cfgP(), estornos: [regra('99999999000199'), regra('11111111000191')] });
    expect(listar(mesmo, 'M110').length).toBe(1);
    const geral = montar();
    recalcularApuracao([geral], { ...cfgP(), estornos: [regra()] });
    expect(listar(geral, 'M110').length).toBe(1);
  });
});

describe('achado 19: chave repetida no bloco M', () => {
  const clonar = (x: Registro): Registro => {
    const c2: Registro = { reg: x.reg, campos: [...x.campos], filhos: [], pai: null };
    for (const f of x.filhos) inserirFilho(c2, clonar(f));
    return c2;
  };
  const soma210 = (e: Escrituracao, t: Tributo) => listar(e, t.M210).reduce((s, x) => s + c(x, 'VL_CONT_PER'), 0);

  it('M210/M610 com a mesma chave (COD_CONT + alíquota): consolidados num só, diferimento somado, M200 fecha com a soma', () => {
    const e = escrituracao({ notas: [nota('1', '2', item('01', '10000', '5102'))] });
    recalcularApuracao([e], cfgP());
    for (const t of [PIS, COFINS]) {
      const m210 = listar(e, t.M210)[0];
      const dup = clonar(m210);
      set(dup, 'VL_CONT_DIFER_ANT', '10');
      inserirFilho(m210.pai!, dup);
    }
    expect(listar(e, 'M210').length).toBe(2);
    const [res] = recalcularApuracao([e], cfgP());
    expect(res.recalculada).toBe(true);
    for (const t of [PIS, COFINS]) {
      expect(listar(e, t.M210).length).toBe(1);
      expect(c(listar(e, t.M210)[0], 'VL_CONT_DIFER_ANT')).toBe(1000);
      expect(soma210(e, t)).toBe(c(listar(e, t.M200)[0], 'VL_TOT_CONT_NC_PER'));
    }
    const a = res.avisos.find((x) => x.codigo === 'CHAVE_REPETIDA_CONSOLIDADA')!;
    expect(a.nivel).toBe('alerta');
    expect(a.mensagem).toMatch(/2 M210 com COD_CONT 01 e alíquota 1,65%/);
    // idempotente: sem repetição, sem aviso
    expect(recalcularApuracao([e], cfgP())[0].avisos.some((x) => x.codigo === 'CHAVE_REPETIDA_CONSOLIDADA')).toBe(false);
  });

  it('M100 repetido com ajuste manual: consolidado e o ajuste preservado', () => {
    const e = escrituracao({ notas: [nota('0', '1', item('50', '10000', '1102')), nota('1', '2', item('01', '100000', '5102'))] });
    recalcularApuracao([e], cfgP());
    const m101 = m100(e, PIS, '101');
    const dup = clonar(m101);
    for (const f of [...dup.filhos]) dup.filhos.splice(dup.filhos.indexOf(f), 1);
    inserirFilho(dup, r('M110', { IND_AJ: '0', VL_AJ: '5', COD_AJ: '06', NUM_DOC: '', DESCR_AJ: 'Ajuste manual', DT_REF: '10012025' }));
    inserirFilho(m101.pai!, dup);
    const [res] = recalcularApuracao([e], cfgP());
    expect(listar(e, 'M100').filter((x) => get(x, 'COD_CRED') === '101').length).toBe(1);
    expect(c(m100(e, PIS, '101'), 'VL_AJUS_REDUC')).toBe(500);
    expect(res.avisos.some((x) => x.codigo === 'CHAVE_REPETIDA_CONSOLIDADA' && /M100 do crédito 101/.test(x.mensagem))).toBe(true);
  });

  it('M410 da mesma natureza com contas diferentes (chave válida pelo guia) e M400 do mesmo CST com contas diferentes: recusa', () => {
    const e = escrituracao({ notas: [nota('1', '2', item('06', '1000', '5102', { COD_NAT: 'N1' }))] });
    const m400 = r('M400', { CST_PIS: '06', VL_TOT_REC: '1000', COD_CTA: '1.1' }, r('M410', { NAT_REC: '403', VL_REC: '600', COD_CTA: '3.1' }), r('M410', { NAT_REC: '403', VL_REC: '400', COD_CTA: '3.2' }));
    inserirFilho(listar(e, 'M001')[0], m400);
    const texto0 = escreverTexto(e);
    const [res] = recalcularApuracao([e], cfgP());
    expect(res.recalculada).toBe(false);
    expect(res.avisos.find((x) => x.codigo === 'APURACAO_CHAVE_REPETIDA')?.mensagem).toMatch(/natureza 403 com conta ou descrição diferentes/);
    expect(escreverTexto(e)).toBe(texto0);
    const e2 = escrituracao({ notas: [nota('1', '2', item('06', '1000', '5102'))] });
    inserirFilho(listar(e2, 'M001')[0], r('M400', { CST_PIS: '06', VL_TOT_REC: '600', COD_CTA: '1.1' }));
    inserirFilho(listar(e2, 'M001')[0], r('M400', { CST_PIS: '06', VL_TOT_REC: '400', COD_CTA: '1.2' }));
    const [r2] = recalcularApuracao([e2], cfgP());
    expect(r2.recalculada).toBe(false);
    expect(r2.avisos.find((x) => x.codigo === 'APURACAO_CHAVE_REPETIDA')?.mensagem).toMatch(/contas contábeis diferentes/);
  });
});
