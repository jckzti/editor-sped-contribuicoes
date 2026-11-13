/**
 * Motor de apuração: recalcula o bloco M (PIS/COFINS) e o bloco 1 (saldo de créditos)
 * a partir dos documentos dos blocos A/C/D/F.
 *
 * Perfil suportado: regime exclusivamente não cumulativo (0110 COD_INC_TRIB = 1), rateio
 * proporcional (0111) ou apropriação direta sem créditos comuns. Fontes: C170, C501/C505,
 * D101/D105, D501/D505, F100, F120, F130 e A170. Fora disso o recálculo é recusado
 * (`recalculada: false`) e o bloco M fica como veio. Ver `perfil.ts`.
 */
import cfopCredito from '../cfopCredito.json';
import { centavos } from '../dec';
import { filhosDe, get, listar, type Aviso, type Escrituracao } from '../modelo';
import { apurarTributo, type ContextoMes } from './apurar';
import type { ConfigApuracao, PendenciaNaturezaReceita, RegraEstorno, ResultadoApuracao, ResumoApuracao } from './contrato';
import { CRITERIOS, criteriosDe, criteriosExigidos } from './criterios';
import { estadoDe, guardarEstado, type EstadoApuracao, type EstadoTributo, type FatosSaldoOriginal } from './estado';
import { aprenderEstornos } from './estornos';
import { CST_RECEITA, extrairFontes, receitaPorTipo, type Fontes } from './fontes';
import {
  aprenderNatureza,
  mapaNcm,
  memoriaNaturezas,
  mesclarNaturezas,
  type NaturezasCnpj,
} from './natureza';
import { consolidarChaveRepetida, recusasChaveRepetida } from './duplicados';
import { verificarFontes, verificarPerfil } from './perfil';
import { aprenderPresumido, tipoPresumidoDe } from './presumido';
import { cstComum, gruposDoCst, type Receitas0111 } from './rateio';
import { lerResumo } from './resumo';
import { aplicarSaldo, chave1100Reg, chaves1100, gravarM205, saldosDoArquivo, type Encadeamento, type SaldoLevado } from './saldo';
import { COFINS, PIS, TRIBUTOS, type IdTributo } from './tributos';
import { agrupar, cent, criar, inserirOrdenado, perOrd, proximoPeriodo, reais, setCent, setTexto } from './util';

export * from './contrato';
export * from './criterios';
export type { NaturezasCnpj, MapaNatureza, TipoChave } from './natureza';

/** Configuração padrão (tabela oficial de CFOP geradores de crédito, sem estornos aprendidos). */
export function configPadrao(): ConfigApuracao {
  const cfopNatBc: Record<string, string> = {};
  for (const [nat, cfops] of Object.entries((cfopCredito as { porCodigo: Record<string, string[]> }).porCodigo)) {
    for (const c of cfops) cfopNatBc[c] = nat;
  }
  // Sem critérios (saldoCredor, ordemUsoCredito, receitaBruta0111, preservarRetencaoCredito):
  // não há padrão, são escolha explícita (ver `criterios.ts`).
  return { cfopNatBc, estornos: [] };
}

const CST_NT = new Set(['04', '05', '06', '07', '08', '09']);

/**
 * Chamar uma vez logo após ler o arquivo, antes de qualquer edição: guarda o resumo
 * da apuração original e "aprende" o que só o arquivo original sabe (estornos ligados
 * a notas, natureza da receita por item, ajustes manuais).
 */
