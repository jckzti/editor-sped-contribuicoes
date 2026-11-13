/**
 * Desconto dos créditos na contribuição do mês e controle de saldos (1100/1500).
 *
 * - Créditos disponíveis: os do próprio mês (M100 VL_CRED_DISP) e os de períodos anteriores
 *   (registros 1100 de PER_APU_CRED anterior, SD_CRED_DISP_EFD menos outras utilizações do mês).
 * - Desconta até zerar a contribuição não cumulativa (descontadas antes as retenções e
 *   outras deduções informadas no M200, que são dados de entrada), na ordem de
 *   `config.ordemUsoCredito`; dentro de cada grupo, do período mais antigo para o mais novo
 *   e na ordem do COD_CRED (101, 102..., 201..., 301...).
 * - Saldo credor do mês → 1100 do próprio período (PER_APU_CRED = mês, ORIG_CRED 01).
 * - "encadear": o saldo de cada 1100 passa para o mês seguinte carregado do mesmo CNPJ.
 */
import { filhosDe, get, listar, removerRegistro, type Aviso, type Escrituracao, type Registro } from '../modelo';
import type { ConfigApuracao } from './contrato';
import type { Tributo } from './tributos';
import { ratear } from '../dec';
import { aliqEsc, cent, criar, inserirOrdenado, perApu, perOrd, reais, setCent, setTexto } from './util';

/** Saldo de crédito de um período levado de um mês para o seguinte. */
export interface SaldoLevado {
  per: string; // MMAAAA
  orig: string;
  cnpjSuc: string;
  codCred: string;
  apu: number;
  ext: number;
  descPaAnt: number;
  perPaAnt: number;
  dcompPaAnt: number;
}

export interface Encadeamento {
  /** Saldos levados do mês anterior, por chave PER|ORIG|CNPJ_SUC|COD_CRED. */
  saldos: Map<string, SaldoLevado>;
  /** Chaves já vistas na cadeia (para distinguir crédito esgotado de crédito trazido de fora). */
  vistas: Set<string>;
  /** Primeiro período (AAAAMM) da cadeia. */
  primeiro: string;
}

const chave1100 = (per: string, orig: string, cnpjSuc: string, codCred: string) => `${per}|${orig}|${cnpjSuc}|${codCred}`;
/** Chave PER|ORIG|CNPJ_SUC|COD_CRED de um 1100/1500. */
export const chave1100Reg = (r: Registro): string => chaveReg(r);
const chaveReg = (r: Registro) => chave1100(get(r, 'PER_APU_CRED'), get(r, 'ORIG_CRED'), get(r, 'CNPJ_SUC'), get(r, 'COD_CRED'));
const ordem1100 = (r: Registro) => `${perOrd(get(r, 'PER_APU_CRED'))}|${get(r, 'COD_CRED')}|${get(r, 'ORIG_CRED')}|${get(r, 'CNPJ_SUC')}`;

interface Fonte {
  tipo: 'anterior' | 'mes';
  ordem: string;
  disponivel: number;
  usado: number;
  reg: Registro;
}

/**
 * Aplica o desconto de créditos e grava 1100/1500 de um tributo.
 * `cadeia` = null: os 1100 de períodos anteriores existentes são dados de entrada.
 * Devolve os saldos a levar para o mês seguinte.
 */
