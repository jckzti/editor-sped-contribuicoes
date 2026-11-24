/**
 * Recalcula, para um tributo, os registros do bloco M que dependem só dos documentos
 * do mês: créditos (M100/M105 + ajustes vinculados M110/M115), contribuições (M210),
 * totais de contribuição do M200 e receitas não tributadas (M400/M410).
 *
 * O desconto dos créditos (M100 campos 13–15, M200 campos 03–08 e 12–13, M205) e o
 * controle de saldos (1100/1500) ficam em `saldo.ts`, porque dependem de outros meses.
 */
import { mulAliq } from '../dec';
import { filhosDe, get, listar, removerRegistro, type Aviso, type Escrituracao, type Registro } from '../modelo';
import type { ConfigApuracao, PendenciaNaturezaReceita, RegraEstorno } from './contrato';
import type { EstadoApuracao } from './estado';
import { ajusteDerivado, estornosDesejados, gravarEstornos } from './estornos';
import type { Fontes, NotaEstorno, OpReceita } from './fontes';
import {
  distribuirNatureza,
  mapaNcm,
  memoriaNaturezas,
  TIPO_CHAVE_PADRAO,
  tipoDaChave,
  type ContextoNatureza,
  type MapaNatureza,
} from './natureza';
import { tipoPresumidoDe } from './presumido';
import { gruposDoCst, ratearPorGrupos, tipoCredito, type Receitas0111 } from './rateio';
import type { Tributo } from './tributos';
import { agrupar, aliqEsc, cent, criar, fmtAliq, inserirOrdenado, setCent, somar } from './util';

export const COD_CONT_NC = new Set(['01', '02', '03', '04', '32', '71']);
export const COD_CONT_CUM = new Set(['31', '51', '52', '53', '54', '72']);
const CST_NT = new Set(['04', '06', '07', '08', '09']);

export interface ContextoMes {
  e: Escrituracao;
  config: ConfigApuracao;
  estado: EstadoApuracao;
  avisos: Aviso[];
  rec: Receitas0111;
  m001: Registro;
  /**
   * Notas elegíveis a estorno pela regra aprendida que não têm ajuste no original
   * (chave da nota → nota). Preenchido nos dois tributos e avisado uma vez por escrituração.
   */
  estornosAusentes: Map<string, NotaEstorno>;
  /** Ajustes/notas de estorno não ligados por ambiguidade (número+data → descrição), avisados uma vez. */
  estornosAmbiguos: Map<string, string>;
}

const chaveAliq = (a: bigint) => a.toString().padStart(14, '0');
const chaveM100 = (r: Registro, t: Tributo) => `${get(r, 'COD_CRED')}|${chaveAliq(aliqEsc(get(r, `ALIQ_${t.sfx}`)))}`;
const chaveM105 = (r: Registro, t: Tributo) => `${get(r, 'NAT_BC_CRED')}|${get(r, `CST_${t.sfx}`)}`;
const chaveM210 = (r: Registro, t: Tributo) => `${get(r, 'COD_CONT')}|${chaveAliq(aliqEsc(get(r, `ALIQ_${t.sfx}`)))}`;

interface LinhaM105 {
  nat: string;
  cst: string;
  total: number;
  parcela: number;
}
interface GrupoCredito {
  codCred: string;
  aliq: bigint;
  linhas: Map<string, LinhaM105>;
}

/** Recalcula M100/M105/M110/M115, M210, M200 (contribuições) e M400/M410 de um tributo. */
export function apurarTributo(ctx: ContextoMes, t: Tributo, f: Fontes): PendenciaNaturezaReceita[] {
  apurarCreditos(ctx, t, f);
  apurarContribuicoes(ctx, t, f);
  return apurarReceitasNaoTributadas(ctx, t, f);
}

// ---------------------------------------------------------------- créditos

