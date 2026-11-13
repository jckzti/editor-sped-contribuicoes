/**
 * Notas de serviço (A100/A170), imobilizado (F120/F130) e cadastros (0150/0200): linhas da
 * grade, edição, regras, exclusão, importação, verificação e efeito na apuração.
 * Não há arquivo real com esses registros: eles são inseridos numa cópia da amostra em
 * memória (pela importação) e em árvores mínimas.
 */
import { describe, expect, it } from 'vitest';
import { arquivosDeAmostra, lerBytes, semAssinatura } from './amostra';
import {
  adicionarArquivo,
  aplicarTributacao,
  colunas,
  configInicial,
  criarSessao,
  desfazer,
  editarCampos,
  escreverSped,
  excluirLinhas,
  exportarLinhasCsv,
  filtrar,
  get,
  importarPacote,
  importarRegras,
  exportarRegras,
  linhasDe,
  listar,
  novaRegra,
  ordenar,
  previsualizarRegra,
  aplicarRegra,
  recalcular,
  recontar,
  somar,
  validar,
  validarDocumento,
  centavos,
  historico,
  TIPOS_LINHA,
  TIPOS_LINHA_TODOS,
  type Escrituracao,
  type PacoteImportacao,
} from './index';

const amostra = arquivosDeAmostra().find((c) => /PICC2B/i.test(c));
const bytes = () => lerBytes(amostra!);
const crit = () => ({ ...configInicial(), saldoCredor: 'somente-mes' as const, ordemUsoCredito: 'anteriores-primeiro' as const, receitaBruta0111: 'manter' as const });
const c = (r: { reg: string; campos: string[] }, f: string) => centavos(get(r as never, f));
const texto = (e: Escrituracao) => Buffer.from(escreverSped(e).bytes).toString('latin1');

/** CNPJ com dígitos verificadores a partir de 12 dígitos. */
function cnpj(base12: string): string {
  const dv = (s: string) => {
    const pesos = s.length === 12 ? [5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2] : [6, 5, 4, 3, 2, 9, 8, 7, 6, 5, 4, 3, 2];
    const r = [...s].reduce((a, d, i) => a + Number(d) * pesos[i], 0) % 11;
    return r < 2 ? '0' : String(11 - r);
  };
  const a = base12 + dv(base12);
  return a + dv(a);
}

const PRESTADOR = { cnpjCpf: cnpj('112223330001'), nome: 'CONSULTORIA TECNICA LTDA', codMunicipio: '4202404' };
const TOMADOR = { cnpjCpf: cnpj('445556660001'), nome: 'CLIENTE DE SERVICO SA', codMunicipio: '3550308' };

function pacote(cnpjEmpresa: string): PacoteImportacao {
  return {
    formato: 'sped-contrib-import',
    versao: 1,
    cnpj: cnpjEmpresa,
    documentos: [
      {
        tipo: 'servico',
        operacao: 'contratado',
        emissao: 'terceiros',
        numero: '7001',
        serie: 'A',
        chave: 'ABC123XYZ',
        dataDocumento: '2025-03-10',
        dataExecucao: '2025-03-08',
        participante: PRESTADOR,
        itens: [
          { codigo: 'SRV-MANUT', descricao: 'MANUTENCAO DE MAQUINAS', codigoServico: '14.01', valorItem: '10000', natBcCred: '03', pis: { cst: '50', aliquota: '1,65' }, cofins: { cst: '50', aliquota: '7,6' } },
          { codigo: 'SRV-ADM', descricao: 'ASSESSORIA ADMINISTRATIVA', valorItem: 500, pis: { cst: '70' }, cofins: { cst: '70' } },
        ],
      },
      {
        tipo: 'servico',
        operacao: 'prestado',
        emissao: 'propria',
        numero: '15',
        dataDocumento: '2025-03-20',
        participante: TOMADOR,
        itens: [{ codigo: 'SRV-PROJ', descricao: 'PROJETO DE ENGENHARIA', valorItem: '2000', valorDesconto: '100', pis: { cst: '01', aliquota: '1,65' }, cofins: { cst: '01', aliquota: '7,6' } }],
      },
      {
        tipo: 'imobilizado',
        periodo: '2025-03',
        modalidade: 'depreciacao',
        identificacaoBem: '04',
        utilizacao: '1',
        valorEncargo: '1200',
        parcelaSemCredito: '200',
        pis: { cst: '50', aliquota: '1,65' },
        cofins: { cst: '50', aliquota: '7,6' },
        descricao: 'TORNO CNC',
      },
      {
        tipo: 'imobilizado',
        periodo: '2025-03',
        modalidade: 'aquisicao',
        identificacaoBem: '05',
        utilizacao: '1',
        mesAquisicao: '2025-03',
        valorAquisicao: '48000',
        parcelas: '4',
        pis: { cst: '50' },
        cofins: { cst: '50' },
        descricao: 'EMPILHADEIRA',
      },
    ],
  };
}

