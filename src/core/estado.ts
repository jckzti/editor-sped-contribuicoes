/**
 * Estado de edição de cada escrituração, guardado fora do objeto `Escrituracao`
 * (em um WeakMap) para não mudar o contrato do modelo:
 * - "resíduos" dos totais dos documentos (total original − soma original dos itens);
 * - uso original dos cadastros (para só remover cadastros que NÓS deixamos órfãos);
 * - posição original de cada registro (para restaurar exclusões no mesmo lugar);
 * - registros excluídos, documentos com totais a recalcular, versão da estrutura (caches).
 *
 * O estado é capturado na primeira vez que é pedido (normalmente em `abrirEscrituracao`,
 * antes de qualquer edição).
 */
import { percorrer, type Escrituracao, type Registro } from './modelo';
import {
  detectarDescontoEhIcms,
  detectarVlDocComDesconto,
  detectarVlDocPorNota,
  somasA100,
  somasC100,
  somasC500,
  totaisA100,
  totaisC100,
  totaisC500,
  usoCadastros,
  type UsoCadastros,
} from './leituras';

export interface EstadoEdicao {
  /** Incrementa a cada mudança de estrutura (inclusão/exclusão) ou de cadastro. Usado pelos caches. */
  versao: number;
  /** Incrementa a cada mudança de valor. */
  versaoValores: number;
  /** C100 → resíduos em centavos (ordem de `somasC100`). */
  residuosC100: Map<Registro, number[]>;
  /** C500 → [resíduo VL_PIS, resíduo VL_COFINS]. */
  residuosC500: Map<Registro, number[]>;
  /** A100 → resíduos de VL_BC_PIS, VL_PIS, VL_BC_COFINS, VL_COFINS (ordem de `somasA100`). */
  residuosA100: Map<Registro, number[]>;
  /** O VL_DOC deste arquivo desconta o VL_DESC dos itens? (detectado na abertura; vale para as notas sem fórmula própria) */
  vlDocComDesconto: boolean;
  /** Fórmula do VL_DOC das notas em que só uma das fórmulas fechava na abertura (ver `vlDocComDescontoDe`). */
  vlDocPorNota: Map<Registro, boolean>;
  /** O ERP grava o ICMS do item no VL_DESC do C170 (detectado na abertura)? Ver `detectarDescontoEhIcms`. */
  descontoEhIcms: boolean;
  /** Uso dos cadastros no arquivo original (inclui UNID_INV dos 0200). */
  usoOriginal: UsoCadastros;
  /**
   * Registros de estabelecimento de bloco (C010, D010, F010...) que JÁ estavam sem
   * nenhum filho no arquivo original: não são removidos (não mexer no que não é nosso).
   */
  estabsVaziosOriginal: Set<Registro>;
  /** Registro excluído (que existia antes da exclusão) → pai de onde saiu. */
  excluidos: Map<Registro, Registro>;
  /** Documentos (C100/C500/A100) cujos itens mudaram e cujos totais precisam ser refeitos. */
  sujos: Set<Registro>;
  /** Cadastros removidos por ficarem órfãos, para recolocar se voltarem a ser usados. Chave: reg|cnpj|código. */
  removidosCadastro: Map<string, { registro: Registro; pai: Registro }>;
  /** Caches dos módulos (linhas da grade, índices), invalidados pela versão. */
  cache: Map<string, { versao: number; valor: unknown }>;
}

const estados = new WeakMap<Escrituracao, EstadoEdicao>();
/** Posição de cada registro no arquivo original (ordem de leitura). Registros novos não têm. */
const ordinais = new WeakMap<Registro, number>();