function apurarCreditos(ctx: ContextoMes, t: Tributo, f: Fontes): void {
  const { e, estado, rec, m001 } = ctx;
  const est = estado.tributos[t.id];
  const s = t.sfx;

  // 1) base total por (tipo, alíquota, NAT_BC_CRED, CST)
  const totais = new Map<string, number>();
  let presumidoSuposto = false;
  for (const op of f.creditos) {
    let presumido = est.tipoPresumido;
    if (!op.importacao && Number(op.cst) >= 60) {
      // recusas (tipo indecidível) já foram feitas antes; aqui o tipo é conhecido
      const p = tipoPresumidoDe(est.presumido, op) ?? { tipo: est.tipoPresumido, suposto: true };
      presumido = p.tipo;
      if (p.suposto) presumidoSuposto = true;
    }
    const tipo = tipoCredito(op, t.aliqBasica, presumido);
    somar(totais, `${tipo}|${op.aliq}|${op.natBc}|${op.cst}`, op.base);
  }
  if (presumidoSuposto) {
    ctx.avisos.push({
      nivel: 'alerta',
      codigo: 'PRESUMIDO_TIPO_SUPOSTO',
      mensagem: `${t.nome}: crédito presumido (CST 60–66) classificado como x07 (outros créditos presumidos): o arquivo original não tinha crédito presumido para ensinar o tipo. Se for presumido da agroindústria, o tipo correto é x06 (106/206/306).`,
    });
  }
  // 2) rateio por grupo de receita → grupos de M100
  const desejados = new Map<string, GrupoCredito>();
  for (const [k, total] of totais) {
    const [tipo, aliqTxt, nat, cst] = k.split('|');
    const aliq = BigInt(aliqTxt);
    const parcelas = ratearPorGrupos(total, gruposDoCst(cst), rec);
    // sem receita para ratear: com base ≠ 0 o mês já foi recusado (APURACAO_RATEIO_SEM_RECEITA); com base 0 não há o que apropriar
    if (!parcelas) continue;
    for (const [g, parcela] of parcelas) {
      if (parcela === 0) continue;
      const codCred = `${g}${tipo}`;
      const km = `${codCred}|${chaveAliq(aliq)}`;
      let grupo = desejados.get(km);
      if (!grupo) desejados.set(km, (grupo = { codCred, aliq, linhas: new Map() }));
      grupo.linhas.set(`${nat}|${cst}`, { nat, cst, total, parcela });
    }
  }

  // 2b) alíquota diferenciada nova: o guia diz que a alíquota define 101/102/103/105, mas não diz
  // quais alíquotas são de embalagens para revenda (105). Se o original tinha 105, o mês já foi
  // recusado (perfil); aqui só avisa quando aparece um 102/202/302 que o original não tinha.
  const originais = new Set(estado.resumoOriginal[t.id].creditos.map((l) => `${l.codCred}|${aliqEsc(l.aliquota)}`));
  const novos102 = [...desejados.values()].filter((g) => g.codCred.slice(1) === '02' && !originais.has(`${g.codCred}|${g.aliq}`));
  if (novos102.length) {
    ctx.avisos.push({
      nivel: 'alerta',
      codigo: 'CREDITO_ALIQ_DIFERENCIADA_NOVO',
      mensagem:
        `${t.nome}: crédito classificado como alíquota diferenciada (${novos102.map((g) => `${g.codCred} a ${fmtAliq(g.aliq)}%`).join(', ')}), que o arquivo original não tinha. ` +
        `Se for aquisição de embalagens para revenda, o tipo correto é x05 (105/205/305), que o editor não gera: confira antes de transmitir.`,
    });
  }

  // 3) estornos desejados (precisam saber quais M100 existirão)
  const regraDe = regraEstorno(ctx, t);
  const existentes = listar(e, t.M100);
  const chavesDesej0 = new Set<string>();
  // M100 que sobram só com ajustes manuais continuam existindo
  const sobrevivem = new Set([...desejados.values()].map((g) => g.codCred));
  for (const m100 of existentes) {
    if (desejados.has(chaveM100(m100, t))) continue;
    if (filhosDe(m100, t.M110).some((a) => !ajusteDerivado(a, est, chavesDesej0))) sobrevivem.add(get(m100, 'COD_CRED'));
  }
  const estornos = estornosDesejados(f.estornos, regraDe, est, rec, sobrevivem, ctx.avisos, t, ctx.estornosAusentes, ctx.estornosAmbiguos);
  const chavesDesej = new Set(estornos.map((d) => d.nota.curto));

  // 4) sincroniza M100/M105
  const porChave = new Map<string, Registro>();
  const sobras: Registro[] = []; // M100 sem crédito no mês ou duplicados
  for (const m100 of existentes) {
    const k = chaveM100(m100, t);
    if (!porChave.has(k)) porChave.set(k, m100);
    else sobras.push(m100);
  }
  const finais: Registro[] = [];
  for (const [k, g] of desejados) {
    let m100 = porChave.get(k);
    porChave.delete(k);
    if (!m100) {
      m100 = criar(t.M100, {
        COD_CRED: g.codCred,
        IND_CRED_ORI: '0',
        [`VL_BC_${s}`]: '0',
        [`ALIQ_${s}`]: fmtAliq(g.aliq),
        VL_CRED: '0',
        VL_AJUS_ACRES: '0',
        VL_AJUS_REDUC: '0',
        [t.campoCredDif]: '0',
        VL_CRED_DISP: '0',
        IND_DESC_CRED: '0',
        VL_CRED_DESC: '0',
        SLD_CRED: '0',
      });
      inserirOrdenado(m001, m100, (r) => (r.reg === t.M100 ? chaveM100(r, t) : ''));
    }
    sincronizarM105(m100, t, g);
    finais.push(m100);
  }
  sobras.push(...porChave.values());
  for (const m100 of sobras) {
    const manuais = filhosDe(m100, t.M110).some((a) => !ajusteDerivado(a, est, chavesDesej));
    if (!manuais) {
      removerRegistro(m100);
      continue;
    }
    for (const m105 of filhosDe(m100, t.M105)) removerRegistro(m105);
    setCent(m100, `VL_BC_${s}`, 0);
    finais.push(m100);
    ctx.avisos.push({
      nivel: 'alerta',
      codigo: 'CREDITO_SO_COM_AJUSTE',
      mensagem: `${t.nome}: o crédito ${get(m100, 'COD_CRED')} ficou sem base no mês, mas foi mantido por ter ajustes manuais (${t.M110}).`,
    });
  }

  // 5) ajustes vinculados a nota
  for (const m100 of finais) {
    const cc = get(m100, 'COD_CRED');
    gravarEstornos(
      m100,
      t,
      estornos.filter((d) => d.codCred === cc && finais.find((x) => get(x, 'COD_CRED') === cc) === m100),
      est,
      chavesDesej,
    );
  }

  // 6) totais do M100 (campos 04, 08–12)
  for (const m100 of finais) {
    const base = filhosDe(m100, t.M105).reduce((acc, r) => acc + cent(r, `VL_BC_${s}`), 0);
    setCent(m100, `VL_BC_${s}`, base);
    const cred = mulAliq(base, get(m100, `ALIQ_${s}`));
    setCent(m100, 'VL_CRED', cred);
    let acres = 0;
    let reduc = 0;
    for (const aj of filhosDe(m100, t.M110)) {
      if (get(aj, 'IND_AJ') === '1') acres += cent(aj, 'VL_AJ');
      else reduc += cent(aj, 'VL_AJ');
    }
    setCent(m100, 'VL_AJUS_ACRES', acres);
    setCent(m100, 'VL_AJUS_REDUC', reduc);
    const dif = cent(m100, t.campoCredDif);
    const disp = cred + acres - reduc - dif;
    setCent(m100, 'VL_CRED_DISP', disp);
    if (disp < 0) {
      ctx.avisos.push({
        nivel: 'alerta',
        codigo: 'CREDITO_NEGATIVO',
        mensagem: `${t.nome}: crédito ${get(m100, 'COD_CRED')} ficou negativo (ajustes de redução maiores que o crédito do mês).`,
      });
    }
  }
}

