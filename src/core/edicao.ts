/**
 * Edição: campos (com validação pelo leiaute), ações de tributação de alto nível,
 * exclusão, inclusão de item, reversão e lista de diferenças.
 *
 * Toda função pública que altera a árvore roda como UMA operação desfazível
 * (ver `operacao.ts`); chamadas feitas dentro de outra operação entram nela.
 */
import { cstCredito, incluirC170, maiorNumItem } from './construir';
import { baseImobilizado, recalcularImobilizado } from './imobilizado';
import { deEscala, fmtCentavos, mulAliq, mulParaCentavos, paraEscala, ratear } from './dec';
import { estadoDe } from './estado';
import type { ItemImport } from './importacao.tipos';
import { CAMPOS_A100_DERIVADOS, CAMPOS_C100_DERIVADOS } from './leituras';
import { linhaAnexada, type LinhaQualquer } from './linhas';
import { idx, leiaute, type CampoLeiaute, type Escrituracao, type Registro } from './modelo';
import { alterar, inserir, remover } from './mutacao';
import { executar } from './operacao';
import tabelas from './tabelas.json';
import { ajustarResiduoPorEdicao } from './totais';
import { garantirUnidade, usoAtual } from './cadastros';
import { emUso } from './leituras';
import { casasDecimais, centavosRapido, cnpjValido, cpfValido, dataUsuarioParaNumero, normalizarNumero, spedParaBr } from './util';

/** Referência a um registro de uma escrituração (alternativa a uma `Linha`). */
export interface RefRegistro {
  e: Escrituracao;
  reg: Registro;
}

export type Alvo = LinhaQualquer | RefRegistro;

export interface ErroCampo {
  registro: string;
  campo: string;
  valor: string;
  mensagem: string;
  /** Documento a que o registro pertence (ex.: "NF 39327 série 001"), quando houver. */
  documento?: string;
}

export interface ResultadoEdicao {
  /** false se houve erro de validação (nesse caso NADA foi alterado). */
  ok: boolean;
  erros: ErroCampo[];
  /** Campos efetivamente alterados (sem contar totais/contadores automáticos). */
  alterados: number;
}

const CST_VALIDOS = tabelas.cst as Record<string, string>;
const NAT_BC_VALIDOS = tabelas.natBcCred as Record<string, string>;

// ---------------------------------------------------------------------------
// Validação de campo
// ---------------------------------------------------------------------------

/**
 * Valida e normaliza um valor para o campo do leiaute. Números viram o formato do SPED
 * (vírgula, sem zeros à direita); datas aceitam DD/MM/AAAA, AAAA-MM-DD ou DDMMAAAA.
 */
export function normalizarCampo(reg: string, campo: string, valor: string | number): { valor: string } | { erro: string } {
  const def = leiaute.registros[reg]?.campos.find((c) => c.nome === campo);
  if (!def) return { erro: `O registro ${reg} não tem o campo ${campo}.` };
  if (campo === 'REG') return { erro: 'O campo REG não pode ser alterado.' };
  let v = typeof valor === 'number' ? String(valor) : valor.trim();
  if (v.includes('|') || /[\r\n]/.test(v)) return { erro: 'O valor não pode conter "|" nem quebra de linha.' };
  if (v === '') return def.obrig === 'S' ? { erro: `${rotuloCampo(def)} é obrigatório.` } : { valor: '' };

  if (def.tipo === 'N') {
    if (def.dec !== null && def.dec !== undefined) {
      const n = normalizarNumero(typeof valor === 'number' ? valor : v);
      if (n === null) return { erro: `${rotuloCampo(def)}: "${v}" não é um número.` };
      if (n.startsWith('-')) return { erro: `${rotuloCampo(def)} não pode ser negativo.` };
      if (casasDecimais(n) > def.dec) return { erro: `${rotuloCampo(def)} aceita no máximo ${def.dec} casas decimais.` };
      return { valor: deEscala(paraEscala(n, def.dec), def.dec) };
    }
    if (campo.startsWith('DT_')) {
      const d = dataUsuarioParaNumero(v);
      if (Number.isNaN(d)) return { erro: `${rotuloCampo(def)}: "${v}" não é uma data (use DD/MM/AAAA).` };
      const s = String(d);
      v = s.slice(6, 8) + s.slice(4, 6) + s.slice(0, 4);
      const dd = Number(v.slice(0, 2));
      const mm = Number(v.slice(2, 4));
      if (mm < 1 || mm > 12 || dd < 1 || dd > new Date(Date.UTC(Number(v.slice(4)), mm, 0)).getUTCDate()) return { erro: `${rotuloCampo(def)}: data inexistente (${spedParaBr(v)}).` };
      return { valor: v };
    }
    if (!/^\d+$/.test(v)) return { erro: `${rotuloCampo(def)} aceita só dígitos.` };
    if (def.fixo && def.tam && def.tam < 100 && v.length < def.tam && campo.startsWith('CST_')) v = v.padStart(def.tam, '0');
    if (def.tam && def.tam < 1000) {
      if (def.fixo && v.length !== def.tam) return { erro: `${rotuloCampo(def)} deve ter ${def.tam} dígitos.` };
      if (v.length > def.tam) return { erro: `${rotuloCampo(def)} aceita no máximo ${def.tam} dígitos.` };
    }
  } else if (def.tam && def.tam < 1000 && v.length > def.tam) {
    return { erro: `${rotuloCampo(def)} aceita no máximo ${def.tam} caracteres.` };
  }
  if (def.valores && !(v in def.valores)) {
    return { erro: `${rotuloCampo(def)}: "${v}" não é válido. Valores aceitos: ${Object.keys(def.valores).join(', ')}.` };
  }
  if ((campo === 'CST_PIS' || campo === 'CST_COFINS') && !(v in CST_VALIDOS)) return { erro: `CST "${v}" não existe na tabela de CST de PIS/COFINS.` };
  if (campo === 'NAT_BC_CRED' && !(v in NAT_BC_VALIDOS)) return { erro: `Código de base de crédito "${v}" não existe (tabela 4.3.7).` };
  return { valor: v };
}

function rotuloCampo(def: CampoLeiaute): string {
  return `${def.nome} (${def.descricao})`;
}

