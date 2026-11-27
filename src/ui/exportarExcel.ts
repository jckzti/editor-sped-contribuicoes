import * as XLSX from 'xlsx';

export function exportarExcel(
  nomeArquivo: string,
  nomeAba: string,
  cabecalhos: readonly string[],
  linhas: readonly (readonly (string | number)[])[]
): void {
  const dados = [
    [...cabecalhos],
    ...linhas.map((linha) => [...linha]),
  ];

  const planilha = XLSX.utils.aoa_to_sheet(dados);

  planilha['!cols'] = cabecalhos.map((titulo, indice) => {
    const maiorConteudo = Math.max(
      titulo.length,
      ...linhas.map((linha) => String(linha[indice] ?? '').length)
    );

    return { wch: Math.min(Math.max(maiorConteudo + 2, 12), 45) };
  });

  const pasta = XLSX.utils.book_new();

  const nomeSeguroAba = nomeAba
    .replace(/[\\/?*[\]:]/g, '-')
    .slice(0, 31) || 'Dados';

  XLSX.utils.book_append_sheet(pasta, planilha, nomeSeguroAba);

  const nomeSeguroArquivo = nomeArquivo
    .replace(/[<>:"/\\|?*]/g, '-')
    .replace(/\.xlsx$/i, '');

  XLSX.writeFile(pasta, `${nomeSeguroArquivo || 'exportacao'}.xlsx`);
}