function sincronizarM105(m100: Registro, t: Tributo, g: GrupoCredito): void {
  const s = t.sfx;
  const atuais = new Map<string, Registro>();
  for (const r of filhosDe(m100, t.M105)) {
    const k = chaveM105(r, t);
    if (atuais.has(k) || !g.linhas.has(k)) removerRegistro(r);
    else atuais.set(k, r);
  }
  for (const [k, l] of g.linhas) {
    let r = atuais.get(k);
    if (!r) {
      r = criar(t.M105, {
        NAT_BC_CRED: l.nat,
        [`CST_${s}`]: l.cst,
        [`VL_BC_${s}_TOT`]: '0',
        [`VL_BC_${s}_CUM`]: '0',
        [`VL_BC_${s}_NC`]: '0',
        [`VL_BC_${s}`]: '0',
        DESC_CRED: l.nat === '13' ? 'Outras operações com direito a crédito' : '',
      });
      inserirOrdenado(m100, r, (x) => (x.reg === t.M105 ? chaveM105(x, t) : ''));
    }
    setCent(r, `VL_BC_${s}_TOT`, l.total);
    setCent(r, `VL_BC_${s}_CUM`, 0);
    setCent(r, `VL_BC_${s}_NC`, l.total);
    setCent(r, `VL_BC_${s}`, l.parcela);
  }
}