// ---------------------------------------------------------------------------
// Descrição de documentos (mensagens e tela de conferência)
// ---------------------------------------------------------------------------

/** Descrição curta do documento/registro para mensagens ("NF 39327 série 001", "Item 3 da NF 39327"...). */
export function descreverRegistro(r: Registro): string {
  const g = (reg: Registro, c: string) => {
    try {
      return reg.campos[idx(reg.reg, c)] ?? '';
    } catch {
      return '';
    }
  };
  switch (r.reg) {
    case 'C100':
      return `NF ${g(r, 'NUM_DOC')}${g(r, 'SER') ? ' série ' + g(r, 'SER') : ''} (${g(r, 'IND_OPER') === '0' ? 'entrada' : 'saída'})`;
    case 'C170':
      return `Item ${g(r, 'NUM_ITEM')} (${g(r, 'COD_ITEM')})${r.pai ? ' da ' + descreverRegistro(r.pai) : ''}`;
    case 'D100':
      return `CT-e/conhecimento ${g(r, 'NUM_DOC')}${g(r, 'SER') ? ' série ' + g(r, 'SER') : ''}`;
    case 'D101':
    case 'D105':
      return `${r.reg === 'D101' ? 'PIS' : 'COFINS'} do ${r.pai ? descreverRegistro(r.pai) : 'frete'}`;
    case 'C500':
      return `Conta de energia/água/gás ${g(r, 'NUM_DOC')}`;
    case 'C501':
    case 'C505':
      return `${r.reg === 'C501' ? 'PIS' : 'COFINS'} da ${r.pai ? descreverRegistro(r.pai) : 'conta'}`;
    case 'F100':
      return `F100 de ${spedParaBr(g(r, 'DT_OPER'))}, valor ${g(r, 'VL_OPER')}`;
    case 'A100':
      return `NFS-e ${g(r, 'NUM_DOC')}${g(r, 'SER') ? ' série ' + g(r, 'SER') : ''} (${g(r, 'IND_OPER') === '0' ? 'serviço contratado' : 'serviço prestado'})`;
    case 'A170':
      return `Item ${g(r, 'NUM_ITEM')} (${g(r, 'COD_ITEM')})${r.pai ? ' da ' + descreverRegistro(r.pai) : ''}`;
    case 'F120':
      return `Imobilizado (depreciação) ${g(r, 'DESC_BEM_IMOB') || 'bem ' + g(r, 'IDENT_BEM_IMOB')}, encargo ${g(r, 'VL_OPER_DEP')}`;
    case 'F130':
      return `Imobilizado (aquisição) ${g(r, 'DESC_BEM_IMOB') || 'bem ' + g(r, 'IDENT_BEM_IMOB')}, valor ${g(r, 'VL_OPER_AQUIS')}`;
    case '0150':
      return `Participante ${g(r, 'COD_PART')} - ${g(r, 'NOME')}`;
    case '0200':
      return `Item ${g(r, 'COD_ITEM')} - ${g(r, 'DESCR_ITEM')}`;
    case '0190':
      return `Unidade ${g(r, 'UNID')}`;
    case '0400':
      return `Natureza da operação ${g(r, 'COD_NAT')}`;
    case '0500':
      return `Conta ${g(r, 'COD_CTA')} - ${g(r, 'NOME_CTA')}`;
    case '9900':
      return `Contador do registro ${g(r, 'REG_BLC')}`;
    default:
      return `Registro ${r.reg}`;
  }
}

/** Documento (C100, D100, C500, F100, A100, F120, F130) a que o registro pertence. */
export function documentoDe(r: Registro): Registro | null {
  let p: Registro | null = r;
  while (p) {
    if (['C100', 'D100', 'C500', 'F100', 'A100', 'F120', 'F130'].includes(p.reg)) return p;
    p = p.pai;
  }
  return null;
}

// ---------------------------------------------------------------------------
// Edição de campos
// ---------------------------------------------------------------------------

function ehLinha(a: Alvo): a is LinhaQualquer {
  return 'tipo' in a && 'doc' in a;
}

/** Resolve a chave ("CAMPO" ou "REG.CAMPO") nos registros do alvo. */
function resolver(a: Alvo, chave: string): { regs: Registro[]; campo: string } | { erro: string } {
  const ponto = chave.indexOf('.');
  const regAlvo = ponto > 0 ? chave.slice(0, ponto) : null;
  const campo = ponto > 0 ? chave.slice(ponto + 1) : chave;
  const tem = (r: Registro | undefined) => !!r && !!leiaute.registros[r.reg]?.campos.some((c) => c.nome === campo);
  if (!ehLinha(a)) {
    if (regAlvo && regAlvo !== a.reg.reg) return { erro: `O registro é ${a.reg.reg}, não ${regAlvo}.` };
    return tem(a.reg) ? { regs: [a.reg], campo } : { erro: `O registro ${a.reg.reg} não tem o campo ${campo}.` };
  }
  const candidatos = [a.reg, a.doc, a.pis, a.cofins].filter((r, i, arr): r is Registro => !!r && arr.indexOf(r) === i);
  if (regAlvo) {
    const r = candidatos.find((c) => c.reg === regAlvo);
    if (!r) {
      if (a.tipo === 'frete' || a.tipo === 'energia') return { erro: `Esta linha não tem registro ${regAlvo} (documento sem complemento de PIS/COFINS).` };
      return { erro: `A linha não tem registro ${regAlvo}.` };
    }
    return tem(r) ? { regs: [r], campo } : { erro: `O registro ${regAlvo} não tem o campo ${campo}.` };
  }
  if (tem(a.reg)) return { regs: [a.reg], campo };
  const comp = [a.pis, a.cofins].filter(tem) as Registro[];
  if (comp.length) return { regs: comp, campo }; // campo comum a D101/D105 (ou C501/C505): os dois juntos
  return { erro: `O campo ${campo} não existe nesta linha.` };
}

/**
 * Altera campos de um ou mais alvos (linhas da grade ou registros), como UMA operação.
 * Chaves: "CAMPO" (do registro principal; em frete/energia, um campo comum ao par
 * PIS/COFINS é gravado nos dois) ou "REG.CAMPO" (ex.: "D105.CST_COFINS", "C100.DT_E_S").
 * Valida tudo antes: se houver qualquer erro, nada é alterado.
 *
 * Editar um total derivado do C100 (VL_DOC, VL_MERC, VL_PIS...) ou do C500 (VL_PIS,
 * VL_COFINS) fixa o novo valor: a diferença para a soma dos itens passa a ser o resíduo.
 */
