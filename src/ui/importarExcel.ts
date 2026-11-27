import * as XLSX from 'xlsx';
import { cadastrosDe, garantirUnidade } from '../core/cadastros';
import { aplicarPlano, normalizarCampo, planejarEdicao, type PassoEdicao } from '../core/edicao';
import { importarPacote } from '../core/importar';
import type { DocumentoImport, ItemImport, PacoteImportacao } from '../core/importacao.tipos';
import { colunas, valor, valorExibicao, type Coluna, type LinhaQualquer, type TipoLinhaTodos } from '../core/linhas';
import { get, leiaute, novoRegistro, type Escrituracao, type Registro } from '../core/modelo';
import { inserir, registrarAcao } from '../core/mutacao';
import { executar, simular } from '../core/operacao';
import { cnpjValido, cpfValido } from '../core/util';
import { chaveDeEdicao } from './celulas';
import { exportarExcel } from './exportarExcel';

const CHAVE = 'Identificador do editor';
const REVISAO = 'Revisão do registro';
const ids = new WeakMap<Registro, string>();
const lotesIncluidos = new WeakMap<Escrituracao, Set<string>>();

function idRegistro(r?: Registro): string {
  if (!r) return '';
  let id = ids.get(r);
  if (!id) ids.set(r, id = crypto.randomUUID());
  return id;
}

function idLinha(linha: LinhaQualquer): string {
  return [idRegistro(linha.reg), idRegistro(linha.pis), idRegistro(linha.cofins)].join(':');
}

function revisao(linha: LinhaQualquer, campos: readonly Coluna[]): string {
  let hash = 2166136261;
  const texto = JSON.stringify(campos.map((c) => valor(linha, c.id)));
  for (let i = 0; i < texto.length; i++) hash = Math.imul(hash ^ texto.charCodeAt(i), 16777619);
  return `r${hash >>> 0}`;
}

const PLANILHAS_INCLUSAO = {
  'Novas notas': ['Grupo', 'CNPJ estabelecimento', 'Período', 'Operação', 'Emissão', 'Modelo', 'Série', 'Número', 'Chave', 'Data documento', 'Data entrada ou saída', 'CPF ou CNPJ participante', 'Nome participante', 'Código município', 'Código país', 'Inscrição estadual', 'Valor documento', 'Frete', 'Seguro', 'Outras despesas'],
  'Novos itens': ['Grupo', 'CNPJ estabelecimento', 'Período', 'Chave da nota existente', 'Número da nota existente', 'Série da nota existente', 'CPF ou CNPJ participante', 'Código', 'Descrição', 'Unidade', 'NCM', 'Quantidade', 'Valor do item', 'Desconto', 'CFOP', 'CST PIS', 'Base PIS', 'Alíquota PIS', 'Valor PIS', 'CST COFINS', 'Base COFINS', 'Alíquota COFINS', 'Valor COFINS', 'Conta contábil'],
};

function titulo(coluna: Coluna): string {
  return `${coluna.rotulo} [${coluna.id}]`;
}

function camposCadastro(reg: string): string[] {
  return leiaute.registros[reg].campos.slice(1).map((c) => c.nome);
}

export function exportarGradeExcel(nome: string, aba: string, tipo: TipoLinhaTodos, visiveis: readonly Coluna[], linhas: LinhaQualquer[]): void {
  const extras = aba === 'Documentos' ? PLANILHAS_INCLUSAO : {
    'Novos cadastros': ['CNPJ estabelecimento', 'Período', ...camposCadastro(tipo === 'participante' ? '0150' : '0200')],
  };
  const campos = colunas(tipo);
  exportarExcel(nome, aba, [CHAVE, REVISAO, ...visiveis.map(titulo)], linhas.map((l) => [idLinha(l), revisao(l, campos), ...visiveis.map((c) => valorExibicao(l, c.id))]), extras);
}

function lerAba(pasta: XLSX.WorkBook, nome: string): string[][] {
  const aba = pasta.Sheets[nome];
  if (!aba) return [];
  return XLSX.utils.sheet_to_json<unknown[]>(aba, { header: 1, raw: false, dateNF: 'yyyy-mm-dd', defval: '', blankrows: true })
    .map((linha) => linha.map((c) => String(c)));
}