export function registrarOriginal(e: Escrituracao): void {
  const cfg = configPadrao();
  const ncm = mapaNcm(e);
  const tributos = {} as Record<IdTributo, EstadoTributo>;
  const aprendido: NaturezasCnpj = { aprendido: {}, manual: {} };
  for (const t of TRIBUTOS) {
    const f = extrairFontes(e, t, cfg.cfopNatBc);
    const ap = aprenderEstornos(e, t, f.estornos);
    const codRec: Record<string, string> = {};
    for (const m205 of listar(e, t.M205)) codRec[get(m205, 'NUM_CAMPO')] ??= get(m205, 'COD_REC');
    const est: EstadoTributo = {
      docsVinculados: ap.vinculados,
      vinculadosCurto: ap.vinculadosCurto,
      ambiguos: ap.ambiguos,
      docsSemEstorno: ap.semEstorno,
      regras: ap.regras,
      codRec,
      naturezas: {},
      naturezaOriginal: {},
      naturezaAmbigua: [],
      tipoPresumido: '07',
      presumido: aprenderPresumido(e, t),
      retencaoOriginal: {},
    };
    const m200 = listar(e, t.M200)[0];
    if (m200 && cent(m200, 'VL_CONT_NC_REC') > 0) {
      for (const m100 of listar(e, t.M100)) {
        if (cent(m100, 'SLD_CRED') <= 0) continue;
        const cc = get(m100, 'COD_CRED');
        const r = (est.retencaoOriginal[cc] ??= { disponivel: 0, descontado: 0 });
        r.disponivel += cent(m100, 'VL_CRED_DISP');
        r.descontado += cent(m100, 'VL_CRED_DESC');
      }
    }
    for (const m400 of listar(e, t.M400)) {
      const cst = get(m400, `CST_${t.sfx}`);
      const alvos: [string, number][] = filhosDe(m400, t.M410).map((r) => [get(r, 'NAT_REC'), cent(r, 'VL_REC')]);
      if (!alvos.length) continue;
      est.naturezaOriginal[cst] = { totais: alvos, total: alvos.reduce((s, [, v]) => s + v, 0) };
      const ops = f.receitas.filter((o) => o.cst === cst);
      const info: { ambigua?: boolean } = {};
      const m = aprenderNatureza(ops, alvos, ncm, info);
      if (m) {
        est.naturezas[cst] = m;
        (aprendido.aprendido[t.id] ??= {})[cst] = m;
      } else if (info.ambigua) est.naturezaAmbigua.push(cst);
    }
    const tipos = listar(e, t.M100).map((r) => get(r, 'COD_CRED').slice(1));
    if (tipos.includes('06') && !tipos.includes('07')) est.tipoPresumido = '06';
    tributos[t.id] = est;
  }
  const r0111 = listar(e, '0111')[0];
  const estado: EstadoApuracao = {
    fatosSaldo: fatosSaldoOriginal(e),
    resumoOriginal: lerResumo(e),
    tributos,
    receitaOriginal: receitaPorTipo(e),
    original0111: r0111
      ? [
          cent(r0111, 'REC_BRU_NCUM_TRIB_MI'),
          cent(r0111, 'REC_BRU_NCUM_NT_MI'),
          cent(r0111, 'REC_BRU_NCUM_EXP'),
          cent(r0111, 'REC_BRU_CUM'),
          cent(r0111, 'REC_BRU_TOTAL'),
        ]
      : null,
    pendencias: [],
  };
  guardarEstado(e, estado);
  mesclarNaturezas(memoriaNaturezas(e.cnpj), aprendido);
}

/**
 * Acrescenta à configuração os padrões aprendidos dos arquivos carregados: regras de
 * estorno de cada CNPJ (em `estornos`, com `cnpj`) e natureza da receita por CNPJ.
 * Não preenche critérios (`IdCriterio`): eles são escolha explícita; o que os originais
 * mostram sobre eles vem em `indiciosCriterios`.
 */
export function aprenderConfig(escrituracoes: Escrituracao[], base?: ConfigApuracao): ConfigApuracao {
  const cfg: ConfigApuracao = base
    ? { ...base, cfopNatBc: { ...base.cfopNatBc }, estornos: [...base.estornos] }
    : configPadrao();
  const carregados = new Set(escrituracoes.map((e) => e.cnpj));
  // regras aprendidas de CNPJs carregados são refeitas; as manuais (sem CNPJ) e as de CNPJs fora da sessão ficam
  cfg.estornos = cfg.estornos.filter((r) => !r.cnpj || !carregados.has(r.cnpj));
  const votos = new Map<string, Map<string, Map<string, { regra: RegraEstorno; n: number }>>>();
  const naturezas: Record<string, NaturezasCnpj> = {};
  for (const [cnpj, n] of Object.entries(base?.naturezasReceita ?? {})) {
    naturezas[cnpj] = { aprendido: {}, manual: {} };
    mesclarNaturezas(naturezas[cnpj], n);
  }
  for (const e of escrituracoes) {
    if (!estadoDe(e)) registrarOriginal(e);
    const est = estadoDe(e)!;
    // As regras do PIS e da Cofins são as mesmas (mesmas notas); usa as do PIS e completa com as da Cofins.
    const porCfop = votos.get(e.cnpj) ?? new Map<string, Map<string, { regra: RegraEstorno; n: number }>>();
    votos.set(e.cnpj, porCfop);
    for (const r0 of [...est.tributos.pis.regras, ...est.tributos.cofins.regras]) {
      const r: RegraEstorno = { ...r0, cnpj: e.cnpj };
      const m = porCfop.get(r.cfop) ?? new Map();
      const id = JSON.stringify(r);
      const v = m.get(id) ?? { regra: r, n: 0 };
      v.n++;
      m.set(id, v);
      porCfop.set(r.cfop, m);
    }
    const n = (naturezas[e.cnpj] ??= { aprendido: {}, manual: {} });
    mesclarNaturezas(n, memoriaNaturezas(e.cnpj));
  }
  for (const porCfop of votos.values()) {
    for (const m of porCfop.values()) cfg.estornos.push([...m.values()].sort((a, b) => b.n - a.n)[0].regra);
  }
  cfg.naturezasReceita = naturezas;
  return cfg;
}