/**
 * Regra de estorno por CFOP: a aprendida no próprio arquivo; senão a da configuração para o
 * MESMO CNPJ (aprendida nos outros meses dele); senão a da configuração sem CNPJ. Regras de
 * outro CNPJ nunca valem (um cliente não herda o estorno de outro carregado na sessão).
 */
function regraEstorno(ctx: ContextoMes, t: Tributo): (cfop: string) => RegraEstorno | undefined {
  const m = new Map<string, RegraEstorno>();
  for (const r of ctx.config.estornos) if (!r.cnpj) m.set(r.cfop, r);
  for (const r of ctx.config.estornos) if (r.cnpj === ctx.e.cnpj) m.set(r.cfop, r);
  for (const r of ctx.estado.tributos[t.id].regras) m.set(r.cfop, r);
  return (cfop) => m.get(cfop);
}

// ---------------------------------------------------------------- contribuições

function apurarContribuicoes(ctx: ContextoMes, t: Tributo, f: Fontes): void {
  const { e, m001 } = ctx;
  const s = t.sfx;
  const r0110 = listar(e, '0110')[0];
  const misto = !!r0110 && get(r0110, 'COD_INC_TRIB') === '3';
  const desejados = new Map<string, { codCont: string; aliq: bigint; rec: number; base: number }>();
  const avisouAliq = new Set<string>();
  for (const op of f.receitas) {
    if (op.cst !== '01' && op.cst !== '02') continue;
    const codCont = misto && op.cst === '01' && op.aliq === t.aliqBasicaCum ? '51' : op.cst;
    if (codCont === '01' && op.aliq !== t.aliqBasica && !avisouAliq.has(fmtAliq(op.aliq))) {
      avisouAliq.add(fmtAliq(op.aliq));
      ctx.avisos.push({
        nivel: 'alerta',
        codigo: 'CST01_ALIQ_DIFERENTE',
        mensagem: `${t.nome}: há operações CST 01 (alíquota básica) com alíquota ${fmtAliq(op.aliq)}%.`,
      });
    }
    const k = `${codCont}|${chaveAliq(op.aliq)}`;
    const d = desejados.get(k) ?? { codCont, aliq: op.aliq, rec: 0, base: 0 };
    d.rec += op.receita;
    d.base += op.base;
    desejados.set(k, d);
  }

  let m200 = listar(e, t.M200)[0];
  if (!m200) {
    m200 = criar(t.M200, {});
    for (const c of [
      'VL_TOT_CONT_NC_PER', 'VL_TOT_CRED_DESC', 'VL_TOT_CRED_DESC_ANT', 'VL_TOT_CONT_NC_DEV', 'VL_RET_NC', 'VL_OUT_DED_NC',
      'VL_CONT_NC_REC', 'VL_TOT_CONT_CUM_PER', 'VL_RET_CUM', 'VL_OUT_DED_CUM', 'VL_CONT_CUM_REC', 'VL_TOT_CONT_REC',
    ]) setCent(m200, c, 0);
    inserirOrdenado(m001, m200, () => '');
  }

  const porChave = new Map<string, Registro>();
  for (const r of filhosDe(m200, t.M210)) {
    const k = chaveM210(r, t);
    if (!porChave.has(k)) porChave.set(k, r);
  }
  const finais: { r: Registro; rec: number; base: number }[] = [];
  for (const [k, d] of desejados) {
    let r = porChave.get(k);
    porChave.delete(k);
    if (!r) {
      r = criar(t.M210, {
        COD_CONT: d.codCont,
        VL_REC_BRT: '0',
        VL_BC_CONT: '0',
        [`VL_AJUS_ACRES_BC_${s}`]: '0',
        [`VL_AJUS_REDUC_BC_${s}`]: '0',
        VL_BC_CONT_AJUS: '0',
        [`ALIQ_${s}`]: fmtAliq(d.aliq),
        VL_CONT_APUR: '0',
        VL_AJUS_ACRES: '0',
        VL_AJUS_REDUC: '0',
        VL_CONT_DIFER: '0',
        VL_CONT_DIFER_ANT: '0',
        VL_CONT_PER: '0',
      });
      inserirOrdenado(m200, r, (x) => (x.reg === t.M210 ? chaveM210(x, t) : ''));
    }
    finais.push({ r, rec: d.rec, base: d.base });
  }
  for (const r of porChave.values()) {
    const temAjustes = filhosDe(r, t.M215).length + filhosDe(r, t.M220).length + filhosDe(r, t.M230).length > 0;
    if (!temAjustes) {
      removerRegistro(r);
      continue;
    }
    finais.push({ r, rec: 0, base: 0 });
    ctx.avisos.push({
      nivel: 'alerta',
      codigo: 'CONTRIBUICAO_SO_COM_AJUSTE',
      mensagem: `${t.nome}: a contribuição ${get(r, 'COD_CONT')} ficou sem receita no mês, mas foi mantida por ter ajustes/diferimentos.`,
    });
  }

  let nc = 0;
  let cum = 0;
  for (const { r, rec, base } of finais) {
    setCent(r, 'VL_REC_BRT', rec);
    setCent(r, 'VL_BC_CONT', base);
    const ajBc = filhosDe(r, t.M215);
    if (ajBc.length) {
      setCent(r, `VL_AJUS_ACRES_BC_${s}`, ajBc.filter((a) => get(a, 'IND_AJ_BC') === '1').reduce((x, a) => x + cent(a, 'VL_AJ_BC'), 0));
      setCent(r, `VL_AJUS_REDUC_BC_${s}`, ajBc.filter((a) => get(a, 'IND_AJ_BC') === '0').reduce((x, a) => x + cent(a, 'VL_AJ_BC'), 0));
    }
    const baseAjus = base + cent(r, `VL_AJUS_ACRES_BC_${s}`) - cent(r, `VL_AJUS_REDUC_BC_${s}`);
    setCent(r, 'VL_BC_CONT_AJUS', baseAjus);
    const apur = mulAliq(baseAjus, get(r, `ALIQ_${s}`));
    setCent(r, 'VL_CONT_APUR', apur);
    const aj = filhosDe(r, t.M220);
    if (aj.length) {
      setCent(r, 'VL_AJUS_ACRES', aj.filter((a) => get(a, 'IND_AJ') === '1').reduce((x, a) => x + cent(a, 'VL_AJ'), 0));
      setCent(r, 'VL_AJUS_REDUC', aj.filter((a) => get(a, 'IND_AJ') === '0').reduce((x, a) => x + cent(a, 'VL_AJ'), 0));
    }
    const dif = filhosDe(r, t.M230);
    if (dif.length) setCent(r, 'VL_CONT_DIFER', dif.reduce((x, a) => x + cent(a, 'VL_CONT_DIF'), 0));
    const per =
      apur + cent(r, 'VL_AJUS_ACRES') - cent(r, 'VL_AJUS_REDUC') - cent(r, 'VL_CONT_DIFER') + cent(r, 'VL_CONT_DIFER_ANT');
    setCent(r, 'VL_CONT_PER', per);
    const cc = get(r, 'COD_CONT');
    if (COD_CONT_NC.has(cc)) nc += per;
    else if (COD_CONT_CUM.has(cc)) cum += per;
  }
  setCent(m200, 'VL_TOT_CONT_NC_PER', nc);
  setCent(m200, 'VL_TOT_CONT_CUM_PER', cum);
}