function inclusoes(pasta: XLSX.WorkBook, origem: string): PacoteImportacao[] {
  const pacotes = new Map<string, PacoteImportacao>();
  const notas = new Map<string, { cnpj: string; documento: Extract<DocumentoImport, { tipo: 'nota' }> }>();
  const adicionar = (cnpj: string, documento: DocumentoImport) => {
    let pacote = pacotes.get(cnpj);
    if (!pacote) pacotes.set(cnpj, pacote = { formato: 'sped-contrib-import', versao: 1, cnpj, origem, documentos: [] });
    pacote.documentos.push(documento);
  };
  const ler = (nome: keyof typeof PLANILHAS_INCLUSAO, tratar: (v: (coluna: string) => string, referencia: string) => void) => {
    const [titulos, ...linhas] = lerAba(pasta, nome);
    if (!titulos) return;
    const colunas = PLANILHAS_INCLUSAO[nome];
    if (colunas.some((c) => !titulos.includes(c))) throw new Error(`Confira os títulos da aba ${nome}.`);
    linhas.forEach((linha, i) => {
      if (linha.some((c) => c.trim())) tratar((c) => (linha[titulos.indexOf(c)] ?? '').trim(), `${nome}, linha ${i + 2}`);
    });
  };
  ler('Novas notas', (v, referencia) => {
    const grupo = v('Grupo');
    const opcao = (c: string) => v(c).toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    const operacao = opcao('Operação');
    const emissao = opcao('Emissão');
    if (!grupo || notas.has(grupo)) throw new Error(`${referencia}: informe um grupo único para a nota.`);
    if ((operacao !== 'entrada' && operacao !== 'saida') || (emissao !== 'propria' && emissao !== 'terceiros')) {
      throw new Error(`${referencia}: informe entrada ou saida e propria ou terceiros.`);
    }
    const cnpj = v('CNPJ estabelecimento');
    const documento: Extract<DocumentoImport, { tipo: 'nota' }> = {
      tipo: 'nota', referencia, periodo: v('Período'), operacao, emissao,
      modelo: v('Modelo') || undefined, serie: v('Série'), numero: v('Número'), chave: v('Chave') || undefined,
      dataDocumento: v('Data documento'), dataEntradaSaida: v('Data entrada ou saída') || undefined,
      participante: {
        cnpjCpf: v('CPF ou CNPJ participante') || undefined, nome: v('Nome participante'),
        codMunicipio: v('Código município') || undefined, codPais: v('Código país') || undefined, ie: v('Inscrição estadual') || undefined,
      },
      totais: { documento: v('Valor documento') || undefined, frete: v('Frete') || undefined, seguro: v('Seguro') || undefined, outrasDespesas: v('Outras despesas') || undefined },
      itens: [],
    };
    notas.set(grupo, { cnpj, documento });
  });
  ler('Novos itens', (v, referencia) => {
    const tributo = (t: 'PIS' | 'COFINS') => ({ cst: v(`CST ${t}`), base: v(`Base ${t}`) || undefined, aliquota: v(`Alíquota ${t}`) || undefined, valor: v(`Valor ${t}`) || undefined });
    const item: ItemImport = {
      codigo: v('Código'), descricao: v('Descrição'), unidade: v('Unidade'), ncm: v('NCM') || undefined,
      quantidade: v('Quantidade'), valorItem: v('Valor do item'), valorDesconto: v('Desconto') || undefined,
      cfop: v('CFOP'), pis: tributo('PIS'), cofins: tributo('COFINS'), contaContabil: v('Conta contábil') || undefined,
    };
    const grupo = v('Grupo');
    if (grupo) {
      const nota = notas.get(grupo);
      if (!nota) throw new Error(`${referencia}: grupo ${grupo} não encontrado em Novas notas.`);
      nota.documento.itens.push(item);
      return;
    }
    const periodo = v('Período');
    if (!periodo) throw new Error(`${referencia}: informe o período da nota existente.`);
    adicionar(v('CNPJ estabelecimento'), {
      tipo: 'itens', referencia, periodo, itens: [item], nota: {
        chave: v('Chave da nota existente') || undefined, numero: v('Número da nota existente') || undefined,
        serie: v('Série da nota existente'), cnpjCpfParticipante: v('CPF ou CNPJ participante') || undefined,
      },
    });
  });
  for (const { cnpj, documento } of notas.values()) adicionar(cnpj, documento);
  return [...pacotes.values()];
}

