/** Biblioteca local de arquivos, organizada por empresa e período no IndexedDB. */
import type { ConfigApuracao } from '../core/apuracao';
import type { Escrituracao } from '../core/modelo';
import type { RelatorioRecalculo } from '../core/recalcular';
import type { Regra } from '../core/regras';
import type { Sessao } from '../core/sessao';

const BANCO = 'editor-sped-contribuicoes';
const VERSAO = 2;
const LEGADO = 'sessao';
const ARQUIVOS = 'arquivos';
const CATALOGO = 'catalogo';
const ESTADO = 'estado';

export interface ArquivoCatalogo {
  id: string;
  cnpj: string;
  empresa: string;
  periodo: string;
  nomeArquivo: string;
  alterada: boolean;
  apuracaoDesatualizada: boolean;
}

interface ArquivoSalvo {
  escrituracao: Escrituracao;
  apuracaoDesatualizada: boolean;
  relatorio: RelatorioRecalculo | null;
}

interface EstadoGlobal {
  config: ConfigApuracao;
  regras: Regra[];
}

export interface SessaoCarregada {
  escrituracoes: Escrituracao[];
  config: ConfigApuracao;
  regras: Regra[];
  apuracaoDesatualizada: boolean;
  relatorios: RelatorioRecalculo[];
}

function metadados(e: Escrituracao, apuracaoDesatualizada: boolean): ArquivoCatalogo {
  return {
    id: e.id,
    cnpj: e.cnpj,
    empresa: e.nome,
    periodo: e.periodo,
    nomeArquivo: e.nomeArquivo,
    alterada: e.alterada,
    apuracaoDesatualizada,
  };
}

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador não oferece armazenamento local para os arquivos.'));
      return;
    }
    const pedido = indexedDB.open(BANCO, VERSAO);
    pedido.onupgradeneeded = (evento) => {
      const db = pedido.result;
      const tx = pedido.transaction!;
      if (!db.objectStoreNames.contains(LEGADO)) db.createObjectStore(LEGADO);
      if (!db.objectStoreNames.contains(ARQUIVOS)) db.createObjectStore(ARQUIVOS);
      if (!db.objectStoreNames.contains(CATALOGO)) db.createObjectStore(CATALOGO);
      if (!db.objectStoreNames.contains(ESTADO)) db.createObjectStore(ESTADO);
      if (evento.oldVersion === 0) return;

      // Migra a sessão única da versão anterior sem reler nem regravar o SPED.
      const legado = tx.objectStore(LEGADO).get('atual');
      legado.onsuccess = () => {
        const antiga = legado.result as
          | { config?: ConfigApuracao; regras?: Regra[]; escrituracoes?: Escrituracao[]; apuracaoDesatualizada?: boolean; relatorios?: RelatorioRecalculo[] }
          | undefined;
        if (!antiga) return;
        tx.objectStore(ESTADO).put({ config: antiga.config, regras: antiga.regras ?? [] }, 'global');
        for (const e of antiga.escrituracoes ?? []) {
          const relatorio = antiga.relatorios?.find((r) => r.escrituracaoId === e.id) ?? null;
          const desatualizada = antiga.apuracaoDesatualizada ?? e.alterada;
          tx.objectStore(ARQUIVOS).put({ escrituracao: e, apuracaoDesatualizada: desatualizada, relatorio } satisfies ArquivoSalvo, e.id);
          tx.objectStore(CATALOGO).put(metadados(e, desatualizada), e.id);
        }
        tx.objectStore(LEGADO).delete('atual');
      };
    };
    pedido.onsuccess = () => {
      pedido.result.onversionchange = () => pedido.result.close();
      resolve(pedido.result);
    };
    pedido.onerror = () => reject(pedido.error ?? new Error('Não foi possível abrir o armazenamento local.'));
    pedido.onblocked = () => reject(new Error('Feche outras abas deste editor e tente novamente.'));
  });
}

function concluir(tx: IDBTransaction): Promise<void> {
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Não foi possível acessar os arquivos salvos.'));
  });
}

export async function listarArquivosSalvos(): Promise<ArquivoCatalogo[]> {
  const db = await abrirBanco();
  try {
    const tx = db.transaction(CATALOGO, 'readonly');
    const itens = await new Promise<ArquivoCatalogo[]>((resolve, reject) => {
      const pedido = tx.objectStore(CATALOGO).getAll();
      pedido.onsuccess = () => resolve(pedido.result as ArquivoCatalogo[]);
      pedido.onerror = () => reject(pedido.error ?? new Error('Não foi possível listar os arquivos salvos.'));
    });
    await concluir(tx);
    return itens.sort((a, b) => a.empresa.localeCompare(b.empresa) || a.cnpj.localeCompare(b.cnpj) || a.periodo.localeCompare(b.periodo));
  } finally {
    db.close();
  }
}

