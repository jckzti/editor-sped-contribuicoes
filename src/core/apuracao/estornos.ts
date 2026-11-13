/**
 * Ajustes de crédito vinculados a nota (M110/M115 e M510/M515): estorno do crédito
 * em notas de saída com itens CST 49 e tributo destacado (ex.: CFOP 5927 baixa por
 * perda, 5201 devolução de compra).
 *
 * No original, o motor reconhece os ajustes cujo NUM_DOC é de uma nota do arquivo e
 * cujo valor (somado entre os M100) é a soma do tributo dos itens CST 49 da nota.
 * Esses ajustes passam a ser derivados da nota; os demais são preservados como estão.
 */
import { ratearPartes } from '../dec';
import { filhosDe, get, inserirFilho, listar, removerRegistro, type Aviso, type Escrituracao, type Registro } from '../modelo';
import type { RegraEstorno } from './contrato';
import { chaveNota, type NotaEstorno } from './fontes';
import { grupoDoCodCred, type Receitas0111 } from './rateio';
import type { EstadoTributo } from './estado';
import type { Tributo } from './tributos';
import { agrupar, cent, criar, setCent, setTexto } from './util';

export interface Aprendizado {
  /** Chaves completas das notas cujo ajuste foi reconhecido como derivado da nota. */
  vinculados: Set<string>;
  /** Número+data (`chaveNota`) dessas notas (é o que o M110 guarda). */
  vinculadosCurto: Set<string>;
  semEstorno: Set<string>;
  /**
   * Ajustes que batem com mais de uma nota candidata (mesmo número e data, outra série ou
   * filial): não são ligados a nenhuma (ficam preservados como estão). Número+data → descrição.
   */
  ambiguos: Map<string, string>;
  regras: RegraEstorno[];
}

/**
 * Reconhece os ajustes vinculados a nota no arquivo original e aprende as regras por CFOP.
 * Só liga um ajuste a uma nota quando há uma única nota candidata (número + data, ou só o
 * número se o ajuste não tiver data igual a nenhuma); havendo mais de uma, o ajuste não é
 * ligado (fica preservado) e as notas candidatas não recebem estorno automático.
 */
export function aprenderEstornos(e: Escrituracao, t: Tributo, notas: NotaEstorno[]): Aprendizado {
  const porCurto = new Map<string, NotaEstorno[]>();
  const porNum = new Map<string, NotaEstorno[]>();
  for (const n of notas) {
    agrupar(porCurto, n.curto, n);
    agrupar(porNum, n.numDoc.replace(/^0+(?=.)/, ''), n);
  }
  const ajustes = new Map<string, { codCred: string; m110: Registro }[]>();
  for (const m100 of listar(e, t.M100)) {
    for (const m110 of filhosDe(m100, t.M110)) {
      const num = get(m110, 'NUM_DOC');
      if (get(m110, 'IND_AJ') !== '0' || !num) continue;
      agrupar(ajustes, chaveNota(num, get(m110, 'DT_REF')), { codCred: get(m100, 'COD_CRED'), m110 });
    }
  }
  const vinculados = new Set<string>();
  const vinculadosCurto = new Set<string>();
  const ambiguos = new Map<string, string>();
  const votos = new Map<string, Map<string, { regra: RegraEstorno; n: number }>>();
  for (const [curto, ajs] of ajustes) {
    const num = curto.slice(0, curto.indexOf('|'));
    const exatos = porCurto.get(curto) ?? [];
    const cands = exatos.length ? exatos : porNum.get(num) ?? [];
    if (!cands.length) continue;
    if (cands.length > 1 && !exatos.length) continue; // data do ajuste não bate com nenhuma e há várias com o número: não liga
    if (cands.length > 1) {
      const series = cands.map((n) => n.serie || '(sem série)').join(', ');
      ambiguos.set(curto, `nota ${get(ajs[0].m110, 'NUM_DOC')} de ${dataLegivel(get(ajs[0].m110, 'DT_REF'))} (${cands.length} notas com esse número: séries ${series})`);
      continue;
    }
    const nota = cands[0];
    const soma = ajs.reduce((s, a) => s + cent(a.m110, 'VL_AJ'), 0);
    if (soma !== nota.valor) continue;
    vinculados.add(nota.chave);
    vinculadosCurto.add(curto);
    const codCreds = [...new Set(ajs.map((a) => a.codCred))];
    const regra: RegraEstorno = {
      cfop: nota.cfop,
      distribuicao: codCreds.length === 1 ? { codCred: codCreds[0] } : 'rateio',
      codAj: get(ajs[0].m110, 'COD_AJ'),
      descricao: get(ajs[0].m110, 'DESCR_AJ'),
      ...(codCreds.length > 1 ? { codCreds } : {}),
    };
    const id = JSON.stringify(regra);
    const porCfop = votos.get(nota.cfop) ?? new Map();
    const v = porCfop.get(id) ?? { regra, n: 0 };
    v.n++;
    porCfop.set(id, v);
    votos.set(nota.cfop, porCfop);
  }
  // notas que disputam um mesmo ajuste também ficam sem estorno automático
  const semEstorno = new Set(notas.filter((n) => !vinculados.has(n.chave)).map((n) => n.chave));
  const regras = [...votos.values()].map((m) => [...m.values()].sort((a, b) => b.n - a.n)[0].regra);
  return { vinculados, vinculadosCurto, semEstorno, ambiguos, regras };
}