describe('importação: validação dos tipos novos (sem arquivo)', () => {
  it('recusa com motivo o que o guia não aceita', () => {
    expect(validarDocumento({ tipo: 'servico', operacao: 'contratado', emissao: 'terceiros', numero: '1', dataDocumento: '2025-03-01', itens: [] })).toEqual(
      expect.arrayContaining(['Participante não informado.', 'Nota de serviço sem itens (o guia exige ao menos um A170).']),
    );
    const semNat = validarDocumento({
      tipo: 'servico', operacao: 'contratado', emissao: 'terceiros', numero: '1', dataDocumento: '2025-03-01', participante: PRESTADOR,
      itens: [{ codigo: 'X', descricao: 'X', valorItem: 1, pis: { cst: '50', aliquota: '0,5775' }, cofins: { cst: '01' } }],
    });
    expect(semNat.join(' ')).toMatch(/exige o código da base de crédito/);
    expect(semNat.join(' ')).toMatch(/mais de 2 casas/);
    expect(semNat.join(' ')).toMatch(/CST 01 de COFINS é de receita, mas o serviço é contratado/);
    expect(validarDocumento({ tipo: 'imobilizado', modalidade: 'aquisicao', identificacaoBem: '04', utilizacao: '1', valorAquisicao: 1, pis: { cst: '50' }, cofins: { cst: '50' } } as never).join(' ')).toMatch(
      /informe "periodo".*parcelas deve ser/,
    );
    expect(validarDocumento({ tipo: 'imobilizado', periodo: '2025-03', modalidade: 'depreciacao', natBcCred: '10', identificacaoBem: '04', utilizacao: '1', valorEncargo: 1, pis: { cst: '50' }, cofins: { cst: '50' } } as never).join(' ')).toMatch(
      /natBcCred "10" não é aceito no F120/,
    );
  });

  it('os tipos novos não entram em TIPOS_LINHA (a interface adota quando quiser)', () => {
    expect(TIPOS_LINHA).toEqual(['item', 'nota', 'frete', 'energia', 'f100']);
    expect(TIPOS_LINHA_TODOS).toEqual(['item', 'nota', 'frete', 'energia', 'f100', 'servico', 'imobDepreciacao', 'imobAquisicao', 'participante', 'produto']);
  });
});

