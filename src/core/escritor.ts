/**
 * Gravação da árvore de registros de volta para o formato .txt da EFD-Contribuições
 * (ISO-8859-1, uma linha por registro, campos entre "|").
 *
 * Não recalcula nada: contadores (x990, 9900, 9999) e apuração são
 * responsabilidade de `recalcular`. Um arquivo lido e gravado sem edição sai
 * idêntico ao original (sem a assinatura).
 */
import { percorrer, type Escrituracao } from './modelo';

export function escreverTexto(e: Escrituracao): string {
  const partes: string[] = [];
  for (const r of percorrer(e.raiz)) {
    partes.push('|' + r.campos.join('|') + '|');
  }
  return partes.join(e.quebraLinha) + e.quebraLinha;
}

export interface ResultadoEscrita {
  bytes: Uint8Array;
  /** Caracteres fora do Latin-1 que precisaram ser trocados por "?". */
  caracteresInvalidos: number;
}

export function escreverSped(e: Escrituracao): ResultadoEscrita {
  const texto = escreverTexto(e);
  const bytes = new Uint8Array(texto.length);
  let invalidos = 0;
  for (let i = 0; i < texto.length; i++) {
    const c = texto.charCodeAt(i);
    if (c > 0xff) {
      bytes[i] = 0x3f;
      invalidos++;
    } else bytes[i] = c;
  }
  return { bytes, caracteresInvalidos: invalidos };
}

/** Nome sugerido para o arquivo gerado: CNPJ + período + sufixo. */
export function nomeArquivoSaida(e: Escrituracao): string {
  return `EFD_CONTRIB_${e.cnpj}_${e.periodo}_ajustado.txt`;
}
