/**
 * Download dos arquivos gerados, feito inteiramente no navegador.
 *
 * Um mês → baixa o .txt direto. Vários meses → junta num .zip (sem compressão
 * para ser instantâneo; o ganho de comprimir não compensa a espera).
 */
import { zipSync } from 'fflate';
import { escreverSped, nomeArquivoSaida } from '../core/escritor';
import type { Escrituracao } from '../core/modelo';

function salvar(bytes: Uint8Array, nome: string, tipo: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type: tipo }));
  const a = document.createElement('a');
  a.href = url;
  a.download = nome;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}

export interface ResultadoDownload {
  arquivos: { nome: string; bytes: number }[];
  /** Caracteres que não existem em ISO-8859-1 e saíram como "?" (por arquivo). */
  caracteresTrocados: number;
}

/** Baixa uma escrituração como .txt. */
export function baixarUma(e: Escrituracao): ResultadoDownload {
  const { bytes, caracteresInvalidos } = escreverSped(e);
  const nome = nomeArquivoSaida(e);
  salvar(bytes, nome, 'text/plain;charset=ISO-8859-1');
  return { arquivos: [{ nome, bytes: bytes.length }], caracteresTrocados: caracteresInvalidos };
}

/**
 * Baixa várias escriturações: uma só vai como .txt, duas ou mais vão num .zip.
 * `extras` (nome → texto) entram no zip junto, ex.: `criterios-usados.txt`.
 */
export function baixarVarias(escrituracoes: Escrituracao[], nomeZip?: string, extras: Record<string, string> = {}): ResultadoDownload {
  if (escrituracoes.length === 0) return { arquivos: [], caracteresTrocados: 0 };
  if (escrituracoes.length === 1) return baixarUma(escrituracoes[0]);

  const conteudo: Record<string, Uint8Array> = {};
  const arquivos: { nome: string; bytes: number }[] = [];
  let trocados = 0;
  for (const e of escrituracoes) {
    const { bytes, caracteresInvalidos } = escreverSped(e);
    let nome = nomeArquivoSaida(e);
    // nomes repetidos (mesmo CNPJ e período carregados duas vezes) recebem sufixo
    for (let i = 2; nome in conteudo; i++) nome = nomeArquivoSaida(e).replace(/\.txt$/, `_${i}.txt`);
    conteudo[nome] = bytes;
    arquivos.push({ nome, bytes: bytes.length });
    trocados += caracteresInvalidos;
  }
  for (const [nome, texto] of Object.entries(extras)) conteudo[nome] = new TextEncoder().encode(texto);
  const cnpjs = new Set(escrituracoes.map((e) => e.cnpj));
  const periodos = escrituracoes.map((e) => e.periodo).sort();
  const padrao =
    cnpjs.size === 1
      ? `EFD_CONTRIB_${escrituracoes[0].cnpj}_${periodos[0]}-${periodos[periodos.length - 1]}_ajustado.zip`
      : `EFD_CONTRIB_ajustado_${periodos[0]}-${periodos[periodos.length - 1]}.zip`;
  salvar(zipSync(conteudo, { level: 0 }), nomeZip ?? padrao, 'application/zip');
  return { arquivos, caracteresTrocados: trocados };
}

/** Baixa um texto qualquer (regras em JSON, CSV de conferência, relatório). */
export function baixarTexto(texto: string, nome: string, tipo = 'text/plain;charset=utf-8'): void {
  salvar(new TextEncoder().encode(texto), nome, tipo);
}
