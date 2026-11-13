/**
 * Prova real do motor de apuração contra o arquivo de amostra (pulada se não houver amostra).
 */
import { describe, expect, it } from 'vitest';
import { arquivosDeAmostra, lerBytes, semAssinatura } from '../amostra';
import { escreverSped } from '../escritor';
import { lerSped } from '../leitor';
import { centavos, fmtCentavos, mulAliq, ratear } from '../dec';
import { filhosDe, get, listar, percorrer, removerRegistro, set, type Escrituracao, type Registro } from '../modelo';
import { aprenderConfig, definirNaturezaReceita, pendenciasNaturezaReceita, recalcularApuracao, registrarOriginal, type ConfigApuracao } from './index';

/** Critérios escolhidos explicitamente (não há padrão). */
const comCriterios = (c: ConfigApuracao): ConfigApuracao => ({ ...c, saldoCredor: 'somente-mes', ordemUsoCredito: 'anteriores-primeiro', receitaBruta0111: 'manter', preservarRetencaoCredito: false });
import { limparMemoriaNaturezas } from './natureza';
import { COFINS, PIS, type Tributo } from './tributos';
import { cent, reais } from './util';

const amostra = arquivosDeAmostra().find((c) => /PICC2B/i.test(c)) ?? arquivosDeAmostra()[0];

function carregar(): { e: Escrituracao; original: Uint8Array } {
  const original = lerBytes(amostra!);
  const e = lerSped(original, amostra!);
  registrarOriginal(e);
  return { e, original };
}

function diferencas(a: string, b: string): string[] {
  const la = a.split(/\r?\n/);
  const lb = b.split(/\r?\n/);
  const out: string[] = [];
  for (let i = 0; i < Math.max(la.length, lb.length) && out.length < 20; i++) {
    if (la[i] !== lb[i]) out.push(`${i + 1}: ${la[i]}  ≠  ${lb[i]}`);
  }
  return out;
}

