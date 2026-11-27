/**
 * O que fica guardado no localStorage: preferências de tela, regras salvas e, a pedido,
 * critérios da apuração lembrados por empresa. Arquivos e edições ficam no IndexedDB.
 *
 * Preferências continuam no localStorage; a sessão com arquivos e edições fica no IndexedDB.
 */
import { exportarRegras, importarRegras, type Regra } from '../core/regras';
import type { TipoLinhaTodos } from '../core/linhas';
import type { EscolhasCriterios } from '../core/apuracao';

const CHAVE_PREF = 'sped-contrib.preferencias';
const CHAVE_REGRAS = 'sped-contrib.regras';

export interface Preferencias {
  aba: string;
  /** Tipo de linha da aba Documentos. */
  tipoLinha: TipoLinhaTodos;
  /** Tipo de linha da aba Cadastros. */
  tipoCadastro: TipoLinhaTodos;
  /** Colunas visíveis por tipo de linha. */
  colunas: Partial<Record<TipoLinhaTodos, string[]>>;
}

const PADRAO: Preferencias = { aba: 'documentos', tipoLinha: 'item', tipoCadastro: 'participante', colunas: {} };

export function lerPreferencias(): Preferencias {
  try {
    const bruto = localStorage.getItem(CHAVE_PREF);
    if (!bruto) return { ...PADRAO };
    const p = JSON.parse(bruto) as Partial<Preferencias>;
    return { ...PADRAO, ...p, colunas: p.colunas ?? {} };
  } catch {
    return { ...PADRAO };
  }
}

export function gravarPreferencias(p: Preferencias): void {
  try {
    localStorage.setItem(CHAVE_PREF, JSON.stringify(p));
  } catch {
    /* navegação privada ou armazenamento cheio: a tela funciona sem isso */
  }
}

export function lerRegrasSalvas(): Regra<TipoLinhaTodos>[] {
  try {
    const bruto = localStorage.getItem(CHAVE_REGRAS);
    return bruto ? importarRegras(bruto, { todosOsTipos: true }) : [];
  } catch {
    return [];
  }
}

export function gravarRegrasSalvas(regras: Regra<TipoLinhaTodos>[]): void {
  try {
    localStorage.setItem(CHAVE_REGRAS, exportarRegras(regras));
  } catch {
    /* idem */
  }
}

const CHAVE_CRITERIOS = 'sped-contrib.criterios-lembrados';

/**
 * Critérios da apuração que a pessoa pediu para "lembrar para esta empresa" (CNPJ →
 * escolhas). Só é gravado a pedido; ao abrir a rotina eles aparecem preenchidos para
 * CONFIRMAR, nunca valem sozinhos.
 */
export function lerCriteriosLembrados(): Record<string, EscolhasCriterios> {
  try {
    const bruto = localStorage.getItem(CHAVE_CRITERIOS);
    return bruto ? (JSON.parse(bruto) as Record<string, EscolhasCriterios>) : {};
  } catch {
    return {};
  }
}

export function gravarCriteriosLembrados(m: Record<string, EscolhasCriterios>): void {
  try {
    if (Object.keys(m).length) localStorage.setItem(CHAVE_CRITERIOS, JSON.stringify(m));
    else localStorage.removeItem(CHAVE_CRITERIOS);
  } catch {
    /* sem armazenamento: só não lembra */
  }
}