export function editarCampos(alvos: Alvo | Alvo[], valores: Record<string, string | number>, descricao = 'Edição de campos'): ResultadoEdicao {
  const { erros, plano } = planejarEdicao(Array.isArray(alvos) ? alvos : [alvos], valores);
  if (erros.length) return { ok: false, erros, alterados: 0 };
  const alterados = executar(descricao, () => aplicarPlano(plano));
  return { ok: true, erros: [], alterados };
}

/** Uma alteração de campo já validada e normalizada. */
export interface PassoEdicao {
  e: Escrituracao;
  r: Registro;
  campo: string;
  valor: string;
}

/** Valida e resolve as alterações sem aplicar nada. */
export function planejarEdicao(alvos: Alvo[], valores: Record<string, string | number>): { erros: ErroCampo[]; plano: PassoEdicao[] } {
  const erros: ErroCampo[] = [];
  const plano: PassoEdicao[] = [];
  for (const a of alvos) {
    for (const [chave, bruto] of Object.entries(valores)) {
      const res = resolver(a, chave);
      if ('erro' in res) {
        erros.push({ registro: a.reg.reg, campo: chave, valor: String(bruto), mensagem: res.erro, documento: docDesc(a.reg) });
        continue;
      }
      for (const r of res.regs) {
        const n = normalizarCampo(r.reg, res.campo, bruto);
        const extra = 'erro' in n ? null : validarCadastro(r, res.campo, n.valor);
        if ('erro' in n) erros.push({ registro: r.reg, campo: res.campo, valor: String(bruto), mensagem: n.erro, documento: docDesc(r) });
        else if (extra) erros.push({ registro: r.reg, campo: res.campo, valor: String(bruto), mensagem: extra, documento: docDesc(r) });
        else plano.push({ e: a.e, r, campo: res.campo, valor: n.valor });
      }
    }
  }
  return { erros, plano };
}

/**
 * Regras próprias dos cadastros (0150/0200) além do leiaute: o código (COD_PART/COD_ITEM)
 * não é editável nesta versão (renomear exigiria mexer em todos os documentos); CNPJ e
 * CPF do participante com dígito verificador válido. Devolve a mensagem de erro ou null.
 */
function validarCadastro(r: Registro, campo: string, v: string): string | null {
  if ((r.reg === '0150' && campo === 'COD_PART') || (r.reg === '0200' && campo === 'COD_ITEM')) {
    return `O código do ${r.reg === '0150' ? 'participante' : 'item'} (${campo}) não pode ser alterado: ele é usado nos documentos. Cadastre outro código, se precisar.`;
  }
  if (r.reg === '0150' && campo === 'CNPJ' && v && !cnpjValido(v)) return `CNPJ ${v} com dígito verificador inválido.`;
  if (r.reg === '0150' && campo === 'CPF' && v && !cpfValido(v)) return `CPF ${v} com dígito verificador inválido.`;
  return null;
}

/** Aplica um plano de edição (sem abrir operação). Devolve quantos campos mudaram. */
export function aplicarPlano(plano: PassoEdicao[]): number {
  let alterados = 0;
  for (const p of plano) {
    if (!p.r.pai && p.r.reg !== '0000') continue; // registro excluído nesse meio-tempo
    if (alterar(p.e, p.r, p.campo, p.valor)) {
      alterados++;
      if (
        (p.r.reg === 'C100' && CAMPOS_C100_DERIVADOS.has(p.campo)) ||
        (p.r.reg === 'C500' && (p.campo === 'VL_PIS' || p.campo === 'VL_COFINS')) ||
        (p.r.reg === 'A100' && CAMPOS_A100_DERIVADOS.has(p.campo))
      ) {
        ajustarResiduoPorEdicao(p.e, p.r, p.campo, centavosRapido(p.valor));
      }
      // imobilizado: campos derivados (guia, F120 campos 09/13 e F130 campos 09, 12 e 16) acompanham a edição
      if (p.r.reg === 'F120' || p.r.reg === 'F130') alterados += recalcularImobilizado(p.e, p.r, p.campo);
      // unidade nova no produto: garante o 0190 do estabelecimento
      if (p.r.reg === '0200' && p.campo === 'UNID_INV' && p.valor && p.r.pai?.reg === '0140') {
        garantirUnidade(p.e, p.r.pai.campos[idx('0140', 'CNPJ')] ?? '', p.valor);
      }
    }
  }
  return alterados;
}

function docDesc(r: Registro): string | undefined {
  const d = documentoDe(r);
  return d ? descreverRegistro(d) : undefined;
}

// ---------------------------------------------------------------------------
// Tributação de alto nível
// ---------------------------------------------------------------------------

/** CSTs sem valor de contribuição/crédito: ao defini-los, a interface pode oferecer zerar base/alíquota/valor. */
export const CSTS_SEM_VALOR = new Set(['04', '05', '06', '07', '08', '09', '49', '70', '71', '72', '73', '74', '75', '98', '99']);

/** O CST não gera débito nem crédito (ver `CSTS_SEM_VALOR`)? */
export function cstSemValor(cst: string): boolean {
  return CSTS_SEM_VALOR.has(cst);
}

/**
 * Como calcular a base de PIS/COFINS:
 * - 'manter': não mexe;
 * - 'valor-item': valor do item (C170/D101/C501.VL_ITEM, F100.VL_OPER);
 * - 'valor-item-menos-desconto': − VL_DESC do item (frete: VL_DESC do D100 proporcional);
 * - 'valor-item-menos-desconto-menos-icms': − também o ICMS (frete/energia: ICMS do documento proporcional);
 * - 'zero'; ou um valor fixo `{ valor }`.
 */
export type ModoBase = 'manter' | 'valor-item' | 'valor-item-menos-desconto' | 'valor-item-menos-desconto-menos-icms' | 'zero' | { valor: string | number };

/**
 * Ação de tributação. Vale para item (C170), F100, frete (D101+D105), energia (C501+C505)
 * e nota (aplica em todos os itens da nota). PIS e COFINS são sempre tratados juntos.
 */