export function aplicarSaldo(
  e: Escrituracao,
  t: Tributo,
  config: ConfigApuracao,
  cadeia: Encadeamento | null,
  avisos: Aviso[],
  retencao: Record<string, { disponivel: number; descontado: number }> = {},
): Map<string, SaldoLevado> {
  const m001 = listar(e, 'M001')[0];
  const m200 = listar(e, t.M200)[0];
  const r1001 = garantir1001(e);
  const perAtual = perApu(e.periodo);
  const ordAtual = e.periodo;

  // ---- créditos de períodos anteriores (1100 com PER_APU_CRED < mês)
  const anteriores: Fonte[] = [];
  const existentes = filhosDe(r1001, t.R1100);
  const doMes: Registro[] = [];
  const usadasDaCadeia = new Set<string>();
  for (const r of existentes) {
    const per = get(r, 'PER_APU_CRED');
    const ord = perOrd(per);
    if (per === perAtual) {
      doMes.push(r);
      continue;
    }
    if (ord > ordAtual) {
      avisos.push({ nivel: 'alerta', codigo: 'SALDO_PERIODO_FUTURO', mensagem: `${t.R1100} com período ${per} posterior ao da escrituração; mantido como está.` });
      continue;
    }
    const k = chaveReg(r);
    if (cadeia) {
      const s = cadeia.saldos.get(k);
      if (s) {
        aplicarLevado(r, s);
        usadasDaCadeia.add(k);
      } else if (cadeia.vistas.has(k) || ord >= cadeia.primeiro) {
        // a cadeia diz que esse crédito se esgotou (ou nunca existiu) nos meses carregados
        removerRegistro(r);
        continue;
      }
    }
    anteriores.push({ tipo: 'anterior', ordem: ordem1100(r), disponivel: 0, usado: 0, reg: r });
  }
  if (cadeia) {
    for (const [k, s] of cadeia.saldos) {
      if (usadasDaCadeia.has(k)) continue;
      const r = criar(t.R1100, { PER_APU_CRED: s.per, ORIG_CRED: s.orig, CNPJ_SUC: s.cnpjSuc, COD_CRED: s.codCred });
      for (const c of ['VL_CRED_PER_EFD', 'VL_CRED_DCOMP_EFD', 'VL_CRED_TRANS', 'VL_CRED_OUT']) setCent(r, c, 0);
      aplicarLevado(r, s);
      inserirOrdenado(r1001, r, (x) => (x.reg === t.R1100 ? ordem1100(x) : ''));
      anteriores.push({ tipo: 'anterior', ordem: ordem1100(r), disponivel: 0, usado: 0, reg: r });
    }
  }
  for (const a of anteriores) {
    const r = a.reg;
    const tot = cent(r, 'VL_CRED_APU') + cent(r, 'VL_CRED_EXT_APU');
    const sd = tot - cent(r, 'VL_CRED_DESC_PA_ANT') - cent(r, 'VL_CRED_PER_PA_ANT') - cent(r, 'VL_CRED_DCOMP_PA_ANT');
    const outros = cent(r, 'VL_CRED_PER_EFD') + cent(r, 'VL_CRED_DCOMP_EFD') + cent(r, 'VL_CRED_TRANS') + cent(r, 'VL_CRED_OUT');
    a.disponivel = Math.max(0, sd - outros);
  }
  anteriores.sort((x, y) => (x.ordem < y.ordem ? -1 : x.ordem > y.ordem ? 1 : 0));

  // ---- créditos do mês (M100), na ordem do COD_CRED
  const m100s = m001 ? filhosDe(m001, t.M100) : [];
  const doMesFontes: Fonte[] = m100s
    .map((r) => {
      const disp = Math.max(0, cent(r, 'VL_CRED_DISP'));
      const ret = config.preservarRetencaoCredito ? retencao[get(r, 'COD_CRED')] : undefined;
      // mantém a mesma proporção descontada no original (o resto fica como saldo credor)
      const limite = ret && ret.disponivel > 0 ? Math.min(disp, ratear(disp, ret.descontado, ret.disponivel)) : disp;
      return {
        tipo: 'mes' as const,
        ordem: `${get(r, 'COD_CRED')}|${aliqEsc(get(r, `ALIQ_${t.sfx}`)).toString().padStart(14, '0')}`,
        disponivel: limite,
        usado: 0,
        reg: r,
      };
    })
    .sort((x, y) => (x.ordem < y.ordem ? -1 : x.ordem > y.ordem ? 1 : 0));

  // ---- desconto
  const nc = cent(m200, 'VL_TOT_CONT_NC_PER');
  const ret = cent(m200, 'VL_RET_NC');
  const outDed = cent(m200, 'VL_OUT_DED_NC');
  let alvo = Math.max(0, nc - ret - outDed);
  if (ret + outDed > nc) {
    avisos.push({
      nivel: 'alerta',
      codigo: 'RETENCAO_MAIOR_QUE_CONTRIBUICAO',
      mensagem: `${t.nome}: retenções/deduções do ${t.M200} (R$ ${reais(ret + outDed)}) maiores que a contribuição não cumulativa do mês (R$ ${reais(nc)}).`,
    });
  }
  const fila = filaDeUso(config.ordemUsoCredito, anteriores, doMesFontes);
  for (const fo of fila) {
    const u = Math.min(fo.disponivel, alvo);
    fo.usado = u;
    alvo -= u;
  }

  // ---- crédito que o original retinha de propósito e que agora passou a ser descontado
  if (!config.preservarRetencaoCredito) {
    for (const [cc, ret] of Object.entries(retencao)) {
      const usado = doMesFontes.filter((fo) => get(fo.reg, 'COD_CRED') === cc).reduce((x, fo) => x + fo.usado, 0);
      if (usado <= ret.descontado) continue;
      avisos.push({
        nivel: 'alerta',
        codigo: 'CREDITO_RETIDO',
        mensagem:
          `${t.nome}: no arquivo original o crédito ${cc} tinha R$ ${reais(ret.disponivel - ret.descontado)} guardados ` +
          `para períodos futuros (saldo credor), mesmo havendo contribuição a recolher — provavelmente para ressarcimento ou compensação. ` +
          `O sistema passou a descontar R$ ${reais(usado)} desse crédito (antes: R$ ${reais(ret.descontado)}). ` +
          `Se o crédito deve continuar guardado, ligue a opção de preservar a retenção de crédito.`,
      });
    }
  }

  // ---- M100 campos 13–15
  let descMes = 0;
  // Por COD_CRED, soma de TODOS os M100 do código (todas as alíquotas): o 1100/1500 do
  // próprio período informa o VL_CRED_DISP e o VL_CRED_DESC do M100 do mesmo COD_CRED
  // (guia, 1100 campos 06 e 09), não só das alíquotas que ficaram com saldo.
  const porCod = new Map<string, { disp: number; desc: number; saldo: number }>();
  for (const fo of doMesFontes) {
    const r = fo.reg;
    const disp = cent(r, 'VL_CRED_DISP');
    setCent(r, 'VL_CRED_DESC', fo.usado);
    setCent(r, 'SLD_CRED', disp - fo.usado);
    setTexto(r, 'IND_DESC_CRED', fo.usado === disp ? '0' : '1');
    descMes += fo.usado;
    const cc = get(r, 'COD_CRED');
    const s = porCod.get(cc) ?? { disp: 0, desc: 0, saldo: 0 };
    s.disp += disp;
    s.desc += fo.usado;
    s.saldo += Math.max(0, disp - fo.usado);
    porCod.set(cc, s);
  }
  const saldoMes = new Map([...porCod].filter(([, s]) => s.saldo > 0));

  // ---- 1100 de períodos anteriores: utilização
  let descAnt = 0;
  for (const a of anteriores) {
    const r = a.reg;
    const tot = cent(r, 'VL_CRED_APU') + cent(r, 'VL_CRED_EXT_APU');
    setCent(r, 'VL_TOT_CRED_APU', tot);
    const sd = tot - cent(r, 'VL_CRED_DESC_PA_ANT') - cent(r, 'VL_CRED_PER_PA_ANT') - cent(r, 'VL_CRED_DCOMP_PA_ANT');
    setCent(r, 'SD_CRED_DISP_EFD', sd);
    setCent(r, 'VL_CRED_DESC_EFD', a.usado);
    setCent(r, 'SLD_CRED_FIM', sd - a.usado - outrasUtilizacoes(r));
    descAnt += a.usado;
  }

  // ---- 1100 do próprio período (saldo credor do mês)
  const doMesPorChave = new Map<string, Registro>();
  for (const r of doMes) {
    if (get(r, 'ORIG_CRED') !== '01') continue; // crédito de sucessão: não é do motor
    const cc = get(r, 'COD_CRED');
    if (doMesPorChave.has(cc)) removerRegistro(r); // duplicado
    else doMesPorChave.set(cc, r);
  }
  for (const [cc, r] of doMesPorChave) if (!saldoMes.has(cc)) removerRegistro(r);
  for (const [cc, s] of saldoMes) {
    let r = doMesPorChave.get(cc);
    if (!r) {
      r = criar(t.R1100, { PER_APU_CRED: perAtual, ORIG_CRED: '01', CNPJ_SUC: '', COD_CRED: cc });
      for (const c of ['VL_CRED_EXT_APU', 'VL_CRED_PER_PA_ANT', 'VL_CRED_DCOMP_PA_ANT', 'VL_CRED_DESC_EFD', 'VL_CRED_PER_EFD', 'VL_CRED_DCOMP_EFD', 'VL_CRED_TRANS', 'VL_CRED_OUT'])
        setCent(r, c, 0);
      inserirOrdenado(r1001, r, (x) => (x.reg === t.R1100 ? ordem1100(x) : ''));
    }
    setCent(r, 'VL_CRED_APU', s.disp);
    setCent(r, 'VL_CRED_EXT_APU', 0);
    setCent(r, 'VL_TOT_CRED_APU', s.disp);
    // desconto no próprio período de apuração do crédito (guia, 1100 campo 09)
    setCent(r, 'VL_CRED_DESC_PA_ANT', s.desc);
    setCent(r, 'VL_CRED_PER_PA_ANT', 0);
    setCent(r, 'VL_CRED_DCOMP_PA_ANT', 0);
    const sd = s.disp - s.desc;
    setCent(r, 'SD_CRED_DISP_EFD', sd);
    setCent(r, 'VL_CRED_DESC_EFD', 0);
    setCent(r, 'SLD_CRED_FIM', sd - outrasUtilizacoes(r));
  }

  // ---- M200 e M205
  if (m200) {
    setCent(m200, 'VL_TOT_CRED_DESC', descMes);
    setCent(m200, 'VL_TOT_CRED_DESC_ANT', descAnt);
    const dev = nc - descMes - descAnt;
    setCent(m200, 'VL_TOT_CONT_NC_DEV', dev);
    const ncRec = dev - ret - outDed;
    setCent(m200, 'VL_CONT_NC_REC', ncRec);
    const cumRec = cent(m200, 'VL_TOT_CONT_CUM_PER') - cent(m200, 'VL_RET_CUM') - cent(m200, 'VL_OUT_DED_CUM');
    setCent(m200, 'VL_CONT_CUM_REC', cumRec);
    setCent(m200, 'VL_TOT_CONT_REC', ncRec + cumRec);
  }

  // ---- 1001
  setTexto(r1001, 'IND_MOV', r1001.filhos.length ? '0' : '1');

  // ---- saldos a levar
  const levar = new Map<string, SaldoLevado>();
  for (const r of filhosDe(r1001, t.R1100)) {
    if (cent(r, 'SLD_CRED_FIM') <= 0) continue;
    if (cent(r, 'VL_CRED_TRANS') || cent(r, 'VL_CRED_OUT')) {
      avisos.push({
        nivel: 'alerta',
        codigo: 'SALDO_TRANSF_OUTROS',
        mensagem: `${t.R1100} ${get(r, 'PER_APU_CRED')}/${get(r, 'COD_CRED')}: VL_CRED_TRANS/VL_CRED_OUT não têm campo próprio no mês seguinte; o saldo levado não os desconta. Confira.`,
      });
    }
    levar.set(chaveReg(r), {
      per: get(r, 'PER_APU_CRED'),
      orig: get(r, 'ORIG_CRED'),
      cnpjSuc: get(r, 'CNPJ_SUC'),
      codCred: get(r, 'COD_CRED'),
      apu: cent(r, 'VL_CRED_APU'),
      ext: cent(r, 'VL_CRED_EXT_APU'),
      descPaAnt: cent(r, 'VL_CRED_DESC_PA_ANT') + cent(r, 'VL_CRED_DESC_EFD'),
      perPaAnt: cent(r, 'VL_CRED_PER_PA_ANT') + cent(r, 'VL_CRED_PER_EFD'),
      dcompPaAnt: cent(r, 'VL_CRED_DCOMP_PA_ANT') + cent(r, 'VL_CRED_DCOMP_EFD'),
    });
  }
  return levar;
}