describe.skipIf(!amostra)('apuração: prova real com a amostra', () => {
  it('recalcular sem edição reproduz o arquivo byte a byte', () => {
    limparMemoriaNaturezas();
    const { e, original } = carregar();
    const [res] = recalcularApuracao([e], comCriterios(aprenderConfig([e])));
    expect(res.avisos.filter((a) => a.nivel === 'erro')).toEqual([]);
    expect(res.recalculada).toBe(true);
    // a amostra é consistente: nenhuma nota elegível sem estorno e nenhum crédito retido
    expect(res.avisos.filter((a) => a.codigo === 'ESTORNO_AUSENTE' || a.codigo === 'CREDITO_RETIDO')).toEqual([]);
    expect(res.avisos.filter((a) => a.nivel === 'alerta')).toEqual([]);
    const editados = [...percorrer(e.raiz)].filter((r) => r.estado);
    expect(editados.map((r) => `${r.reg} ${r.estado} ${JSON.stringify(r.antes ?? {})} ${r.campos.join('|')}`)).toEqual([]);
    const gravado = Buffer.from(escreverSped(e).bytes).toString('latin1');
    const esperado = Buffer.from(semAssinatura(original)).toString('latin1');
    expect(diferencas(gravado, esperado)).toEqual([]);
    expect(gravado === esperado).toBe(true);
  });

  it('reconstrói o bloco M apagado/zerado e chega ao mesmo arquivo (caminhos de criação)', () => {
    limparMemoriaNaturezas();
    const { e, original } = carregar();
    const cfg = comCriterios(aprenderConfig([e]));
    for (const t of [PIS, COFINS]) {
      const m100s = listar(e, t.M100);
      // 201 inteiro some; o 101 perde M105 e estornos e fica com campos zerados
      removerRegistro(m100s.find((r) => get(r, 'COD_CRED') === '201')!);
      const m101 = m100s.find((r) => get(r, 'COD_CRED') === '101')!;
      for (const f of [...m101.filhos]) if (f.reg === t.M105 || get(f, 'NUM_DOC')) removerRegistro(f);
      for (const c of ['VL_BC_' + t.sfx, 'VL_CRED', 'VL_AJUS_ACRES', 'VL_AJUS_REDUC', 'VL_CRED_DISP', 'VL_CRED_DESC', 'SLD_CRED']) set(m101, c, '1');
      set(m101, 'IND_DESC_CRED', '1');
      const m200 = listar(e, t.M200)[0];
      for (const f of [...m200.filhos]) removerRegistro(f);
      for (const c of ['VL_TOT_CONT_NC_PER', 'VL_TOT_CRED_DESC', 'VL_TOT_CONT_NC_DEV', 'VL_CONT_NC_REC', 'VL_TOT_CONT_REC']) set(m200, c, '7');
      for (const r of listar(e, t.M400)) removerRegistro(r);
    }
    const [res] = recalcularApuracao([e], cfg);
    expect(res.recalculada).toBe(true);
    const gravado = Buffer.from(escreverSped(e).bytes).toString('latin1');
    const esperado = Buffer.from(semAssinatura(original)).toString('latin1');
    expect(diferencas(gravado, esperado)).toEqual([]);
    // idempotente: recalcular de novo não muda nada
    recalcularApuracao([e], cfg);
    expect(Buffer.from(escreverSped(e).bytes).toString('latin1') === esperado).toBe(true);
  });

  // ------------------------------------------------------------------ cenários com edição

  it('(a) base de item de entrada CST 53 CFOP 1101 → M105 02, M100 101/201, M200 (PIS e Cofins)', () => {
    limparMemoriaNaturezas();
    const { e } = carregar();
    const cfg = comCriterios(aprenderConfig([e]));
    const rec = receitas(e);
    const item = itens(e).find((i) => get(i, 'CST_PIS') === '53' && get(i, 'CFOP') === '1101')!;
    const antes = { pis: capturar(e, PIS), cofins: capturar(e, COFINS) };
    const delta = 100000; // + R$ 1.000,00 na base
    for (const t of [PIS, COFINS]) set(item, `VL_BC_${t.sfx}`, fmtCentavos(centavos(get(item, `VL_BC_${t.sfx}`)) + delta));
    const [res] = recalcularApuracao([e], cfg);
    expect(res.recalculada).toBe(true);
    for (const t of [PIS, COFINS]) {
      const a = antes[t.id];
      const tot02 = a.m105['101|02'].tot + delta;
      const p101 = ratear(tot02, rec[1], rec[1] + rec[2]);
      const p201 = ratear(tot02, rec[2], rec[1] + rec[2]);
      for (const [cc, p] of [['101', p101], ['201', p201]] as const) {
        const m105 = m105De(e, t, cc, '02');
        expect(cent(m105, `VL_BC_${t.sfx}_TOT`)).toBe(tot02);
        expect(cent(m105, `VL_BC_${t.sfx}_NC`)).toBe(tot02);
        expect(cent(m105, `VL_BC_${t.sfx}`)).toBe(p);
        const base = a.m100[cc].base - a.m105[`${cc}|02`].parcela + p;
        const m100 = m100De(e, t, cc);
        expect(cent(m100, `VL_BC_${t.sfx}`)).toBe(base);
        const cred = mulAliq(base, t === PIS ? '1,65' : '7,6');
        expect(cent(m100, 'VL_CRED')).toBe(cred);
        expect(cent(m100, 'VL_CRED_DISP')).toBe(cred + a.m100[cc].acres - a.m100[cc].reduc);
        expect(cent(m100, 'VL_CRED_DESC')).toBe(cent(m100, 'VL_CRED_DISP'));
        expect(cent(m100, 'SLD_CRED')).toBe(0);
      }
      const desc = cent(m100De(e, t, '101'), 'VL_CRED_DISP') + cent(m100De(e, t, '201'), 'VL_CRED_DISP');
      const m200 = listar(e, t.M200)[0];
      expect(cent(m200, 'VL_TOT_CONT_NC_PER')).toBe(a.nc);
      expect(cent(m200, 'VL_TOT_CRED_DESC')).toBe(desc);
      expect(cent(m200, 'VL_TOT_CONT_NC_DEV')).toBe(a.nc - desc);
      expect(cent(m200, 'VL_TOT_CONT_REC')).toBe(a.nc - desc);
      expect(cent(listar(e, t.M205)[0], 'VL_DEBITO')).toBe(a.nc - desc);
      expect(cent(m200, 'VL_TOT_CRED_DESC')).toBeGreaterThan(a.desc); // crédito subiu
    }
  });

  it('(b) item de saída CST 01 → CST 06: M210, M400 e pendência/atribuição de natureza', () => {
    limparMemoriaNaturezas();
    const { e } = carregar();
    const cfg = comCriterios(aprenderConfig([e]));
    const antes = { pis: capturar(e, PIS), cofins: capturar(e, COFINS) };
    const item = itens(e).find((i) => get(i, 'CST_PIS') === '01' && get(i, 'CFOP') === '6101' && centavos(get(i, 'VL_ITEM')) > 0)!;
    const v = centavos(get(item, 'VL_ITEM'));
    const b = centavos(get(item, 'VL_BC_PIS'));
    for (const t of [PIS, COFINS]) {
      set(item, `CST_${t.sfx}`, '06');
      set(item, `ALIQ_${t.sfx}`, '0');
      set(item, `VL_${t.sfx}`, '0');
    }
    let [res] = recalcularApuracao([e], cfg);
    expect(res.recalculada).toBe(true);
    for (const t of [PIS, COFINS]) {
      const a = antes[t.id];
      const m210 = listar(e, t.M210).find((r) => get(r, 'COD_CONT') === '01')!;
      expect(cent(m210, 'VL_REC_BRT')).toBe(a.m210['01'].rec - v);
      expect(cent(m210, 'VL_BC_CONT')).toBe(a.m210['01'].base - b);
      const apur = mulAliq(a.m210['01'].base - b, t === PIS ? '1,65' : '7,6');
      expect(cent(m210, 'VL_CONT_APUR')).toBe(apur);
      expect(cent(m210, 'VL_CONT_PER')).toBe(apur);
      const nc = apur + a.m210['02'].per;
      expect(cent(listar(e, t.M200)[0], 'VL_TOT_CONT_NC_PER')).toBe(nc);
      const m400 = listar(e, t.M400).find((r) => get(r, `CST_${t.sfx}`) === '06')!;
      expect(cent(m400, 'VL_TOT_REC')).toBe(a.m400['06'] + v);
      expect(m410(m400, t)).toEqual({ ...a.m410['06'], '999': v });
    }
    const chave = `COD_NAT:${get(item, 'COD_NAT')}`;
    expect(pendenciasNaturezaReceita(e)).toEqual([expect.objectContaining({ cst: '06', chave, valor: v })]);
    expect(res.avisos.some((x) => x.codigo === 'NATUREZA_RECEITA_PENDENTE')).toBe(true);

    definirNaturezaReceita(e, '06', chave, '908');
    [res] = recalcularApuracao([e], cfg);
    expect(pendenciasNaturezaReceita(e)).toEqual([]);
    for (const t of [PIS, COFINS]) {
      const m400 = listar(e, t.M400).find((r) => get(r, `CST_${t.sfx}`) === '06')!;
      expect(m410(m400, t)).toEqual({ ...antes[t.id].m410['06'], '908': antes[t.id].m410['06']['908'] + v });
    }
    // a atribuição vale para outro mês do mesmo CNPJ
    const outro = lerSped(lerBytes(amostra!), amostra!);
    registrarOriginal(outro);
    const it2 = itens(outro).find((i) => get(i, 'COD_NAT') === get(item, 'COD_NAT') && get(i, 'CST_PIS') === '01')!;
    for (const t of [PIS, COFINS]) {
      set(it2, `CST_${t.sfx}`, '06');
      set(it2, `ALIQ_${t.sfx}`, '0');
      set(it2, `VL_${t.sfx}`, '0');
    }
    recalcularApuracao([outro], comCriterios(aprenderConfig([outro])));
    expect(pendenciasNaturezaReceita(outro)).toEqual([]);
  });

  it('(c) excluir nota de perda CFOP 5927 remove o M110/M510 vinculado', () => {
    limparMemoriaNaturezas();
    const { e } = carregar();
    const cfg = comCriterios(aprenderConfig([e]));
    const antes = { pis: capturar(e, PIS), cofins: capturar(e, COFINS) };
    const nota = listar(e, 'C100').find((c) => c.filhos.some((i) => get(i, 'CST_PIS') === '49' && get(i, 'CFOP') === '5927'))!;
    const num = get(nota, 'NUM_DOC');
    const valor = {
      pis: nota.filhos.reduce((s, i) => s + centavos(get(i, 'VL_PIS')), 0),
      cofins: nota.filhos.reduce((s, i) => s + centavos(get(i, 'VL_COFINS')), 0),
    };
    removerRegistro(nota);
    recalcularApuracao([e], cfg);
    for (const t of [PIS, COFINS]) {
      const a = antes[t.id];
      expect(listar(e, t.M110).some((r) => get(r, 'NUM_DOC') === num)).toBe(false);
      expect(listar(e, t.M110).length).toBe(a.qtdM110 - 1);
      const m101 = m100De(e, t, '101');
      expect(cent(m101, 'VL_AJUS_REDUC')).toBe(a.m100['101'].reduc - valor[t.id]);
      expect(cent(m101, 'VL_CRED_DISP')).toBe(a.m100['101'].disp + valor[t.id]);
      const m200 = listar(e, t.M200)[0];
      expect(cent(m200, 'VL_TOT_CRED_DESC')).toBe(a.desc + valor[t.id]);
      expect(cent(m200, 'VL_TOT_CONT_REC')).toBe(a.nc - a.desc - valor[t.id]);
      expect(cent(listar(e, t.M205)[0], 'VL_DEBITO')).toBe(a.nc - a.desc - valor[t.id]);
    }
  });

  it('(d) nota nova de devolução de compra CFOP 5201 gera estorno rateado entre 101 e 201', () => {
    limparMemoriaNaturezas();
    const { e } = carregar();
    const cfg = comCriterios(aprenderConfig([e]));
    const rec = receitas(e);
    const antes = { pis: capturar(e, PIS), cofins: capturar(e, COFINS) };
    const modelo = listar(e, 'C100').find((c) => c.filhos.some((i) => get(i, 'CST_PIS') === '49' && get(i, 'CFOP') === '5201'))!;
    const nova = clonar(modelo, null);
    set(nova, 'NUM_DOC', '999001');
    set(nova, 'CHV_NFE', '');
    const pai = modelo.pai!;
    nova.pai = pai;
    pai.filhos.splice(pai.filhos.indexOf(modelo) + 1, 0, nova);
    recalcularApuracao([e], cfg);
    for (const t of [PIS, COFINS]) {
      const a = antes[t.id];
      const v = nova.filhos.filter((i) => get(i, `CST_${t.sfx}`) === '49').reduce((s, i) => s + centavos(get(i, `VL_${t.sfx}`)), 0);
      const p101 = ratear(v, rec[1], rec[1] + rec[2]);
      const p201 = ratear(v, rec[2], rec[1] + rec[2]);
      for (const [cc, p] of [['101', p101], ['201', p201]] as const) {
        const m100 = m100De(e, t, cc);
        const aj = filhosDe(m100, t.M110).filter((r) => get(r, 'NUM_DOC') === '999001');
        expect(aj.length).toBe(1);
        expect(aj[0].estado).toBe('novo');
        expect(aj[0].campos.slice(1)).toEqual(['0', fmtCentavos(p), '06', '999001', 'Filial: 1', get(nova, 'DT_DOC')]);
        const det = filhosDe(aj[0], t.M115);
        expect(det.map((d) => d.campos.slice(1, 7))).toEqual([[fmtCentavos(p), '', '0', '0', get(nova, 'DT_DOC'), '']]);
        expect(cent(m100, 'VL_AJUS_REDUC')).toBe(a.m100[cc].reduc + p);
        expect(cent(m100, 'VL_CRED_DISP')).toBe(a.m100[cc].disp - p);
      }
      expect(cent(listar(e, t.M200)[0], 'VL_TOT_CRED_DESC')).toBe(a.desc - p101 - p201);
    }
  });

  for (const modo of ['somente-mes', 'encadear'] as const) {
    it(`(e) saldo credor no mês (${modo}): IND_DESC_CRED, SLD_CRED, 1100/1500, M200 e M205`, () => {
      limparMemoriaNaturezas();
      const { e } = carregar();
      const cfg = { ...comCriterios(aprenderConfig([e])), saldoCredor: modo };
      const antes = { pis: capturar(e, PIS), cofins: capturar(e, COFINS) };
      zerarSaidasCst01(e);
      const [res] = recalcularApuracao([e], cfg);
      expect(res.recalculada).toBe(true);
      for (const t of [PIS, COFINS]) {
        const a = antes[t.id];
        const aliq = t === PIS ? '1,65' : '7,6';
        const m210 = listar(e, t.M210).find((r) => get(r, 'COD_CONT') === '01')!;
        const baseF100 = listar(e, 'F100')
          .filter((f) => get(f, `CST_${t.sfx}`) === '01')
          .reduce((s, f) => s + centavos(get(f, `VL_BC_${t.sfx}`)), 0);
        expect(cent(m210, 'VL_BC_CONT')).toBe(baseF100);
        const nc = mulAliq(baseF100, aliq) + a.m210['02'].per;
        const d101 = a.m100['101'].disp;
        const d201 = a.m100['201'].disp;
        expect(nc).toBeLessThan(d101);
        const m101 = m100De(e, t, '101');
        const m201 = m100De(e, t, '201');
        expect([get(m101, 'IND_DESC_CRED'), cent(m101, 'VL_CRED_DESC'), cent(m101, 'SLD_CRED')]).toEqual(['1', nc, d101 - nc]);
        expect([get(m201, 'IND_DESC_CRED'), cent(m201, 'VL_CRED_DESC'), cent(m201, 'SLD_CRED')]).toEqual(['1', 0, d201]);
        const m200 = listar(e, t.M200)[0];
        expect(m200.campos.slice(1).map(centavos)).toEqual([nc, nc, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0]);
        expect(listar(e, t.M205)).toEqual([]);
        const r1100 = listar(e, t.R1100);
        expect(r1100.map((r) => r.campos.slice(1))).toEqual([
          ['032025', '01', '', '101', ...[d101, 0, d101, nc, 0, 0, d101 - nc, 0, 0, 0, 0, 0, d101 - nc].map(fmtCentavos)],
          ['032025', '01', '', '201', ...[d201, 0, d201, 0, 0, 0, d201, 0, 0, 0, 0, 0, d201].map(fmtCentavos)],
        ]);
      }
      expect(get(listar(e, '1001')[0], 'IND_MOV')).toBe('0');
      expect(res.resumo.pis.saldoCredor).toBe(antes.pis.m100['101'].disp + antes.pis.m100['201'].disp - res.resumo.pis.creditoDescontado);
      // idempotente
      const bytes = Buffer.from(escreverSped(e).bytes);
      recalcularApuracao([e], cfg);
      expect(Buffer.from(escreverSped(e).bytes).equals(bytes)).toBe(true);
    });
  }

  it('(g) nota elegível sem estorno no original: avisa ESTORNO_AUSENTE e não cria ajuste', () => {
    limparMemoriaNaturezas();
    // antes de registrarOriginal: tira o ajuste de duas notas de perda (como faria um ERP incompleto)
    const e = lerSped(lerBytes(amostra!), amostra!);
    const nums: string[] = [];
    for (const t of [PIS, COFINS]) {
      const alvos = listar(e, t.M110)
        .filter((r) => get(r, 'COD_AJ') === '06' && get(r, 'NUM_DOC'))
        .slice(0, 2);
      for (const r of alvos) {
        if (t === PIS) nums.push(get(r, 'NUM_DOC'));
        removerRegistro(r);
      }
    }
    expect(nums.length).toBe(2);
    registrarOriginal(e);
    const [res] = recalcularApuracao([e], comCriterios(aprenderConfig([e])));
    expect(res.recalculada).toBe(true);
    const aviso = res.avisos.find((a) => a.codigo === 'ESTORNO_AUSENTE')!;
    expect(aviso.nivel).toBe('alerta');
    expect(aviso.mensagem).toMatch(/^2 notas com CFOP 5927 teriam estorno de crédito pela regra do arquivo, mas não têm ajuste no original; o sistema manteve sem ajuste\. Confira se o estorno deveria existir\./);
    for (const n of nums) expect(aviso.mensagem).toContain(`${n} (CFOP 5927)`);
    expect(aviso.mensagem).not.toMatch(/e outras/);
    // continua sem ajuste: o motor não inventa
    for (const t of [PIS, COFINS]) {
      for (const n of nums) expect(listar(e, t.M110).some((r) => get(r, 'NUM_DOC') === n)).toBe(false);
    }
    // só um aviso, embora as notas apareçam no PIS e na Cofins
    expect(res.avisos.filter((a) => a.codigo === 'ESTORNO_AUSENTE').length).toBe(1);
  });

  it('(h) crédito retido de propósito no original: avisa CREDITO_RETIDO e preserva se pedido', () => {
    limparMemoriaNaturezas();
    // monta um original em que o 201 foi guardado (saldo credor) havendo contribuição a recolher
    const e = lerSped(lerBytes(amostra!), amostra!);
    const retido: Record<string, { disp: number; desc: number }> = {};
    for (const t of [PIS, COFINS]) {
      const m201 = listar(e, t.M100).find((r) => get(r, 'COD_CRED') === '201')!;
      const disp = centavos(get(m201, 'VL_CRED_DISP'));
      const desc = Math.trunc(disp / 4); // desconta 25% e guarda o resto
      retido[t.id] = { disp, desc };
      set(m201, 'IND_DESC_CRED', '1');
      set(m201, 'VL_CRED_DESC', fmtCentavos(desc));
      set(m201, 'SLD_CRED', fmtCentavos(disp - desc));
      const m200 = listar(e, t.M200)[0];
      const nc = centavos(get(m200, 'VL_TOT_CONT_NC_PER'));
      const descTotal = centavos(get(m100De(e, t, '101'), 'VL_CRED_DISP')) + desc;
      for (const [campo, v] of [
        ['VL_TOT_CRED_DESC', descTotal],
        ['VL_TOT_CONT_NC_DEV', nc - descTotal],
        ['VL_CONT_NC_REC', nc - descTotal],
        ['VL_TOT_CONT_REC', nc - descTotal],
      ] as const) set(m200, campo, fmtCentavos(v));
      expect(nc - descTotal).toBeGreaterThan(0); // sobrou a recolher: retenção deliberada
    }
    registrarOriginal(e);
    const cfg = comCriterios(aprenderConfig([e]));

    // padrão: desconta o máximo e avisa
    const [res] = recalcularApuracao([e], cfg);
    for (const t of [PIS, COFINS]) {
      const m201 = m100De(e, t, '201');
      expect(cent(m201, 'VL_CRED_DESC')).toBe(retido[t.id].disp);
      expect(cent(m201, 'SLD_CRED')).toBe(0);
      const aviso = res.avisos.find((a) => a.codigo === 'CREDITO_RETIDO' && a.mensagem.startsWith(t.nome))!;
      expect(aviso.nivel).toBe('alerta');
      expect(aviso.mensagem).toContain('o crédito 201 tinha R$');
      expect(aviso.mensagem).toContain(reais(retido[t.id].disp - retido[t.id].desc));
      expect(aviso.mensagem).toMatch(/passou a descontar/);
    }

    // preservarRetencaoCredito: mantém a proporção do original e não avisa
    const e2 = lerSped(lerBytes(amostra!), amostra!);
    for (const t of [PIS, COFINS]) {
      const m201 = listar(e2, t.M100).find((r) => get(r, 'COD_CRED') === '201')!;
      set(m201, 'IND_DESC_CRED', '1');
      set(m201, 'VL_CRED_DESC', fmtCentavos(retido[t.id].desc));
      set(m201, 'SLD_CRED', fmtCentavos(retido[t.id].disp - retido[t.id].desc));
      const m200 = listar(e2, t.M200)[0];
      const nc = centavos(get(m200, 'VL_TOT_CONT_NC_PER'));
      const descTotal = centavos(get(m100De(e2, t, '101'), 'VL_CRED_DISP')) + retido[t.id].desc;
      set(m200, 'VL_CONT_NC_REC', fmtCentavos(nc - descTotal));
    }
    registrarOriginal(e2);
    const [res2] = recalcularApuracao([e2], { ...cfg, preservarRetencaoCredito: true });
    expect(res2.avisos.filter((a) => a.codigo === 'CREDITO_RETIDO')).toEqual([]);
    for (const t of [PIS, COFINS]) {
      const m201 = m100De(e2, t, '201');
      const { disp, desc } = retido[t.id];
      expect(cent(m201, 'VL_CRED_DISP')).toBe(disp);
      expect(cent(m201, 'VL_CRED_DESC')).toBe(ratear(disp, desc, disp));
      expect(cent(m201, 'SLD_CRED')).toBe(disp - ratear(disp, desc, disp));
      expect(get(m201, 'IND_DESC_CRED')).toBe('1');
      // o saldo guardado vai para o 1100/1500 do próprio mês
      const r1100 = listar(e2, t.R1100).find((r) => get(r, 'COD_CRED') === '201')!;
      expect(cent(r1100, 'SLD_CRED_FIM')).toBe(disp - ratear(disp, desc, disp));
    }
  });

  it('(f) encadeamento: saldo do mês 1 descontado no mês 2; idempotente; lacuna avisa', () => {
    limparMemoriaNaturezas();
    const { e: e1 } = carregar();
    const e2 = mesSeguinte('01042025', '30042025', '202504');
    const cfgBase = comCriterios(aprenderConfig([e1, e2]));
    const antes2 = { pis: capturar(e2, PIS), cofins: capturar(e2, COFINS) };
    zerarSaidasCst01(e1);

    // somente-mes: o mês 2 não usa o saldo do mês 1
    recalcularApuracao([e2, e1], { ...cfgBase, saldoCredor: 'somente-mes' });
    for (const t of [PIS, COFINS]) {
      expect(cent(listar(e2, t.M200)[0], 'VL_TOT_CRED_DESC_ANT')).toBe(0);
      expect(listar(e2, t.R1100)).toEqual([]);
    }

    const cfg = { ...cfgBase, saldoCredor: 'encadear' as const };
    const res = recalcularApuracao([e2, e1], cfg); // ordem de entrada não importa
    expect(res.map((r) => r.recalculada)).toEqual([true, true]);
    for (const t of [PIS, COFINS]) {
      const a2 = antes2[t.id];
      const s101 = cent(m100De(e1, t, '101'), 'SLD_CRED');
      const s201 = cent(m100De(e1, t, '201'), 'SLD_CRED');
      const disp101m1 = cent(m100De(e1, t, '101'), 'VL_CRED_DISP');
      const desc101m1 = cent(m100De(e1, t, '101'), 'VL_CRED_DESC');
      expect(s101).toBeGreaterThan(0);
      // mês 2: anteriores primeiro (101 e depois 201 de 03/2025), depois os do mês
      let alvo = a2.nc;
      const u101 = Math.min(s101, alvo);
      alvo -= u101;
      const u201 = Math.min(s201, alvo);
      alvo -= u201;
      const m200 = listar(e2, t.M200)[0];
      expect(cent(m200, 'VL_TOT_CRED_DESC_ANT')).toBe(u101 + u201);
      const c101 = Math.min(a2.m100['101'].disp, alvo);
      alvo -= c101;
      const c201 = Math.min(a2.m100['201'].disp, alvo);
      expect(cent(m100De(e2, t, '101'), 'VL_CRED_DESC')).toBe(c101);
      expect(cent(m100De(e2, t, '201'), 'VL_CRED_DESC')).toBe(c201);
      expect(cent(m200, 'VL_TOT_CRED_DESC')).toBe(c101 + c201);
      expect(cent(m200, 'VL_TOT_CONT_REC')).toBe(a2.nc - u101 - u201 - c101 - c201);
      const ant = listar(e2, t.R1100).find((r) => get(r, 'PER_APU_CRED') === '032025' && get(r, 'COD_CRED') === '101')!;
      expect(ant.campos.slice(5).map(centavos)).toEqual([disp101m1, 0, disp101m1, desc101m1, 0, 0, s101, u101, 0, 0, 0, 0, s101 - u101]);
      // saldo do próprio mês 2 (se sobrou) também vai para o 1100
      const atual = listar(e2, t.R1100).filter((r) => get(r, 'PER_APU_CRED') === '042025');
      expect(atual.map((r) => get(r, 'COD_CRED'))).toEqual(
        [['101', a2.m100['101'].disp - c101], ['201', a2.m100['201'].disp - c201]].filter(([, s]) => (s as number) > 0).map(([c]) => c),
      );
    }

    // idempotência: recalcular de novo não muda nenhum dos dois meses
    const b1 = Buffer.from(escreverSped(e1).bytes);
    const b2 = Buffer.from(escreverSped(e2).bytes);
    recalcularApuracao([e1, e2], cfg);
    expect(Buffer.from(escreverSped(e1).bytes).equals(b1)).toBe(true);
    expect(Buffer.from(escreverSped(e2).bytes).equals(b2)).toBe(true);

    // lacuna: mês 2 como maio → encadeia e avisa
    const e3 = mesSeguinte('01052025', '31052025', '202505');
    const r3 = recalcularApuracao([e1, e3], cfg);
    expect(r3[1].avisos.some((x) => x.codigo === 'LACUNA_DE_MESES')).toBe(true);
    expect(cent(listar(e3, PIS.M200)[0], 'VL_TOT_CRED_DESC_ANT')).toBeGreaterThan(0);
  });
});