export interface AcaoTributacao {
  tipo: 'tributacao';
  /** CST para PIS e COFINS (atalho para cstPis = cstCofins). */
  cst?: string;
  cstPis?: string;
  cstCofins?: string;
  /** Alíquotas em percentual ("1,65", 1.65...). */
  aliqPis?: string | number;
  aliqCofins?: string | number;
  base?: ModoBase;
  /** Código da base de cálculo do crédito (D101/D105, C501/C505, F100, A170, F120, F130; ignorado no C170, onde vem do CFOP). */
  natBcCred?: string;
  /** Origem do crédito (IND_ORIG_CRED): "0" mercado interno, "1" importação. Só onde o campo existe (F100, A170, F120, F130). */
  indOrigCred?: '0' | '1';
  /** Conta contábil (COD_CTA). */
  conta?: string;
  /**
   * Recalcular valor = base × alíquota. Padrão: só quando a base, a alíquota ou o
   * zeramento mudaram nesta ação. true = sempre; false = nunca.
   */
  recalcularValor?: boolean;
  /** Se o CST definido não tiver valor (ver `cstSemValor`), zera base, alíquota e valor. Padrão false. */
  zerarSemCredito?: boolean;
}

export interface ResultadoAcao {
  /** Linhas em que a ação foi aplicada. */
  linhas: number;
  /** Campos alterados. */
  alterados: number;
  /** Observações (ex.: NAT_BC_CRED ignorado no C170). */
  avisos: string[];
  /** Erros de validação da ação (nesse caso nada foi alterado). */
  erros: string[];
}

interface Lado {
  r: Registro;
  /** "PIS" ou "COFINS" */
  t: 'PIS' | 'COFINS';
  cst: number;
  base: number;
  aliq: number;
  valor: number;
  quant: number;
  aliqQuant: number;
  nat: number;
  conta: number;
  item: number;
}

function ixOpt(reg: string, campo: string): number {
  return leiaute.registros[reg].campos.findIndex((c) => c.nome === campo);
}

const ladosCache = new Map<string, Omit<Lado, 'r'>>();
function defLado(reg: string, t: 'PIS' | 'COFINS'): Omit<Lado, 'r'> {
  const k = reg + t;
  let d = ladosCache.get(k);
  if (!d) {
    d = {
      t,
      cst: ixOpt(reg, `CST_${t}`),
      base: ixOpt(reg, `VL_BC_${t}`),
      aliq: ixOpt(reg, `ALIQ_${t}`),
      valor: ixOpt(reg, `VL_${t}`),
      quant: ixOpt(reg, `QUANT_BC_${t}`),
      aliqQuant: ixOpt(reg, `ALIQ_${t}_QUANT`),
      nat: ixOpt(reg, 'NAT_BC_CRED'),
      conta: ixOpt(reg, 'COD_CTA'),
      item: reg === 'F100' ? ixOpt(reg, 'VL_OPER') : reg === 'F120' ? ixOpt(reg, 'VL_OPER_DEP') : reg === 'F130' ? ixOpt(reg, 'VL_OPER_AQUIS') : ixOpt(reg, 'VL_ITEM'),
    };
    ladosCache.set(k, d);
  }
  return d;
}

function ladosDe(l: LinhaQualquer): Lado[] {
  switch (l.tipo) {
    case 'item':
    case 'f100':
    case 'servico':
    case 'imobDepreciacao':
    case 'imobAquisicao':
      return [{ r: l.reg, ...defLado(l.reg.reg, 'PIS') }, { r: l.reg, ...defLado(l.reg.reg, 'COFINS') }];
    case 'frete':
    case 'energia': {
      const out: Lado[] = [];
      if (l.pis) out.push({ r: l.pis, ...defLado(l.pis.reg, 'PIS') });
      if (l.cofins) out.push({ r: l.cofins, ...defLado(l.cofins.reg, 'COFINS') });
      return out;
    }
    default:
      return [];
  }
}

/** Expande linhas de nota em linhas de item (as demais passam direto). */
function expandir(linhas: LinhaQualquer[]): LinhaQualquer[] {
  const out: LinhaQualquer[] = [];
  for (const l of linhas) {
    if (l.tipo !== 'nota') out.push(l);
    else for (const it of l.reg.filhos) if (it.reg === 'C170') out.push({ tipo: 'item', e: l.e, reg: it, doc: l.reg, est: l.est });
  }
  return out;
}

/** Parte proporcional de um valor do documento para o complemento (frete/energia com vários pares). */
function proporcional(lado: Lado, totalDoc: number): number {
  const doc = lado.r.pai;
  if (!doc || !totalDoc) return 0;
  let soma = 0;
  for (const f of doc.filhos) if (f.reg === lado.r.reg) soma += centavosRapido(f.campos[lado.item]);
  const parte = centavosRapido(lado.r.campos[lado.item]);
  if (!Number.isFinite(soma) || !Number.isFinite(parte) || !Number.isFinite(totalDoc)) return NaN;
  return soma === parte ? totalDoc : ratear(totalDoc, parte, soma);
}

function calcularBase(l: LinhaQualquer, lado: Lado, modo: ModoBase): number | null {
  if (modo === 'manter') return null;
  if (modo === 'zero') return 0;
  if (typeof modo === 'object') return centavosRapido(deEscala(paraEscala(normalizarNumero(modo.valor) ?? '0', 2), 2));
  const c = lado.r.campos;
  // imobilizado: a base vem da regra do guia (encargo − parcela sem crédito; aquisição ÷ parcelas),
  // qualquer que seja o modo "valor do item…"
  if (l.tipo === 'imobDepreciacao' || l.tipo === 'imobAquisicao') return baseImobilizado(lado.r);
  const item = centavosRapido(c[lado.item]);
  let desc = 0;
  let icms = 0;
  if (l.tipo === 'servico') desc = centavosRapido(c[idx('A170', 'VL_DESC')]);
  else if (l.tipo === 'item') {
    desc = centavosRapido(c[idx('C170', 'VL_DESC')]);
    icms = centavosRapido(c[idx('C170', 'VL_ICMS')]);
  } else if (l.tipo === 'frete') {
    desc = proporcional(lado, centavosRapido(l.doc.campos[idx('D100', 'VL_DESC')]));
    icms = proporcional(lado, centavosRapido(l.doc.campos[idx('D100', 'VL_ICMS')]));
  } else if (l.tipo === 'energia') {
    icms = proporcional(lado, centavosRapido(l.doc.campos[idx('C500', 'VL_ICMS')]));
  }
  if (modo === 'valor-item') return item;
  if (modo === 'valor-item-menos-desconto') return Math.max(0, item - desc);
  // ERP que grava o ICMS no VL_DESC do item: nesse item o desconto JÁ é o ICMS; tirar os dois
  // excluiria o ICMS duas vezes. A base fica VL_ITEM − VL_ICMS (o ICMS sai uma vez só).
  if (l.tipo === 'item' && icms > 0 && desc === icms && estadoDe(l.e).descontoEhIcms) return Math.max(0, item - icms);
  return Math.max(0, item - desc - icms);
}

