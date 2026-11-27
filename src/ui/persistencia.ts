/** Guarda a sessão de trabalho localmente no navegador, sem enviar dados à rede. */
import type { RelatorioRecalculo } from '../core/recalcular';
import type { Sessao } from '../core/sessao';

export type SessaoPersistida = Partial<Sessao> & {
  apuracaoDesatualizada?: boolean;
  relatorios?: RelatorioRecalculo[] | null;
};

const BANCO = 'editor-sped-contribuicoes';
const VERSAO = 1;
const ARMAZENAMENTO = 'sessao';

function abrirBanco(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('Este navegador não oferece armazenamento local para a sessão.'));
      return;
    }
    const pedido = indexedDB.open(BANCO, VERSAO);
    pedido.onupgradeneeded = () => {
      if (!pedido.result.objectStoreNames.contains(ARMAZENAMENTO)) pedido.result.createObjectStore(ARMAZENAMENTO);
    };
    pedido.onsuccess = () => resolve(pedido.result);
    pedido.onerror = () => reject(pedido.error ?? new Error('Não foi possível abrir o armazenamento local.'));
  });
}

export async function lerSessaoLocal(): Promise<SessaoPersistida | null> {
  const db = await abrirBanco();
  try {
    return await new Promise((resolve, reject) => {
      const pedido = db.transaction(ARMAZENAMENTO, 'readonly').objectStore(ARMAZENAMENTO).get('atual');
      pedido.onsuccess = () => resolve((pedido.result as SessaoPersistida | undefined) ?? null);
      pedido.onerror = () => reject(pedido.error ?? new Error('Não foi possível restaurar a sessão.'));
    });
  } finally {
    db.close();
  }
}

export async function gravarSessaoLocal(sessao: Sessao, apuracaoDesatualizada: boolean, relatorios: RelatorioRecalculo[] | null): Promise<void> {
  const db = await abrirBanco();
  try {
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(ARMAZENAMENTO, 'readwrite');
      tx.objectStore(ARMAZENAMENTO).put({ config: sessao.config, regras: sessao.regras, escrituracoes: sessao.escrituracoes, apuracaoDesatualizada, relatorios }, 'atual');
      tx.oncomplete = () => resolve();
      tx.onabort = tx.onerror = () => reject(tx.error ?? new Error('Não foi possível guardar a sessão neste navegador.'));
    });
  } finally {
    db.close();
  }
}