export interface PreviaExcel {
  erros: string[];
  mudancas: string[];
  avisos: string[];
  aplicar: () => void;
}

function novosCadastros(pasta: XLSX.WorkBook, tipo: TipoLinhaTodos, escrituracoes: Escrituracao[], erros: string[]) {
  const [titulos, ...linhas] = lerAba(pasta, 'Novos cadastros');
  const reg = tipo === 'participante' ? '0150' : '0200';
  const campoCodigo = reg === '0150' ? 'COD_PART' : 'COD_ITEM';
  const plano: { e: Escrituracao; pai: Registro; cnpj: string; r: Registro; referencia: string }[] = [];
  if (!titulos) return plano;
  const campos = camposCadastro(reg);
  if (['CNPJ estabelecimento', 'Período', ...campos].some((c) => !titulos.includes(c))) throw new Error('Confira o tipo de cadastro selecionado e os títulos da aba Novos cadastros.');
  const vistos = new Map<Registro, Set<string>>();
  linhas.forEach((linha, i) => {
    if (!linha.some((c) => c.trim())) return;
    const referencia = `Novos cadastros, linha ${i + 2}`;
    const v = (campo: string) => (linha[titulos.indexOf(campo)] ?? '').trim();
    const cnpj = v('CNPJ estabelecimento');
    const periodo = v('Período');
    const candidatas = escrituracoes.filter((e) => e.periodo === periodo.replace('-', '') && cadastrosDe(e, cnpj).cnpj === cnpj && cadastrosDe(e, cnpj).r0140);
    if (candidatas.length !== 1) {
      erros.push(`${referencia}: informe um CNPJ de estabelecimento e período AAAA-MM que identifiquem uma escrituração carregada.`);
      return;
    }
    const e = candidatas[0];
    const cad = cadastrosDe(e, cnpj);
    const pai = cad.r0140!;
    const codigo = v(campoCodigo);
    const codigos = vistos.get(pai) ?? new Set<string>();
    if ((reg === '0150' ? cad.part : cad.item).has(codigo) || codigos.has(codigo)) {
      erros.push(`${referencia}: o código ${codigo} já existe ou está repetido.`);
      return;
    }
    const valores: Record<string, string> = {};
    const antes = erros.length;
    for (const campo of campos) {
      const n = normalizarCampo(reg, campo, v(campo));
      if ('erro' in n) erros.push(`${referencia}, ${campo}: ${n.erro}`);
      else valores[campo] = n.valor;
    }
    if (reg === '0150' && ((valores.CNPJ && !cnpjValido(valores.CNPJ)) || (valores.CPF && !cpfValido(valores.CPF)) || (valores.CNPJ && valores.CPF))) {
      erros.push(`${referencia}: informe apenas um CNPJ ou CPF válido.`);
    }
    if (erros.length !== antes) return;
    const r = novoRegistro(reg, valores);
    r.cadastroAvulso = true;
    codigos.add(codigo);
    vistos.set(pai, codigos);
    plano.push({ e, pai, cnpj, r, referencia });
  });
  return plano;
}