/** Resultado de `diagnosticarBaseIcms`: como está a base de PIS dos itens (C170) em relação ao ICMS. */
export interface DiagnosticoBaseIcms {
  /** Itens de nota (C170) considerados (linhas de nota viram os seus itens; outros tipos são ignorados). */
  itens: number;
  /** Itens com VL_ICMS > 0. */
  comIcms: number;
  /** Itens com base de PIS = VL_ITEM − VL_DESC. */
  baseItemMenosDesconto: number;
  /** Itens com ICMS em que VL_DESC = VL_ICMS (o desconto é o próprio ICMS). */
  descontoIgualIcms: number;
  /** Itens com ICMS cuja base atual já exclui o ICMS (base = item − ICMS ou item − desconto − ICMS). */
  baseJaExcluiIcms: number;
  /** Itens com ICMS e desconto > 0 diferente do ICMS (nesses o modo tira o desconto E o ICMS). */
  descontoDiferenteIcms: number;
  /** Itens cuja base de PIS mudaria com `modo` (padrão: "valor-item-menos-desconto-menos-icms"). */
  mudariam: number;
  /** Soma da variação da base de PIS desses itens, em centavos (negativa = base menor). */
  variacaoBase: number;
  /** Escriturações (entre as das linhas) em que o ERP grava o ICMS no VL_DESC do item. */
  escrituracoesDescontoEhIcms: number;
}

/**
 * Diagnóstico, sem alterar nada, da base de PIS dos itens em relação ao ICMS, para a
 * interface mostrar antes de aplicar "valor − desconto − ICMS" (ou outro modo).
 */
export function diagnosticarBaseIcms(linhas: LinhaQualquer[], modo: ModoBase = 'valor-item-menos-desconto-menos-icms'): DiagnosticoBaseIcms {
  const d: DiagnosticoBaseIcms = { itens: 0, comIcms: 0, baseItemMenosDesconto: 0, descontoIgualIcms: 0, baseJaExcluiIcms: 0, descontoDiferenteIcms: 0, mudariam: 0, variacaoBase: 0, escrituracoesDescontoEhIcms: 0 };
  const escs = new Set<Escrituracao>();
  for (const l of expandir(linhas)) {
    if (l.tipo !== 'item' || !linhaAnexada(l)) continue;
    escs.add(l.e);
    const lado = ladosDe(l)[0];
    const b = classificarBase(l, lado);
    d.itens++;
    if (b.icms > 0) d.comIcms++;
    if (b.base === b.item - b.desc) d.baseItemMenosDesconto++;
    if (b.icms > 0 && b.desc === b.icms) d.descontoIgualIcms++;
    if (b.icms > 0 && b.desc > 0 && b.desc !== b.icms) d.descontoDiferenteIcms++;
    if (b.jaExclui) d.baseJaExcluiIcms++;
    const nova = calcularBase(l, lado, modo);
    if (nova !== null && Number.isFinite(nova) && nova !== b.base) {
      d.mudariam++;
      d.variacaoBase += nova - b.base;
    }
  }
  for (const e of escs) if (estadoDe(e).descontoEhIcms) d.escrituracoesDescontoEhIcms++;
  return d;
}

function classificarBase(l: LinhaQualquer, lado: Lado): { item: number; desc: number; icms: number; base: number; jaExclui: boolean } {
  const c = lado.r.campos;
  const item = centavosRapido(c[lado.item]);
  const desc = centavosRapido(c[idx('C170', 'VL_DESC')]);
  const icms = centavosRapido(c[idx('C170', 'VL_ICMS')]);
  const base = centavosRapido(c[lado.base]);
  const jaExclui = l.tipo === 'item' && icms > 0 && (base === item - icms || base === item - desc - icms);
  return { item, desc, icms, base, jaExclui };
}

/** Valida a ação de tributação; devolve mensagens de erro (vazio = ok). */
export function validarAcaoTributacao(a: AcaoTributacao): string[] {
  const erros: string[] = [];
  for (const [nome, v] of [['CST', a.cst], ['CST PIS', a.cstPis], ['CST COFINS', a.cstCofins]] as const) {
    if (v !== undefined && !(v in CST_VALIDOS)) erros.push(`${nome} "${v}" não existe na tabela de CST de PIS/COFINS.`);
  }
  for (const [nome, v] of [['Alíquota PIS', a.aliqPis], ['Alíquota COFINS', a.aliqCofins]] as const) {
    if (v === undefined) continue;
    const n = normalizarNumero(v);
    if (n === null || n.startsWith('-')) erros.push(`${nome}: "${String(v)}" não é um percentual válido.`);
    else if (casasDecimais(n) > 4) erros.push(`${nome} aceita no máximo 4 casas decimais.`);
  }
  if (a.base && typeof a.base === 'object') {
    const n = normalizarNumero(a.base.valor);
    if (n === null || n.startsWith('-')) erros.push(`Base: "${String(a.base.valor)}" não é um valor válido.`);
  } else if (a.base && !['manter', 'valor-item', 'valor-item-menos-desconto', 'valor-item-menos-desconto-menos-icms', 'zero'].includes(a.base)) {
    erros.push(`Modo de base "${String(a.base)}" desconhecido.`);
  }
  if (a.natBcCred !== undefined && a.natBcCred !== '' && !(a.natBcCred in NAT_BC_VALIDOS)) erros.push(`Código de base de crédito "${a.natBcCred}" não existe (tabela 4.3.7).`);
  if (a.conta !== undefined && (a.conta.length > 255 || a.conta.includes('|'))) erros.push('Conta contábil inválida (máx. 255 caracteres, sem "|").');
  if (a.indOrigCred !== undefined && a.indOrigCred !== '0' && a.indOrigCred !== '1') erros.push(`Origem do crédito "${String(a.indOrigCred)}" inválida (0 ou 1).`);
  return erros;
}

