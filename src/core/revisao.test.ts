/**
 * Regressão da revisão fiscal de 13/11/2026 (achados numerados como no relatório
 * `revisao-fiscal.md`). Os testes que usam o arquivo real de amostra são pulados quando ele
 * não existe; os demais usam árvores mínimas ou só a API pública.
 */
import { describe, expect, it } from 'vitest';
import { arquivosDeAmostra, lerBytes, semAssinatura } from './amostra';
import { aprenderNatureza, mapaNcm } from './apuracao/natureza';
import { extrairFontes } from './apuracao/fontes';
import { PIS } from './apuracao/tributos';
import { estadoDe as estadoApuracao } from './apuracao/estado';
import { estadoDe } from './estado';
import {
  adicionarArquivo,
  aplicarTributacao,
  aprenderConfig,
  centavos,
  centavosRapido,
  configInicial,
  criarSessao,
  criteriosDe,
  criteriosExigidos,
  criteriosPendentes,
  definirCriterio,
  indiciosCriterios,
  sessaoSerializavel,
  diagnosticarBaseIcms,
  editarCampos,
  filtrar,
  gerarArquivo,
  get,
  idx,
  linhasDe,
  listar,
  numeroEscalado,
  percorrer,
  recalcular,
  resumoApuracao,
  resumoOriginal,
  restaurarSessao,
  set,
  validar,
  type Escrituracao,
  type Linha,
} from './index';

const amostra = arquivosDeAmostra().find((c) => /PICC2B/i.test(c));
const latin1 = new TextDecoder('latin1');
const paraBytes = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const bytes = () => lerBytes(amostra!);
const g = (r: { reg: string; campos: string[] }, c: string) => get(r as never, c);
const cent = (r: { reg: string; campos: string[] }, c: string) => centavos(g(r, c));

type Cfg = NonNullable<Parameters<typeof criarSessao>[0]>;
/** Configuração com os critérios escolhidos (não há padrão). */
const comCrit = (x: Partial<Cfg> = {}): Cfg => ({ ...configInicial(), saldoCredor: 'encadear', ordemUsoCredito: 'anteriores-primeiro', receitaBruta0111: 'ajustar-pelo-delta', ...x });

function abrir(cfg: Cfg = comCrit(), b: Uint8Array = bytes(), nome = 'PICC2B.TXT') {
  const s = criarSessao(cfg);
  const e = adicionarArquivo(s, b, nome);
  return { s, e };
}
const itensCst = (e: Escrituracao, cst: string) => linhasDe(e, 'item').filter((l) => g(l.reg, 'CST_PIS') === cst);
const aRecolher = (e: Escrituracao) => {
  const r = resumoApuracao(e);
  return r.pis.aRecolher + r.cofins.aRecolher;
};
const naoInfo = (rel: ReturnType<typeof recalcular>) => rel.flatMap((r) => r.avisos).filter((a) => a.nivel !== 'info');