/**
 * Fatos do arquivo original sobre saldo credor: 1100/1500 de períodos anteriores e do próprio
 * período, e a ordem em que o original consumiu os créditos (usou crédito antigo enquanto
 * sobrava do mês = "anteriores-primeiro"; o contrário = "mes-primeiro").
 */
function fatosSaldoOriginal(e: Escrituracao): FatosSaldoOriginal {
  const f: FatosSaldoOriginal = { anteriores: [], proprios: [], ordem: [] };
  const per = `${e.periodo.slice(4, 6)}${e.periodo.slice(0, 4)}`;
  for (const t of TRIBUTOS) {
    const todos = listar(e, t.R1100);
    const anteriores = todos.filter((r) => perOrd(get(r, 'PER_APU_CRED')) < e.periodo);
    for (const r of anteriores) {
      f.anteriores.push({ tributo: t.nome, per: get(r, 'PER_APU_CRED'), codCred: get(r, 'COD_CRED'), usado: cent(r, 'VL_CRED_DESC_EFD'), sobra: cent(r, 'SLD_CRED_FIM') });
    }
    for (const r of todos) {
      if (get(r, 'PER_APU_CRED') === per && cent(r, 'SLD_CRED_FIM') > 0) f.proprios.push({ tributo: t.nome, codCred: get(r, 'COD_CRED'), saldo: cent(r, 'SLD_CRED_FIM') });
    }
    if (!anteriores.length) continue;
    const usadoAnt = anteriores.reduce((s, r) => s + cent(r, 'VL_CRED_DESC_EFD'), 0);
    const sobraAnt = anteriores.reduce((s, r) => s + cent(r, 'SLD_CRED_FIM'), 0);
    const m100 = listar(e, t.M100);
    const usadoMes = m100.reduce((s, r) => s + cent(r, 'VL_CRED_DESC'), 0);
    const sobraMes = m100.reduce((s, r) => s + cent(r, 'SLD_CRED'), 0);
    if (usadoAnt > 0 && sobraMes > 0) f.ordem.push({ tributo: t.nome, voto: 'anteriores-primeiro' });
    else if (usadoMes > 0 && sobraAnt > 0) f.ordem.push({ tributo: t.nome, voto: 'mes-primeiro' });
  }
  return f;
}

/**
 * Atribui manualmente a natureza da receita (NAT_REC do M410/M810) a uma chave de
 * pendência (`PendenciaNaturezaReceita.chave`), para o CST informado. Vale para PIS e
 * Cofins e para todos os meses carregados do mesmo CNPJ. Recalcule depois.
 */
export function definirNaturezaReceita(e: Escrituracao, cst: string, chave: string, natRec: string): void {
  const m = memoriaNaturezas(e.cnpj);
  (m.manual[cst] ??= {})[chave] = natRec;
}

interface ResultadoInterno {
  res: ResultadoApuracao;
  levar: Record<IdTributo, Map<string, SaldoLevado>>;
}

/**
 * Recalcula o bloco M de cada escrituração e, conforme a configuração, o bloco 1
 * (1100/1500) encadeando o saldo credor entre meses do mesmo CNPJ, em ordem de período.
 * Altera as árvores recebidas. Não mexe em contadores (x990/9900): isso é do orquestrador.
 */