/** Aplica a tributação nas linhas (sem abrir operação: use `aplicarTributacao`). */
export function aplicarTributacaoSemOperacao(linhas: LinhaQualquer[], a: AcaoTributacao): ResultadoAcao {
  const res: ResultadoAcao = { linhas: 0, alterados: 0, avisos: [], erros: validarAcaoTributacao(a) };
  if (res.erros.length) return res;
  const aliqTxt = (v: string | number | undefined) => (v === undefined ? undefined : deEscala(paraEscala(normalizarNumero(v)!, 4), 4));
  const aliq = { PIS: aliqTxt(a.aliqPis), COFINS: aliqTxt(a.aliqCofins) };
  const cst = { PIS: a.cstPis ?? a.cst, COFINS: a.cstCofins ?? a.cst };
  let natIgnorada = 0;
  const natInvalida = new Map<string, number>();
  let semParcelas = 0;
  const modoIcms = a.base === 'valor-item-menos-desconto-menos-icms';
  const icms = { itens: 0, jaExclui: 0, descDiferente: 0, arquivoDescontoEhIcms: false };
  const semBase = { credito: 0, debito: 0 };
  const invalidos = new Set<string>();
  const definiuBase = a.base !== undefined && a.base !== 'manter';
  for (const l of expandir(linhas)) {
    if (!linhaAnexada(l)) continue;
    const lados = ladosDe(l);
    if (!lados.length) continue;
    res.linhas++;
    if (modoIcms && l.tipo === 'item') {
      // base de PIS ANTES da ação: já exclui o ICMS e não vai mudar?
      const b = classificarBase(l, lados[0]);
      icms.itens++;
      if (estadoDe(l.e).descontoEhIcms) icms.arquivoDescontoEhIcms = true;
      if (b.jaExclui && calcularBase(l, lados[0], a.base!) === b.base) icms.jaExclui++;
      if (b.icms > 0 && b.desc > 0 && b.desc !== b.icms) icms.descDiferente++;
    }
    let linhaSemCredito = false;
    let linhaSemDebito = false;
    for (const lado of lados) {
      const { r } = lado;
      const set = (i: number, v: string) => {
        if (i >= 0 && alterar(l.e, r, i, v)) res.alterados++;
      };
      const novoCst = cst[lado.t];
      if (novoCst !== undefined) set(lado.cst, novoCst);
      let mexeu = false;
      const cstFinal = r.campos[lado.cst];
      if (a.zerarSemCredito && cstSemValor(cstFinal)) {
        set(lado.base, '0');
        set(lado.aliq, '0');
        set(lado.valor, '0');
        if (lado.quant >= 0) set(lado.quant, '');
        if (lado.aliqQuant >= 0) set(lado.aliqQuant, '');
      } else {
        const novaAliq = aliq[lado.t];
        if (novaAliq !== undefined) {
          set(lado.aliq, novaAliq);
          mexeu = true;
        }
        let base = a.base ? calcularBase(l, lado, a.base) : null;
        if (base !== null && Number.isNaN(base) && (l.tipo === 'imobAquisicao' || l.tipo === 'imobDepreciacao')) {
          base = null; // F130 com parcelas "9" (outra periodicidade): a base do mês é dado de entrada
          if (lado.t === 'PIS') semParcelas++;
        }
        if (base !== null && !Number.isFinite(base)) {
          invalidos.add(descreverRegistro(r));
        } else if (base !== null) {
          set(lado.base, fmtCentavos(base));
          mexeu = true;
        }
        if (mexeu && lado.quant >= 0) {
          set(lado.quant, '');
          set(lado.aliqQuant, '');
        }
        const recalc = a.recalcularValor ?? mexeu;
        if (recalc) {
          const b = r.campos[lado.base];
          const porQuantidade = !b && lado.quant >= 0 && !!r.campos[lado.quant];
          const vb = centavosRapido(b);
          if (!porQuantidade && !Number.isFinite(vb)) invalidos.add(descreverRegistro(r));
          else {
            const v = porQuantidade
              ? mulParaCentavos(r.campos[lado.quant], r.campos[lado.aliqQuant], 3, 4) // alíquota em reais por unidade
              : mulAliq(vb, r.campos[lado.aliq]);
            set(lado.valor, fmtCentavos(v));
          }
        }
      }
      // CST de crédito (50–66) ou de receita tributada (01/02) definido nesta ação sem definir a base, em linha com base zero
      if (novoCst !== undefined && !definiuBase) {
        const cstF = r.campos[lado.cst];
        const semQuant = lado.quant < 0 || !r.campos[lado.quant];
        if (semQuant && centavosRapido(r.campos[lado.base]) === 0) {
          if (cstCredito(cstF)) linhaSemCredito = true;
          else if (cstF === '01' || cstF === '02') linhaSemDebito = true;
        }
      }
      if (a.natBcCred !== undefined) {
        const valores = lado.nat >= 0 ? leiaute.registros[r.reg].campos[lado.nat].valores : undefined;
        if (lado.nat < 0) natIgnorada++;
        else if (a.natBcCred && valores && !(a.natBcCred in valores)) natInvalida.set(r.reg, (natInvalida.get(r.reg) ?? 0) + 1);
        else set(lado.nat, a.natBcCred);
      }
      if (a.indOrigCred !== undefined) {
        const io = ixOpt(r.reg, 'IND_ORIG_CRED');
        if (io >= 0) set(io, a.indOrigCred);
      }
      if (a.conta !== undefined && lado.conta >= 0) set(lado.conta, a.conta);
    }
    if (linhaSemCredito) semBase.credito++;
    if (linhaSemDebito) semBase.debito++;
  }
  if (natIgnorada) res.avisos.push('NAT_BC_CRED não existe no item de nota (C170): a base de crédito vem do CFOP na apuração. Campo ignorado nesses itens.');
  for (const [reg, n] of natInvalida) {
    const v = Object.keys(leiaute.registros[reg].campos.find((c) => c.nome === 'NAT_BC_CRED')!.valores ?? {}).join(', ');
    res.avisos.push(`NAT_BC_CRED "${a.natBcCred}" não é aceito no ${reg} (só ${v}); campo mantido em ${n} registro(s).`);
  }
  if (semParcelas) res.avisos.push(`${semParcelas} bem(ns) do F130 com parcelas "9" (outra periodicidade): a base do mês não é calculada pelo editor; informe-a no campo de base.`);
  if (modoIcms && icms.itens) {
    if (icms.jaExclui) res.avisos.push(`Em ${icms.jaExclui} de ${icms.itens} itens a base atual já exclui o ICMS; a ação não muda esses itens.`);
    if (icms.arquivoDescontoEhIcms) {
      res.avisos.push('Neste arquivo o ERP grava o ICMS do item no campo de desconto (VL_DESC = VL_ICMS na maioria dos itens): nesses itens a base usada é VL_ITEM − VL_ICMS, para não excluir o ICMS duas vezes.');
      if (icms.descDiferente) {
        res.avisos.push(`Em ${icms.descDiferente} item(ns) o desconto (VL_DESC) é diferente do ICMS: neles a ação tira o desconto E o ICMS. Como o ERP deste arquivo usa o VL_DESC para o ICMS, confira se o desconto desses itens não é (parte do) ICMS.`);
      }
    }
  }
  if (semBase.credito) {
    res.avisos.push(`${semBase.credito} linha(s) ficarão com CST de crédito (50–66) e base de cálculo zero: não gerarão crédito. Para o crédito entrar, escolha também a base (ex.: valor do item).`);
  }
  if (semBase.debito) {
    res.avisos.push(`${semBase.debito} linha(s) ficarão com CST de receita tributada (01/02) e base de cálculo zero: não gerarão débito. Escolha também a base (ex.: valor do item).`);
  }
  if (invalidos.size) {
    const l = [...invalidos];
    res.avisos.push(`${l.length} registro(s) com valor não numérico no campo de valor/base não tiveram a base ou o valor recalculados: ${l.slice(0, 5).join('; ')}${l.length > 5 ? '…' : ''}.`);
  }
  return res;
}