describe.skipIf(!amostra)('serviços, imobilizado e cadastros numa cópia da amostra', () => {
  function abrirComImportacao() {
    const s = criarSessao(crit());
    const e = adicionarArquivo(s, bytes(), 'PICC2B.TXT');
    const original = texto(e);
    const res = importarPacote(s.escrituracoes, pacote(e.cnpj));
    return { s, e, original, res };
  }

  it('importa nota de serviço (contratada e prestada) e bens do imobilizado; duplicata e fora do período são recusados; desfazer volta byte a byte', () => {
    const { s, e, original, res } = abrirComImportacao();
    expect(res.ignorados).toEqual([]);
    expect(res.incluidos).toBe(4);
    // A010 criado; A100 com totais = soma dos A170 (fim da operação)
    const a100 = listar(e, 'A100');
    expect(a100.length).toBe(2);
    expect(listar(e, 'A010').map((r) => r.campos[1])).toEqual([e.cnpj]);
    const contratada = a100.find((r) => get(r, 'IND_OPER') === '0')!;
    expect([c(contratada, 'VL_DOC'), c(contratada, 'VL_BC_PIS'), c(contratada, 'VL_PIS'), c(contratada, 'VL_COFINS')]).toEqual([1050000, 1000000, 16500, 76000]);
    const itens = contratada.filhos.filter((f) => f.reg === 'A170');
    expect(itens.map((i) => `${get(i, 'NUM_ITEM')}|${get(i, 'NAT_BC_CRED')}|${get(i, 'IND_ORIG_CRED')}|${get(i, 'CST_PIS')}`)).toEqual(['1|03|0|50', '2||0|70']);
    const prestada = a100.find((r) => get(r, 'IND_OPER') === '1')!;
    expect([get(prestada, 'COD_PART') !== '', c(prestada, 'VL_BC_PIS'), get(prestada.filhos[0], 'NAT_BC_CRED'), get(prestada.filhos[0], 'IND_ORIG_CRED')]).toEqual([true, 190000, '', '']);
    // cadastros criados: participante e serviço (tipo 09, código da LC 116)
    const prod = linhasDe(e, 'produto').find((l) => get(l.reg, 'COD_ITEM') === 'SRV-MANUT')!;
    expect([get(prod.reg, 'TIPO_ITEM'), get(prod.reg, 'COD_LST')]).toEqual(['09', '14.01']);
    expect(linhasDe(e, 'participante').some((l) => get(l.reg, 'CNPJ') === PRESTADOR.cnpjCpf)).toBe(true);
    // imobilizado: bases pela regra do guia
    const f120 = listar(e, 'F120')[0];
    expect([get(f120, 'NAT_BC_CRED'), c(f120, 'VL_BC_PIS'), c(f120, 'VL_PIS'), c(f120, 'VL_COFINS')]).toEqual(['09', 100000, 1650, 7600]);
    const f130 = listar(e, 'F130')[0];
    // F130 veio com CST 50 e SEM alíquota: o editor não supõe; alíquota e valor zerados, pendente
    expect([get(f130, 'NAT_BC_CRED'), get(f130, 'MES_OPER_AQUIS'), c(f130, 'VL_BC_CRED'), c(f130, 'VL_BC_PIS'), get(f130, 'ALIQ_PIS'), c(f130, 'VL_PIS')]).toEqual(['10', '032025', 4800000, 100000, '0', 0]);
    expect(res.semAliquota).toBe(1);
    expect(res.avisos.some((a) => /sem alíquota/.test(a.mensagem))).toBe(true);
    expect(validar(e).filter((a) => a.registro === f130).map((a) => `${a.nivel}:${a.codigo}`)).toEqual(['erro:CST_ALIQUOTA_ZERO', 'erro:CST_ALIQUOTA_ZERO']);
    // contadores coerentes
    expect(recontar(e).alteracoes).toBe(0);
    // duplicatas (inclusive o imobilizado idêntico) e fora do período
    const dup = importarPacote(s.escrituracoes, pacote(e.cnpj));
    expect(dup.incluidos).toBe(0);
    expect(dup.ignorados.map((x) => x.motivo.slice(0, 40))).toEqual([
      'Nota de serviço já existe na escrituraçã',
      'Nota de serviço já existe na escrituraçã',
      'Bem do imobilizado idêntico já existe na',
      'Bem do imobilizado idêntico já existe na',
    ]);
    const fora = importarPacote(s.escrituracoes, { ...pacote(e.cnpj), documentos: [{ ...pacote(e.cnpj).documentos[1], numero: '99', dataDocumento: '2025-05-02' } as never] });
    expect(fora.ignorados[0].motivo).toMatch(/fora do período/);
    // desfazer a importação volta ao arquivo original
    desfazer();
    desfazer();
    desfazer();
    expect(texto(e)).toBe(original);
  });

  it('linhas da grade: serviço, F120, F130, participante e produto com filtro, ordenação, soma e CSV', () => {
    const { e } = abrirComImportacao();
    const srv = linhasDe(e, 'servico');
    expect(srv.length).toBe(3);
    expect(colunas('servico').some((col) => col.id === 'A100.NUM_DOC')).toBe(true);
    expect(colunas('produto').find((col) => col.id === '0200.COD_ITEM')?.editavel).toBe(false);
    expect(colunas('participante').find((col) => col.id === '0150.NOME')?.editavel).toBe(true);
    const contratado = filtrar(srv, [{ coluna: 'A100.IND_OPER', op: 'igual', valor: '0' }]);
    expect(contratado.length).toBe(2);
    expect(ordenar(srv, [{ coluna: 'A170.VL_ITEM', desc: true }]).map((l) => get(l.reg, 'COD_ITEM'))).toEqual(['SRV-MANUT', 'SRV-PROJ', 'SRV-ADM']);
    const t = somar(srv);
    expect([t.linhas, t.valorItem, t.desconto, t.basePis]).toEqual([3, 1250000, 10000, 1190000]);
    expect(somar(linhasDe(e, 'imobDepreciacao')).basePis).toBe(100000);
    expect(somar(linhasDe(e, 'imobAquisicao')).valorItem).toBe(4800000);
    expect(exportarLinhasCsv(srv, ['A100.NUM_DOC', 'A170.COD_ITEM', '0150.NOME']).split('\r\n')[1]).toBe('7001;SRV-MANUT;CONSULTORIA TECNICA LTDA');
    expect(linhasDe(e, 'produto').find((l) => get(l.reg, 'COD_ITEM') === 'SRV-MANUT') && filtrar(linhasDe(e, 'produto'), [{ coluna: 'qtd0205', op: 'igual', valor: 0 }]).length).toBeGreaterThan(0);
  });

  it('efeito na apuração: M105 03 (serviço), 09 (depreciação), 10 (aquisição) e M210 com o serviço prestado; aviso "não conferido"', () => {
    const { s, e } = abrirComImportacao();
    const m210Antes = listar(e, 'M210').reduce((x, r) => x + c(r, 'VL_BC_CONT'), 0);
    const rel = recalcular(s.escrituracoes, s.config, { todas: true });
    expect(rel[0].apuracao?.recalculada).toBe(true);
    const m105 = listar(e, 'M105').filter((r) => get(r, 'CST_PIS') === '50');
    const porNat = Object.fromEntries(m105.map((r) => [get(r, 'NAT_BC_CRED'), c(r, 'VL_BC_PIS_TOT')]));
    expect(porNat).toEqual({ '03': 1000000, '09': 100000, '10': 100000 });
    expect(listar(e, 'M210').reduce((x, r) => x + c(r, 'VL_BC_CONT'), 0)).toBe(m210Antes + 190000);
    const nc = rel[0].avisos.find((a) => a.codigo === 'APURACAO_NAO_CONFERIDA')!.mensagem;
    for (const reg of ['A170', 'F120', 'F130']) expect(nc).toContain(`registro ${reg}`);
  });

  it('edição e regra em lote: tributação do serviço, F120/F130 derivados pelo guia, NAT_BC_CRED por registro; tudo desfazível', () => {
    const { s, e } = abrirComImportacao();
    recalcular(s.escrituracoes, s.config);
    const antes = texto(e);
    const nHist = historico().desfazer.length;
    const adm = linhasDe(e, 'servico').find((l) => get(l.reg, 'COD_ITEM') === 'SRV-ADM')!;
    const r = aplicarTributacao([adm], { tipo: 'tributacao', cst: '50', aliqPis: '1,65', aliqCofins: '7,6', base: 'valor-item-menos-desconto', natBcCred: '03' });
    expect(r.erros).toEqual([]);
    expect([get(adm.reg, 'VL_BC_PIS'), get(adm.reg, 'VL_PIS'), get(adm.reg, 'NAT_BC_CRED')]).toEqual(['500', '8,25', '03']);
    recalcular(s.escrituracoes, s.config);
    expect(c(adm.doc, 'VL_PIS')).toBe(16500 + 825); // total do A100 acompanha os itens
    desfazer();
    recalcular(s.escrituracoes, s.config);
    // F120: encargo editado → base e valores recalculados (campo 09 = 06 − 07)
    const dep = linhasDe(e, 'imobDepreciacao')[0];
    editarCampos(dep, { VL_OPER_DEP: '2200' });
    expect([get(dep.reg, 'VL_BC_PIS'), get(dep.reg, 'VL_BC_COFINS'), get(dep.reg, 'VL_PIS'), get(dep.reg, 'VL_COFINS')]).toEqual(['2000', '2000', '33', '152']);
    // F130: parcelas 48 → 24 meses: base do mês dobra (campo 12 = campo 09 ÷ meses)
    const aq = linhasDe(e, 'imobAquisicao')[0];
    editarCampos(aq, { ALIQ_PIS: '1,65', ALIQ_COFINS: '7,6' }); // veio sem alíquota (pendente)
    editarCampos(aq, { IND_NR_PARC: '3' });
    expect([get(aq.reg, 'VL_BC_PIS'), get(aq.reg, 'VL_PIS')]).toEqual(['2000', '33']);
    // NAT_BC_CRED fora da tabela do registro é recusado na ação, com aviso
    const nat = aplicarTributacao([aq], { tipo: 'tributacao', natBcCred: '09' });
    expect(nat.avisos.join()).toMatch(/não é aceito no F130/);
    expect(get(aq.reg, 'NAT_BC_CRED')).toBe('10');
    // regra em lote sobre serviços: prévia = aplicação
    const regra = novaRegra({ nome: 'Serviço técnico com crédito', tipoLinha: 'servico', filtros: [{ coluna: 'A170.COD_ITEM', op: 'igual', valor: 'SRV-ADM' }], acoes: [{ tipo: 'tributacao', cst: '50', base: 'valor-item', aliqPis: '1,65', aliqCofins: '7,6', natBcCred: '03' }] });
    const prev = previsualizarRegra(s.escrituracoes, regra);
    expect([prev.linhas, prev.delta.valorPis]).toEqual([1, 825]);
    expect(aplicarRegra(s.escrituracoes, regra).delta).toEqual(prev.delta);
    // a regra vai e volta no arquivo de regras com a opção dos tipos novos
    expect(() => importarRegras(exportarRegras([regra]))).toThrow(/todosOsTipos/);
    expect(importarRegras(exportarRegras([regra]), { todosOsTipos: true })[0].tipoLinha).toBe('servico');
    while (historico().desfazer.length > nHist) desfazer();
    recalcular(s.escrituracoes, s.config);
    const la = antes.split('\r\n');
    const lb = texto(e).split('\r\n');
    expect(lb.map((l, i) => (l === la[i] ? '' : `${i}: ${la[i]} ≠ ${l}`)).filter(Boolean).slice(0, 8)).toEqual([]);
  });

  it('exclusão: item de serviço leva a NFS-e vazia; recálculo tira cadastros órfãos e o A010; contadores coerentes; desfazer volta', () => {
    const { s, e } = abrirComImportacao();
    recalcular(s.escrituracoes, s.config);
    const antes = texto(e);
    const prestado = linhasDe(e, 'servico').filter((l) => get(l.doc, 'IND_OPER') === '1');
    excluirLinhas(prestado);
    expect(listar(e, 'A100').length).toBe(1);
    recalcular(s.escrituracoes, s.config);
    expect(linhasDe(e, 'produto').some((l) => get(l.reg, 'COD_ITEM') === 'SRV-PROJ')).toBe(false);
    expect(linhasDe(e, 'participante').some((l) => get(l.reg, 'CNPJ') === TOMADOR.cnpjCpf)).toBe(false);
    excluirLinhas(linhasDe(e, 'servico'));
    recalcular(s.escrituracoes, s.config);
    expect(listar(e, 'A010')).toEqual([]);
    expect(recontar(e).alteracoes).toBe(0);
    desfazer();
    desfazer();
    recalcular(s.escrituracoes, s.config);
    expect(texto(e)).toBe(antes);
  });

  it('cadastros: edita nome/endereço e unidade (cria 0190); código e CNPJ inválido recusados; cadastro em uso não é excluído', () => {
    const { s, e } = abrirComImportacao();
    const part = linhasDe(e, 'participante').find((l) => get(l.reg, 'CNPJ') === PRESTADOR.cnpjCpf)!;
    expect(editarCampos(part, { NOME: 'CONSULTORIA TECNICA EIRELI', END: 'RUA DAS FLORES' }).ok).toBe(true);
    expect(get(part.reg, 'NOME')).toBe('CONSULTORIA TECNICA EIRELI');
    const cod = editarCampos(part, { COD_PART: 'NOVO' });
    expect(cod.ok).toBe(false);
    expect(cod.erros[0].mensagem).toMatch(/não pode ser alterado/);
    expect(editarCampos(part, { CNPJ: '11111111111111' }).erros[0].mensagem).toMatch(/dígito verificador/);
    const prod = linhasDe(e, 'produto').find((l) => get(l.reg, 'COD_ITEM') === 'SRV-MANUT')!;
    editarCampos(prod, { UNID_INV: 'HR' });
    expect(listar(e, '0190').some((u) => get(u, 'UNID') === 'HR')).toBe(true);
    const r = excluirLinhas([part, prod]);
    expect(r.excluidos).toBe(0);
    expect(r.recusados?.length).toBe(2);
    // edição de cadastro aparece na conferência como edição do usuário (não automática)
    recalcular(s.escrituracoes, s.config);
    expect(validar(e).filter((a) => a.registro === part.reg)).toEqual([]);
  });

  it('verificação: CST × operação no serviço, NAT_BC_CRED em crédito, datas do A100 e base do imobilizado', () => {
    const { e } = abrirComImportacao();
    const srv = linhasDe(e, 'servico');
    const contratado = srv.find((l) => get(l.reg, 'COD_ITEM') === 'SRV-MANUT')!;
    editarCampos(contratado, { CST_PIS: '01', NAT_BC_CRED: '' });
    const v = validar(e).filter((a) => a.registro === contratado.reg).map((a) => `${a.nivel}:${a.codigo}`);
    expect(v).toContain('erro:CST_RECEITA_ENTRADA');
    editarCampos(contratado, { CST_PIS: '50' });
    expect(validar(e).filter((a) => a.registro === contratado.reg).map((a) => a.codigo)).toContain('NAT_BC_CRED_AUSENTE');
    // A100: basta uma das datas (emissão ou execução) no período
    editarCampos(contratado, { 'A100.DT_DOC': '28022025' });
    expect(validar(e).filter((a) => a.registro === contratado.doc && a.codigo.startsWith('DATA'))).toEqual([]);
    editarCampos(contratado, { 'A100.DT_EXE_SERV': '27022025' });
    expect(validar(e).filter((a) => a.registro === contratado.doc).map((a) => `${a.nivel}:${a.codigo}`)).toContain('erro:DATA_PERIODO');
    // F130 com base do mês digitada fora da regra: alerta
    const aq = linhasDe(e, 'imobAquisicao')[0];
    editarCampos(aq, { VL_BC_PIS: '999' });
    expect(validar(e).filter((a) => a.registro === aq.reg).map((a) => `${a.nivel}:${a.codigo}`)).toContain('alerta:IMOBILIZADO_BASE');
  });

  it('contrato: data do serviço (execução, senão emissão), COD_LST de item já cadastrado e base informada no imobilizado', () => {
    const s = criarSessao(crit());
    const e = adicionarArquivo(s, bytes(), 'PICC2B.TXT');
    importarPacote(s.escrituracoes, pacote(e.cnpj));
    const base = pacote(e.cnpj);
    const res = importarPacote(s.escrituracoes, {
      ...base,
      documentos: [
        // execução fora de qualquer escrituração carregada, emissão em março: entra em março
        { ...(base.documentos[1] as object), numero: '16', dataExecucao: '2025-02-25', dataDocumento: '2025-03-02' } as never,
        // item já cadastrado com outro COD_LST: o cadastro não muda e a importação avisa
        { ...(base.documentos[0] as object), numero: '7002', chave: undefined, itens: [{ codigo: 'SRV-MANUT', descricao: 'X', codigoServico: '07.02', valorItem: 1, natBcCred: '03', pis: { cst: '50', aliquota: '1,65' }, cofins: { cst: '50', aliquota: '7,6' } }] } as never,
        // imobilizado com base informada diferente da regra: usa a regra e avisa
        { ...(base.documentos[2] as object), valorEncargo: '300', pis: { cst: '50', aliquota: '1,65', base: '999' } } as never,
      ],
    });
    expect(res.ignorados).toEqual([]);
    expect(res.incluidos).toBe(3);
    expect(listar(e, 'A100').some((r) => get(r, 'NUM_DOC') === '16')).toBe(true);
    expect(get(listar(e, '0200').find((r) => get(r, 'COD_ITEM') === 'SRV-MANUT')!, 'COD_LST')).toBe('14.01');
    expect(res.avisos.some((a) => /já existe no cadastro \(0200\) com COD_LST "14.01"/.test(a.mensagem))).toBe(true);
    const f120 = listar(e, 'F120').find((r) => get(r, 'VL_OPER_DEP') === '300')!;
    expect(get(f120, 'VL_BC_PIS')).toBe('100');
    expect(res.avisos.some((a) => /Base de PIS informada \(999\) difere da regra do guia \(100\)/.test(a.mensagem))).toBe(true);
    const fora = importarPacote(s.escrituracoes, { ...base, documentos: [{ ...(base.documentos[1] as object), numero: '17', dataExecucao: '2025-02-25', dataDocumento: '2025-02-26' } as never] });
    expect(fora.ignorados[0].motivo).toMatch(/Nem a data de execução .* nem a de emissão/);
  });

  it('prova real não muda: a amostra sem os registros novos sai idêntica', () => {
    const s = criarSessao(crit());
    const e = adicionarArquivo(s, bytes(), 'PICC2B.TXT');
    recalcular(s.escrituracoes, s.config, { todas: true });
    expect(Buffer.from(escreverSped(e).bytes).equals(Buffer.from(semAssinatura(bytes())))).toBe(true);
  });
});