export function recalcularApuracao(escrituracoes: Escrituracao[], config: ConfigApuracao): ResultadoApuracao[] {
  const resultados = new Map<Escrituracao, ResultadoApuracao>();
  const porCnpj = new Map<string, Escrituracao[]>();
  for (const e of escrituracoes) agrupar(porCnpj, e.cnpj, e);
  for (const [cnpj, lista] of porCnpj) {
    const ordenada = [...lista].sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0));
    const semOriginal = new Set(ordenada.filter((e) => !estadoDe(e)));
    for (const e of semOriginal) registrarOriginal(e);
    // critérios (sem padrão): os da sessão sobrepostos pelos da empresa; pendente = não recalcula
    const escolhas = criteriosDe(config, cnpj);
    const faltam = criteriosExigidos(ordenada).filter((id) => escolhas[id] === undefined);
    if (faltam.length) {
      const nomes = faltam.map((id) => CRITERIOS.find((c) => c.id === id)!.pergunta);
      for (const e of ordenada) {
        resultados.set(e, {
          escrituracaoId: e.id,
          recalculada: false,
          avisos: [
            {
              nivel: 'erro',
              codigo: 'CRITERIOS_PENDENTES',
              mensagem:
                `Apuração não recalculada: falta escolher ${faltam.length === 1 ? 'o critério' : `${faltam.length} critérios`} da apuração para ${e.nome || 'a empresa'} (CNPJ ${cnpj}) — ` +
                `${faltam.join(', ')}: ${nomes.join(' / ')} Não há padrão: escolha na tela de critérios e recalcule. O bloco M ficou como estava.`,
            },
          ],
          resumo: lerResumo(e),
        });
      }
      continue;
    }
    const cfgEmpresa: ConfigApuracao = { ...config, ...escolhas };
    const cadeias: Record<IdTributo, Encadeamento | null> = { pis: null, cofins: null };
    /** Meses já recalculados deste CNPJ (período AAAAMM → saldos que levam ao mês seguinte). */
    const feitos = new Map<string, { e: Escrituracao; levar: Record<IdTributo, Map<string, SaldoLevado>> }>();
    let anterior: Escrituracao | null = null;
    for (const e of ordenada) {
      const avisosCadeia: Aviso[] = [];
      const encadear = cfgEmpresa.saldoCredor === 'encadear' && anterior !== null;
      if (encadear && anterior) {
        if (anterior.periodo === e.periodo) {
          avisosCadeia.push({
            nivel: 'alerta',
            codigo: 'PERIODO_REPETIDO',
            mensagem: `Há mais de uma escrituração do período ${e.periodo} para o CNPJ ${e.cnpj}; o saldo credor foi encadeado na ordem de carga. Confira.`,
          });
        } else if (proximoPeriodo(anterior.periodo) !== e.periodo) {
          avisosCadeia.push({
            nivel: 'alerta',
            codigo: 'LACUNA_DE_MESES',
            mensagem: `Saldo credor encadeado de ${anterior.periodo} para ${e.periodo}, com meses faltando entre eles (não carregados).`,
          });
        }
      }
      const r = recalcularUma(e, cfgEmpresa, encadear ? cadeias : { pis: null, cofins: null });
      r.res.avisos.unshift(...avisosCadeia);
      if (semOriginal.has(e)) {
        r.res.avisos.unshift({
          nivel: 'alerta',
          codigo: 'APURACAO_SEM_ORIGINAL',
          mensagem: 'registrarOriginal não foi chamado logo após a leitura; o aprendizado (estornos, natureza da receita) foi feito sobre o estado atual do arquivo.',
        });
      }
      if (cfgEmpresa.saldoCredor !== 'encadear') r.res.avisos.push(...conferirSaldoTrazido(e, feitos));
      resultados.set(e, r.res);
      if (!feitos.has(e.periodo)) feitos.set(e.periodo, { e, levar: r.levar });
      if (cfgEmpresa.saldoCredor === 'encadear') {
        for (const t of TRIBUTOS) {
          const c = cadeias[t.id];
          const vistas = new Set(c?.vistas ?? []);
          for (const k of chaves1100(e, t)) vistas.add(k);
          for (const k of r.levar[t.id].keys()) vistas.add(k);
          cadeias[t.id] = { saldos: r.levar[t.id], vistas, primeiro: c?.primeiro ?? e.periodo };
        }
      }
      anterior = e;
    }
  }
  return escrituracoes.map((e) => resultados.get(e)!);
}

/** Saldo disponível descrito por um 1100 (campos 08 − 09 − 10 − 11). */
function disponivelLevado(s: SaldoLevado): number {
  return s.apu + s.ext - s.descPaAnt - s.perPaAnt - s.dcompPaAnt;
}

/**
 * Modo "somente-mes": os 1100/1500 de períodos anteriores são dados de entrada e não são
 * revistos. Se o período de origem (ou o mês imediatamente anterior) também está carregado
 * e foi recalculado, confere o que o mês traz com o que o recálculo daquele mês deixou:
 * divergência = o mês está descontando crédito que não existe mais (ou deixando de usar o
 * que existe). Erro com os valores e a orientação de encadear.
 */