describe.skipIf(!amostra)('revisão fiscal — arquivo real', () => {
  it('critérios pendentes: o recálculo é recusado (CRITERIOS_PENDENTES) e o arquivo não muda', () => {
    const s = criarSessao();
    const e = adicionarArquivo(s, bytes(), 'PICC2B.TXT');
    expect([s.config.saldoCredor, s.config.ordemUsoCredito, s.config.receitaBruta0111]).toEqual([undefined, undefined, undefined]);
    expect(criteriosPendentes(s.config, s.escrituracoes)).toEqual([{ cnpj: e.cnpj, nome: e.nome, pendentes: ['saldoCredor', 'ordemUsoCredito', 'receitaBruta0111'] }]);
    const rel = recalcular(s.escrituracoes, s.config, { todas: true });
    expect(rel[0].apuracao?.recalculada).toBe(false);
    const aviso = rel[0].avisos.find((a) => a.codigo === 'CRITERIOS_PENDENTES')!;
    expect(aviso.nivel).toBe('erro');
    expect(aviso.mensagem).toContain('saldoCredor, ordemUsoCredito, receitaBruta0111');
    expect(Buffer.from(gerarArquivo(e).bytes).equals(Buffer.from(semAssinatura(bytes())))).toBe(true);
    // escolher só alguns continua pendente; escolher para a empresa (CNPJ) libera
    let cfg = definirCriterio(s.config, null, 'saldoCredor', 'encadear');
    cfg = definirCriterio(cfg, e.cnpj, 'ordemUsoCredito', 'tributados-primeiro');
    expect(criteriosPendentes(cfg, s.escrituracoes)[0].pendentes).toEqual(['receitaBruta0111']);
    cfg = definirCriterio(cfg, e.cnpj, 'receitaBruta0111', 'manter');
    expect(criteriosPendentes(cfg, s.escrituracoes)).toEqual([]);
    expect(criteriosDe(cfg, e.cnpj)).toEqual({ saldoCredor: 'encadear', ordemUsoCredito: 'tributados-primeiro', receitaBruta0111: 'manter' });
    expect(criteriosDe(cfg, '00000000000000')).toEqual({ saldoCredor: 'encadear' });
    expect(s.config.saldoCredor).toBeUndefined(); // definirCriterio não altera a configuração recebida
    expect(() => definirCriterio(cfg, null, 'saldoCredor', 'outro' as never)).toThrow(/não é uma opção/);
    // "todas as empresas" apaga a escolha própria da empresa para o critério
    expect(criteriosDe(definirCriterio(cfg, null, 'ordemUsoCredito', 'mes-primeiro'), e.cnpj).ordemUsoCredito).toBe('mes-primeiro');
    // os critérios por empresa vão e voltam na sessão salva
    const salvo = JSON.parse(JSON.stringify(sessaoSerializavel({ ...s, config: cfg })));
    const s2 = criarSessao();
    restaurarSessao(s2, salvo);
    expect(s2.config.criteriosPorCnpj).toEqual(cfg.criteriosPorCnpj);
    expect(s2.config.saldoCredor).toBe('encadear');
  });

  it('prova real com TODAS as combinações de critérios: bytes idênticos, nada editado, nenhum alerta/erro', () => {
    const esperado = Buffer.from(semAssinatura(bytes()));
    const combos: Partial<Cfg>[] = [];
    for (const saldoCredor of ['encadear', 'somente-mes'] as const)
      for (const ordemUsoCredito of ['anteriores-primeiro', 'mes-primeiro', 'tributados-primeiro'] as const)
        for (const receitaBruta0111 of ['manter', 'ajustar-pelo-delta'] as const)
          for (const preservarRetencaoCredito of [undefined, true, false]) combos.push({ saldoCredor, ordemUsoCredito, receitaBruta0111, preservarRetencaoCredito });
    for (const c of combos) {
      const { s, e } = abrir(comCrit(c));
      expect(e.avisos.filter((a) => a.nivel !== 'info')).toEqual([]);
      const rel = recalcular(s.escrituracoes, s.config, { todas: true });
      expect(naoInfo(rel), JSON.stringify(c)).toEqual([]);
      expect(rel[0].apuracao?.recalculada).toBe(true);
      expect([...percorrer(e.raiz)].filter((r) => r.estado).map((r) => r.reg), JSON.stringify(c)).toEqual([]);
      expect(Buffer.from(gerarArquivo(e).bytes).equals(esperado), JSON.stringify(c)).toBe(true);
      recalcular(s.escrituracoes, s.config, { todas: true });
      expect(Buffer.from(gerarArquivo(e).bytes).equals(esperado)).toBe(true);
    }
    const { e } = abrir();
    expect(validar(e).filter((a) => a.nivel !== 'info')).toEqual([]);
  });

  it('indícios dos critérios extraídos da amostra (um mês, sem saldo credor nem retenção)', () => {
    const { s, e } = abrir();
    const ind = indiciosCriterios(s.escrituracoes)[e.cnpj];
    expect(ind.saldoCredor).toBeUndefined();
    expect(ind.ordemUsoCredito).toBeUndefined();
    expect(ind.preservarRetencaoCredito).toBeUndefined();
    expect(ind.receitaBruta0111?.evidencia).toMatch(/0111/);
    expect(criteriosExigidos(s.escrituracoes)).toEqual(['saldoCredor', 'ordemUsoCredito', 'receitaBruta0111']);
  });

  it('achado 1: "valor − desconto − ICMS" exclui o ICMS uma vez só quando o ERP grava o ICMS no VL_DESC', () => {
    const { s, e } = abrir();
    expect(estadoDe(e).descontoEhIcms).toBe(true);
    const sai = itensCst(e, '01');
    const c = (l: Linha, f: string) => cent(l.reg, f);
    const descIgualIcms = sai.filter((l) => c(l, 'VL_DESC') === c(l, 'VL_ICMS')); // 6.211 na revisão (3 deles sem ICMS)
    expect(descIgualIcms.length).toBe(6211);
    const antes = new Map(sai.map((l) => [l, c(l, 'VL_BC_PIS')]));
    const diag = diagnosticarBaseIcms(sai);
    expect([diag.itens, diag.descontoIgualIcms, diag.baseItemMenosDesconto, diag.escrituracoesDescontoEhIcms]).toEqual([6454, 6208, 6359, 1]);
    expect(diag.baseJaExcluiIcms).toBe(6208);
    const r0 = aRecolher(e);
    const res = aplicarTributacao(sai, { tipo: 'tributacao', base: 'valor-item-menos-desconto-menos-icms', recalcularValor: true });
    expect(res.avisos).toContain('Em 6208 de 6454 itens a base atual já exclui o ICMS; a ação não muda esses itens.');
    expect(res.avisos.some((a) => a.includes('o ERP grava o ICMS do item no campo de desconto'))).toBe(true);
    // nenhum dos 6.211 itens em que o desconto já é o ICMS tem a base reduzida
    expect(descIgualIcms.filter((l) => c(l, 'VL_BC_PIS') !== antes.get(l))).toEqual([]);
    expect(sai.filter((l) => c(l, 'VL_BC_PIS') !== antes.get(l)).length).toBe(diag.mudariam);
    recalcular(s.escrituracoes, s.config, { todas: true });
    // antes da correção: 320.160,85 → 218.504,35 (ICMS tirado duas vezes)
    expect(r0).toBe(32016085);
    expect(aRecolher(e)).toBeGreaterThan(31000000);
  });

  it('achado 2: em "somente-mes", abril que desconta saldo de março maior que o recalculado dá ERRO; encadeando, usa o certo', () => {
    const paraAbril = (b: Uint8Array) => {
      const t = latin1.decode(b);
      const i = t.indexOf('\n');
      return paraBytes(t.slice(0, i).replace('|01032025|31032025|', '|01042025|30042025|') + t.slice(i));
    };
    // "originais": março com saldo credor (80% das saídas CST 01 → 06) e abril encadeado
    const s0 = criarSessao(comCrit());
    const a0 = adicionarArquivo(s0, bytes(), 'MAR.TXT');
    const sai = itensCst(a0, '01');
    aplicarTributacao(sai.slice(0, Math.floor(sai.length * 0.8)), { tipo: 'tributacao', cst: '06', zerarSemCredito: true });
    const b0 = adicionarArquivo(s0, paraAbril(bytes()), 'ABR.TXT');
    recalcular(s0.escrituracoes, s0.config, { todas: true });
    const MAR = gerarArquivo(a0).bytes;
    const ABR = gerarArquivo(b0).bytes;
    const glosar = (cfg: Cfg = comCrit()) => {
      const s = criarSessao(cfg);
      const A = adicionarArquivo(s, MAR, 'MAR.TXT');
      const B = adicionarArquivo(s, ABR, 'ABR.TXT');
      const ent = itensCst(A, '53');
      aplicarTributacao(ent.slice(0, Math.floor(ent.length / 2)), { tipo: 'tributacao', cst: '70', zerarSemCredito: true });
      const rel = recalcular(s.escrituracoes, s.config, { todas: true });
      const sldMar = listar(A, '1100').filter((r) => g(r, 'PER_APU_CRED') === '032025').reduce((x, r) => x + cent(r, 'SLD_CRED_FIM'), 0);
      const usoAbr = listar(B, '1100').filter((r) => g(r, 'PER_APU_CRED') === '032025').reduce((x, r) => x + cent(r, 'VL_CRED_DESC_EFD'), 0);
      return { rel: rel.find((r) => r.escrituracaoId === B.id)!, sldMar, usoAbr };
    };
    const so = glosar(comCrit({ saldoCredor: 'somente-mes' }));
    const erro = so.rel.avisos.find((a) => a.codigo === 'SALDO_CREDOR_DIVERGENTE');
    expect(erro?.nivel).toBe('erro');
    expect(erro?.mensagem).toContain('crédito que não existe');
    const enc = glosar();
    expect(enc.rel.avisos.some((a) => a.codigo === 'SALDO_CREDOR_DIVERGENTE')).toBe(false);
    expect(enc.usoAbr).toBeLessThanOrEqual(enc.sldMar);
  });

  it('achado 3: nota de outra série com o mesmo número e data não toma o estorno da nota certa', () => {
    const linhas = latin1.decode(bytes()).split('\r\n');
    const iNum = idx('C100', 'NUM_DOC') + 1;
    const iSer = idx('C100', 'SER') + 1;
    const iChv = idx('C100', 'CHV_NFE') + 1;
    const iCst = idx('C170', 'CST_PIS') + 1;
    const iVp = idx('C170', 'VL_PIS') + 1;
    const iVc = idx('C170', 'VL_COFINS') + 1;
    const k = linhas.findIndex((l) => l.startsWith('|C100|') && l.split('|')[iNum] === '135303');
    let fim = k + 1;
    while (linhas[fim].startsWith('|C170|')) fim++;
    const bloco = linhas.slice(k, fim).map((l, j) => {
      const f = l.split('|');
      if (j === 0) {
        f[iSer] = '999';
        f[iChv] = '';
      } else if (f[iCst] === '49') {
        f[iVp] = '500';
        f[iVc] = '2303,03';
      }
      return f.join('|');
    });
    const { s, e } = abrir(undefined, paraBytes([...linhas.slice(0, fim), ...bloco, ...linhas.slice(fim)].join('\r\n')), 'X.TXT');
    const ajustes = () => ['M110', 'M510'].flatMap((r) => listar(e, r).filter((x) => g(x, 'NUM_DOC') === '135303').map((x) => `${r} ${g(x.pai!, 'COD_CRED')} ${g(x, 'VL_AJ')}`));
    const antes = ajustes();
    expect(antes).toEqual(['M110 101 109,24', 'M110 201 1,68', 'M510 101 503,15', 'M510 201 7,75']);
    const rel = recalcular(s.escrituracoes, s.config, { todas: true });
    expect(ajustes()).toEqual(antes);
    expect(rel[0].avisos.find((a) => a.codigo === 'ESTORNO_AMBIGUO')?.nivel).toBe('alerta');
    const o = resumoOriginal(e)!;
    const r = resumoApuracao(e);
    expect([r.pis.aRecolher, r.cofins.aRecolher]).toEqual([o.pis.aRecolher, o.cofins.aRecolher]);
  });

  it('achado 4: reclassificar receita 01 → 04 com "ajustar" ajusta o 0111 com alerta; em "manter", alerta forte', () => {
    const reclassificar = (cfg: Cfg = comCrit()) => {
      const { s, e } = abrir(cfg);
      const itens = itensCst(e, '01').sort((a, b) => cent(b.reg, 'VL_ITEM') - cent(a.reg, 'VL_ITEM'));
      const tot = itens.reduce((x, l) => x + cent(l.reg, 'VL_ITEM'), 0);
      let alvo = 0;
      const sel: Linha[] = [];
      for (const l of itens) {
        if (alvo > tot * 0.3) break;
        sel.push(l);
        alvo += cent(l.reg, 'VL_ITEM');
      }
      aplicarTributacao(sel, { tipo: 'tributacao', cst: '04', zerarSemCredito: true });
      const rel = recalcular(s.escrituracoes, s.config, { todas: true });
      const base201 = cent(listar(e, 'M100').find((r) => g(r, 'COD_CRED') === '201')!, 'VL_BC_PIS');
      return { rel, e, alvo, base201 };
    };
    const p = reclassificar();
    const aj = p.rel[0].avisos.find((a) => a.codigo === '0111_AJUSTADO')!;
    expect(aj.nivel).toBe('alerta');
    expect(aj.mensagem).toContain('→');
    const r0111 = listar(p.e, '0111')[0];
    expect(cent(r0111, 'REC_BRU_NCUM_TRIB_MI')).toBe(1242451770 - p.alvo);
    // antes: base 201 ficava em 47.105,54 (proporção antiga); com o 0111 atualizado vai a ~898 mil
    expect(p.base201).toBeGreaterThan(80000000);
    const m = reclassificar(comCrit({ receitaBruta0111: 'manter' }));
    const forte = m.rel[0].avisos.find((a) => a.codigo === '0111_DESATUALIZADO')!;
    expect(forte.nivel).toBe('alerta');
    expect(forte.mensagem).toContain('proporção ANTIGA');
  });

  it('achado 7: sem COD_NAT no item, a coincidência de somas por COD_ITEM (milhões de partições) não vira regra', () => {
    const { s, e } = abrir();
    const est = estadoApuracao(e)!.tributos.pis;
    expect(est.naturezas['06'].tipoChave).toBe('COD_NAT'); // na amostra a partição por COD_NAT é única
    const ops = extrairFontes(e, PIS, s.config.cfopNatBc).receitas.filter((o) => o.cst === '06');
    const info: { ambigua?: boolean } = {};
    const m = aprenderNatureza(ops.map((o) => ({ ...o, codNat: '' })), est.naturezaOriginal['06'].totais, mapaNcm(e), info);
    expect(m).toBeNull();
    expect(info.ambigua).toBe(true);
  });

  it('achado 8: CST de crédito sem escolher a base, em linhas de base zero: aviso na ação e ERRO na verificação', () => {
    const { e } = abrir();
    const ent = itensCst(e, '53').slice(0, 50);
    aplicarTributacao(ent, { tipo: 'tributacao', cst: '70', zerarSemCredito: true });
    const res = aplicarTributacao(ent, { tipo: 'tributacao', cst: '50' });
    expect(res.avisos).toContain('50 linha(s) ficarão com CST de crédito (50–66) e base de cálculo zero: não gerarão crédito. Para o crédito entrar, escolha também a base (ex.: valor do item).');
    const v = validar(e).filter((a) => a.codigo === 'CST_CREDITO_BASE_ZERO');
    expect(v.length).toBe(100); // PIS e COFINS de cada item
    expect(v[0].nivel).toBe('erro');
    expect(v[0].mensagem).toContain('CST de crédito com base de cálculo zero');
    expect(v[0].documento).toMatch(/^NF /);
    // escolhendo a base, sem aviso
    const ok = aplicarTributacao(ent, { tipo: 'tributacao', cst: '50', base: 'valor-item', aliqPis: '1,65', aliqCofins: '7,6' });
    expect(ok.avisos.some((a) => a.includes('base de cálculo zero'))).toBe(false);
    expect(validar(e).filter((a) => a.codigo === 'CST_CREDITO_BASE_ZERO')).toEqual([]);
  });

  it('achado 10: datas do documento conforme o guia', () => {
    const { e } = abrir();
    const notas = linhasDe(e, 'nota');
    const ent = notas.filter((l) => g(l.reg, 'IND_OPER') === '0');
    const sai = notas.filter((l) => g(l.reg, 'IND_OPER') === '1');
    const avisos = (l: Linha) => validar(e).filter((a) => a.registro === l.reg && a.codigo.startsWith('DATA')).map((a) => `${a.nivel}:${a.codigo}`);
    editarCampos(sai[0], { DT_DOC: '31032025', DT_E_S: '01042025' });
    expect(avisos(sai[0])).toEqual(['alerta:DATA_PERIODO']); // aceita (DT_DOC no período), só alerta
    editarCampos(ent[0], { DT_DOC: '10022025', DT_E_S: '20022025' });
    expect(avisos(ent[0])).toEqual(['erro:DATA_PERIODO']); // nenhuma das duas no período
    editarCampos(ent[1], { DT_DOC: '20032025', DT_E_S: '10032025' });
    expect(avisos(ent[1])).toEqual(['erro:DATA_ENTRADA_ANTES_EMISSAO']);
    editarCampos(ent[2], { DT_DOC: '27022025', DT_E_S: '03032025' });
    expect(avisos(ent[2])).toEqual([]); // extemporânea normal: aceita
    const noMes = ent.find((l, i) => i > 2 && g(l.reg, 'DT_DOC').endsWith('032025'))!;
    editarCampos(noMes, { DT_E_S: '' });
    expect(avisos(noMes)).toEqual(['erro:DATA_ENTRADA_OBRIGATORIA']);
  });

  it('achado 17: a fórmula do VL_DOC é a de cada nota (nota que desconta o VL_DESC num arquivo que não desconta)', () => {
    const linhas = latin1.decode(bytes()).split('\r\n');
    const iDesc = idx('C170', 'VL_DESC') + 1;
    const iDoc = idx('C100', 'VL_DOC') + 1;
    // primeira nota com desconto nos itens: o VL_DOC passa a descontar o VL_DESC (fórmula "com")
    let k = -1;
    let soma = 0;
    for (let j = 0; j < linhas.length && k < 0; j++) {
      if (!linhas[j].startsWith('|C100|')) continue;
      let s = 0;
      for (let q = j + 1; linhas[q].startsWith('|C170|'); q++) s += centavos(linhas[q].split('|')[iDesc]);
      if (s > 0) {
        k = j;
        soma = s;
      }
    }
    const f = linhas[k].split('|');
    const docCom = centavos(f[iDoc]) - soma;
    f[iDoc] = (docCom / 100).toFixed(2).replace('.', ',');
    linhas[k] = f.join('|');
    const { s, e } = abrir(undefined, paraBytes(linhas.join('\r\n')), 'X.TXT');
    const est = estadoDe(e);
    expect(est.vlDocComDesconto).toBe(false); // o arquivo continua "sem desconto"
    const c100 = listar(e, 'C100').find((r) => cent(r, 'VL_DOC') === docCom)!;
    expect(est.vlDocPorNota.get(c100)).toBe(true);
    const it = c100.filhos.find((x) => x.reg === 'C170' && cent(x, 'VL_DESC') > 0)!;
    editarCampos({ e, reg: it }, { VL_DESC: ((cent(it, 'VL_DESC') + 100) / 100).toFixed(2).replace('.', ',') });
    recalcular(s.escrituracoes, s.config);
    expect(cent(c100, 'VL_DOC')).toBe(docCom - 100);
  });

  it('achado 19: M210 repetido (prova p9 a) é consolidado e a soma dos M210 fecha com o M200', () => {
    const t = latin1.decode(bytes()).replace(/(\|M210\|02\|[^\r]*\r\n)/, '$1$1');
    const { s, e } = abrir(comCrit(), paraBytes(t), 'X.TXT');
    expect(listar(e, 'M210').length).toBe(3);
    const rel = recalcular(s.escrituracoes, s.config, { todas: true });
    expect(rel[0].apuracao?.recalculada).toBe(true);
    expect(listar(e, 'M210').length).toBe(2);
    const soma = listar(e, 'M210').reduce((x, r) => x + cent(r, 'VL_CONT_PER'), 0);
    expect(soma).toBe(cent(listar(e, 'M200')[0], 'VL_TOT_CONT_NC_PER'));
    expect(rel[0].avisos.find((a) => a.codigo === 'CHAVE_REPETIDA_CONSOLIDADA')?.mensagem).toMatch(/2 M210 com COD_CONT 02/);
    // o resto do arquivo volta a ser o original: só a linha repetida saiu
    expect(Buffer.from(gerarArquivo(e).bytes).equals(Buffer.from(semAssinatura(bytes())))).toBe(true);
  });

  it('achado 18: regras de estorno aprendidas levam o CNPJ do arquivo', () => {
    const { s, e } = abrir();
    const regras = aprenderConfig(s.escrituracoes, s.config).estornos;
    expect(regras.length).toBeGreaterThan(0);
    expect(regras.every((r) => r.cnpj === e.cnpj)).toBe(true);
  });
});

