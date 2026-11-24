import * as XLSX from 'xlsx';
import { expect, it, vi } from 'vitest';
import { lerSped } from '../core/leitor';
import { colunas, linhasDe, type TipoLinhaTodos } from '../core/linhas';
import { get, listar } from '../core/modelo';
import { desfazer } from '../core/operacao';
import { exportarExcel } from './exportarExcel';
import { exportarGradeExcel, prepararExcel } from './importarExcel';

vi.mock('./exportarExcel', () => ({ exportarExcel: vi.fn() }));

const cnpj = '12345678000195';
const fornecedor = '11222333000181';

function escrituracao() {
  return lerSped(new TextEncoder().encode([
    `|0000|006|0|||01012025|31012025|EMPRESA TESTE|${cnpj}|SC|4202404||00|9|`,
    '|0001|0|', `|0140|1|EMPRESA TESTE|${cnpj}|SC||4202404|||`,
    `|0150|P1|FORNECEDOR|1058|${fornecedor}|||4202404||||||`,
    '|0190|UN|UNIDADE|', '|0200|I1|ITEM UM|||UN|01|48211000||48|||', '|0990|6|',
    '|C001|0|', `|C010|${cnpj}|2|`,
    '|C100|0|1|P1|55|00|1|1||10012025|10012025|100|1|0|0|100|9|0|0|0|0|0|0|0|0|0|0|0|0|',
    '|C170|1|I1||1|UN|100|0|0|000|1101||0|0|0|0|0|0|0|||0|0|0|50|100|1,65|||1,65|50|100|7,6|||7,6||',
    '|C990|4|', '|9001|0|', '|9900|0000|1|', '|9990|2|', '|9999|14|', '',
  ].join('\n')), 'sintetica.txt');
}

function planilha(e: ReturnType<typeof escrituracao>, aba: string, tipo: TipoLinhaTodos) {
  const linhas = linhasDe(e, tipo);
  exportarGradeExcel('teste', aba, tipo, colunas(tipo), linhas);
  const [, , titulos, dados, extras] = vi.mocked(exportarExcel).mock.lastCall!;
  const pasta = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(pasta, XLSX.utils.aoa_to_sheet([[...titulos], ...dados.map((l) => [...l])]), aba);
  for (const [nome, cabecalho] of Object.entries(extras ?? {})) XLSX.utils.book_append_sheet(pasta, XLSX.utils.aoa_to_sheet([[...cabecalho]]), nome);
  const acrescentar = (nome: string, valores: Record<string, string>) => {
    const folha = pasta.Sheets[nome];
    const [campos] = XLSX.utils.sheet_to_json<string[]>(folha, { header: 1 });
    XLSX.utils.sheet_add_aoa(folha, [campos.map((c) => valores[c] ?? '')], { origin: -1 });
  };
  const previa = () => prepararExcel(XLSX.write(pasta, { bookType: 'xlsx', type: 'array' }), 'teste.xlsx', aba, tipo, linhasDe(e, tipo), [e]);
  return { pasta, titulos, acrescentar, previa };
}

it('atualiza cadastros, mantém novos produtos sem uso e rejeita planilha desatualizada', () => {
  const e = escrituracao();
  const p = planilha(e, 'Cadastros', 'produto');
  const descricao = p.titulos.findIndex((c) => c.endsWith('[0200.DESCR_ITEM]'));
  expect(descricao).toBeGreaterThan(1);
  XLSX.utils.sheet_add_aoa(p.pasta.Sheets.Cadastros, [['Descrição revisada']], { origin: { r: 1, c: descricao } });
  p.acrescentar('Novos cadastros', { 'CNPJ estabelecimento': cnpj, 'Período': '2025-01', COD_ITEM: 'I2', DESCR_ITEM: 'NOVO', UNID_INV: 'UN', TIPO_ITEM: '01' });
  const previa = p.previa();
  expect(previa.erros).toEqual([]);
  expect(listar(e, '0200')).toHaveLength(1);
  previa.aplicar();
  expect(listar(e, '0200').map((r) => get(r, 'DESCR_ITEM'))).toEqual(['Descrição revisada', 'NOVO']);
  expect(p.previa().erros.join(' ')).toMatch(/mudou após a exportação/);
  desfazer();
  expect(listar(e, '0200').map((r) => get(r, 'DESCR_ITEM'))).toEqual(['ITEM UM']);
});

it('prevê uma nota inteira e um item em nota existente antes de aplicar juntos', () => {
  const e = escrituracao();
  const p = planilha(e, 'Documentos', 'item');
  p.acrescentar('Novas notas', {
    Grupo: 'N2', 'CNPJ estabelecimento': cnpj, 'Período': '2025-01', Operação: 'entrada', Emissão: 'terceiros', Modelo: '01',
    Série: '1', Número: '2', 'Data documento': '2025-01-11', 'CPF ou CNPJ participante': fornecedor, 'Nome participante': 'FORNECEDOR',
  });
  const item = { Código: 'I1', Descrição: 'ITEM UM', Unidade: 'UN', Quantidade: '1', 'Valor do item': '25', CFOP: '1101', 'CST PIS': '50', 'Alíquota PIS': '1,65', 'CST COFINS': '50', 'Alíquota COFINS': '7,6' };
  p.acrescentar('Novos itens', { ...item, Grupo: 'N2' });
  p.acrescentar('Novos itens', { ...item, 'CNPJ estabelecimento': cnpj, 'Período': '2025-01', 'Número da nota existente': '1', 'Série da nota existente': '1', 'CPF ou CNPJ participante': fornecedor });
  const previa = p.previa();
  expect(previa.erros).toEqual([]);
  expect(previa.mudancas).toHaveLength(2);
  expect(listar(e, 'C100')).toHaveLength(1);
  expect(listar(e, 'C170')).toHaveLength(1);
  previa.aplicar();
  expect(listar(e, 'C100')).toHaveLength(2);
  expect(listar(e, 'C170')).toHaveLength(3);
  desfazer();
  expect(listar(e, 'C100')).toHaveLength(1);
  expect(listar(e, 'C170')).toHaveLength(1);
});