function conferirSaldoTrazido(e: Escrituracao, feitos: Map<string, { e: Escrituracao; levar: Record<IdTributo, Map<string, SaldoLevado>> }>): Aviso[] {
  const avisos: Aviso[] = [];
  const anteriorImediato = [...feitos.keys()].find((p) => proximoPeriodo(p) === e.periodo);
  const orientacao =
    'Com a opção "registrar só no mês", o editor não corrige o saldo trazido de meses anteriores. Use a opção de levar o saldo credor para os meses seguintes (encadear) e recalcule.';
  for (const t of TRIBUTOS) {
    const levarAnt = anteriorImediato ? feitos.get(anteriorImediato)!.levar[t.id] : null;
    const vistos = new Set<string>();
    for (const r of listar(e, t.R1100)) {
      const per = get(r, 'PER_APU_CRED');
      const ord = perOrd(per);
      if (ord >= e.periodo) continue;
      const k = chave1100Reg(r);
      vistos.add(k);
      const origem = feitos.get(ord);
      if (!origem && !levarAnt) continue; // nada carregado para conferir
      const cc = get(r, 'COD_CRED');
      const rotulo = `${t.R1100} do período ${per.slice(0, 2)}/${per.slice(2)} (crédito ${cc})`;
      if (levarAnt) {
        // o mês imediatamente anterior foi recalculado: o que ele deixa é o que este mês pode usar
        const s = levarAnt.get(k);
        const esperado = s ? disponivelLevado(s) : 0;
        const atual = cent(r, 'VL_CRED_APU') + cent(r, 'VL_CRED_EXT_APU') - cent(r, 'VL_CRED_DESC_PA_ANT') - cent(r, 'VL_CRED_PER_PA_ANT') - cent(r, 'VL_CRED_DCOMP_PA_ANT');
        if (atual !== esperado) {
          avisos.push({
            nivel: 'erro',
            codigo: 'SALDO_CREDOR_DIVERGENTE',
            mensagem:
              `${t.nome}: o ${rotulo} traz R$ ${reais(atual)} de crédito disponível, mas pelo mês ${periodoLegivel(anteriorImediato!)} recalculado ` +
              `sobram R$ ${reais(esperado)}. Este mês está ${atual > esperado ? `descontando até R$ ${reais(atual - esperado)} de crédito que não existe` : `deixando de usar R$ ${reais(esperado - atual)} de crédito que existe`}. ${orientacao}`,
          });
        }
        continue;
      }
      // só o período de origem está carregado (sem o mês imediatamente anterior): confere o campo 06
      const proprio = listar(origem!.e, t.R1100).find((x) => chave1100Reg(x) === k);
      const apuEsperado = proprio ? cent(proprio, 'VL_CRED_APU') : 0;
      const apu = cent(r, 'VL_CRED_APU');
      if (apu !== apuEsperado) {
        avisos.push({
          nivel: 'erro',
          codigo: 'SALDO_CREDOR_DIVERGENTE',
          mensagem:
            `${t.nome}: o ${rotulo} informa crédito apurado (VL_CRED_APU) de R$ ${reais(apu)}, mas o mês ${periodoLegivel(ord)} recalculado ` +
            `tem R$ ${reais(apuEsperado)} de saldo credor desse crédito. ${orientacao}`,
        });
      }
    }
    if (levarAnt) {
      for (const [k, s] of levarAnt) {
        if (vistos.has(k) || disponivelLevado(s) <= 0) continue;
        avisos.push({
          nivel: 'alerta',
          codigo: 'SALDO_CREDOR_NAO_LEVADO',
          mensagem:
            `${t.nome}: o mês ${periodoLegivel(anteriorImediato!)} recalculado termina com R$ ${reais(disponivelLevado(s))} de saldo do crédito ${s.codCred} ` +
            `(período ${s.per.slice(0, 2)}/${s.per.slice(2)}), que este mês não traz no ${t.R1100}. ${orientacao}`,
        });
      }
    }
  }
  return avisos;
}

function periodoLegivel(aaaamm: string): string {
  return `${aaaamm.slice(4, 6)}/${aaaamm.slice(0, 4)}`;
}

/** Valores do 0111 (TRIB, NT, EXP, TOTAL) que o recálculo vai gravar, e avisos sobre ele. */
function planejar0111(e: Escrituracao, config: ConfigApuracao, estado: EstadoApuracao): { novos: [number, number, number, number] | null; avisos: Aviso[] } {
  const r0111 = listar(e, '0111')[0];
  const avisos: Aviso[] = [];
  if (!r0111 || !estado.original0111) return { novos: null, avisos };
  const o = estado.original0111;
  const atual = receitaPorTipo(e);
  const d = [atual.trib - estado.receitaOriginal.trib, atual.nt - estado.receitaOriginal.nt, atual.exp - estado.receitaOriginal.exp];
  const ajustado: [number, number, number, number] = [o[0] + d[0], o[1] + d[1], o[2] + d[2], o[4] + d[0] + d[1] + d[2]];
  const nomes = ['tributada no mercado interno', 'não tributada no mercado interno', 'de exportação'];
  if (config.receitaBruta0111 === 'ajustar-pelo-delta') {
    const mudou = [0, 1, 2].filter((i) => ajustado[i] !== o[i]);
    if (mudou.length) {
      avisos.push({
        nivel: 'alerta',
        codigo: '0111_AJUSTADO',
        mensagem:
          `Receita bruta do 0111 ajustada pela variação da receita dos documentos editados (base do rateio dos créditos comuns): ` +
          mudou.map((i) => `${nomes[i]} R$ ${reais(o[i])} → R$ ${reais(ajustado[i])}`).join('; ') +
          `; total R$ ${reais(o[4])} → R$ ${reais(ajustado[3])}. Confira se a receita bruta do mês é essa.`,
      });
    }
    return { novos: ajustado, avisos };
  }
  // "manter": avisa se a receita por tipo mudou e o 0111 continua com a proporção antiga
  const noArquivo = [cent(r0111, 'REC_BRU_NCUM_TRIB_MI'), cent(r0111, 'REC_BRU_NCUM_NT_MI'), cent(r0111, 'REC_BRU_NCUM_EXP')];
  const mudouReceita = d.some((x) => x !== 0);
  const acompanhou = [0, 1, 2].every((i) => noArquivo[i] === ajustado[i]);
  if (mudouReceita && !acompanhou) {
    avisos.push({
      nivel: 'alerta',
      codigo: '0111_DESATUALIZADO',
      mensagem:
        `ATENÇÃO: a receita por tipo dos documentos mudou (` +
        [0, 1, 2].filter((i) => d[i] !== 0).map((i) => `${nomes[i]} ${d[i] > 0 ? '+' : '−'}R$ ${reais(Math.abs(d[i]))}`).join('; ') +
        `), mas o 0111 foi mantido como estava. O rateio dos créditos comuns (CST 53–56/63–66) entre 101/201/301 está usando a proporção ANTIGA ` +
        `e o 0111 declarado não corresponde aos documentos. Pela variação, seria: ` +
        [0, 1, 2].map((i) => `${nomes[i]} R$ ${reais(ajustado[i])}`).join('; ') +
        `. Use a opção "ajustar pela variação da receita editada" ou corrija o 0111.`,
    });
  }
  return { novos: null, avisos };
}

