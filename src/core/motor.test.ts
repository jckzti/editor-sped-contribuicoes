import { beforeEach, describe, expect, it } from 'vitest';
import { arquivosDeAmostra, lerBytes, semAssinatura } from './amostra';
import {
  abrirEscrituracao,
  aplicarAcoes,
  aplicarRegra,
  aplicarRegras,
  aplicarTributacao,
  apuracaoNula,
  configInicial,
  configPadrao,
  definirLimiteHistorico,
  definirLimiteMemoriaHistorico,
  diferencas,
  desfazer,
  dvChave,
  editarCampos,
  escreverSped,
  excluirLinhas,
  exportarLinhasCsv,
  exportarRegras,
  filtrar,
  get,
  importarPacote,
  importarRegras,
  incluirItem,
  indices,
  lerSped,
  limparHistorico,
  linhasDe,
  linhasDeTodas,
  listar,
  novaRegra,
  ordenar,
  podeDesfazer,
  previsualizarAcoes,
  previsualizarRegra,
  recalcular,
  recalcularApuracao,
  recontar,
  refazer,
  reverterRegistro,
  historico,
  sincronizarEstabelecimentos,
  somar,
  usoHistorico,
  validar,
  valor,
  xmlNfeParaNota,
  converterCfopEntrada,
  cfopEntradaCorrespondente,
  type Escrituracao,
  type Linha,
  type PacoteImportacao,
  type Regra,
} from './index';
import { centavos } from './dec';
import { BYTES_POR_CAMPO } from './mutacao';

const amostras = arquivosDeAmostra();
const caminho = amostras.find((p) => /PICC2B/i.test(p)) ?? amostras[0];

function abrir(trocarPeriodo?: [string, string]): { e: Escrituracao; original: Buffer } {
  let bytes = lerBytes(caminho);
  if (trocarPeriodo) {
    const txt = Buffer.from(bytes).toString('latin1').replace('|01032025|31032025|', `|${trocarPeriodo[0]}|${trocarPeriodo[1]}|`);
    bytes = new Uint8Array(Buffer.from(txt, 'latin1'));
  }
  const e = abrirEscrituracao(bytes, caminho.split('/').pop()!);
  return { e, original: Buffer.from(semAssinatura(bytes)) };
}

const bytesDe = (e: Escrituracao) => Buffer.from(escreverSped(e).bytes);
const cfg = configInicial();
/** Critérios escolhidos explicitamente (não há padrão). */
const comCriterios = () => ({ ...configPadrao(), saldoCredor: 'somente-mes' as const, ordemUsoCredito: 'anteriores-primeiro' as const, receitaBruta0111: 'manter' as const });
const recalcNulo = (es: Escrituracao[], todas = true) => recalcular(es, cfg, { todas, apuracao: apuracaoNula });
const n9900 = (e: Escrituracao, reg: string) => Number(listar(e, '9900').find((r) => r.campos[1] === reg)?.campos[2] ?? 0);
// (listar() do modelo não acha registros de nível 0 além da raiz, como o 9999)
const qtdLin = (e: Escrituracao, reg: string) => Number(e.raiz.filhos.find((f) => f.reg === reg)?.campos[1]);