/**
 * Ordem de consumo das fontes de crédito:
 * - "anteriores-primeiro": 1100 de períodos anteriores (do mais antigo), depois os M100 do mês;
 * - "mes-primeiro": M100 do mês, depois os anteriores;
 * - "tributados-primeiro": créditos do grupo 100 (só descontáveis) de todos os períodos,
 *   do mais antigo ao mês, e só então os dos grupos 200/300 (ressarcíveis/compensáveis),
 *   também do mais antigo ao mês.
 */
function filaDeUso(ordem: ConfigApuracao['ordemUsoCredito'], anteriores: Fonte[], doMes: Fonte[]): Fonte[] {
  if (ordem === 'mes-primeiro') return [...doMes, ...anteriores];
  if (ordem === 'tributados-primeiro') {
    const grupo1 = (f: Fonte) => get(f.reg, 'COD_CRED').startsWith('1');
    return [...anteriores.filter(grupo1), ...doMes.filter(grupo1), ...anteriores.filter((f) => !grupo1(f)), ...doMes.filter((f) => !grupo1(f))];
  }
  return [...anteriores, ...doMes];
}

function outrasUtilizacoes(r: Registro): number {
  return cent(r, 'VL_CRED_PER_EFD') + cent(r, 'VL_CRED_DCOMP_EFD') + cent(r, 'VL_CRED_TRANS') + cent(r, 'VL_CRED_OUT');
}

