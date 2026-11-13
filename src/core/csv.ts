/**
 * Exportação de linhas da grade para CSV de conferência em planilha
 * (Excel em português): separador ";", decimal vírgula (como no SPED), datas
 * DD/MM/AAAA e BOM UTF-8 no início para acentuação correta.
 */
import { coluna, leitor, type Coluna, type LinhaQualquer } from './linhas';
import { spedParaBr } from './util';

function escapar(v: string): string {
  return /[;"\r\n]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}

/**
 * Gera o texto CSV (com BOM) das linhas nas colunas pedidas (ids ou objetos `Coluna`).
 * Códigos com zeros à esquerda (CST, CFOP, NCM, chave) saem como texto entre aspas
 * precedidas de "=" para o Excel não tirar os zeros.
 */
export function exportarLinhasCsv(linhas: LinhaQualquer[], colunas: (string | Coluna)[]): string {
  if (!linhas.length) return '﻿' + colunas.map((c) => escapar(typeof c === 'string' ? c : c.rotulo)).join(';') + '\r\n';
  const tipo = linhas[0].tipo;
  const cols = colunas.map((c) => {
    const col = typeof c === 'string' ? coluna(tipo, c) : c;
    if (!col) throw new Error(`Coluna "${String(c)}" não existe nas linhas do tipo ${tipo}.`);
    return { col, ler: leitor(tipo, col.id) };
  });
  const partes: string[] = ['﻿' + cols.map(({ col }) => escapar(col.rotulo)).join(';')];
  for (const l of linhas) {
    const campos = cols.map(({ col, ler }) => {
      const v = ler(l);
      if (!v) return '';
      if (col.tipo === 'data') return spedParaBr(v);
      if (col.tipo === 'codigo' && /^0\d|^\d{12,}$/.test(v)) return `="${v}"`;
      return escapar(v);
    });
    partes.push(campos.join(';'));
  }
  return partes.join('\r\n') + '\r\n';
}