function dataLegivel(d: string): string {
  return /^\d{8}$/.test(d) ? `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}` : d || '(sem data)';
}

/** Uma parcela de ajuste a gravar sob um M100. */
export interface EstornoDesejado {
  chave: string;
  nota: NotaEstorno;
  regra: RegraEstorno;
  codCred: string;
  valor: number;
}

/**
 * Calcula os ajustes de estorno que devem existir, por M100 (COD_CRED).
 * As notas elegíveis pela regra que no original não tinham ajuste continuam sem ajuste
 * (o motor não inventa o que o arquivo não tem) e são registradas em `ausentes`, para o
 * aviso consolidado da escrituração.
 */
export function estornosDesejados(
  notas: NotaEstorno[],
  regraDe: (cfop: string) => RegraEstorno | undefined,
  est: EstadoTributo,
  rec: Receitas0111,
  codCredsExistentes: Set<string>,
  avisos: Aviso[],
  t: Tributo,
  ausentes?: Map<string, NotaEstorno>,
  ambiguos?: Map<string, string>,
): EstornoDesejado[] {
  const out: EstornoDesejado[] = [];
  // O M110 só guarda número + data: duas notas com o mesmo número e data não podem ter cada
  // uma o seu ajuste derivado. Fica a que já era vinculada no original; as outras são avisadas.
  const porCurto = new Map<string, NotaEstorno[]>();
  for (const n of notas) agrupar(porCurto, n.curto, n);
  for (const nota of notas) {
    const regra = regraDe(nota.cfop);
    if (est.ambiguos.has(nota.curto)) {
      // havia ajuste no original e mais de uma nota candidata: ajuste preservado, nota sem estorno automático
      ambiguos?.set(nota.curto, est.ambiguos.get(nota.curto)!);
      continue;
    }
    const mesmas = porCurto.get(nota.curto)!;
    if (mesmas.length > 1 && !est.docsVinculados.has(nota.chave)) {
      if (regra || mesmas.some((n) => est.docsVinculados.has(n.chave))) {
        ambiguos?.set(nota.curto, `nota ${nota.numDoc} de ${dataLegivel(nota.dtDoc)} (${mesmas.length} notas com esse número e data: séries ${mesmas.map((n) => n.serie || '(sem série)').join(', ')})`);
      }
      continue;
    }
    if (est.docsSemEstorno.has(nota.chave)) {
      if (regra) ausentes?.set(nota.chave, nota);
      continue;
    }
    if (!regra) continue;
    if (regra.distribuicao !== 'rateio') {
      const cc = regra.distribuicao.codCred;
      if (!codCredsExistentes.has(cc)) {
        avisos.push({
          nivel: 'alerta',
          codigo: 'ESTORNO_SEM_CREDITO',
          mensagem: `${t.nome}: estorno da nota ${nota.numDoc} (CFOP ${nota.cfop}) iria para o crédito ${cc}, que não existe no mês; ajuste não gerado.`,
        });
        continue;
      }
      out.push({ chave: nota.chave, nota, regra, codCred: cc, valor: nota.valor });
      continue;
    }
    const alvo = (regra.codCreds ?? ['101', '201']).filter((c) => codCredsExistentes.has(c) && grupoDoCodCred(c));
    const denom = alvo.reduce((s, c) => s + rec[grupoDoCodCred(c)!], 0);
    if (!alvo.length || denom <= 0) {
      avisos.push({
        nivel: 'alerta',
        codigo: 'ESTORNO_SEM_CREDITO',
        mensagem: `${t.nome}: estorno rateado da nota ${nota.numDoc} (CFOP ${nota.cfop}) sem crédito/receita para ratear; ajuste não gerado.`,
      });
      continue;
    }
    const parcelas = ratearPartes(nota.valor, alvo.map((c) => rec[grupoDoCodCred(c)!]));
    alvo.forEach((c, i) => {
      if (parcelas[i] > 0) out.push({ chave: nota.chave, nota, regra, codCred: c, valor: parcelas[i] });
    });
  }
  return out;
}