export async function guardarArquivo(e: Escrituracao, apuracaoDesatualizada = false, relatorio: RelatorioRecalculo | null = null): Promise<void> {
  const db = await abrirBanco();
  try {
    const tx = db.transaction([ARQUIVOS, CATALOGO], 'readwrite');
    tx.objectStore(ARQUIVOS).put({ escrituracao: e, apuracaoDesatualizada, relatorio } satisfies ArquivoSalvo, e.id);
    tx.objectStore(CATALOGO).put(metadados(e, apuracaoDesatualizada), e.id);
    await concluir(tx);
  } finally {
    db.close();
  }
}

export async function guardarSessaoAtiva(sessao: Sessao, apuracaoDesatualizada: boolean, relatorios: RelatorioRecalculo[] | null): Promise<void> {
  const db = await abrirBanco();
  try {
    const tx = db.transaction([ARQUIVOS, CATALOGO, ESTADO], 'readwrite');
    tx.objectStore(ESTADO).put({ config: sessao.config, regras: sessao.regras }, 'global');
    const arquivos = tx.objectStore(ARQUIVOS);
    const catalogo = tx.objectStore(CATALOGO);
    const porId = new Map((relatorios ?? []).map((r) => [r.escrituracaoId, r]));
    for (const e of sessao.escrituracoes) {
      const anterior = arquivos.get(e.id);
      anterior.onsuccess = () => {
        const registro = anterior.result as ArquivoSalvo | undefined;
        const relatorio = porId.get(e.id) ?? registro?.relatorio ?? null;
        arquivos.put({ escrituracao: e, apuracaoDesatualizada, relatorio } satisfies ArquivoSalvo, e.id);
        catalogo.put(metadados(e, apuracaoDesatualizada), e.id);
      };
    }
    await concluir(tx);
  } finally {
    db.close();
  }
}

export async function carregarArquivosSalvos(ids: string[], configPadrao: ConfigApuracao, regrasPadrao: Regra[]): Promise<SessaoCarregada> {
  const db = await abrirBanco();
  try {
    const tx = db.transaction([ARQUIVOS, CATALOGO, ESTADO], 'readonly');
    const dados = await new Promise<{ arquivos: ArquivoSalvo[]; catalogo: ArquivoCatalogo[]; global?: EstadoGlobal }>((resolve, reject) => {
      const arquivos: ArquivoSalvo[] = [];
      const catalogo: ArquivoCatalogo[] = [];
      let global: EstadoGlobal | undefined;
      let pendentes = ids.length + 1;
      const finalizar = () => {
        if (!pendentes) resolve({ arquivos, catalogo, global });
      };
      const reqGlobal = tx.objectStore(ESTADO).get('global');
      reqGlobal.onsuccess = () => { global = reqGlobal.result as EstadoGlobal | undefined; pendentes--; finalizar(); };
      reqGlobal.onerror = () => reject(reqGlobal.error ?? new Error('Não foi possível abrir a configuração salva.'));
      for (const id of ids) {
        const reqArquivo = tx.objectStore(ARQUIVOS).get(id);
        const reqMeta = tx.objectStore(CATALOGO).get(id);
        let concluido = 0;
        const pronto = () => {
          concluido++;
          if (concluido !== 2) return;
          if (!reqArquivo.result || !reqMeta.result) {
            reject(new Error('Um dos períodos selecionados não está mais disponível. Atualize a lista e tente novamente.'));
            return;
          }
          arquivos.push(reqArquivo.result as ArquivoSalvo);
          catalogo.push(reqMeta.result as ArquivoCatalogo);
          pendentes--;
          finalizar();
        };
        reqArquivo.onsuccess = reqMeta.onsuccess = pronto;
        reqArquivo.onerror = reqMeta.onerror = () => reject(new Error('Não foi possível abrir um dos períodos selecionados.'));
      }
    });
    await concluir(tx);
    const stale = new Set(dados.catalogo.filter((m) => m.apuracaoDesatualizada).map((m) => m.id));
    return {
      escrituracoes: dados.arquivos.map((r) => r.escrituracao).sort((a, b) => a.periodo.localeCompare(b.periodo)),
      config: dados.global?.config ?? configPadrao,
      regras: dados.global?.regras ?? regrasPadrao,
      apuracaoDesatualizada: [...stale].length > 0,
      relatorios: dados.arquivos.map((r) => r.relatorio).filter((r): r is RelatorioRecalculo => !!r),
    };
  } finally {
    db.close();
  }
}