export function prepararExcel(bytes: ArrayBuffer, arquivo: string, aba: string, tipo: TipoLinhaTodos, linhas: LinhaQualquer[], escrituracoes: Escrituracao[]): PreviaExcel {
  const pasta = XLSX.read(bytes);
  const [titulos, ...dados] = lerAba(pasta, aba);
  if (!titulos || !titulos.includes(CHAVE) || !titulos.includes(REVISAO)) throw new Error(`Use uma nova planilha exportada pela aba ${aba}.`);
  const indiceId = titulos.indexOf(CHAVE);
  const indiceRevisao = titulos.indexOf(REVISAO);
  const campos = colunas(tipo);
  const editaveis = campos.flatMap((c) => {
    const chave = chaveDeEdicao(tipo, c.id);
    const indice = titulos.indexOf(titulo(c));
    return chave && indice >= 0 ? [{ c, chave, indice }] : [];
  });
  const porId = new Map(linhas.map((linha) => [idLinha(linha), linha]));
  const vistos = new Set<string>();
  const plano: PassoEdicao[] = [];
  const porRegistro = new Map<Registro, Map<string, string>>();
  const erros: string[] = [];
  const mudancas: string[] = [];
  const avisos: string[] = [];
  dados.forEach((celulas, i) => {
    if (!celulas.some((c) => c !== '')) return;
    const referencia = `${aba}, linha ${i + 2}`;
    const id = celulas[indiceId];
    const linha = porId.get(id);
    if (!linha || vistos.has(id)) {
      erros.push(`${referencia}: ${linha ? 'identificador repetido' : 'registro não encontrado no tipo e na sessão atuais'}.`);
      return;
    }
    vistos.add(id);
    if (celulas[indiceRevisao] !== revisao(linha, campos)) {
      erros.push(`${referencia}: o registro mudou após a exportação. Exporte uma planilha nova.`);
      return;
    }
    const alteradas = editaveis.flatMap(({ c, chave, indice }) => {
      const atual = valorExibicao(linha, c.id);
      const novo = celulas[indice] ?? '';
      return novo !== atual ? [{ c, chave, atual, novo }] : [];
    });
    const alteracao = planejarEdicao([linha], Object.fromEntries(alteradas.map(({ chave, novo }) => [chave, novo])));
    if (alteracao.erros.length) {
      erros.push(...alteracao.erros.map((e) => `${referencia}, ${e.campo}: ${e.mensagem}`));
      return;
    }
    for (const passo of alteracao.plano) {
      let campos = porRegistro.get(passo.r);
      if (!campos) porRegistro.set(passo.r, campos = new Map());
      const anterior = campos.get(passo.campo);
      if (anterior === undefined) {
        campos.set(passo.campo, passo.valor);
        plano.push(passo);
      } else if (anterior !== passo.valor) {
        erros.push(`${referencia}: há valores diferentes para o mesmo campo ${passo.campo}.`);
      }
    }
    mudancas.push(...alteradas.map(({ c, atual, novo }) => `${referencia}, ${c.rotulo}: ${atual || '(vazio)'} → ${novo || '(vazio)'}`));
  });
  const pacotes = aba === 'Documentos' ? inclusoes(pasta, arquivo) : [];
  const lote = JSON.stringify(pacotes.map((p) => [p.cnpj, p.documentos.map(({ referencia: _referencia, ...d }) => d)]));
  const jaIncluido = () => pacotes.length > 0 && escrituracoes.some((e) => lotesIncluidos.get(e)?.has(lote));
  if (jaIncluido()) erros.push('As inclusões desta planilha já foram aplicadas nesta sessão. Exporte uma nova planilha para continuar.');
  const cadastros = aba === 'Cadastros' ? novosCadastros(pasta, tipo, escrituracoes, erros) : [];
  for (const c of cadastros) mudancas.push(`${c.referencia}: incluir cadastro ${get(c.r, c.r.reg === '0150' ? 'COD_PART' : 'COD_ITEM')}`);
  const importar = () => pacotes.map((p) => importarPacote(escrituracoes, p));
  if (pacotes.length && !erros.length) {
    for (const [i, res] of simular(() => { aplicarPlano(plano); return importar(); }).entries()) {
      erros.push(...res.ignorados.map((d) => `${d.referencia ?? 'Inclusão'}: ${d.motivo}`));
      avisos.push(...res.avisos.map((a) => a.mensagem));
      for (const documento of pacotes[i].documentos) {
        mudancas.push(`${documento.referencia}: ${documento.tipo === 'nota' ? `incluir nota ${documento.numero} com ${documento.itens.length} item(ns)` : 'incluir item em nota existente'}`);
      }
    }
  }
  return {
    erros, mudancas, avisos,
    aplicar: () => executar('Importação de Excel', () => {
      if (erros.length || jaIncluido()) throw new Error('Corrija os erros da planilha antes de aplicar.');
      aplicarPlano(plano);
      for (const { e, pai, cnpj, r } of cadastros) {
        if (r.reg === '0200') garantirUnidade(e, cnpj, get(r, 'UNID_INV'));
        inserir(e, pai, r);
      }
      const resultados = importar();
      for (const res of resultados) {
        if (res.ignorados.length) throw new Error(res.ignorados.map((d) => `${d.referencia}: ${d.motivo}`).join('\n'));
      }
      const destino = escrituracoes.find((e) => resultados.some((r) => e.id in r.porEscrituracao));
      if (destino) {
        let lotes = lotesIncluidos.get(destino);
        if (!lotes) lotesIncluidos.set(destino, lotes = new Set());
        const incluidos = lotes;
        registrarAcao(destino, () => incluidos.add(lote), () => incluidos.delete(lote));
      }
    }),
  };
}