function aplicarLevado(r: Registro, s: SaldoLevado): void {
  setCent(r, 'VL_CRED_APU', s.apu);
  setCent(r, 'VL_CRED_EXT_APU', s.ext);
  setCent(r, 'VL_CRED_DESC_PA_ANT', s.descPaAnt);
  setCent(r, 'VL_CRED_PER_PA_ANT', s.perPaAnt);
  setCent(r, 'VL_CRED_DCOMP_PA_ANT', s.dcompPaAnt);
}

/** Lê os saldos a levar de uma escrituração sem recalcular (mês recusado). */
export function saldosDoArquivo(e: Escrituracao, t: Tributo): Map<string, SaldoLevado> {
  const levar = new Map<string, SaldoLevado>();
  for (const r of listar(e, t.R1100)) {
    if (cent(r, 'SLD_CRED_FIM') <= 0) continue;
    levar.set(chaveReg(r), {
      per: get(r, 'PER_APU_CRED'),
      orig: get(r, 'ORIG_CRED'),
      cnpjSuc: get(r, 'CNPJ_SUC'),
      codCred: get(r, 'COD_CRED'),
      apu: cent(r, 'VL_CRED_APU'),
      ext: cent(r, 'VL_CRED_EXT_APU'),
      descPaAnt: cent(r, 'VL_CRED_DESC_PA_ANT') + cent(r, 'VL_CRED_DESC_EFD'),
      perPaAnt: cent(r, 'VL_CRED_PER_PA_ANT') + cent(r, 'VL_CRED_PER_EFD'),
      dcompPaAnt: cent(r, 'VL_CRED_DCOMP_PA_ANT') + cent(r, 'VL_CRED_DCOMP_EFD'),
    });
  }
  return levar;
}