/** Aplica a tributação nas linhas como UMA operação desfazível. */
export function aplicarTributacao(linhas: LinhaQualquer[], a: AcaoTributacao, descricao = 'Alteração de tributação'): ResultadoAcao {
  const erros = validarAcaoTributacao(a);
  if (erros.length) return { linhas: 0, alterados: 0, avisos: [], erros };
  return executar(descricao, () => aplicarTributacaoSemOperacao(linhas, a));
}

// ---------------------------------------------------------------------------
// Exclusão
// ---------------------------------------------------------------------------

export interface OpcoesExclusao {
  /** Item: se a nota ficar sem itens, exclui a nota também. Padrão true. */
  excluirNotaVazia?: boolean;
}

export interface ResultadoExclusao {
  /** Registros principais excluídos (C170, C100, D100/par, C500/par, F100, A170, F120, F130, 0150, 0200). */
  excluidos: number;
  /** Notas (C100 ou A100) excluídas por ficarem sem itens. */
  notasExcluidas: number;
  /** Cadastros (0150/0200) não excluídos por estarem em uso, com o motivo. */
  recusados?: string[];
}

/** Exclui as linhas (sem abrir operação: use `excluirLinhas`). */
export function excluirLinhasSemOperacao(linhas: LinhaQualquer[], opcoes: OpcoesExclusao = {}): ResultadoExclusao {
  const excluirNotaVazia = opcoes.excluirNotaVazia ?? true;
  const res: ResultadoExclusao = { excluidos: 0, notasExcluidas: 0 };
  const notasTocadas = new Map<Registro, Escrituracao>();
  const usos = new Map<Escrituracao, ReturnType<typeof usoAtual>>();
  for (const l of linhas) {
    if (!linhaAnexada(l)) continue;
    switch (l.tipo) {
      case 'item':
      case 'servico':
        remover(l.e, l.reg);
        notasTocadas.set(l.doc, l.e);
        res.excluidos++;
        break;
      case 'nota':
      case 'f100':
      case 'imobDepreciacao':
      case 'imobAquisicao':
        remover(l.e, l.reg);
        res.excluidos++;
        break;
      case 'participante':
      case 'produto': {
        // cadastro em uso não sai (a remoção de órfãos continua automática no recálculo)
        let uso = usos.get(l.e);
        if (!uso) usos.set(l.e, (uso = usoAtual(l.e)));
        const cnpj = l.est?.campos[idx('0140', 'CNPJ')] ?? '';
        const cod = l.reg.campos[1] ?? '';
        if (emUso(uso, cnpj, l.tipo === 'participante' ? 'part' : 'item', cod)) {
          (res.recusados ??= []).push(`${descreverRegistro(l.reg)}: em uso nos documentos; não excluído.`);
          break;
        }
        remover(l.e, l.reg);
        res.excluidos++;
        break;
      }
      case 'frete':
      case 'energia': {
        // documento com um só par (ou nenhum): sai o documento inteiro; senão, só o par
        const pisReg = l.tipo === 'frete' ? 'D101' : 'C501';
        const pares = l.doc.filhos.filter((f) => f.reg === pisReg).length;
        if (pares <= 1) remover(l.e, l.doc);
        else {
          if (l.pis) remover(l.e, l.pis);
          if (l.cofins) remover(l.e, l.cofins);
        }
        res.excluidos++;
        break;
      }
    }
  }
  if (excluirNotaVazia) {
    for (const [nota, e] of notasTocadas) {
      if (nota.pai && !nota.filhos.some((f) => f.reg === 'C170' || f.reg === 'A170')) {
        remover(e, nota);
        res.notasExcluidas++;
      }
    }
  }
  return res;
}

/** Exclui as linhas (itens, notas, fretes, energia, F100) como UMA operação desfazível. */
export function excluirLinhas(linhas: LinhaQualquer[], opcoes: OpcoesExclusao = {}, descricao?: string): ResultadoExclusao {
  return executar(descricao ?? `Exclusão de ${linhas.length} linha(s)`, () => excluirLinhasSemOperacao(linhas, opcoes));
}