describe('revisão fiscal — sem arquivo real', () => {
  it('achado 14: filtro numérico "igual a" compara exatamente (1,61; 1,68; 3,78...)', () => {
    for (const v of ['1,61', '1,68', '1,82', '1,89', '3,78', '0,1', '12345678,9']) {
      expect(numeroEscalado(v)).toBe(numeroEscalado(v.replace(',', '.')));
    }
    expect(numeroEscalado('1,61')).toBe(1610000);
    expect(numeroEscalado('1,6100004')).toBe(1610000);
    expect(numeroEscalado('1,6100005')).toBe(1610001);
    expect(numeroEscalado('x')).toBeNaN();
  });

  it('achado 18: sessão salva antiga (regras de estorno sem CNPJ, aprendidas) não espalha a regra para outros clientes', () => {
    const s = criarSessao(comCrit());
    const base = { distribuicao: { codCred: '101' } as const, codAj: '06', descricao: 'Estorno' };
    restaurarSessao(s, {
      formato: 'sped-contrib-sessao',
      versao: 1,
      config: { ...s.config, estornos: [{ cfop: '5927', ...base }, { cfop: '5201', ...base, cnpj: '11111111000191' }] },
      regras: [],
      arquivos: [],
    });
    expect(s.config.estornos.map((r) => `${r.cfop}:${r.cnpj}`)).toEqual(['5201:11111111000191']);
  });

  it('achado 15: centavosRapido não devolve 0 em silêncio para texto que não é número', () => {
    expect(centavosRapido('')).toBe(0);
    expect(centavosRapido(' 12,5 ')).toBe(1250);
    expect(centavosRapido('-0,005')).toBe(-1);
    expect(centavosRapido('1.234,56')).toBeNaN();
    expect(centavosRapido('abc')).toBeNaN();
    expect(centavosRapido('-')).toBeNaN();
    expect(centavosRapido('R$ 10')).toBeNaN();
  });

});