/** Estado de edição da escrituração (capturado na primeira chamada). */
export function estadoDe(e: Escrituracao): EstadoEdicao {
  let st = estados.get(e);
  if (st) return st;
  let n = 0;
  for (const r of percorrer(e.raiz)) if (r.estado !== 'novo') ordinais.set(r, n++);
  const vlDocComDesconto = detectarVlDocComDesconto(e);
  const vlDocPorNota = detectarVlDocPorNota(e);
  const estabsVaziosOriginal = new Set<Registro>();
  for (const bloco of e.raiz.filhos) {
    if (!/^.001$/.test(bloco.reg)) continue;
    for (const f of bloco.filhos) if (/^.010$/.test(f.reg) && f.filhos.length === 0) estabsVaziosOriginal.add(f);
  }
  const residuosC100 = new Map<Registro, number[]>();
  const residuosC500 = new Map<Registro, number[]>();
  const residuosA100 = new Map<Registro, number[]>();
  for (const bloco of e.raiz.filhos) {
    if (bloco.reg === 'A001') {
      for (const a010 of bloco.filhos) for (const doc of a010.filhos) if (doc.reg === 'A100') residuosA100.set(doc, diferenca(totaisA100(doc), somasA100(doc)));
      continue;
    }
    if (bloco.reg !== 'C001') continue;
    for (const c010 of bloco.filhos) {
      for (const doc of c010.filhos) {
        if (doc.reg === 'C100') residuosC100.set(doc, diferenca(totaisC100(doc), somasC100(doc, vlDocPorNota.get(doc) ?? vlDocComDesconto)));
        else if (doc.reg === 'C500') residuosC500.set(doc, diferenca(totaisC500(doc), somasC500(doc)));
      }
    }
  }
  st = {
    versao: 0,
    versaoValores: 0,
    residuosC100,
    residuosC500,
    residuosA100,
    vlDocComDesconto,
    vlDocPorNota,
    descontoEhIcms: detectarDescontoEhIcms(e),
    usoOriginal: usoCadastros(e, true),
    estabsVaziosOriginal,
    excluidos: new Map(),
    sujos: new Set(),
    removidosCadastro: new Map(),
    cache: new Map(),
  };
  estados.set(e, st);
  return st;
}

/** A fórmula do VL_DOC desta nota desconta o VL_DESC dos itens? (a da nota, se tinha; senão a do arquivo) */
export function vlDocComDescontoDe(e: Escrituracao, c100: Registro): boolean {
  const st = estadoDe(e);
  return st.vlDocPorNota.get(c100) ?? st.vlDocComDesconto;
}

function diferenca(a: number[], b: number[]): number[] {
  return a.map((v, i) => v - b[i]);
}

/** Posição do registro no arquivo original (undefined para registros novos). */
export function ordinalOriginal(r: Registro): number | undefined {
  return ordinais.get(r);
}

/** Lê um cache versionado da escrituração (undefined se ausente ou desatualizado). */
export function lerCache<T>(e: Escrituracao, chave: string): T | undefined {
  const st = estadoDe(e);
  const c = st.cache.get(chave);
  return c && c.versao === st.versao ? (c.valor as T) : undefined;
}

export function gravarCache<T>(e: Escrituracao, chave: string, valor: T): T {
  const st = estadoDe(e);
  st.cache.set(chave, { versao: st.versao, valor });
  return valor;
}

/** Invalida os caches (linhas da grade, índices de cadastro) da escrituração. */
export function invalidar(e: Escrituracao): void {
  estadoDe(e).versao++;
}

/**
 * Insere `r` sob `pai` na posição que tinha no arquivo original (pelo ordinal),
 * ou, se for novo, depois dos irmãos do mesmo tipo (ordem do leiaute).
 * Devolve o índice usado.
 */
export function posicaoDeInsercao(pai: Registro, r: Registro, ordemTipo: (reg: string) => number): number {
  const ord = ordinais.get(r);
  const tipo = ordemTipo(r.reg);
  for (let i = 0; i < pai.filhos.length; i++) {
    const irmao = pai.filhos[i];
    const ti = ordemTipo(irmao.reg);
    if (ti > tipo) return i;
    if (ti === tipo && ord !== undefined) {
      const oi = ordinais.get(irmao);
      if (oi !== undefined && oi > ord) return i;
    }
  }
  return pai.filhos.length;
}