// ---------------------------------------------------------------------------
// Inclusão de item
// ---------------------------------------------------------------------------

/**
 * Inclui um item (C170) em uma nota existente (C100), com NUM_ITEM = maior da nota + 1,
 * criando os cadastros que faltarem (0200, 0190, 0400). Totais da nota são refeitos.
 * Devolve o registro criado e os avisos de cadastro.
 */
export function incluirItem(nota: RefRegistro | LinhaQualquer, item: ItemImport): { registro: Registro; avisos: string[] } {
  const c100 = ehLinha(nota) ? nota.doc : nota.reg;
  if (c100.reg !== 'C100') throw new Error('Itens só podem ser incluídos em nota (C100).');
  const est = c100.pai;
  const avisos: string[] = [];
  const registro = executar(`Inclusão de item na ${descreverRegistro(c100)}`, () =>
    incluirC170(nota.e, c100, est?.campos[1] ?? '', item, maiorNumItem(c100) + 1, avisos),
  );
  return { registro, avisos };
}

// ---------------------------------------------------------------------------
// Reversão e diferenças
// ---------------------------------------------------------------------------

/**
 * Volta o registro ao original: campos editados recebem o valor original; registro
 * incluído é excluído. Desfazível.
 */
export function reverterRegistro(ref: RefRegistro): void {
  const { e, reg: r } = ref;
  executar(`Reverter ${descreverRegistro(r)}`, () => {
    if (r.estado === 'novo') {
      remover(e, r);
      return;
    }
    for (const [i, v] of Object.entries(r.antes ?? {})) {
      alterar(e, r, Number(i), v);
      if (r.reg === 'C100' || r.reg === 'C500' || r.reg === 'A100') {
        const campo = leiaute.registros[r.reg].campos[Number(i)].nome;
        if (
          (r.reg === 'C100' && CAMPOS_C100_DERIVADOS.has(campo)) ||
          (r.reg === 'C500' && (campo === 'VL_PIS' || campo === 'VL_COFINS')) ||
          (r.reg === 'A100' && CAMPOS_A100_DERIVADOS.has(campo))
        ) {
          ajustarResiduoPorEdicao(e, r, campo, centavosRapido(v));
        }
      }
    }
  });
}

/** Recoloca um registro excluído no lugar original (se o pai ainda existir). Desfazível. */
export function restaurarExcluido(e: Escrituracao, r: Registro): boolean {
  const pai = estadoDe(e).excluidos.get(r);
  if (!pai || r.pai) return false;
  if (!anexado(e, pai)) return false;
  executar(`Restaurar ${descreverRegistro(r)}`, () => inserir(e, pai, r));
  return true;
}

function anexado(e: Escrituracao, r: Registro): boolean {
  let p: Registro | null = r;
  while (p?.pai) p = p.pai;
  return p === e.raiz;
}

export interface Diferenca {
  tipo: 'editado' | 'incluido' | 'excluido';
  registro: Registro;
  reg: string;
  /** Ex.: "Item 3 (PA.0029) da NF 39327 série 001 (saída)". */
  descricao: string;
  /** Campos alterados (só para "editado"). */
  campos?: { campo: string; antes: string; depois: string }[];
  /** Quantidade de registros filhos incluídos/excluídos junto (ex.: itens de uma nota). */
  filhos?: number;
  /**
   * Mudança feita automaticamente pelo motor (totais, cadastros, contadores, bloco M/1/9),
   * para a tela de conferência poder escondê-la.
   */
  automatico: boolean;
}

const AUTOMATICOS = new Set(['0150', '0190', '0200', '0205', '0206', '0208', '0400', '0500']);

function ehAutomatico(r: Registro, campos?: string[]): boolean {
  const bloco = leiaute.registros[r.reg]?.bloco ?? r.reg[0];
  if (bloco === 'M' || bloco === '1' || bloco === '9') return true;
  // cadastro editado campo a campo é edição do usuário (incluído/excluído continua automático)
  if (campos && (r.reg === '0150' || r.reg === '0200')) return false;
  if (/^.(001|990)$/.test(r.reg) || AUTOMATICOS.has(r.reg)) return true;
  if (campos && r.reg === 'C100') return campos.every((c) => CAMPOS_C100_DERIVADOS.has(c));
  if (campos && r.reg === 'C500') return campos.every((c) => c === 'VL_PIS' || c === 'VL_COFINS');
  if (campos && r.reg === 'A100') return campos.every((c) => CAMPOS_A100_DERIVADOS.has(c));
  return false;
}

function contarSubarvore(r: Registro): number {
  let n = 0;
  for (const f of r.filhos) n += 1 + contarSubarvore(f);
  return n;
}

/**
 * O que mudou na escrituração desde a abertura: registros editados (com campo a campo),
 * incluídos e excluídos (só o registro de cima de cada subárvore).
 */
export function diferencas(e: Escrituracao): Diferenca[] {
  const out: Diferenca[] = [];
  const visita = (r: Registro, paiNovo: boolean) => {
    if (r.estado === 'novo' && !paiNovo) {
      out.push({ tipo: 'incluido', registro: r, reg: r.reg, descricao: descreverRegistro(r), filhos: contarSubarvore(r), automatico: ehAutomatico(r) });
    } else if (r.estado === 'editado' && r.antes) {
      const def = leiaute.registros[r.reg];
      const campos = Object.entries(r.antes).map(([i, antes]) => ({ campo: def?.campos[Number(i)]?.nome ?? `#${i}`, antes, depois: r.campos[Number(i)] ?? '' }));
      out.push({ tipo: 'editado', registro: r, reg: r.reg, descricao: descreverRegistro(r), campos, automatico: ehAutomatico(r, campos.map((c) => c.campo)) });
    }
    const novo = paiNovo || r.estado === 'novo';
    for (const f of r.filhos) visita(f, novo);
  };
  visita(e.raiz, false);
  for (const [r, pai] of estadoDe(e).excluidos) {
    if (r.pai || !anexado(e, pai)) continue; // só o topo de cada subárvore excluída
    out.push({ tipo: 'excluido', registro: r, reg: r.reg, descricao: descreverRegistro(r), filhos: contarSubarvore(r), automatico: ehAutomatico(r) });
  }
  return out;
}