/** Chaves 1100 presentes no arquivo (para marcar como vistas na cadeia). */
export function chaves1100(e: Escrituracao, t: Tributo): string[] {
  return listar(e, t.R1100).map(chaveReg);
}

function garantir1001(e: Escrituracao): Registro {
  let r = listar(e, '1001')[0];
  if (!r) {
    r = criar('1001', { IND_MOV: '1' });
    inserirOrdenado(e.raiz, r, () => '');
  }
  return r;
}

/** M205/M605: detalhamento por código de receita do valor a recolher. */
export function gravarM205(e: Escrituracao, t: Tributo, codRec: Record<string, string>, avisos: Aviso[]): void {
  const m200 = listar(e, t.M200)[0];
  if (!m200) return;
  const alvos: [string, number][] = [
    ['08', cent(m200, 'VL_CONT_NC_REC')],
    ['12', cent(m200, 'VL_CONT_CUM_REC')],
  ];
  for (const [campo, valor] of alvos) {
    const regs = filhosDe(m200, t.M205).filter((r) => get(r, 'NUM_CAMPO') === campo);
    if (valor <= 0) {
      for (const r of regs) removerRegistro(r);
      continue;
    }
    if (!regs.length) {
      const cod = codRec[campo] ?? (campo === '08' ? t.codRecNC : '');
      const r = criar(t.M205, { NUM_CAMPO: campo, COD_REC: cod, VL_DEBITO: '0' });
      setCent(r, 'VL_DEBITO', valor);
      inserirOrdenado(m200, r, (x) => (x.reg === t.M205 ? get(x, 'NUM_CAMPO') : ''));
      if (!cod) avisos.push({ nivel: 'alerta', codigo: 'M205_SEM_COD_REC', mensagem: `${t.M205} campo ${campo} criado sem código de receita; informe o COD_REC.` });
      continue;
    }
    const outros = regs.slice(1).reduce((s, r) => s + cent(r, 'VL_DEBITO'), 0);
    if (regs.length > 1 && valor - outros < 0) {
      avisos.push({ nivel: 'alerta', codigo: 'M205_VARIOS', mensagem: `${t.M205} campo ${campo} com vários códigos de receita; confira a divisão do valor a recolher.` });
    }
    setCent(regs[0], 'VL_DEBITO', valor - outros);
  }
}