// ---------------------------------------------------------------- receitas não tributadas

function apurarReceitasNaoTributadas(ctx: ContextoMes, t: Tributo, f: Fontes): PendenciaNaturezaReceita[] {
  const { e, m001 } = ctx;
  const s = t.sfx;
  const porCst = new Map<string, OpReceita[]>();
  for (const op of f.receitas) {
    if (!(CST_NT.has(op.cst) || (op.cst === '05' && op.aliq === 0n))) continue;
    agrupar(porCst, op.cst, op);
  }
  const ncm = mapaNcm(e);
  const existentes = new Map<string, Registro>();
  for (const r of listar(e, t.M400)) {
    const k = get(r, `CST_${s}`);
    if (existentes.has(k)) removerRegistro(r);
    else existentes.set(k, r);
  }
  const pendencias: PendenciaNaturezaReceita[] = [];
  for (const [cst, ops] of [...porCst.entries()].sort()) {
    const total = ops.reduce((x, o) => x + o.receita, 0);
    if (total === 0) continue;
    let m400 = existentes.get(cst);
    existentes.delete(cst);
    if (!m400) {
      m400 = criar(t.M400, { [`CST_${s}`]: cst, VL_TOT_REC: '0', COD_CTA: ops.find((o) => o.codCta)?.codCta ?? '' });
      inserirOrdenado(m001, m400, (x) => (x.reg === t.M400 ? get(x, `CST_${s}`) : ''));
    }
    setCent(m400, 'VL_TOT_REC', total);
    const res = distribuirNatureza(ops, contextoNatureza(ctx, t, cst, ncm));
    pendencias.push(...res.pendencias);
    const atuais = new Map<string, Registro>();
    for (const r of filhosDe(m400, t.M410)) {
      const k = get(r, 'NAT_REC');
      if (atuais.has(k) || !res.linhas.get(k)) removerRegistro(r);
      else atuais.set(k, r);
    }
    for (const [nat, v] of [...res.linhas.entries()].sort()) {
      if (v === 0) continue;
      let r = atuais.get(nat);
      if (!r) {
        r = criar(t.M410, { NAT_REC: nat, VL_REC: '0', COD_CTA: get(m400, 'COD_CTA') });
        inserirOrdenado(m400, r, (x) => (x.reg === t.M410 ? get(x, 'NAT_REC') : ''));
      }
      setCent(r, 'VL_REC', v);
    }
  }
  for (const r of existentes.values()) removerRegistro(r);
  return pendencias;
}