/**
 * Recusas que dependem do mês (com a receita do 0111 que será usada): crédito comum sem
 * receita para ratear e crédito presumido cujo tipo (06/07) o original não permite decidir.
 */
function recusasDoMes(e: Escrituracao, estado: EstadoApuracao, fontes: Record<IdTributo, Fontes>, rec: Receitas0111): Aviso[] {
  const erros: Aviso[] = [];
  for (const t of TRIBUTOS) {
    erros.push(...recusasChaveRepetida(e, t));
    const est = estado.tributos[t.id];
    const basePorCst = new Map<string, number>();
    const presumidoSemTipo = new Map<string, number>();
    for (const op of fontes[t.id].creditos) {
      basePorCst.set(op.cst, (basePorCst.get(op.cst) ?? 0) + op.base);
      if (!op.importacao && Number(op.cst) >= 60 && !tipoPresumidoDe(est.presumido, op)) {
        const k = `alíquota ${fmtAliqTexto(op.aliq)}% / NAT_BC_CRED ${op.natBc} / CST ${op.cst}`;
        presumidoSemTipo.set(k, (presumidoSemTipo.get(k) ?? 0) + op.base);
      }
    }
    for (const [cst, base] of basePorCst) {
      if (!cstComum(cst) || base === 0) continue;
      const denom = gruposDoCst(cst).reduce((s, g) => s + rec[g], 0);
      if (denom > 0) continue;
      erros.push({
        nivel: 'erro',
        codigo: 'APURACAO_RATEIO_SEM_RECEITA',
        mensagem:
          `Apuração não recalculada (${t.nome}): há crédito CST ${cst} (base R$ ${reais(base)}), comum a mais de um tipo de receita, ` +
          `mas o 0111 não tem receita nos tipos a que ele se vincula. O guia não diz como apropriar esse crédito; o editor não descarta nem escolhe sozinho. ` +
          `Confira o 0111 ou o CST dos documentos.`,
      });
    }
    if (presumidoSemTipo.size) {
      erros.push({
        nivel: 'erro',
        codigo: 'APURACAO_PRESUMIDO_AMBIGUO',
        mensagem:
          `Apuração não recalculada (${t.nome}): o arquivo original tem crédito presumido da agroindústria (x06) e de outras hipóteses (x07), ` +
          `e não dá para saber de qual tipo é o crédito presumido de ${[...presumidoSemTipo.keys()].join('; ')}. ` +
          `O editor não escolhe o tipo sozinho (as regras de ressarcimento e compensação são diferentes).`,
      });
    }
  }
  return erros;
}

function fmtAliqTexto(a: bigint): string {
  const s = a.toString().padStart(5, '0');
  const i = s.slice(0, -4).replace(/^0+(?=.)/, '');
  const f = s.slice(-4).replace(/0+$/, '');
  return f ? `${i},${f}` : i;
}