describe.skipIf(!amostra)('revisão fiscal — arquivo real (filtro e número inválido)', () => {
  it('achado 14: filtrar "VL_PIS igual a 1,61" acha o item', () => {
    const { e } = abrir();
    const it = itensCst(e, '01')[0];
    editarCampos(it, { VL_PIS: '1,61' });
    const achou = filtrar(linhasDe(e, 'item'), [{ coluna: 'C170.VL_PIS', op: 'igual', valor: '1,61' }]);
    expect(achou.map((l) => l.reg)).toContain(it.reg);
    expect(filtrar(linhasDe(e, 'item'), [{ coluna: 'C170.VL_PIS', op: 'entre', valor: 1.61, valor2: '1,61' }]).map((l) => l.reg)).toContain(it.reg);
  });

  it('achado 15: texto não numérico num item não zera totais nem derruba o recálculo; a verificação aponta', () => {
    const { s, e } = abrir();
    const it = listar(e, 'C170')[0];
    const nota = it.pai!;
    const merc = g(nota, 'VL_MERC');
    set(it, 'VL_ITEM', '1.234,56'); // como viria de uma planilha, sem passar pela validação
    expect(() => recalcular(s.escrituracoes, s.config, { todas: true })).not.toThrow();
    expect(g(nota, 'VL_MERC')).toBe(merc);
    expect(validar(e).find((a) => a.codigo === 'NUMERO_INVALIDO' && a.registro === it)?.nivel).toBe('erro');
  });
});