/** Gera CNPJ válido a partir de 12 dígitos. */
function cnpj(base12: string): string {
  const dv = (s: string) => {
    let soma = 0;
    let peso = s.length - 7;
    for (const ch of s) {
      soma += Number(ch) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  const d1 = dv(base12);
  return base12 + d1 + dv(base12 + d1);
}

function chave(cuf: string, aamm: string, cnpjEmit: string, mod: string, serie: string, numero: string): string {
  const c43 = cuf + aamm + cnpjEmit + mod + serie.padStart(3, '0') + numero.padStart(9, '0') + '1' + '12345678';
  return c43 + dvChave(c43);
}

const TETO_PADRAO = 300 * 1024 * 1024;

beforeEach(() => {
  limparHistorico();
  definirLimiteMemoriaHistorico(TETO_PADRAO);
  definirLimiteHistorico(200);
});

/** Escrituração mínima a partir de linhas de registro (para casos que a amostra não tem). */
function sintetica(linhas: string[]): Escrituracao {
  return lerSped(new Uint8Array(Buffer.from(linhas.join('\n') + '\n', 'latin1')), 'sintetica.txt');
}

describe.skipIf(!caminho)('motor de edição com a amostra real', () => {
  it('prova real: abrir → recalcular (apuração nula) → gravar = original; recalcular de novo não muda nada', () => {
    const { e, original } = abrir();
    expect(recontar(e).alteracoes).toBe(0);
    const rel = recalcNulo([e]);
    expect(rel[0].alteracoesAutomaticas).toBe(0);
    expect(bytesDe(e).equals(original)).toBe(true);
    recalcNulo([e]);
    expect(bytesDe(e).equals(original)).toBe(true);
    expect(diferencas(e)).toEqual([]);
  });

  it('editar CST/base dos itens atualiza C100.VL_PIS/VL_COFINS; desfazer volta byte a byte', () => {
    const { e, original } = abrir();
    const nota = linhasDe(e, 'nota').find((l) => get(l.reg, 'IND_OPER') === '0' && l.reg.filhos.filter((f) => f.reg === 'C170').length >= 2)!;
    const itens = linhasDe(e, 'item').filter((l) => l.doc === nota.reg);
    const pisAntes = centavos(get(nota.reg, 'VL_PIS'));
    const somaAntes = itens.reduce((s, l) => s + centavos(get(l.reg, 'VL_PIS')), 0);
    const r = aplicarTributacao(itens, { tipo: 'tributacao', cst: '50', aliqPis: '1,65', aliqCofins: '7,6', base: 'valor-item' });
    expect(r.erros).toEqual([]);
    expect(r.linhas).toBe(itens.length);
    for (const l of itens) {
      expect(get(l.reg, 'CST_PIS')).toBe('50');
      expect(get(l.reg, 'VL_BC_PIS')).toBe(get(l.reg, 'VL_ITEM'));
    }
    const somaDepois = itens.reduce((s, l) => s + centavos(get(l.reg, 'VL_PIS')), 0);
    expect(centavos(get(nota.reg, 'VL_PIS'))).toBe(pisAntes - somaAntes + somaDepois);
    const somaCofins = itens.reduce((s, l) => s + centavos(get(l.reg, 'VL_COFINS')), 0);
    expect(centavos(get(nota.reg, 'VL_COFINS'))).toBe(somaCofins);
    expect(e.alterada).toBe(true);
    const difs = diferencas(e);
    expect(difs.some((d) => d.reg === 'C170' && !d.automatico)).toBe(true);
    const depois = bytesDe(e);
    desfazer();
    expect(bytesDe(e).equals(original)).toBe(true);
    refazer();
    expect(bytesDe(e).equals(depois)).toBe(true);
  });

  it('editarCampos valida pelo leiaute e normaliza números', () => {
    const { e } = abrir();
    const l = linhasDe(e, 'item')[0];
    const ruim = editarCampos(l, { CST_PIS: 'XX', VL_ITEM: '12,345', CFOP: '510' });
    expect(ruim.ok).toBe(false);
    expect(ruim.erros.map((x) => x.campo).sort()).toEqual(['CFOP', 'CST_PIS', 'VL_ITEM']);
    expect(e.alterada).toBe(false);
    const bom = editarCampos(l, { VL_BC_PIS: '1.234,50', CST_PIS: '1', 'C100.DT_E_S': '05/03/2025' });
    expect(bom.ok).toBe(true);
    expect(get(l.reg, 'VL_BC_PIS')).toBe('1234,5');
    expect(get(l.reg, 'CST_PIS')).toBe('01');
    expect(get(l.doc, 'DT_E_S')).toBe('05032025');
    // editar total da nota fixa o valor (resíduo) mesmo depois de mexer nos itens
    const notaLinha = linhasDe(e, 'nota').find((n) => n.reg === l.doc)!;
    editarCampos(notaLinha, { VL_DOC: '999,99' });
    aplicarTributacao([l], { tipo: 'tributacao', base: 'valor-item' });
    expect(get(l.doc, 'VL_DOC')).toBe('999,99');
  });

  it('excluir nota inteira remove cadastros órfãos e ajusta contadores; arquivo relido é íntegro', () => {
    const { e, original } = abrir();
    // nota cujo participante e itens só aparecem nela
    const usoPart = new Map<string, number>();
    const usoItem = new Map<string, number>();
    for (const r of ['C100', 'D100', 'C500', 'F100']) for (const d of listar(e, r)) usoPart.set(get(d, 'COD_PART'), (usoPart.get(get(d, 'COD_PART')) ?? 0) + 1);
    for (const it of listar(e, 'C170')) usoItem.set(get(it, 'COD_ITEM'), (usoItem.get(get(it, 'COD_ITEM')) ?? 0) + 1);
    const nota = linhasDe(e, 'nota').find((l) => {
      const itens = l.reg.filhos.filter((f) => f.reg === 'C170');
      return usoPart.get(get(l.reg, 'COD_PART')) === 1 && itens.length > 0 && itens.some((i) => usoItem.get(get(i, 'COD_ITEM')) === 1);
    })!;
    expect(nota).toBeTruthy();
    const itens = nota.reg.filhos.filter((f) => f.reg === 'C170');
    const itensOrfaos = new Set(itens.map((i) => get(i, 'COD_ITEM')).filter((c) => usoItem.get(c) === itens.filter((i) => get(i, 'COD_ITEM') === c).length));
    const codPart = get(nota.reg, 'COD_PART');
    const antes = { c990: qtdLin(e, 'C990'), o990: qtdLin(e, '0990'), c100: n9900(e, 'C100'), c170: n9900(e, 'C170'), p150: n9900(e, '0150'), i200: n9900(e, '0200'), total: qtdLin(e, '9999') };
    const filhos0205 = listar(e, '0200').filter((r) => itensOrfaos.has(get(r, 'COD_ITEM'))).reduce((s, r) => s + r.filhos.length, 0);

    excluirLinhas([nota]);
    expect(indices(e).padrao.part.has(codPart)).toBe(false);
    for (const c of itensOrfaos) expect(indices(e).padrao.item.has(c)).toBe(false);
    expect(qtdLin(e, 'C990')).toBe(antes.c990 - 1 - itens.length);
    expect(n9900(e, 'C100')).toBe(antes.c100 - 1);
    expect(n9900(e, 'C170')).toBe(antes.c170 - itens.length);
    expect(n9900(e, '0150')).toBe(antes.p150 - 1);
    expect(n9900(e, '0200')).toBe(antes.i200 - itensOrfaos.size);
    // unidades/0400/0500 também podem ter ficado órfãos: 0990 confere com a contagem real
    const linhas0 = listar(e, '0990')[0];
    expect(Number(linhas0.campos[1])).toBeLessThanOrEqual(antes.o990 - 1 - itensOrfaos.size - filhos0205);
    // relido: hierarquia íntegra e mesmas contagens
    const relido = lerSped(escreverSped(e).bytes, 'relido.txt');
    expect(relido.avisos.filter((a) => a.nivel !== 'info')).toEqual([]);
    for (const reg of ['C100', 'C170', '0150', '0200', '0190', '9900']) expect(listar(relido, reg).length).toBe(listar(e, reg).length);
    expect(recontar(relido).alteracoes).toBe(0);
    expect(Number(relido.raiz.filhos.find((f) => f.reg === '9999')!.campos[1])).toBeLessThan(antes.total);
    const difs = diferencas(e);
    expect(difs.some((d) => d.tipo === 'excluido' && d.reg === 'C100' && !d.automatico)).toBe(true);
    expect(difs.some((d) => d.tipo === 'excluido' && d.reg === '0150' && d.automatico)).toBe(true);
    // desfazer: original byte a byte (cadastros voltam ao lugar)
    const depois = bytesDe(e);
    desfazer();
    expect(bytesDe(e).equals(original)).toBe(true);
    refazer();
    expect(bytesDe(e).equals(depois)).toBe(true);
  });

  it('excluir item: nota fica (se tiver outros itens) ou sai junto; NUM_ITEM não é renumerado', () => {
    const { e, original } = abrir();
    const nota = linhasDe(e, 'nota').find((l) => l.reg.filhos.filter((f) => f.reg === 'C170').length >= 3)!;
    const itens = linhasDe(e, 'item').filter((l) => l.doc === nota.reg);
    const nums = itens.map((l) => get(l.reg, 'NUM_ITEM'));
    excluirLinhas([itens[1]]);
    expect(nota.reg.pai).not.toBeNull();
    expect(nota.reg.filhos.filter((f) => f.reg === 'C170').map((f) => get(f, 'NUM_ITEM'))).toEqual(nums.filter((_, i) => i !== 1));
    const merc = nota.reg.filhos.filter((f) => f.reg === 'C170').reduce((s, f) => s + centavos(get(f, 'VL_ITEM')), 0);
    expect(centavos(get(nota.reg, 'VL_MERC'))).toBe(merc);
    excluirLinhas(itens.filter((_, i) => i !== 1));
    expect(nota.reg.pai).toBeNull();
    desfazer();
    desfazer();
    expect(bytesDe(e).equals(original)).toBe(true);
  });

  it('incluir item em nota existente: NUM_ITEM = maior + 1, cadastros criados, totais refeitos', () => {
    const { e, original } = abrir();
    const nota = linhasDe(e, 'nota').find((l) => get(l.reg, 'IND_OPER') === '0' && l.reg.filhos.length > 0)!;
    const maior = Math.max(...nota.reg.filhos.map((f) => Number(get(f, 'NUM_ITEM'))));
    const merc = centavos(get(nota.reg, 'VL_MERC'));
    const { registro, avisos } = incluirItem(nota, {
      codigo: 'NOVO-ITEM-1',
      descricao: 'PRODUTO NOVO DE TESTE',
      ncm: '48211000',
      unidade: 'GL',
      tipoItem: '01',
      quantidade: 2,
      valorItem: '100.50',
      cfop: '1101',
      pis: { cst: '50', aliquota: 1.65 },
      cofins: { cst: '50', aliquota: 7.6 },
    });
    expect(avisos).toEqual([]);
    expect(get(registro, 'NUM_ITEM')).toBe(String(maior + 1));
    expect(get(registro, 'VL_PIS')).toBe('1,66');
    expect(centavos(get(nota.reg, 'VL_MERC'))).toBe(merc + 10050);
    expect(indices(e).padrao.item.has('NOVO-ITEM-1')).toBe(true);
    expect(indices(e).padrao.unid.has('GL')).toBe(true);
    expect(validar(e).filter((a) => a.registro === registro)).toEqual([]);
    reverterRegistro({ e, reg: registro });
    expect(bytesDe(e).equals(original)).toBe(true);
  });

  it('regra em lote: prévia = efeito aplicado; aplica em duas escriturações; desfazer volta as duas', () => {
    const a = abrir();
    const b = abrir(['01042025', '30042025']);
    const escs = [a.e, b.e];
    const regra: Regra = novaRegra({
      nome: 'Entradas CST 53 → 50 com base sem ICMS',
      tipoLinha: 'item',
      filtros: [
        { coluna: 'C170.CST_PIS', op: 'igual', valor: '53' },
        { coluna: 'C100.IND_OPER', op: 'igual', valor: '0' },
      ],
      acoes: [{ tipo: 'tributacao', cst: '50', aliqPis: '1,65', aliqCofins: '7,6', base: 'valor-item-menos-desconto-menos-icms' }],
    });
    const exclusao: Regra = novaRegra({ nome: 'Excluir CST 49', tipoLinha: 'item', filtros: [{ coluna: 'C170.CST_PIS', op: 'igual', valor: '49' }], acoes: [{ tipo: 'excluir' }] });
    const prev = previsualizarRegra(escs, regra);
    expect(prev.erros).toEqual([]);
    expect(prev.aplicada).toBe(false);
    expect(prev.linhas).toBe(2 * 279);
    expect(a.e.alterada).toBe(false);
    expect(bytesDe(a.e).equals(a.original)).toBe(true);
    const prevEx = previsualizarRegra(escs, exclusao);
    expect(prevEx.excluidas).toBe(50);
    expect(bytesDe(b.e).equals(b.original)).toBe(true);

    const [apl, aplEx] = aplicarRegras(escs, [regra, exclusao]);
    const resumo = (r: typeof prev) => r.porEscrituracao.map((x) => ({ linhas: x.linhas, excluidas: x.excluidas, delta: x.delta }));
    expect(resumo(apl)).toEqual(resumo(prev));
    expect(apl.amostra).toEqual(prev.amostra);
    expect(resumo(aplEx)).toEqual(resumo(prevEx));
    expect(apl.porEscrituracao.every((x) => x.linhas === 279)).toBe(true);
    for (const e of escs) {
      expect(filtrar(linhasDe(e, 'item'), [{ coluna: 'C170.CST_PIS', op: 'igual', valor: '53' }]).length).toBe(0);
      expect(filtrar(linhasDe(e, 'item'), [{ coluna: 'C170.CST_PIS', op: 'igual', valor: '49' }]).length).toBe(0);
    }
    const depoisB = bytesDe(b.e);
    desfazer();
    desfazer();
    expect(bytesDe(a.e).equals(a.original)).toBe(true);
    expect(bytesDe(b.e).equals(b.original)).toBe(true);
    refazer();
    refazer();
    expect(bytesDe(b.e).equals(depoisB)).toBe(true);
  });

  it('ações na seleção: prévia e aplicação, definir campo e frete com D101/D105 juntos', () => {
    const { e, original } = abrir();
    const fretes = linhasDe(e, 'frete').slice(0, 5);
    const prev = previsualizarAcoes(fretes, [{ tipo: 'tributacao', cst: '50', natBcCred: '07', base: 'valor-item' }, { tipo: 'definirCampo', campo: 'COD_CTA', valor: '3.4.01.009.4253' }]);
    expect(prev.erros).toEqual([]);
    const apl = aplicarAcoes(fretes, [{ tipo: 'tributacao', cst: '50', natBcCred: '07', base: 'valor-item' }, { tipo: 'definirCampo', campo: 'COD_CTA', valor: '3.4.01.009.4253' }]);
    expect(apl.delta).toEqual(prev.delta);
    for (const l of fretes) {
      expect(get(l.pis!, 'NAT_BC_CRED')).toBe('07');
      expect(get(l.cofins!, 'NAT_BC_CRED')).toBe('07');
      expect(get(l.pis!, 'VL_BC_PIS')).toBe(get(l.pis!, 'VL_ITEM'));
      expect(get(l.cofins!, 'VL_BC_COFINS')).toBe(get(l.cofins!, 'VL_ITEM'));
    }
    desfazer();
    expect(bytesDe(e).equals(original)).toBe(true);
  });

  it('importação: 5 tipos de documento, cadastros, duplicata e fora de período; desfazer volta ao original', () => {
    const { e, original } = abrir();
    const cnpjEmp = e.cnpj;
    const fornecedor = cnpj('112223330001');
    const transportadora = cnpj('114447770001');
    const energia = cnpj('336839120001');
    const notaExistente = linhasDe(e, 'nota').find((l) => get(l.reg, 'IND_OPER') === '0' && get(l.reg, 'CHV_NFE'))!;
    const chaveNova = chave('42', '2503', fornecedor, '55', '1', '777');
    const item = (codigo: string, valorItem: string) => ({
      codigo,
      descricao: 'MATERIA PRIMA ' + codigo,
      ncm: '39011000',
      unidade: 'GL',
      tipoItem: '01',
      quantidade: '10',
      valorItem,
      cfop: '1101',
      icms: { cst: '00', base: valorItem, aliquota: 12, valor: (Number(valorItem) * 0.12).toFixed(2) },
      pis: { cst: '50', aliquota: 1.65 },
      cofins: { cst: '50', aliquota: 7.6 },
    });
    const pacote: PacoteImportacao = {
      formato: 'sped-contrib-import',
      versao: 1,
      cnpj: cnpjEmp,
      origem: 'teste',
      documentos: [
        {
          tipo: 'nota',
          referencia: 'nota nova',
          operacao: 'entrada',
          emissao: 'terceiros',
          serie: '1',
          numero: '777',
          chave: chaveNova,
          dataDocumento: '2025-03-10',
          dataEntradaSaida: '2025-03-12',
          participante: { cnpjCpf: fornecedor, nome: 'FORNECEDOR FICTICIO LTDA', codMunicipio: '4202404', ie: '123456789' },
          itens: [item('MP-001', '1000.00'), item('MP-002', '250.50')],
        },
        { tipo: 'itens', referencia: 'itens na nota existente', nota: { chave: get(notaExistente.reg, 'CHV_NFE') }, itens: [item('MP-003', '10')] },
        {
          tipo: 'frete',
          referencia: 'cte',
          operacao: 'entrada',
          emissao: 'terceiros',
          serie: '1',
          numero: '5555',
          chave: chave('42', '2503', transportadora, '57', '1', '5555'),
          dataDocumento: '2025-03-15',
          participante: { cnpjCpf: transportadora, nome: 'TRANSPORTES FICTICIOS SA', codMunicipio: '4202404' },
          valorDocumento: '300',
          icms: { base: '300', valor: '36' },
          natFrete: '2',
          creditos: [{ valorItem: '300', cst: '50', natBcCred: '14', base: '264' }],
        },
        {
          tipo: 'energia',
          referencia: 'energia',
          modelo: '06',
          numero: '991',
          dataDocumento: '2025-03-05',
          dataEntrada: '2025-03-06',
          participante: { cnpjCpf: energia, nome: 'DISTRIBUIDORA FICTICIA', codMunicipio: '4202404' },
          valorDocumento: '1000',
          valorIcms: '170',
          creditos: [{ valorItem: '1000', cst: '50', natBcCred: '04', base: '830' }],
        },
        {
          tipo: 'f100',
          referencia: 'aluguel',
          indOper: '0',
          participante: { cnpjCpf: '52998224725', nome: 'LOCADOR PESSOA FISICA', codMunicipio: '4202404' },
          data: '2025-03-31',
          valor: '5000',
          pis: { cst: '50', aliquota: '1,65' },
          cofins: { cst: '50', aliquota: '7,6' },
          natBcCred: '05',
        },
        { ...({} as object), tipo: 'nota', referencia: 'duplicada', operacao: 'entrada', emissao: 'terceiros', serie: '1', numero: '777', chave: chaveNova, dataDocumento: '2025-03-10', participante: { cnpjCpf: fornecedor, nome: 'X' }, itens: [item('MP-001', '1')] },
        { tipo: 'f100', referencia: 'fora do período', periodo: '2025-07', indOper: '1', data: '2025-07-01', valor: '10', pis: { cst: '01', aliquota: 1.65 }, cofins: { cst: '01', aliquota: 7.6 } },
      ],
    };
    const antes = { c100: listar(e, 'C100').length, c170: listar(e, 'C170').length, d100: listar(e, 'D100').length, c500: listar(e, 'C500').length, f100: listar(e, 'F100').length, p150: listar(e, '0150').length };
    const res = importarPacote([e], pacote);
    expect(res.ignorados.map((i) => i.referencia)).toEqual(['duplicada', 'fora do período']);
    expect(res.ignorados[0].motivo).toMatch(/já existe/);
    expect(res.ignorados[1].motivo).toMatch(/2025-07/);
    expect(res.incluidos).toBe(5);
    expect(res.porEscrituracao[e.id]).toBe(5);
    expect(listar(e, 'C100').length).toBe(antes.c100 + 1);
    expect(listar(e, 'C170').length).toBe(antes.c170 + 3);
    expect(listar(e, 'D100').length).toBe(antes.d100 + 1);
    expect(listar(e, 'C500').length).toBe(antes.c500 + 1);
    expect(listar(e, 'F100').length).toBe(antes.f100 + 1);
    expect(listar(e, '0150').length).toBe(antes.p150 + 4);
    const nova = listar(e, 'C100').find((r) => get(r, 'CHV_NFE') === chaveNova)!;
    expect(nova.pai?.reg).toBe('C010');
    expect(get(nova, 'COD_PART')).toBe(fornecedor);
    expect(get(nova, 'VL_MERC')).toBe('1250,5');
    expect(get(nova, 'VL_PIS')).toBe(String((16.5 + 4.13).toFixed(2)).replace('.', ','));
    expect(nova.filhos.map((f) => get(f, 'NUM_ITEM'))).toEqual(['1', '2']);
    expect(indices(e).padrao.item.has('MP-001')).toBe(true);
    const d100 = listar(e, 'D100').find((r) => get(r, 'NUM_DOC') === '5555')!;
    expect(d100.pai?.reg).toBe('D010');
    expect(d100.filhos.map((f) => f.reg)).toEqual(['D101', 'D105']);
    // frete e energia vieram com CST de crédito e SEM alíquota: o editor não supõe 1,65/7,6 —
    // entram com alíquota e valor zerados e contados como pendentes de tributação
    expect([get(d100.filhos[0], 'ALIQ_PIS'), get(d100.filhos[0], 'VL_PIS'), get(d100.filhos[1], 'ALIQ_COFINS')]).toEqual(['0', '0', '0']);
    expect(res.semAliquota).toBe(2);
    expect(res.pendentesTributacao).toBeGreaterThanOrEqual(2);
    expect(res.avisos.some((a) => a.indice === -1 && /2 item\(ns\)\/crédito\(s\)\/operação\(ões\) com CST de crédito .* sem alíquota/.test(a.mensagem))).toBe(true);
    expect(validar(e).filter((a) => a.codigo === 'CST_ALIQUOTA_ZERO' && (a.registro?.pai === d100)).length).toBe(2);
    const c500 = listar(e, 'C500').find((r) => get(r, 'NUM_DOC') === '991')!;
    expect(get(c500, 'VL_PIS')).toBe('0');
    expect(get(c500, 'VL_COFINS')).toBe('0');
    const f100 = listar(e, 'F100').at(-1)!;
    expect(get(f100, 'VL_PIS')).toBe('82,5');
    expect(get(f100, 'COD_PART')).toBe('52998224725');
    expect(n9900(e, 'C100')).toBe(antes.c100 + 1);
    // validação: sem referências quebradas; só o que veio sem alíquota (D101/D105 e C501/C505) fica pendente
    const erros = validar(e).filter((a) => a.nivel === 'erro');
    expect(erros.filter((a) => a.codigo !== 'CST_ALIQUOTA_ZERO')).toEqual([]);
    expect(erros.map((a) => a.registro?.reg).sort()).toEqual(['C501', 'C505', 'D101', 'D105']);
    // relido íntegro
    const relido = lerSped(escreverSped(e).bytes, 'x.txt');
    expect(relido.avisos.filter((a) => a.nivel !== 'info')).toEqual([]);
    expect(recontar(relido).alteracoes).toBe(0);
    desfazer();
    expect(bytesDe(e).equals(original)).toBe(true);
  });

  it('filtros e ordenação sobre a amostra', () => {
    const { e } = abrir();
    const itens = linhasDe(e, 'item');
    expect(itens.length).toBe(6921);
    expect(linhasDe(e, 'item')).toBe(itens); // cache
    expect(filtrar(itens, [{ coluna: 'C170.CST_PIS', op: 'igual', valor: '53' }]).length).toBe(279);
    expect(filtrar(itens, [{ coluna: 'C170.CST_PIS', op: 'em', valores: ['06', '08'] }]).length).toBe(163);
    expect(filtrar(itens, [{ coluna: 'C170.CST_PIS', op: 'diferente', valor: '01' }]).length).toBe(6921 - 6454);
    const grandes = filtrar(itens, [{ coluna: 'C170.VL_ITEM', op: 'maior', valor: '10.000,00' }]);
    expect(grandes.every((l) => centavos(valor(l, 'C170.VL_ITEM')) > 1000000)).toBe(true);
    const marco = filtrar(itens, [{ coluna: 'C100.DT_DOC', op: 'entre', valor: '01/03/2025', valor2: '2025-03-31' }]);
    expect(marco.every((l) => valor(l, 'C100.DT_DOC').endsWith('032025'))).toBe(true);
    const nomeParte = valor(itens[0], '0150.NOME').slice(0, 5).toLowerCase();
    expect(filtrar(itens, [], nomeParte).length).toBeGreaterThan(0);
    expect(filtrar(itens, [{ coluna: '0200.COD_NCM', op: 'naoVazio' }]).length).toBe(6921);
    const ord = ordenar(itens, [{ coluna: 'C170.VL_ITEM', desc: true }]);
    expect(centavos(valor(ord[0], 'C170.VL_ITEM'))).toBe(Math.max(...itens.map((l) => centavos(valor(l, 'C170.VL_ITEM')))));
    const t = somar(itens);
    expect(t.valorPis).toBe(listar(e, 'C170').reduce((s, r) => s + centavos(get(r, 'VL_PIS')), 0));
    expect(linhasDe(e, 'frete').length).toBe(867);
    expect(linhasDe(e, 'energia').length).toBe(3);
    expect(linhasDe(e, 'f100').length).toBe(3);
    expect(valor(linhasDe(e, 'frete')[0], '0150.UF')).toBe('SC');
    const csv = exportarLinhasCsv(itens.slice(0, 3), ['C100.NUM_DOC', 'C170.CST_PIS', 'C170.VL_ITEM', 'C100.DT_DOC']);
    expect(csv.startsWith('﻿Nº nota;CST PIS;Valor item;Data emissão\r\n')).toBe(true);
    expect(csv.split("\r\n")[1]).toMatch(/^\d+;\d\d;[\d,]+;\d\d\/\d\d\/\d{4}$/);
  });

  it('linhas de várias escriturações juntas e cache invalidado após exclusão', () => {
    const a = abrir();
    const b = abrir(['01042025', '30042025']);
    const todas = linhasDeTodas([a.e, b.e], 'item');
    expect(todas.length).toBe(2 * 6921);
    const antes = linhasDe(a.e, 'item');
    excluirLinhas([antes[0]]);
    const depois = linhasDe(a.e, 'item');
    expect(depois).not.toBe(antes);
    expect(depois.length).toBeLessThan(antes.length);
  });

  it.skipIf(!apuracaoDisponivel())('integração com a apuração real: recalcular não altera arquivo não editado', () => {
    const { e, original } = abrir();
    const rel = recalcular([e], comCriterios(), { todas: true });
    expect(rel[0].avisos.filter((x) => x.nivel === 'erro')).toEqual([]);
    expect(bytesDe(e).equals(original)).toBe(true);
    aplicarTributacao(linhasDe(e, 'item').slice(0, 10), { tipo: 'tributacao', base: 'valor-item' });
    recalcular([e], comCriterios());
    const relido = lerSped(escreverSped(e).bytes, 'x.txt');
    expect(recontar(relido).alteracoes).toBe(0);
  });
});

function apuracaoDisponivel(): boolean {
  try {
    recalcularApuracao([], comCriterios());
    return true;
  } catch (err) {
    return !/não implementad/i.test(String((err as Error).message));
  }
}

describe('regras: arquivo JSON', () => {
  it('exporta e importa regras; recusa regra inválida', () => {
    const r = novaRegra({ nome: 'CFOP 1101 crédito', tipoLinha: 'item', filtros: [{ coluna: 'C170.CFOP', op: 'igual', valor: '1101' }], acoes: [{ tipo: 'tributacao', cst: '50', aliqPis: 1.65, aliqCofins: 7.6, base: 'valor-item-menos-desconto' }] });
    const volta = importarRegras(exportarRegras([r]));
    expect(volta).toEqual([r]);
    const ruim = JSON.parse(exportarRegras([{ ...r, filtros: [{ coluna: 'NAO.EXISTE', op: 'igual', valor: 1 }], acoes: [{ tipo: 'tributacao', cst: 'ZZ' }] }]));
    expect(() => importarRegras(ruim)).toThrow(/NAO.EXISTE[\s\S]*ZZ/);
    expect(() => importarRegras('{"formato":"outro"}')).toThrow(/formato/);
  });
});

describe('XML de NF-e', () => {
  const empresa = cnpj('032254110001');
  const outro = cnpj('112223330001');
  const xml = (emit: string, dest: string, tpNF: string, cfop: string) => `<?xml version="1.0" encoding="UTF-8"?>
<nfeProc xmlns="http://www.portalfiscal.inf.br/nfe" versao="4.00"><NFe><infNFe Id="NFe${chave('42', '2503', emit, '55', '1', '123')}" versao="4.00">
<ide><cUF>42</cUF><mod>55</mod><serie>1</serie><nNF>123</nNF><dhEmi>2025-03-10T10:00:00-03:00</dhEmi><dhSaiEnt>2025-03-11T08:00:00-03:00</dhSaiEnt><tpNF>${tpNF}</tpNF></ide>
<emit><CNPJ>${emit}</CNPJ><xNome>EMITENTE &amp; CIA</xNome><enderEmit><xLgr>RUA A</xLgr><nro>10</nro><xBairro>CENTRO</xBairro><cMun>4202404</cMun><UF>SC</UF><cPais>1058</cPais></enderEmit><IE>123</IE></emit>
<dest><CNPJ>${dest}</CNPJ><xNome>DESTINATARIO LTDA</xNome><enderDest><xLgr>RUA B</xLgr><nro>20</nro><xBairro>BAIRRO</xBairro><cMun>3550308</cMun><UF>SP</UF></enderDest></dest>
<det nItem="1"><prod><cProd>P1</cProd><xProd>PRODUTO UM</xProd><NCM>48211000</NCM><CFOP>${cfop}</CFOP><uCom>UN</uCom><qCom>2.0000</qCom><vProd>200.00</vProd><vDesc>10.00</vDesc></prod>
<imposto><ICMS><ICMS00><orig>0</orig><CST>00</CST><vBC>190.00</vBC><pICMS>12.00</pICMS><vICMS>22.80</vICMS></ICMS00></ICMS><IPI><cEnq>999</cEnq><IPINT><CST>53</CST></IPINT></IPI>
<PIS><PISAliq><CST>01</CST><vBC>190.00</vBC><pPIS>1.65</pPIS><vPIS>3.14</vPIS></PISAliq></PIS><COFINS><COFINSAliq><CST>01</CST><vBC>190.00</vBC><pCOFINS>7.60</pCOFINS><vCOFINS>14.44</vCOFINS></COFINSAliq></COFINS></imposto></det>
<total><ICMSTot><vBC>190.00</vBC><vICMS>22.80</vICMS><vProd>200.00</vProd><vFrete>0.00</vFrete><vSeg>0.00</vSeg><vDesc>10.00</vDesc><vOutro>0.00</vOutro><vNF>190.00</vNF></ICMSTot></total>
<transp><modFrete>1</modFrete></transp></infNFe></NFe></nfeProc>`;

  it('entrada de terceiros: CFOP de venda pendente (insumo × revenda), PIS/COFINS pendentes (CST 98), data de entrada = emissão', () => {
    const n = xmlNfeParaNota(xml(outro, empresa, '1', '5102'), empresa);
    expect(n.operacao).toBe('entrada');
    expect(n.emissao).toBe('terceiros');
    expect(n.participante.cnpjCpf).toBe(outro);
    expect(n.participante.nome).toBe('EMITENTE & CIA');
    // achado 11 da revisão: 5102 não vira 1102 (nem 5101 vira 1101) sem o usuário dizer se é insumo ou revenda
    expect(n.itens[0].cfop).toBe('1949');
    expect(n.pendencias.some((p) => p.includes('CFOP 5102') && p.includes('1101') && p.includes('1102'))).toBe(true);
    expect(xmlNfeParaNota(xml(outro, empresa, '1', '5102'), empresa, { finalidade: 'revenda' }).itens[0].cfop).toBe('1102');
    expect(xmlNfeParaNota(xml(outro, empresa, '1', '6101'), empresa, { finalidade: 'insumo' }).itens[0].cfop).toBe('2101');
    expect(n.itens[0].pis).toEqual({ cst: '98', base: '0', aliquota: '0', valor: '0' });
    expect(n.itens[0].icms?.cst).toBe('000');
    // data de entrada: a de emissão (o dhSaiEnt do XML, 11/03, é a saída do fornecedor), com pendência visível
    expect(n.dataEntradaSaida).toBe('2025-03-10');
    expect(n.pendencias.some((p) => p.startsWith('Data de entrada não informada; usada a de emissão'))).toBe(true);
    expect(n.pendencias.length).toBe(3);
    expect(n.dataDocumento).toBe('2025-03-10');
    expect(n.totais?.documento).toBe('190.00');
    expect(n.indFrete).toBe('1');
    expect(n.chave).toHaveLength(44);
  });

  it('saída própria: CFOP e CST do XML mantidos, participante = destinatário', () => {
    const n = xmlNfeParaNota(xml(empresa, outro, '1', '6101'), empresa);
    expect(n.operacao).toBe('saida');
    expect(n.emissao).toBe('propria');
    expect(n.participante.cnpjCpf).toBe(outro);
    expect(n.participante.codMunicipio).toBe('3550308');
    expect(n.itens[0].cfop).toBe('6101');
    expect(n.itens[0].pis.cst).toBe('01');
    expect(n.itens[0].pis.valor).toBe('3.14');
    expect(n.pendencias).toEqual([]);
  });

  it('de-para de CFOP: só pares inequívocos; sem par fica pendente, nunca CFOP inexistente', () => {
    expect(converterCfopEntrada('5656')).toEqual({ situacao: 'convertido', cfop: '1653' });
    expect(converterCfopEntrada('6655')).toEqual({ situacao: 'convertido', cfop: '2652' });
    expect(converterCfopEntrada('5910')).toEqual({ situacao: 'convertido', cfop: '1910' });
    expect(converterCfopEntrada('5405')).toEqual({ situacao: 'insumo-ou-revenda', insumo: '1401', revenda: '1403' });
    expect(converterCfopEntrada('5929')).toEqual({ situacao: 'sem-par' });
    expect(cfopEntradaCorrespondente('5405')).toBe(''); // antes: 1405, que não existe
    const n = xmlNfeParaNota(xml(outro, empresa, '1', '5929'), empresa);
    expect(n.itens[0].cfop).toBe('1949');
    expect(n.pendencias.some((p) => p.includes('CFOP 5929') && p.includes('sem CFOP de entrada correspondente'))).toBe(true);
  });

  it('recusa XML de outra empresa', () => {
    expect(() => xmlNfeParaNota(xml(outro, outro, '1', '5102'), empresa)).toThrow(/não é emitente/);
  });
});

describe('desempenho de filtro (alerta, não falha por lentidão moderada)', () => {
  it('filtra e soma 500 mil linhas sintéticas', () => {
    // escrituração sintética mínima: 0000 → C001 → C010 → 500 C100 × 1000 C170
    const txt: string[] = [
      '|0000|006|0||' + '|01012025|31012025|EMPRESA|11222333000181|SC|4202404||00|9|',
      '|0001|0|',
      '|0140||EMPRESA|11222333000181|SC||4202404|||',
      '|0150|P1|PARTICIPANTE UM|1058|11444777000161|||4202404||||||',
      '|0200|I1|ITEM UM|||UN|01|48211000||48|||',
      '|0990|6|',
      '|C001|0|',
      '|C010|11222333000181|2|',
    ];
    const notas = 500;
    const porNota = 1000;
    for (let n = 0; n < notas; n++) {
      txt.push(`|C100|0|1|P1|55|00|1|${n + 1}||10012025|10012025|1000|1|0|0|1000|9|0|0|0|0|0|0|0|0|0|0|0|0|`);
      for (let i = 0; i < porNota; i++) {
        const cst = i % 10 === 0 ? '50' : '70';
        txt.push(`|C170|${i + 1}|I1||1|UN|${(i % 97) + 1},5|0|0|000|1101||0|0|0|0|0|0|0|||0|0|0|${cst}|1|1,65|||0,02|${cst}|1|7,6|||0,08||`);
      }
    }
    txt.push('|C990|2|', '|M001|1|', '|M990|2|', '|9001|0|', '|9990|2|', '|9999|1|');
    const e = lerSped(new Uint8Array(Buffer.from(txt.join('\n') + '\n', 'latin1')), 'sintetico.txt');
    const linhas: Linha[] = linhasDe(e, 'item');
    expect(linhas.length).toBe(notas * porNota);
    const t0 = performance.now();
    const r = filtrar(linhas, [
      { coluna: 'C170.CST_PIS', op: 'igual', valor: '50' },
      { coluna: 'C170.VL_ITEM', op: 'maior', valor: '10' },
      { coluna: 'C100.DT_DOC', op: 'entre', valor: '01/01/2025', valor2: '31/01/2025' },
    ]);
    const ms = performance.now() - t0;
    const t1 = performance.now();
    const busca = filtrar(linhas, [], 'participante um');
    const msBusca = performance.now() - t1;
    const t2 = performance.now();
    somar(r);
    const msSoma = performance.now() - t2;
    expect(r.length).toBeGreaterThan(0);
    expect(busca.length).toBe(linhas.length);
    if (ms > 300 || msBusca > 600) console.warn(`[alerta de desempenho] filtro ${ms.toFixed(0)} ms, busca textual ${msBusca.toFixed(0)} ms, soma ${msSoma.toFixed(0)} ms`);
    expect(ms).toBeLessThan(5000);
  });
});

describe.skipIf(!caminho)('teto de memória do histórico', () => {
  it('descarta as operações mais antigas, mantém o desfazer das que sobraram', () => {
    const { e, original } = abrir();
    const itens = linhasDe(e, 'item').slice(0, 2000);
    definirLimiteMemoriaHistorico(1024 * 1024); // 1 MB: cada operação aqui custa ~700 KB
    for (let k = 0; k < 6; k++) {
      const r = aplicarTributacao(itens, {
        tipo: 'tributacao',
        cst: k % 2 ? '50' : '53',
        aliqPis: k % 2 ? '1,65' : '2',
        aliqCofins: k % 2 ? '7,6' : '8',
        base: k % 2 ? 'valor-item' : 'valor-item-menos-desconto',
      });
      expect(r.erros).toEqual([]);
      expect(usoHistorico().bytesEstimados).toBeLessThanOrEqual(usoHistorico().limiteBytes);
    }
    const uso = usoHistorico();
    expect(uso.truncado).toBe(true);
    expect(uso.descartadas).toBeGreaterThan(0);
    expect(uso.motivoTruncamento).toBe('memoria');
    expect(uso.umaOperacaoAcimaDoTeto).toBe(false);
    const restantes = historico().desfazer;
    expect(restantes.length).toBeGreaterThan(0);
    expect(restantes.length).toBeLessThan(6);
    expect(uso.operacoes).toBe(restantes.length);
    // a frase do rodapé sai só do usoHistorico(), sem chamar historico()
    expect(uso.paraDesfazer).toBe(restantes.length);
    expect(uso.paraRefazer).toBe(0);
    // desfazer continua funcionando nas operações que sobraram
    let n = 0;
    while (desfazer()) n++;
    expect(n).toBe(restantes.length);
    expect(podeDesfazer()).toBe(false);
    expect(usoHistorico()).toMatchObject({ paraDesfazer: 0, paraRefazer: n, truncado: true, motivoTruncamento: 'memoria' });
    // as antigas foram descartadas: o arquivo não volta ao original (e isso é o combinado)
    expect(bytesDe(e).equals(original)).toBe(false);
  });

  it('uma única operação acima do teto é mantida; o resto do histórico é esvaziado', () => {
    const { e, original } = abrir();
    definirLimiteMemoriaHistorico(1024 * 1024);
    editarCampos(linhasDe(e, 'nota')[0], { DT_E_S: '31/03/2025' });
    expect(historico().desfazer.length).toBe(1);
    const r = aplicarTributacao(linhasDe(e, 'item'), { tipo: 'tributacao', cst: '50', aliqPis: '1,65', aliqCofins: '7,6', base: 'valor-item' });
    expect(r.erros).toEqual([]);
    const uso = usoHistorico();
    expect(uso.bytesEstimados).toBeGreaterThan(uso.limiteBytes);
    expect(uso.umaOperacaoAcimaDoTeto).toBe(true);
    expect(historico().desfazer.length).toBe(1);
    expect(podeDesfazer()).toBe(true);
    // com a marca ligada, o refazer foi esvaziado junto
    expect(uso).toMatchObject({ paraDesfazer: 1, paraRefazer: 0 });
    desfazer();
    expect(podeDesfazer()).toBe(false);
    // a marca é do último descarte e não acompanha o desfazer: quem decide é paraRefazer
    expect(usoHistorico()).toMatchObject({ umaOperacaoAcimaDoTeto: true, paraDesfazer: 0, paraRefazer: 1 });
    // a edição descartada do histórico continua aplicada no arquivo
    expect(get(linhasDe(e, 'nota')[0].reg, 'DT_E_S')).toBe('31032025');
    expect(bytesDe(e).equals(original)).toBe(false);
  });

  it('bytesEstimados acompanha as mudanças; baixar o teto apara na hora; limparHistorico zera', () => {
    const { e } = abrir();
    const itens = linhasDe(e, 'item').slice(0, 500);
    for (let k = 0; k < 3; k++) aplicarTributacao(itens, { tipo: 'tributacao', aliqPis: k % 2 ? '1,65' : '2', base: k % 2 ? 'valor-item' : 'zero' });
    const pilha = historico().desfazer;
    expect(pilha.length).toBe(3);
    // operação só de campos (sem inclusão/exclusão): custo = mudanças × custo por campo
    expect(pilha.at(-1)!.bytesEstimados).toBe(pilha.at(-1)!.mudancas * BYTES_POR_CAMPO);
    const antes = usoHistorico().bytesEstimados;
    expect(antes).toBe(pilha.reduce((s, o) => s + o.bytesEstimados, 0));
    definirLimiteMemoriaHistorico(1024 * 1024); // cabe tudo: nada muda
    expect(usoHistorico()).toMatchObject({ bytesEstimados: antes, truncado: false, descartadas: 0 });
    definirLimiteHistorico(1); // teto por quantidade também apara
    expect(historico().desfazer.length).toBe(1);
    expect(usoHistorico()).toMatchObject({ truncado: true, motivoTruncamento: 'quantidade', paraDesfazer: 1, paraRefazer: 0 });
    expect(usoHistorico().bytesEstimados).toBeLessThan(antes);
    limparHistorico();
    expect(usoHistorico()).toMatchObject({ operacoes: 0, paraDesfazer: 0, paraRefazer: 0, bytesEstimados: 0, truncado: false, descartadas: 0, motivoTruncamento: null, umaOperacaoAcimaDoTeto: false });
    expect(podeDesfazer()).toBe(false);
  });
});

describe.skipIf(!caminho)('estabelecimento de bloco sem documentos', () => {
  it('C010 sai do arquivo quando fica sem nenhum documento; D010/F010 ficam; desfazer volta byte a byte', () => {
    const { e, original } = abrir();
    expect(sincronizarEstabelecimentos(e)).toEqual([]); // arquivo intocado: nada a remover
    const c010 = listar(e, 'C010');
    expect(c010.length).toBe(1);
    excluirLinhas([...linhasDe(e, 'nota'), ...linhasDe(e, 'energia')]);
    expect(listar(e, 'C010')).toEqual([]);
    expect(c010[0].pai).toBeNull();
    // bloco C ficou vazio: IND_MOV do C001 vira 1 e C990 conta só abertura + encerramento
    const c001 = e.raiz.filhos.find((f) => f.reg === 'C001')!;
    expect(c001.filhos).toEqual([]);
    expect(c001.campos[1]).toBe('1');
    expect(qtdLin(e, 'C990')).toBe(2);
    expect(n9900(e, 'C010')).toBe(0);
    // os outros blocos não foram tocados
    expect(listar(e, 'D010').length).toBe(1);
    expect(listar(e, 'F010').length).toBe(1);
    expect(listar(e, 'D100').length).toBe(867);
    expect(e.raiz.filhos.find((f) => f.reg === 'D001')!.campos[1]).toBe('0');
    const relido = lerSped(escreverSped(e).bytes, 'relido.txt');
    expect(relido.avisos.filter((a) => a.nivel !== 'info')).toEqual([]);
    expect(recontar(relido).alteracoes).toBe(0);
    expect(validar(e).filter((a) => a.nivel === 'erro')).toEqual([]);
    desfazer();
    expect(bytesDe(e).equals(original)).toBe(true);
  });
});

describe('estabelecimento que já estava vazio no original não é removido', () => {
  const cnpjA = cnpj('112223330001');
  const cnpjB = cnpj('112223330002');
  const cnpjP = cnpj('114447770001');
  const arquivo = () =>
    sintetica([
      `|0000|006|0|||01012025|31012025|EMPRESA TESTE|${cnpjA}|SC|4202404||00|9|`,
      '|0001|0|',
      `|0140|1|EMPRESA TESTE|${cnpjA}|SC||4202404|||`,
      `|0150|P1|PARTICIPANTE UM|1058|${cnpjP}|||4202404||||||`,
      '|0190|UN|UNIDADE|',
      '|0200|I1|ITEM UM|||UN|01|48211000||48|||',
      '|0990|6|',
      '|C001|0|',
      `|C010|${cnpjA}|2|`,
      '|C100|0|1|P1|55|00|1|1||10012025|10012025|100|1|0|0|100|9|0|0|0|0|0|0|0|0|0|0|0|0|',
      '|C170|1|I1||1|UN|100|0|0|000|1101||0|0|0|0|0|0|0|||0|0|0|50|100|1,65|||1,65|50|100|7,6|||7,6||',
      `|C010|${cnpjB}|2|`,
      '|C990|5|',
      '|9001|0|',
      '|9900|0000|1|',
      '|9990|2|',
      '|9999|14|',
    ]);

  it('mantém o C010 originalmente vazio e remove o que ficou vazio pela edição', () => {
    const e = arquivo();
    const vazio = listar(e, 'C010').find((r) => r.campos[1] === cnpjB)!;
    expect(vazio.filhos).toEqual([]);
    // uma edição qualquer já dispara a sincronização: o C010 vazio do original fica
    const nota = linhasDe(e, 'nota')[0];
    expect(editarCampos(nota, { VL_DOC: '101' }).ok).toBe(true);
    expect(listar(e, 'C010').length).toBe(2);
    // ao excluir a nota, só o C010 que ficou sem documentos sai
    excluirLinhas([nota]);
    expect(listar(e, 'C010').map((r) => r.campos[1])).toEqual([cnpjB]);
    expect(vazio.pai?.reg).toBe('C001');
    // bloco C ainda tem o estabelecimento vazio original: IND_MOV segue 0
    expect(e.raiz.filhos.find((f) => f.reg === 'C001')!.campos[1]).toBe('0');
    // cadastros do estabelecimento que saiu ficaram órfãos e foram removidos
    expect(listar(e, '0150')).toEqual([]);
    expect(listar(e, '0200')).toEqual([]);
    desfazer();
    desfazer();
    expect(listar(e, 'C010').length).toBe(2);
    expect(listar(e, 'C170').length).toBe(1);
    expect(listar(e, '0150').length).toBe(1);
  });
});
