/**
 * Apoio aos testes: localiza arquivos SPED reais de amostra na raiz do projeto
 * (ou em ./amostras). Esses arquivos têm dados de clientes e não são versionados;
 * quando não existem, os testes que dependem deles são pulados.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

export function arquivosDeAmostra(): string[] {
  const raiz = process.cwd();
  const out: string[] = [];
  for (const dir of [raiz, join(raiz, 'amostras')]) {
    if (!existsSync(dir)) continue;
    for (const nome of readdirSync(dir)) {
      if (/\.txt$/i.test(nome)) out.push(join(dir, nome));
    }
  }
  return out;
}

export function lerBytes(caminho: string): Uint8Array {
  return new Uint8Array(readFileSync(caminho));
}

/** Conteúdo do arquivo até o fim da linha |9999| (sem a assinatura digital). */
export function semAssinatura(bytes: Uint8Array): Uint8Array {
  const txt = Buffer.from(bytes).toString('latin1');
  const i = txt.lastIndexOf('\n|9999|');
  if (i < 0) return bytes;
  const fim = txt.indexOf('\n', i + 1);
  return bytes.subarray(0, fim < 0 ? bytes.length : fim + 1);
}