// ------------------------------------------------------------------ apoio

function receitas(e: Escrituracao): { 1: number; 2: number; 3: number } {
  const r = listar(e, '0111')[0];
  return { 1: cent(r, 'REC_BRU_NCUM_TRIB_MI'), 2: cent(r, 'REC_BRU_NCUM_NT_MI'), 3: cent(r, 'REC_BRU_NCUM_EXP') };
}

function itens(e: Escrituracao): Registro[] {
  return listar(e, 'C170').filter((i) => !['02', '03', '04', '05'].includes(get(i.pai!, 'COD_SIT')));
}

function m100De(e: Escrituracao, t: Tributo, cc: string): Registro {
  return listar(e, t.M100).find((r) => get(r, 'COD_CRED') === cc)!;
}

function m105De(e: Escrituracao, t: Tributo, cc: string, nat: string): Registro {
  return filhosDe(m100De(e, t, cc), t.M105).find((r) => get(r, 'NAT_BC_CRED') === nat)!;
}

function m410(m400: Registro, t: Tributo): Record<string, number> {
  return Object.fromEntries(filhosDe(m400, t.M410).map((r) => [get(r, 'NAT_REC'), cent(r, 'VL_REC')]));
}

/** Valores relevantes do bloco M antes da edição. */
function capturar(e: Escrituracao, t: Tributo) {
  const m100: Record<string, { base: number; acres: number; reduc: number; disp: number }> = {};
  const m105: Record<string, { tot: number; parcela: number }> = {};
  for (const r of listar(e, t.M100)) {
    const cc = get(r, 'COD_CRED');
    m100[cc] = { base: cent(r, `VL_BC_${t.sfx}`), acres: cent(r, 'VL_AJUS_ACRES'), reduc: cent(r, 'VL_AJUS_REDUC'), disp: cent(r, 'VL_CRED_DISP') };
    for (const d of filhosDe(r, t.M105)) m105[`${cc}|${get(d, 'NAT_BC_CRED')}`] = { tot: cent(d, `VL_BC_${t.sfx}_TOT`), parcela: cent(d, `VL_BC_${t.sfx}`) };
  }
  const m210: Record<string, { rec: number; base: number; per: number }> = {};
  for (const r of listar(e, t.M210)) m210[get(r, 'COD_CONT')] = { rec: cent(r, 'VL_REC_BRT'), base: cent(r, 'VL_BC_CONT'), per: cent(r, 'VL_CONT_PER') };
  const m400: Record<string, number> = {};
  const m410s: Record<string, Record<string, number>> = {};
  for (const r of listar(e, t.M400)) {
    m400[get(r, `CST_${t.sfx}`)] = cent(r, 'VL_TOT_REC');
    m410s[get(r, `CST_${t.sfx}`)] = m410(r, t);
  }
  const m200 = listar(e, t.M200)[0];
  return {
    m100,
    m105,
    m210,
    m400,
    m410: m410s,
    nc: cent(m200, 'VL_TOT_CONT_NC_PER'),
    desc: cent(m200, 'VL_TOT_CRED_DESC'),
    qtdM110: listar(e, t.M110).length,
  };
}

function zerarSaidasCst01(e: Escrituracao): void {
  for (const i of itens(e)) {
    for (const t of [PIS, COFINS]) {
      if (get(i, `CST_${t.sfx}`) !== '01') continue;
      set(i, `VL_BC_${t.sfx}`, '0');
      set(i, `VL_${t.sfx}`, '0');
    }
  }
}

function clonar(r: Registro, pai: Registro | null): Registro {
  const c: Registro = { reg: r.reg, campos: [...r.campos], filhos: [], pai, estado: 'novo' };
  c.filhos = r.filhos.map((f) => clonar(f, c));
  return c;
}

/** A amostra relida como se fosse outro mês (mesmo CNPJ). */
function mesSeguinte(dtIni: string, dtFin: string, periodo: string): Escrituracao {
  const e = lerSped(lerBytes(amostra!), amostra!);
  const r0000 = listar(e, '0000')[0] ?? e.raiz;
  set(r0000, 'DT_INI', dtIni);
  set(r0000, 'DT_FIN', dtFin);
  e.dtIni = dtIni;
  e.dtFim = dtFin;
  e.periodo = periodo;
  e.id = `${e.id}-${periodo}`;
  registrarOriginal(e);
  return e;
}