/**
 * O M110 é um ajuste derivado de nota (recalculável)? `chavesDesejadas` = número+data
 * (`chaveNota`) das notas com estorno desejado neste recálculo.
 */
export function ajusteDerivado(m110: Registro, est: EstadoTributo, chavesDesejadas: Set<string>): boolean {
  const num = get(m110, 'NUM_DOC');
  if (get(m110, 'IND_AJ') !== '0' || !num) return false;
  const k = chaveNota(num, get(m110, 'DT_REF'));
  if (est.ambiguos.has(k)) return false;
  return est.vinculadosCurto.has(k) || chavesDesejadas.has(k);
}

/** Grava os ajustes derivados sob um M100: atualiza, cria e remove. */
export function gravarEstornos(
  m100: Registro,
  t: Tributo,
  desejados: EstornoDesejado[],
  est: EstadoTributo,
  chavesDesejadas: Set<string>,
): void {
  const porChave = new Map(desejados.map((d) => [d.nota.curto, d]));
  for (const m110 of filhosDe(m100, t.M110)) {
    if (!ajusteDerivado(m110, est, chavesDesejadas)) continue;
    const k = chaveNota(get(m110, 'NUM_DOC'), get(m110, 'DT_REF'));
    const d = porChave.get(k);
    if (!d) {
      removerRegistro(m110);
      continue;
    }
    porChave.delete(k);
    setCent(m110, 'VL_AJ', d.valor);
    const dets = filhosDe(m110, t.M115);
    if (dets.length === 0) inserirFilho(m110, novoDetalhe(t, d));
    else if (dets.length === 1) setCent(dets[0], 'DET_VALOR_AJ', d.valor);
  }
  for (const d of porChave.values()) {
    const m110 = criar(t.M110, {
      IND_AJ: '0',
      VL_AJ: '0',
      COD_AJ: d.regra.codAj,
      NUM_DOC: d.nota.numDoc,
      DESCR_AJ: d.regra.descricao,
      DT_REF: d.nota.dtDoc,
    });
    setCent(m110, 'VL_AJ', d.valor);
    inserirAjuste(m100, m110, t, est, chavesDesejadas);
    inserirFilho(m110, novoDetalhe(t, d));
    est.docsVinculados.add(d.chave);
    est.vinculadosCurto.add(d.nota.curto);
  }
}

const numOrd = (n: string) => n.replace(/^0+(?=.)/, '').padStart(20, '0');

/**
 * Ajustes derivados ficam antes dos manuais, em ordem de número de documento
 * (como na amostra: estornos por nota e, por último, o ajuste manual).
 */
function inserirAjuste(m100: Registro, m110: Registro, t: Tributo, est: EstadoTributo, chaves: Set<string>): void {
  const k = numOrd(get(m110, 'NUM_DOC'));
  const i = m100.filhos.findIndex(
    (f) => f.reg === t.M110 && (!ajusteDerivado(f, est, chaves) || numOrd(get(f, 'NUM_DOC')) > k),
  );
  if (i < 0) {
    inserirFilho(m100, m110);
    return;
  }
  m110.pai = m100;
  m100.filhos.splice(i, 0, m110);
}

function novoDetalhe(t: Tributo, d: EstornoDesejado): Registro {
  const r = criar(t.M115, {
    DET_VALOR_AJ: '0',
    DET_BC_CRED: '0',
    DET_ALIQ: '0',
    DT_OPER_AJ: d.nota.dtDoc,
    COD_CTA: d.nota.codCta,
  });
  setCent(r, 'DET_VALOR_AJ', d.valor);
  setTexto(r, 'DT_OPER_AJ', d.nota.dtDoc);
  return r;
}