function recalcularUma(
  e: Escrituracao,
  config: ConfigApuracao,
  cadeias: Record<IdTributo, Encadeamento | null>,
): ResultadoInterno {
  const avisos: Aviso[] = [];
  if (!estadoDe(e)) {
    registrarOriginal(e);
    avisos.push({
      nivel: 'alerta',
      codigo: 'APURACAO_SEM_ORIGINAL',
      mensagem: 'registrarOriginal não foi chamado logo após a leitura; o aprendizado (estornos, natureza da receita) foi feito sobre o estado atual do arquivo.',
    });
  }
  const estado = estadoDe(e)!;

  const erros = verificarPerfil(e);
  const fontes = {} as Record<IdTributo, Fontes>;
  if (!erros.length) {
    for (const t of TRIBUTOS) {
      fontes[t.id] = extrairFontes(e, t, config.cfopNatBc);
      erros.push(...verificarFontes(e, t, fontes[t.id]));
    }
  }

  // 0111: receita bruta (base do rateio) — planejado antes, gravado só se o mês for recalculado
  const r0111 = listar(e, '0111')[0];
  const plano0111 = erros.length ? { novos: null, avisos: [] } : planejar0111(e, config, estado);
  const rec: Receitas0111 = plano0111.novos
    ? { 1: plano0111.novos[0], 2: plano0111.novos[1], 3: plano0111.novos[2] }
    : r0111
      ? { 1: cent(r0111, 'REC_BRU_NCUM_TRIB_MI'), 2: cent(r0111, 'REC_BRU_NCUM_NT_MI'), 3: cent(r0111, 'REC_BRU_NCUM_EXP') }
      : { 1: 0, 2: 0, 3: 0 };
  if (!erros.length) erros.push(...recusasDoMes(e, estado, fontes, rec));

  if (erros.length) {
    const vistos = new Set<string>();
    const unicos = erros.filter((a) => (vistos.has(a.mensagem) ? false : (vistos.add(a.mensagem), true)));
    return {
      res: { escrituracaoId: e.id, recalculada: false, avisos: [...avisos, ...unicos], resumo: lerResumo(e) },
      levar: { pis: saldosDoArquivo(e, PIS), cofins: saldosDoArquivo(e, COFINS) },
    };
  }

  if (r0111 && plano0111.novos) {
    setCent(r0111, 'REC_BRU_NCUM_TRIB_MI', plano0111.novos[0]);
    setCent(r0111, 'REC_BRU_NCUM_NT_MI', plano0111.novos[1]);
    setCent(r0111, 'REC_BRU_NCUM_EXP', plano0111.novos[2]);
    setCent(r0111, 'REC_BRU_TOTAL', plano0111.novos[3]);
  }
  avisos.push(...plano0111.avisos);

  let m001 = listar(e, 'M001')[0];
  if (!m001) {
    m001 = criar('M001', { IND_MOV: '1' });
    inserirOrdenado(e.raiz, m001, () => '');
  }
  // chave repetida que o leiaute não admite (M210, M100, M105, M400, M410): consolida antes de apurar
  for (const t of TRIBUTOS) consolidarChaveRepetida(e, t, avisos);
  const ctx: ContextoMes = { e, config, estado, avisos, rec, m001, estornosAusentes: new Map(), estornosAmbiguos: new Map() };
  const pendencias: PendenciaNaturezaReceita[] = [];
  for (const t of TRIBUTOS) {
    const p = apurarTributo(ctx, t, fontes[t.id]);
    if (t === PIS) pendencias.push(...p);
    else for (const x of p) if (!pendencias.some((y) => y.cst === x.cst && y.chave === x.chave)) pendencias.push(x);
  }
  const levar = {} as Record<IdTributo, Map<string, SaldoLevado>>;
  for (const t of TRIBUTOS) {
    levar[t.id] = aplicarSaldo(e, t, config, cadeias[t.id], avisos, estado.tributos[t.id].retencaoOriginal);
    gravarM205(e, t, estado.tributos[t.id].codRec, avisos);
  }
  avisarEstornosAusentes(ctx);
  avisarEstornosAmbiguos(ctx);
  setTexto(m001, 'IND_MOV', m001.filhos.length ? '0' : '1');

  estado.pendencias = pendencias;
  if (pendencias.length) {
    avisos.push({
      nivel: 'alerta',
      codigo: 'NATUREZA_RECEITA_PENDENTE',
      mensagem: `${pendencias.length} grupo(s) de receita não tributada sem natureza da receita (M410/M810) conhecida; lançados em natureza provisória. Atribua a natureza na tela de pendências.`,
    });
  }
  const ambiguas = [...new Set(TRIBUTOS.flatMap((t) => estado.tributos[t.id].naturezaAmbigua))].sort();
  if (ambiguas.length) {
    avisos.push({
      nivel: 'info',
      codigo: 'NATUREZA_RECEITA_AMBIGUA',
      mensagem:
        `CST ${ambiguas.join(', ')}: a divisão por natureza da receita (M410/M810) do arquivo original pode ser explicada pelos itens de mais de um jeito; ` +
        `o editor não aprendeu uma regra (não adivinha). Enquanto a receita desses CST não mudar, a divisão original é mantida; se mudar, a diferença vira pendência.`,
    });
  }
  avisos.push(...avisosNaoConferidos(e, fontes));
  return { res: { escrituracaoId: e.id, recalculada: true, avisos, resumo: lerResumo(e) }, levar };
}