function contextoNatureza(ctx: ContextoMes, t: Tributo, cst: string, ncm: Map<string, string>): ContextoNatureza {
  const { e, estado, config } = ctx;
  const mem = memoriaNaturezas(e.cnpj);
  const cfg = config.naturezasReceita?.[e.cnpj];
  const proprio = estado.tributos[t.id].naturezas[cst];
  const memAp = mem.aprendido[t.id]?.[cst];
  const cfgAp = cfg?.aprendido[t.id]?.[cst];
  const manual: Record<string, string> = { ...(cfg?.manual[cst] ?? {}), ...(mem.manual[cst] ?? {}) };
  const tipoManual = Object.keys(manual).map(tipoDaChave).find((x) => x);
  const tipo = proprio?.tipoChave ?? memAp?.tipoChave ?? cfgAp?.tipoChave ?? tipoManual ?? TIPO_CHAVE_PADRAO;
  const mapas = [proprio, memAp, cfgAp].filter((m): m is MapaNatureza => !!m && m.tipoChave === tipo);
  return {
    cst,
    tipoChave: tipo,
    buscar: (k) => manual[k] ?? mapas.find((m) => k in m.mapa)?.mapa[k],
    temMapa: mapas.length > 0 || Object.keys(manual).some((k) => tipoDaChave(k) === tipo),
    original: estado.tributos[t.id].naturezaOriginal[cst],
    ncm,
  };
}