/**
 * Aviso consolidado das notas que, pela regra de estorno aprendida do próprio arquivo,
 * teriam ajuste de crédito e no original não têm. O motor mantém sem ajuste (não inventa
 * dado que o arquivo não tem); quem confere decide.
 */
function avisarEstornosAusentes(ctx: ContextoMes): void {
  if (!ctx.estornosAusentes.size) return;
  const notas = [...ctx.estornosAusentes.values()].sort((a, b) => (a.numDoc < b.numDoc ? -1 : a.numDoc > b.numDoc ? 1 : 0));
  const porCfop = new Map<string, number>();
  for (const n of notas) porCfop.set(n.cfop, (porCfop.get(n.cfop) ?? 0) + 1);
  const quais = [...porCfop.entries()]
    .sort()
    .map(([cfop, n]) => `${n} ${n === 1 ? 'nota' : 'notas'} com CFOP ${cfop}`)
    .join(' e ');
  const lista = notas.slice(0, 10).map((n) => `${n.numDoc} (CFOP ${n.cfop})`);
  const resto = notas.length - lista.length;
  ctx.avisos.push({
    nivel: 'alerta',
    codigo: 'ESTORNO_AUSENTE',
    mensagem:
      `${quais} teriam estorno de crédito pela regra do arquivo, mas não têm ajuste no original; ` +
      `o sistema manteve sem ajuste. Confira se o estorno deveria existir. ` +
      `Notas: ${lista.join(', ')}${resto > 0 ? ` e outras ${resto}` : ''}.`,
  });
}

/** Aviso consolidado dos ajustes de estorno que não puderam ser ligados a uma nota só (mesmo número e data). */
function avisarEstornosAmbiguos(ctx: ContextoMes): void {
  if (!ctx.estornosAmbiguos.size) return;
  const lista = [...ctx.estornosAmbiguos.values()].sort();
  ctx.avisos.push({
    nivel: 'alerta',
    codigo: 'ESTORNO_AMBIGUO',
    mensagem:
      `Ajuste de estorno de crédito (M110/M510) que o editor não ligou a nenhuma nota porque há mais de uma nota com o mesmo número e data: ` +
      `${lista.slice(0, 10).join('; ')}${lista.length > 10 ? ` e outras ${lista.length - 10}` : ''}. ` +
      `O ajuste foi mantido como está, sem recálculo, e essas notas não recebem estorno automático. Confira.`,
  });
}

/** Avisos "info" do que o motor apurou sem conferência contra arquivo real. */
function avisosNaoConferidos(e: Escrituracao, fontes: Record<IdTributo, Fontes>): Aviso[] {
  const itens = new Set<string>();
  for (const t of TRIBUTOS) {
    const f = fontes[t.id];
    for (const o of f.origens) if (['A170', 'F120', 'F130', 'D501', 'D505'].includes(o)) itens.add(`registro ${o}`);
    if (f.creditos.some((c) => c.origem === 'F100')) itens.add('crédito em F100');
    for (const c of f.creditos) {
      if (c.cst !== '53') itens.add(`crédito CST ${c.cst}`);
      if (c.importacao) itens.add('crédito de importação (x08)');
    }
    for (const r of f.receitas) if (CST_RECEITA.has(r.cst) && CST_NT.has(r.cst) && r.cst !== '06' && r.cst !== '08') itens.add(`receita CST ${r.cst}`);
    if (listar(e, t.R1100).length) itens.add(`controle de saldo de créditos (${t.R1100})`);
    for (const m100 of listar(e, t.M100)) if (centavos(get(m100, 'SLD_CRED')) > 0) itens.add('desconto parcial de créditos (saldo credor)');
  }
  if (!itens.size) return [];
  return [
    {
      nivel: 'info',
      codigo: 'APURACAO_NAO_CONFERIDA',
      mensagem: `Apurado por regras do guia, não conferido contra arquivo real: ${[...itens].sort().join('; ')}.`,
    },
  ];
}

/** Resumo da apuração como está agora na árvore (lido do bloco M). */
export function resumoApuracao(e: Escrituracao): ResumoApuracao {
  return lerResumo(e);
}

/** Resumo da apuração do arquivo original (capturado em `registrarOriginal`). */
export function resumoOriginal(e: Escrituracao): ResumoApuracao | undefined {
  return estadoDe(e)?.resumoOriginal;
}

/** Receitas não tributadas (CST 04–09) cuja natureza da receita (M410/M810) não pôde ser determinada. */
export function pendenciasNaturezaReceita(e: Escrituracao): PendenciaNaturezaReceita[] {
  return estadoDe(e)?.pendencias ?? [];
}
