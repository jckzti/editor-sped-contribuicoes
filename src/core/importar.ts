/**
 * Importação do pacote JSON (`PacoteImportacao`) para as escriturações carregadas.
 *
 * - Escolhe a escrituração pelo CNPJ do estabelecimento (0140/C010) e pelo período do
 *   documento (`periodo`; senão data de entrada/saída; senão data do documento, dentro
 *   de DT_INI..DT_FIN).
 * - Cria C100+C170, itens em nota existente, D100+D101+D105, C500+C501+C505, F100,
 *   nota de serviço (A100+A170) e bem do imobilizado (F120 ou F130) no bloco e
 *   estabelecimento certos (cria C010/D010/F010/A010 se faltar).
 * - Cria os cadastros que faltarem (0150, 0200, 0190, 0400). Conta contábil (0500) não
 *   é criada: o pacote não traz os dados do plano de contas (gera aviso).
 * - Recusa duplicata (mesma chave, ou mesmo modelo+série+número+participante) e documento
 *   fora do período das escriturações carregadas, com o motivo no resultado.
 * - Tudo como UMA operação desfazível.
 *
 * O editor NÃO supõe alíquota: documento, item ou crédito com CST de crédito (50–66) ou de
 * receita tributada (01/02) que vem sem alíquota entra com alíquota e valor zerados e é
 * contado como pendente de tributação (`semAliquota`, `pendentesTributacao`), com aviso para
 * definir a alíquota por regra. A verificação acusa `CST_ALIQUOTA_ZERO` enquanto não for definida.
 */
import { cadastrosDe, contaExiste, garantirItem, garantirParticipante, indices } from './cadastros';
import { camposTributo, cent, cstCredito, cstReceita, incluirC170, maiorNumItem, num, num0 } from './construir';
import { divArred, fmtCentavos, mulAliq } from './dec';
import { MESES_PARCELAS } from './imobilizado';
import type {
  CreditoImport,
  DocumentoImport,
  EnergiaImport,
  FreteImport,
  ImobilizadoImport,
  ItemImport,
  ItemServicoImport,
  ItensEmNotaImport,
  NotaImport,
  OutraOperacaoImport,
  PacoteImportacao,
  ParticipanteImport,
  ResultadoImportacao,
  ServicoImport,
} from './importacao.tipos';
import { idx, leiaute, novoRegistro, type Escrituracao, type Registro } from './modelo';
import { inserir, pontoDeSalvamento, voltarAte } from './mutacao';
import { executar } from './operacao';
import tabelas from './tabelas.json';
import { fixarResiduosAtuais } from './totais';
import { casasDecimais, centavosRapido, chaveValida, cnpjValido, cpfValido, dataSpedParaNumero, isoParaSped, normalizarNumero, periodoIso, soDigitos } from './util';

export interface AvisoImportacao {
  /** Posição do documento no pacote (base 0). */
  indice: number;
  referencia?: string;
  mensagem: string;
}

/** Resultado da importação: o do contrato + avisos e pendências (acréscimos deste módulo). */
export interface ResultadoImportacaoDetalhado extends ResultadoImportacao {
  /** Avisos de documentos incluídos (cadastro incompleto, conta sem 0500, tributação pendente...). */
  avisos: AvisoImportacao[];
  /**
   * Itens/créditos com tributação a definir por regra: entrada com CST 98 e base zero, mais os
   * que vieram com CST de crédito ou de receita tributada sem alíquota (`semAliquota`).
   */
  pendentesTributacao: number;
  /** Itens, créditos, operações e bens com CST de crédito (50–66) ou 01/02 que vieram sem alíquota (entraram com alíquota zero). */
  semAliquota: number;
}

const CST_VALIDOS = tabelas.cst as Record<string, string>;
const NAT_BC_VALIDOS = tabelas.natBcCred as Record<string, string>;

function valoresDe(reg: string, campo: string): Record<string, string> | undefined {
  return leiaute.registros[reg].campos.find((c) => c.nome === campo)?.valores;
}

// ---------------------------------------------------------------------------
// Validação
// ---------------------------------------------------------------------------

function validarData(iso: string | undefined, nome: string, obrig: boolean, erros: string[]): void {
  if (!iso) {
    if (obrig) erros.push(`${nome} não informada.`);
    return;
  }
  if (!isoParaSped(iso)) erros.push(`${nome} "${iso}" inválida (use AAAA-MM-DD).`);
}

function validarNumero(v: unknown, nome: string, obrig: boolean, erros: string[]): void {
  if (v === undefined || v === null || v === '') {
    if (obrig) erros.push(`${nome} não informado.`);
    return;
  }
  try {
    num(v as string, 6, nome);
  } catch (err) {
    erros.push((err as Error).message);
  }
}

function validarParticipante(p: ParticipanteImport | undefined, erros: string[], obrig = true): void {
  if (!p) {
    if (obrig) erros.push('Participante não informado.');
    return;
  }
  const d = soDigitos(p.cnpjCpf);
  if (d.length === 14 && !cnpjValido(d)) erros.push(`CNPJ do participante ${d} com dígito verificador inválido.`);
  else if (d.length === 11 && !cpfValido(d)) erros.push(`CPF do participante ${d} com dígito verificador inválido.`);
  else if (d && d.length !== 14 && d.length !== 11) erros.push(`CNPJ/CPF do participante "${p.cnpjCpf}" deve ter 14 ou 11 dígitos.`);
  if (!d && (!p.codPais || p.codPais === '1058')) erros.push('Participante sem CNPJ/CPF (para exterior, informe codPais).');
  if (!p.nome?.trim()) erros.push('Nome do participante não informado.');
}

function validarChave(ch: string | undefined, erros: string[]): void {
  if (!ch) return;
  const d = soDigitos(ch);
  if (!chaveValida(d)) erros.push(`Chave de acesso "${ch}" inválida (44 dígitos com dígito verificador).`);
}

function validarCst(cst: string | undefined, nome: string, erros: string[]): void {
  if (!cst) erros.push(`${nome}: CST não informado.`);
  else if (!(cst in CST_VALIDOS)) erros.push(`${nome}: CST "${cst}" não existe.`);
}

function validarItem(it: ItemImport, k: number, operacao: 'entrada' | 'saida' | null, erros: string[]): void {
  const p = `Item ${k + 1}${it?.codigo ? ` (${it.codigo})` : ''}`;
  if (!it || typeof it !== 'object') {
    erros.push(`${p}: inválido.`);
    return;
  }
  if (!it.codigo?.trim()) erros.push(`${p}: código do produto não informado.`);
  if (!it.unidade?.trim()) erros.push(`${p}: unidade não informada.`);
  if (it.unidade && it.unidade.trim().length > 6) erros.push(`${p}: unidade "${it.unidade}" tem mais de 6 caracteres.`);
  validarNumero(it.quantidade, `${p}: quantidade`, true, erros);
  validarNumero(it.valorItem, `${p}: valor do item`, true, erros);
  validarNumero(it.valorDesconto, `${p}: desconto`, false, erros);
  if (!/^\d{4}$/.test(it.cfop ?? '')) erros.push(`${p}: CFOP "${it.cfop ?? ''}" deve ter 4 dígitos.`);
  else if (operacao) {
    const c = it.cfop[0];
    if (operacao === 'entrada' && !'123'.includes(c)) erros.push(`${p}: CFOP ${it.cfop} é de saída, mas a nota é de entrada.`);
    if (operacao === 'saida' && !'567'.includes(c)) erros.push(`${p}: CFOP ${it.cfop} é de entrada, mas a nota é de saída.`);
  }
  for (const [t, nome] of [[it.pis, 'PIS'], [it.cofins, 'COFINS']] as const) {
    if (!t) {
      erros.push(`${p}: ${nome} não informado.`);
      continue;
    }
    validarCst(t.cst, `${p}: ${nome}`, erros);
    validarNumero(t.base, `${p}: base de ${nome}`, false, erros);
    validarNumero(t.aliquota, `${p}: alíquota de ${nome}`, false, erros);
    validarNumero(t.valor, `${p}: valor de ${nome}`, false, erros);
    if (operacao === 'saida' && cstCredito(t.cst)) erros.push(`${p}: CST ${t.cst} de ${nome} é de crédito (entrada), mas a nota é de saída.`);
    if (operacao === 'entrada' && cstReceita(t.cst)) erros.push(`${p}: CST ${t.cst} de ${nome} é de receita (saída), mas a nota é de entrada.`);
  }
}

function validarCreditos(cr: CreditoImport[] | undefined, erros: string[]): void {
  if (!Array.isArray(cr) || !cr.length) {
    erros.push('Informe ao menos uma linha de crédito (complemento de PIS/COFINS).');
    return;
  }
  cr.forEach((c, k) => {
    const p = `Crédito ${k + 1}`;
    validarNumero(c.valorItem, `${p}: valor`, true, erros);
    validarCst(c.cst, p, erros);
    if (c.natBcCred && !(c.natBcCred in NAT_BC_VALIDOS)) erros.push(`${p}: código de base de crédito "${c.natBcCred}" não existe.`);
    if (cstCredito(c.cst) && !c.natBcCred) erros.push(`${p}: CST ${c.cst} gera crédito e exige o código da base de crédito (natBcCred).`);
    if (cstReceita(c.cst)) erros.push(`${p}: CST ${c.cst} é de receita; aquisição usa CST 50 a 99.`);
    validarNumero(c.base, `${p}: base`, false, erros);
    validarNumero(c.aliquotaPis, `${p}: alíquota PIS`, false, erros);
    validarNumero(c.aliquotaCofins, `${p}: alíquota COFINS`, false, erros);
  });
}

const SIT_SEM_ITENS = new Set(['02', '03', '04', '05']);

/** Valida um documento do pacote; devolve as mensagens de erro (vazio = ok). */
export function validarDocumento(d: DocumentoImport): string[] {
  const erros: string[] = [];
  if (!d || typeof d !== 'object') return ['Documento inválido.'];
  if (d.periodo && !/^\d{4}-\d{2}$/.test(d.periodo)) erros.push(`Período "${d.periodo}" inválido (use AAAA-MM).`);
  switch (d.tipo) {
    case 'nota': {
      if (d.operacao !== 'entrada' && d.operacao !== 'saida') erros.push('Operação deve ser "entrada" ou "saida".');
      if (d.emissao !== 'propria' && d.emissao !== 'terceiros') erros.push('Emissão deve ser "propria" ou "terceiros".');
      const mod = d.modelo ?? '55';
      if (!(mod in (valoresDe('C100', 'COD_MOD') ?? {}))) erros.push(`Modelo "${mod}" não é aceito no C100 (01, 1B, 04, 55, 65).`);
      const sit = d.situacao ?? '00';
      if (!(sit in (valoresDe('C100', 'COD_SIT') ?? {}))) erros.push(`Situação "${sit}" inválida.`);
      if (!/^\d{1,9}$/.test(d.numero ?? '')) erros.push(`Número "${d.numero ?? ''}" deve ter de 1 a 9 dígitos.`);
      if ((d.serie ?? '').length > 3) erros.push(`Série "${d.serie}" tem mais de 3 caracteres.`);
      validarChave(d.chave, erros);
      if (mod === '55' && !d.chave) erros.push('NF-e (modelo 55) exige a chave de acesso.');
      validarData(d.dataDocumento, 'Data do documento', !SIT_SEM_ITENS.has(sit), erros);
      validarData(d.dataEntradaSaida, 'Data de entrada/saída', false, erros);
      if (!SIT_SEM_ITENS.has(sit)) {
        validarParticipante(d.participante, erros);
        if (!Array.isArray(d.itens) || !d.itens.length) erros.push('Nota sem itens.');
        else d.itens.forEach((it, k) => validarItem(it, k, d.operacao === 'entrada' || d.operacao === 'saida' ? d.operacao : null, erros));
      }
      for (const [k, v] of Object.entries(d.totais ?? {})) validarNumero(v, `Total "${k}"`, false, erros);
      break;
    }
    case 'itens':
      if (!d.nota || (!d.nota.chave && !d.nota.numero)) erros.push('Informe a chave ou o número da nota que recebe os itens.');
      if (!Array.isArray(d.itens) || !d.itens.length) erros.push('Nenhum item para incluir.');
      else d.itens.forEach((it, k) => validarItem(it, k, null, erros));
      break;
    case 'frete': {
      if (d.operacao !== 'entrada') erros.push('O D100 só registra aquisição de frete (operação "entrada"); prestação de serviço de transporte não é suportada.');
      if (d.emissao !== 'propria' && d.emissao !== 'terceiros') erros.push('Emissão deve ser "propria" ou "terceiros".');
      const mod = d.modelo ?? '57';
      if (!(mod in (valoresDe('D100', 'COD_MOD') ?? {}))) erros.push(`Modelo "${mod}" não é aceito no D100.`);
      const sit = d.situacao ?? '00';
      if (!(sit in (valoresDe('D100', 'COD_SIT') ?? {}))) erros.push(`Situação "${sit}" inválida para o D100.`);
      if (!/^\d{1,9}$/.test(d.numero ?? '')) erros.push(`Número "${d.numero ?? ''}" deve ter de 1 a 9 dígitos.`);
      validarChave(d.chave, erros);
      validarData(d.dataDocumento, 'Data do documento', true, erros);
      validarData(d.dataEntradaSaida, 'Data da aquisição', false, erros);
      validarParticipante(d.participante, erros);
      validarNumero(d.valorDocumento, 'Valor do documento', true, erros);
      if (!(d.natFrete in (valoresDe('D101', 'IND_NAT_FRT') ?? {}))) erros.push(`Natureza do frete "${d.natFrete ?? ''}" inválida (0, 1, 2, 3, 4, 5 ou 9).`);
      if (d.indFrete && !(d.indFrete in (valoresDe('D100', 'IND_FRT') ?? {}))) erros.push(`Tipo de frete "${d.indFrete}" inválido.`);
      validarCreditos(d.creditos, erros);
      break;
    }
    case 'energia': {
      const mod = d.modelo ?? '06';
      if (!(mod in (valoresDe('C500', 'COD_MOD') ?? {}))) erros.push(`Modelo "${mod}" não é aceito no C500 (06, 28, 29, 55, 66).`);
      const sit = d.situacao ?? '00';
      if (!(sit in (valoresDe('C500', 'COD_SIT') ?? {}))) erros.push(`Situação "${sit}" inválida para o C500.`);
      if (!/^\d{1,9}$/.test(d.numero ?? '')) erros.push(`Número "${d.numero ?? ''}" deve ter de 1 a 9 dígitos.`);
      validarChave(d.chave, erros);
      validarData(d.dataDocumento, 'Data do documento', true, erros);
      validarData(d.dataEntrada, 'Data de entrada', true, erros);
      validarParticipante(d.participante, erros);
      validarNumero(d.valorDocumento, 'Valor do documento', true, erros);
      validarCreditos(d.creditos, erros);
      break;
    }
    case 'f100': {
      if (!['0', '1', '2'].includes(d.indOper)) erros.push('indOper deve ser "0", "1" ou "2".');
      validarData(d.data, 'Data da operação', true, erros);
      validarNumero(d.valor, 'Valor da operação', true, erros);
      validarParticipante(d.participante, erros, false);
      for (const [t, nome] of [[d.pis, 'PIS'], [d.cofins, 'COFINS']] as const) {
        if (!t) erros.push(`${nome} não informado.`);
        else {
          validarCst(t.cst, nome, erros);
          if (d.indOper === '0' && cstReceita(t.cst)) erros.push(`${nome}: CST ${t.cst} é de receita, mas indOper "0" é operação com crédito.`);
          if (d.indOper !== '0' && cstCredito(t.cst)) erros.push(`${nome}: CST ${t.cst} é de crédito, mas indOper "${d.indOper}" é receita.`);
        }
      }
      if (d.indOper === '0' && !d.natBcCred) erros.push('Operação com crédito (indOper "0") exige natBcCred.');
      if (d.natBcCred && !(d.natBcCred in NAT_BC_VALIDOS)) erros.push(`Código de base de crédito "${d.natBcCred}" não existe.`);
      if (d.indOrigCred && !['0', '1'].includes(d.indOrigCred)) erros.push('indOrigCred deve ser "0" ou "1".');
      break;
    }
    case 'servico':
      validarServico(d, erros);
      break;
    case 'imobilizado':
      validarImobilizado(d, erros);
      break;
    default:
      erros.push(`Tipo de documento "${(d as { tipo?: string }).tipo ?? ''}" desconhecido (use nota, itens, frete, energia, f100, servico ou imobilizado).`);
  }
  return erros;
}

function validarServico(d: ServicoImport, erros: string[]): void {
  if (d.operacao !== 'contratado' && d.operacao !== 'prestado') erros.push('Operação deve ser "contratado" ou "prestado".');
  if (d.emissao !== 'propria' && d.emissao !== 'terceiros') erros.push('Emissão deve ser "propria" ou "terceiros".');
  const sit = d.situacao ?? '00';
  if (sit !== '00' && sit !== '02') erros.push(`Situação "${sit}" inválida para nota de serviço (00 regular ou 02 cancelada).`);
  if (!(d.numero ?? '').trim()) erros.push('Número do documento não informado (use "SN" se não houver).');
  else if (d.numero.length > 60) erros.push('Número do documento com mais de 60 caracteres.');
  if ((d.serie ?? '').length > 20) erros.push(`Série "${d.serie}" tem mais de 20 caracteres.`);
  if ((d.chave ?? '').length > 60) erros.push('Chave/código de verificação da NFS-e com mais de 60 caracteres.');
  if (d.indPagamento && !['0', '1', '9'].includes(d.indPagamento)) erros.push('indPagamento deve ser "0", "1" ou "9".');
  validarData(d.dataDocumento, 'Data do documento', true, erros);
  validarData(d.dataExecucao, 'Data de execução do serviço', false, erros);
  for (const [v, nome] of [[d.valorDocumento, 'Valor do documento'], [d.valorDesconto, 'Desconto'], [d.pisRetido, 'PIS retido'], [d.cofinsRetido, 'COFINS retida'], [d.valorIss, 'ISS']] as const) {
    validarNumero(v, nome, false, erros);
  }
  if (sit === '02') return;
  // guia, A100 campo 04: participante obrigatório na contratação (operação geradora de crédito)
  validarParticipante(d.participante, erros, d.operacao === 'contratado');
  if (!Array.isArray(d.itens) || !d.itens.length) {
    erros.push('Nota de serviço sem itens (o guia exige ao menos um A170).');
    return;
  }
  d.itens.forEach((it, k) => validarItemServico(it, k, d.operacao, erros));
}

function validarItemServico(it: ItemServicoImport, k: number, operacao: 'contratado' | 'prestado', erros: string[]): void {
  const p = `Item ${k + 1}${it?.codigo ? ` (${it.codigo})` : ''}`;
  if (!it || typeof it !== 'object') {
    erros.push(`${p}: inválido.`);
    return;
  }
  if (!it.codigo?.trim()) erros.push(`${p}: código do serviço não informado.`);
  if (it.unidade && it.unidade.trim().length > 6) erros.push(`${p}: unidade "${it.unidade}" tem mais de 6 caracteres.`);
  validarNumero(it.valorItem, `${p}: valor do item`, true, erros);
  validarNumero(it.valorDesconto, `${p}: desconto`, false, erros);
  if (it.indOrigCred && !['0', '1'].includes(it.indOrigCred)) erros.push(`${p}: indOrigCred deve ser "0" ou "1".`);
  if (it.natBcCred && !(it.natBcCred in NAT_BC_VALIDOS)) erros.push(`${p}: código de base de crédito "${it.natBcCred}" não existe.`);
  for (const [t, nome] of [[it.pis, 'PIS'], [it.cofins, 'COFINS']] as const) {
    if (!t) {
      erros.push(`${p}: ${nome} não informado.`);
      continue;
    }
    validarCst(t.cst, `${p}: ${nome}`, erros);
    validarNumero(t.base, `${p}: base de ${nome}`, false, erros);
    validarNumero(t.aliquota, `${p}: alíquota de ${nome}`, false, erros);
    const al = t.aliquota === undefined || t.aliquota === '' ? null : normalizarNumero(t.aliquota);
    if (al && casasDecimais(al) > 2) erros.push(`${p}: alíquota de ${nome} "${String(t.aliquota)}" tem mais de 2 casas (o leiaute do A170 aceita 2).`);
    validarNumero(t.valor, `${p}: valor de ${nome}`, false, erros);
    if (operacao === 'prestado' && cstCredito(t.cst)) erros.push(`${p}: CST ${t.cst} de ${nome} é de crédito, mas o serviço é prestado (receita).`);
    if (operacao === 'contratado' && cstReceita(t.cst)) erros.push(`${p}: CST ${t.cst} de ${nome} é de receita, mas o serviço é contratado.`);
    if (cstCredito(t.cst) && !it.natBcCred) erros.push(`${p}: CST ${t.cst} gera crédito e exige o código da base de crédito (natBcCred, ex.: "03" serviço utilizado como insumo).`);
  }
  if (operacao === 'prestado' && (it.natBcCred || it.indOrigCred)) erros.push(`${p}: natBcCred/indOrigCred só valem em serviço contratado (guia, A170 campos 07 e 08).`);
}

function validarImobilizado(d: ImobilizadoImport, erros: string[]): void {
  if (!d.periodo) erros.push('Bem do imobilizado não tem data de documento: informe "periodo" (AAAA-MM).');
  if (d.modalidade !== 'depreciacao' && d.modalidade !== 'aquisicao') erros.push('modalidade deve ser "depreciacao" (F120) ou "aquisicao" (F130).');
  const reg = d.modalidade === 'aquisicao' ? 'F130' : 'F120';
  const nat = d.natBcCred ?? (reg === 'F130' ? '10' : '09');
  if (!(nat in (valoresDe(reg, 'NAT_BC_CRED') ?? {}))) erros.push(`natBcCred "${nat}" não é aceito no ${reg} (${Object.keys(valoresDe(reg, 'NAT_BC_CRED') ?? {}).join(', ')}).`);
  if (!(d.identificacaoBem in (valoresDe(reg, 'IDENT_BEM_IMOB') ?? {}))) erros.push(`identificacaoBem "${d.identificacaoBem ?? ''}" inválida (01 a 06 ou 99).`);
  if (!(d.utilizacao in (valoresDe(reg, 'IND_UTIL_BEM_IMOB') ?? {}))) erros.push(`utilizacao "${d.utilizacao ?? ''}" inválida (1, 2, 3 ou 9).`);
  if (d.indOrigCred && !['0', '1'].includes(d.indOrigCred)) erros.push('indOrigCred deve ser "0" ou "1".');
  validarNumero(d.parcelaSemCredito, 'Parcela sem direito a crédito', false, erros);
  if (d.modalidade !== 'aquisicao') validarNumero(d.valorEncargo, 'Encargo de depreciação/amortização', true, erros);
  else {
    validarNumero(d.valorAquisicao, 'Valor de aquisição', true, erros);
    if (d.mesAquisicao && !/^\d{4}-(0[1-9]|1[0-2])$/.test(d.mesAquisicao)) erros.push(`mesAquisicao "${d.mesAquisicao}" inválido (use AAAA-MM).`);
    if (!d.parcelas || !(d.parcelas in (valoresDe('F130', 'IND_NR_PARC') ?? {}))) erros.push('parcelas deve ser "1", "2", "3", "4", "5" ou "9".');
    if (d.parcelas === '9') validarNumero(d.baseMes, 'Base do mês (parcelas "9")', true, erros);
  }
  for (const [t, nome] of [[d.pis, 'PIS'], [d.cofins, 'COFINS']] as const) {
    if (!t) {
      erros.push(`${nome} não informado.`);
      continue;
    }
    validarCst(t.cst, nome, erros);
    if (cstReceita(t.cst)) erros.push(`${nome}: CST ${t.cst} é de receita; bem do imobilizado usa CST de crédito (50 a 66) ou sem crédito.`);
    validarNumero(t.aliquota, `Alíquota de ${nome}`, false, erros);
  }
}

/** Valida o pacote inteiro sem importar: erros gerais e por documento (índice → mensagens). */
export function validarPacote(p: PacoteImportacao): { gerais: string[]; porDocumento: Map<number, string[]> } {
  const gerais: string[] = [];
  const porDocumento = new Map<number, string[]>();
  if (!p || typeof p !== 'object') return { gerais: ['O arquivo não é um pacote de importação (JSON).'], porDocumento };
  if (p.formato !== 'sped-contrib-import') gerais.push('Formato desconhecido: o campo "formato" deve ser "sped-contrib-import".');
  if (p.versao !== 1) gerais.push(`Versão ${String(p.versao)} do pacote não suportada (esperada 1).`);
  const cnpj = soDigitos(p.cnpj);
  if (!cnpjValido(cnpj)) gerais.push(`CNPJ do pacote "${p.cnpj ?? ''}" inválido.`);
  if (!Array.isArray(p.documentos)) gerais.push('O pacote não tem a lista "documentos".');
  else
    p.documentos.forEach((d, i) => {
      const e = validarDocumento(d);
      if (e.length) porDocumento.set(i, e);
    });
  return { gerais, porDocumento };
}

// ---------------------------------------------------------------------------
// Escolha da escrituração e duplicatas
// ---------------------------------------------------------------------------

function temEstabelecimento(e: Escrituracao, cnpj: string): boolean {
  if (e.cnpj === cnpj) return true;
  if (indices(e).estabs.has(cnpj)) return true;
  for (const b of e.raiz.filhos) if (b.reg === 'C001') for (const f of b.filhos) if (f.reg === 'C010' && f.campos[1] === cnpj) return true;
  return false;
}

function dataReferencia(d: DocumentoImport): string | undefined {
  switch (d.tipo) {
    case 'nota':
    case 'frete':
      return d.dataEntradaSaida || d.dataDocumento;
    case 'energia':
      return d.dataEntrada || d.dataDocumento;
    case 'f100':
      return d.data;
    case 'servico':
      return d.dataExecucao || d.dataDocumento;
    default:
      return undefined;
  }
}

function escolher(cands: Escrituracao[], d: DocumentoImport): Escrituracao | string {
  if (d.periodo) {
    const e = cands.find((x) => periodoIso(x.periodo) === d.periodo);
    return e ?? `Nenhuma escrituração carregada do período ${d.periodo} para este CNPJ.`;
  }
  const ref = dataReferencia(d);
  if (!ref) return 'Documento sem período nem data para escolher a escrituração.';
  const naData = (iso: string) => {
    const n = dataSpedParaNumero(isoParaSped(iso));
    return cands.find((x) => n >= dataSpedParaNumero(x.dtIni) && n <= dataSpedParaNumero(x.dtFim));
  };
  // serviço: a data de execução; se nenhuma escrituração a cobre, a de emissão (o guia aceita qualquer uma no período)
  const e = naData(ref) ?? (d.tipo === 'servico' && d.dataExecucao && d.dataDocumento ? naData(d.dataDocumento) : undefined);
  if (e) return e;
  return d.tipo === 'servico' && d.dataExecucao
    ? `Nem a data de execução (${d.dataExecucao}) nem a de emissão (${d.dataDocumento}) estão no período das escriturações carregadas deste CNPJ.`
    : `Data ${ref} fora do período das escriturações carregadas deste CNPJ.`;
}

/** Índice de documentos existentes para detectar duplicatas. */
interface IndiceDocs {
  chaves: Set<string>;
  numeros: Set<string>;
  f100: Set<string>;
  /** F120/F130: todos os campos (bem idêntico no mesmo mês = duplicata). */
  imob: Set<string>;
}

const normNum = (s: string) => (/^\d+$/.test(s) ? String(Number(s)) : s.trim().toUpperCase());

function chaveNumero(reg: string, mod: string, ser: string, num: string, partDoc: string): string {
  return `${reg}|${mod}|${normNum(ser)}|${normNum(num)}|${partDoc}`;
}

const IF100 = ['IND_OPER', 'COD_PART', 'DT_OPER', 'VL_OPER', 'CST_PIS', 'VL_PIS', 'CST_COFINS', 'VL_COFINS', 'COD_CTA'].map((c) => idx('F100', c));
function chaveF100(r: Registro): string {
  return IF100.map((i) => r.campos[i] ?? '').join('|');
}

/** Chave de duplicata de um F100 do pacote, sem criar nada (null se o participante ainda não existe: não há como ser duplicata). */
function chaveF100Import(e: Escrituracao, cnpj: string, d: OutraOperacaoImport): string | null {
  let codPart = '';
  if (d.participante) {
    const doc = soDigitos(d.participante.cnpjCpf);
    const p = doc ? cadastrosDe(e, cnpj).partDoc.get(doc) : undefined;
    if (!p) return null;
    codPart = p.campos[idx('0150', 'COD_PART')];
  }
  const valor = cent(d.valor, 'Valor');
  const pis = camposTributo(d.pis, valor, 0, 'PIS');
  const cofins = camposTributo(d.cofins, valor, 0, 'COFINS');
  return [d.indOper, codPart, isoParaSped(d.data), fmtCentavos(valor), pis.cst, pis.valor, cofins.cst, cofins.valor, (d.contaContabil ?? '').trim()].join('|');
}

/** Chave do A100 pelo guia: IND_OPER, IND_EMIT, COD_SIT, SER, NUM_DOC e, se emissão de terceiros, o participante. */
function chaveA100(oper: string, emit: string, sit: string, ser: string, num: string, partDoc: string): string {
  return chaveNumero('A100', `${oper}|${emit}|${sit}`, ser, num, emit === '1' ? partDoc : '');
}

const chaveImob = (r: Registro) => `${r.reg}|${r.campos.slice(1).join('|')}`;

function documentoDoParticipante(e: Escrituracao, est: Registro, cod: string): string {
  const p = cadastrosDe(e, est.campos[1] ?? '').part.get(cod);
  return p ? p.campos[idx('0150', 'CNPJ')] || p.campos[idx('0150', 'CPF')] || cod : cod;
}

function indexarDocs(e: Escrituracao): IndiceDocs {
  const ix: IndiceDocs = { chaves: new Set(), numeros: new Set(), f100: new Set(), imob: new Set() };
  for (const b of e.raiz.filhos) {
    for (const est of b.filhos) {
      for (const doc of est.filhos) {
        switch (doc.reg) {
          case 'C100':
          case 'D100':
          case 'C500': {
            const g = (c: string) => doc.campos[idx(doc.reg, c)] ?? '';
            const ch = doc.reg === 'C100' ? g('CHV_NFE') : doc.reg === 'D100' ? g('CHV_CTE') : g('CHV_DOCe');
            if (ch) ix.chaves.add(ch);
            ix.numeros.add(chaveNumero(doc.reg, g('COD_MOD'), g('SER'), g('NUM_DOC'), documentoDoParticipante(e, est, g('COD_PART'))));
            break;
          }
          case 'F100':
            ix.f100.add(chaveF100(doc));
            break;
          case 'F120':
          case 'F130':
            ix.imob.add(chaveImob(doc));
            break;
          case 'A100': {
            const g = (c: string) => doc.campos[idx('A100', c)] ?? '';
            if (g('CHV_NFSE')) ix.chaves.add(`A100|${g('CHV_NFSE')}`);
            ix.numeros.add(chaveA100(g('IND_OPER'), g('IND_EMIT'), g('COD_SIT'), g('SER'), g('NUM_DOC'), documentoDoParticipante(e, est, g('COD_PART'))));
            break;
          }
        }
      }
    }
  }
  return ix;
}

/** x010 do estabelecimento no bloco (cria se faltar, sob o x001). */
function estabNoBloco(e: Escrituracao, abertura: string, regEst: string, cnpj: string): Registro {
  const x001 = e.raiz.filhos.find((f) => f.reg === abertura);
  if (!x001) throw new Error(`A escrituração não tem o registro ${abertura}.`);
  const existente = x001.filhos.find((f) => f.reg === regEst && f.campos[1] === cnpj);
  if (existente) return existente;
  const valores: Record<string, string> = { CNPJ: cnpj };
  if (regEst === 'C010') {
    const outro = x001.filhos.find((f) => f.reg === 'C010');
    valores.IND_ESCRI = outro?.campos[idx('C010', 'IND_ESCRI')] || '2';
  }
  const r = novoRegistro(regEst, valores);
  inserir(e, x001, r);
  return r;
}

// ---------------------------------------------------------------------------
// Criação dos documentos
// ---------------------------------------------------------------------------

/** CST que exige alíquota (crédito 50–66 ou receita tributada 01/02) e veio sem ela (ou zero)? */
function faltaAliquota(cst: string | undefined, aliquota: unknown): boolean {
  const c = (cst ?? '').padStart(2, '0');
  if (!cstCredito(c) && c !== '01' && c !== '02') return false;
  if (aliquota === undefined || aliquota === null || aliquota === '') return true;
  const n = normalizarNumero(aliquota as string | number);
  return n !== null && Number(n) === 0;
}

function criarNota(e: Escrituracao, cnpj: string, d: NotaImport, avisos: string[]): Registro {
  const est = estabNoBloco(e, 'C001', 'C010', cnpj);
  const sit = d.situacao ?? '00';
  const semItens = SIT_SEM_ITENS.has(sit);
  const base: Record<string, string> = {
    IND_OPER: d.operacao === 'entrada' ? '0' : '1',
    IND_EMIT: d.emissao === 'propria' ? '0' : '1',
    COD_MOD: d.modelo ?? '55',
    COD_SIT: sit,
    SER: d.serie ?? '',
    NUM_DOC: String(Number(d.numero)),
    CHV_NFE: soDigitos(d.chave),
  };
  if (semItens) {
    if (d.itens?.length) avisos.push(`Documento com situação ${sit} (cancelado/denegado/inutilizado) é escriturado sem itens; ${d.itens.length} item(ns) ignorado(s).`);
    const c100 = novoRegistro('C100', base);
    inserir(e, est, c100);
    return c100;
  }
  const codPart = garantirParticipante(e, cnpj, d.participante, avisos);
  const t = d.totais ?? {};
  const c100 = novoRegistro('C100', {
    ...base,
    COD_PART: codPart,
    DT_DOC: isoParaSped(d.dataDocumento),
    DT_E_S: isoParaSped(d.dataEntradaSaida),
    IND_PGTO: d.indPagamento ?? '1',
    VL_ABAT_NT: '0',
    IND_FRT: d.indFrete ?? '9',
    VL_FRT: num0(t.frete, 2, 'Frete'),
    VL_SEG: num0(t.seguro, 2, 'Seguro'),
    VL_OUT_DA: num0(t.outrasDespesas, 2, 'Outras despesas'),
    VL_PIS_ST: '0',
    VL_COFINS_ST: '0',
  });
  inserir(e, est, c100);
  d.itens.forEach((it, k) => incluirC170(e, c100, cnpj, it, k + 1, avisos));
  // totais: os informados prevalecem; o que faltar é somado dos itens
  let sItem = 0;
  let sDesc = 0;
  let sIpi = 0;
  let sSt = 0;
  const soma: Record<string, number> = { VL_BC_ICMS: 0, VL_ICMS: 0, VL_BC_ICMS_ST: 0, VL_ICMS_ST: 0, VL_IPI: 0, VL_PIS: 0, VL_COFINS: 0 };
  for (const f of c100.filhos) {
    if (f.reg !== 'C170') continue;
    const g = (c: string) => centavosRapido(f.campos[idx('C170', c)]);
    sItem += g('VL_ITEM');
    sDesc += g('VL_DESC');
    sIpi += g('VL_IPI');
    sSt += g('VL_ICMS_ST');
    for (const c of Object.keys(soma)) soma[c] += g(c);
  }
  const g100 = (c: string) => centavosRapido(c100.campos[idx('C100', c)]);
  const vlDesc = t.desconto !== undefined ? cent(t.desconto, 'Desconto') : sDesc;
  const vlMerc = t.mercadorias !== undefined ? cent(t.mercadorias, 'Mercadorias') : sItem;
  const vlDoc =
    t.documento !== undefined ? cent(t.documento, 'Valor do documento') : sItem - sDesc + sIpi + sSt + g100('VL_FRT') + g100('VL_SEG') + g100('VL_OUT_DA');
  const gravar = (c: string, v: number) => (c100.campos[idx('C100', c)] = fmtCentavos(v));
  gravar('VL_DOC', vlDoc);
  gravar('VL_DESC', vlDesc);
  gravar('VL_MERC', vlMerc);
  for (const [c, v] of Object.entries(soma)) gravar(c, v);
  fixarResiduosAtuais(e, c100);
  return c100;
}

function criarItensEmNota(e: Escrituracao, c100: Registro, d: ItensEmNotaImport, avisos: string[]): void {
  const cnpj = c100.pai?.campos[1] ?? '';
  let n = maiorNumItem(c100);
  for (const it of d.itens) incluirC170(e, c100, cnpj, it, ++n, avisos);
}

function complementos(e: Escrituracao, doc: Registro, cr: CreditoImport[], regPis: string, regCofins: string, extra: Record<string, string>, contaDoc: string): void {
  for (const c of cr) {
    const vlItem = cent(c.valorItem, 'Valor do crédito');
    const base = c.base !== undefined && c.base !== '' ? cent(c.base, 'Base do crédito') : vlItem;
    for (const [reg, t, aliqInf] of [
      [regPis, 'PIS', c.aliquotaPis],
      [regCofins, 'COFINS', c.aliquotaCofins],
    ] as const) {
      const aliq = num(aliqInf, 4, `Alíquota ${t}`) || '0'; // sem alíquota: zero e pendente (o editor não supõe)
      const sufixo = t === 'PIS' ? 'PIS' : 'COFINS';
      inserir(
        e,
        doc,
        novoRegistro(reg, {
          ...extra,
          VL_ITEM: fmtCentavos(vlItem),
          [`CST_${sufixo}`]: c.cst,
          NAT_BC_CRED: c.natBcCred ?? '',
          [`VL_BC_${sufixo}`]: fmtCentavos(base),
          [`ALIQ_${sufixo}`]: aliq,
          [`VL_${sufixo}`]: fmtCentavos(mulAliq(base, aliq)),
          COD_CTA: (c.contaContabil ?? contaDoc ?? '').trim(),
        }),
      );
    }
  }
}

function criarFrete(e: Escrituracao, cnpj: string, d: FreteImport, avisos: string[]): Registro {
  const est = estabNoBloco(e, 'D001', 'D010', cnpj);
  const codPart = garantirParticipante(e, cnpj, d.participante, avisos);
  const mod = d.modelo ?? '57';
  const icms = d.icms ?? {};
  const d100 = novoRegistro('D100', {
    IND_OPER: '0',
    IND_EMIT: d.emissao === 'propria' ? '0' : '1',
    COD_PART: codPart,
    COD_MOD: mod,
    COD_SIT: d.situacao ?? '00',
    SER: d.serie ?? '',
    SUB: d.subserie ?? '',
    NUM_DOC: String(Number(d.numero)),
    CHV_CTE: soDigitos(d.chave),
    DT_DOC: isoParaSped(d.dataDocumento),
    DT_A_P: isoParaSped(d.dataEntradaSaida),
    'TP_CT-e': mod === '57' || mod === '67' ? '0' : '',
    CHV_CTE_REF: '',
    VL_DOC: num0(d.valorDocumento, 2, 'Valor do documento'),
    VL_DESC: num0(d.valorDesconto, 2, 'Desconto'),
    IND_FRT: d.indFrete ?? '1',
    VL_SERV: num0(d.valorServico ?? d.valorDocumento, 2, 'Valor do serviço'),
    VL_BC_ICMS: num0(icms.base, 2, 'Base ICMS'),
    VL_ICMS: num0(icms.valor, 2, 'ICMS'),
    VL_NT: num0(icms.naoTributado, 2, 'Valor não tributado'),
    COD_INF: '',
    COD_CTA: (d.contaContabil ?? '').trim(),
  });
  inserir(e, est, d100);
  complementos(e, d100, d.creditos, 'D101', 'D105', { IND_NAT_FRT: d.natFrete }, d.contaContabil ?? '');
  return d100;
}

function criarEnergia(e: Escrituracao, cnpj: string, d: EnergiaImport, avisos: string[]): Registro {
  const est = estabNoBloco(e, 'C001', 'C010', cnpj);
  const codPart = garantirParticipante(e, cnpj, d.participante, avisos);
  const c500 = novoRegistro('C500', {
    COD_PART: codPart,
    COD_MOD: d.modelo ?? '06',
    COD_SIT: d.situacao ?? '00',
    SER: d.serie ?? '',
    SUB: d.subserie ?? '',
    NUM_DOC: String(Number(d.numero)),
    DT_DOC: isoParaSped(d.dataDocumento),
    DT_ENT: isoParaSped(d.dataEntrada),
    VL_DOC: num0(d.valorDocumento, 2, 'Valor do documento'),
    VL_ICMS: num0(d.valorIcms, 2, 'ICMS'),
    COD_INF: '',
    VL_PIS: '0',
    VL_COFINS: '0',
    CHV_DOCe: soDigitos(d.chave),
  });
  inserir(e, est, c500);
  complementos(e, c500, d.creditos, 'C501', 'C505', {}, '');
  // VL_PIS/VL_COFINS = soma dos complementos (resíduo zero): preenchidos no fim da operação
  return c500;
}

function criarF100(e: Escrituracao, cnpj: string, d: OutraOperacaoImport, avisos: string[]): Registro {
  const est = estabNoBloco(e, 'F001', 'F010', cnpj);
  const codPart = d.participante ? garantirParticipante(e, cnpj, d.participante, avisos) : '';
  const valor = cent(d.valor, 'Valor da operação');
  const pis = camposTributo(d.pis, valor, 0, 'PIS');
  const cofins = camposTributo(d.cofins, valor, 0, 'COFINS');
  if (d.codItem && !cadastrosDe(e, cnpj).item.has(d.codItem)) avisos.push(`Código de item ${d.codItem} não existe no 0200: COD_ITEM ficou em branco.`);
  const f100 = novoRegistro('F100', {
    IND_OPER: d.indOper,
    COD_PART: codPart,
    COD_ITEM: d.codItem && cadastrosDe(e, cnpj).item.has(d.codItem) ? d.codItem : '',
    DT_OPER: isoParaSped(d.data),
    VL_OPER: fmtCentavos(valor),
    CST_PIS: pis.cst,
    VL_BC_PIS: pis.base,
    ALIQ_PIS: pis.aliq,
    VL_PIS: pis.valor,
    CST_COFINS: cofins.cst,
    VL_BC_COFINS: cofins.base,
    ALIQ_COFINS: cofins.aliq,
    VL_COFINS: cofins.valor,
    NAT_BC_CRED: d.natBcCred ?? '',
    IND_ORIG_CRED: d.indOper === '0' ? d.indOrigCred ?? '0' : '',
    COD_CTA: (d.contaContabil ?? '').trim(),
    COD_CCUS: d.centroCusto ?? '',
    DESC_DOC_OPER: d.descricao ?? '',
  });
  inserir(e, est, f100);
  return f100;
}

function criarServico(e: Escrituracao, cnpj: string, d: ServicoImport, avisos: string[]): Registro {
  const est = estabNoBloco(e, 'A001', 'A010', cnpj);
  const sit = d.situacao ?? '00';
  const base: Record<string, string> = {
    IND_OPER: d.operacao === 'contratado' ? '0' : '1',
    IND_EMIT: d.emissao === 'propria' ? '0' : '1',
    COD_SIT: sit,
    SER: d.serie ?? '',
    SUB: d.subserie ?? '',
    NUM_DOC: d.numero.trim(),
  };
  if (sit === '02') {
    // guia: documento cancelado só leva situação, operação, emitente, número, série, subsérie e participante
    if (d.itens?.length) avisos.push(`Nota de serviço cancelada é escriturada sem itens; ${d.itens.length} item(ns) ignorado(s).`);
    const cod = d.participante ? garantirParticipante(e, cnpj, d.participante, avisos) : '';
    const a100 = novoRegistro('A100', { ...base, COD_PART: cod });
    inserir(e, est, a100);
    return a100;
  }
  const codPart = d.participante ? garantirParticipante(e, cnpj, d.participante, avisos) : '';
  const a100 = novoRegistro('A100', {
    ...base,
    COD_PART: codPart,
    CHV_NFSE: (d.chave ?? '').trim(),
    DT_DOC: isoParaSped(d.dataDocumento),
    DT_EXE_SERV: isoParaSped(d.dataExecucao),
    VL_DOC: '0',
    IND_PGTO: d.indPagamento ?? '1',
    VL_DESC: '0',
    VL_BC_PIS: '0',
    VL_PIS: '0',
    VL_BC_COFINS: '0',
    VL_COFINS: '0',
    VL_PIS_RET: num0(d.pisRetido, 2, 'PIS retido'),
    VL_COFINS_RET: num0(d.cofinsRetido, 2, 'COFINS retida'),
    VL_ISS: num0(d.valorIss, 2, 'ISS'),
  });
  inserir(e, est, a100);
  let sItem = 0;
  let sDesc = 0;
  const contratado = d.operacao === 'contratado';
  (d.itens ?? []).forEach((it, k) => {
    const existente = cadastrosDe(e, cnpj).item.get(it.codigo.trim());
    const lstAtual = existente ? existente.campos[idx('0200', 'COD_LST')] ?? '' : '';
    if (existente && it.codigoServico && lstAtual !== it.codigoServico.trim()) {
      avisos.push(`Item ${it.codigo} já existe no cadastro (0200) com COD_LST "${lstAtual}"; o código de serviço "${it.codigoServico}" do pacote não foi gravado (o cadastro existente não é alterado).`);
    }
    garantirItem(e, cnpj, { codigo: it.codigo, descricao: it.descricao, unidade: it.unidade ?? '', tipoItem: '09', codLst: it.codigoServico }, avisos);
    const vlItem = cent(it.valorItem, 'Valor do item');
    const vlDesc = cent(it.valorDesconto, 'Desconto do item');
    sItem += vlItem;
    sDesc += vlDesc;
    const pis = camposTributo({ ...it.pis, aliquota: num(it.pis.aliquota, 2, 'Alíquota de PIS') }, vlItem, vlDesc, 'PIS');
    const cofins = camposTributo({ ...it.cofins, aliquota: num(it.cofins.aliquota, 2, 'Alíquota de COFINS') }, vlItem, vlDesc, 'COFINS');
    const conta = (it.contaContabil ?? '').trim();
    if (conta && !contaExiste(e, conta)) avisos.push(`Item ${it.codigo}: conta contábil ${conta} não existe no plano de contas (0500).`);
    const credito = contratado && (cstCredito(pis.cst) || cstCredito(cofins.cst));
    if (contratado && it.indOrigCred === '1') {
      avisos.push(`Item ${it.codigo}: serviço importado (origem "1") exige o registro A120 (guia, A100 obs. 3), que a importação não cria: inclua-o no PVA.`);
    }
    inserir(
      e,
      a100,
      novoRegistro('A170', {
        NUM_ITEM: String(k + 1),
        COD_ITEM: it.codigo.trim(),
        DESCR_COMPL: (it.descricaoComplementar ?? '').trim(),
        VL_ITEM: fmtCentavos(vlItem),
        VL_DESC: fmtCentavos(vlDesc),
        NAT_BC_CRED: credito ? it.natBcCred ?? '' : '',
        IND_ORIG_CRED: contratado ? it.indOrigCred ?? '0' : '',
        CST_PIS: pis.cst,
        VL_BC_PIS: pis.base,
        ALIQ_PIS: pis.aliq,
        VL_PIS: pis.valor,
        CST_COFINS: cofins.cst,
        VL_BC_COFINS: cofins.base,
        ALIQ_COFINS: cofins.aliq,
        VL_COFINS: cofins.valor,
        COD_CTA: conta,
        COD_CCUS: it.centroCusto ?? '',
      }),
    );
  });
  const gravar = (c: string, v: number) => (a100.campos[idx('A100', c)] = fmtCentavos(v));
  const vlDesc = d.valorDesconto !== undefined ? cent(d.valorDesconto, 'Desconto') : sDesc;
  gravar('VL_DESC', vlDesc);
  gravar('VL_DOC', d.valorDocumento !== undefined ? cent(d.valorDocumento, 'Valor do documento') : sItem - vlDesc);
  // VL_BC_PIS, VL_PIS, VL_BC_COFINS, VL_COFINS = soma dos A170 (resíduo zero): preenchidos no fim da operação
  return a100;
}

/**
 * Monta o F120/F130 (sem inserir), com as bases pela regra do guia. `pis.base`/`cofins.base`
 * do pacote não são usadas: se diferirem da regra, avisa.
 */
function montarImobilizado(d: ImobilizadoImport, avisos: string[] = []): Registro {
  const f130 = d.modalidade === 'aquisicao';
  const parcela = cent(d.parcelaSemCredito, 'Parcela sem crédito');
  let baseMes: number;
  const extra: Record<string, string> = {};
  if (d.modalidade === 'depreciacao') {
    const enc = cent(d.valorEncargo, 'Encargo');
    baseMes = enc - parcela;
    extra.VL_OPER_DEP = fmtCentavos(enc);
  } else {
    const aquis = cent(d.valorAquisicao, 'Valor de aquisição');
    const total = aquis - parcela;
    const meses = MESES_PARCELAS[d.parcelas ?? ''];
    baseMes = meses ? Number(divArred(BigInt(total), BigInt(meses))) : cent(d.baseMes, 'Base do mês');
    extra.MES_OPER_AQUIS = d.mesAquisicao ? d.mesAquisicao.slice(5, 7) + d.mesAquisicao.slice(0, 4) : '';
    extra.VL_OPER_AQUIS = fmtCentavos(aquis);
    extra.VL_BC_CRED = fmtCentavos(total);
    extra.IND_NR_PARC = d.parcelas ?? '';
  }
  for (const [t, nome] of [[d.pis, 'PIS'], [d.cofins, 'COFINS']] as const) {
    if (t.base === undefined || t.base === '') continue;
    const informada = cent(t.base, `Base de ${nome}`);
    if (informada !== baseMes) {
      avisos.push(`Base de ${nome} informada (${fmtCentavos(informada)}) difere da regra do guia (${fmtCentavos(baseMes)}); usada a do guia.`);
    }
  }
  const trib = (t: ImobilizadoImport['pis'], nome: 'PIS' | 'COFINS') => {
    const aliq = num(t.aliquota, 4, `Alíquota de ${nome}`) || '0'; // sem alíquota: zero e pendente
    return { cst: t.cst.padStart(2, '0'), base: fmtCentavos(baseMes), aliq, valor: fmtCentavos(mulAliq(baseMes, aliq)) };
  };
  const pis = trib(d.pis, 'PIS');
  const cofins = trib(d.cofins, 'COFINS');
  return novoRegistro(f130 ? 'F130' : 'F120', {
    NAT_BC_CRED: d.natBcCred ?? (f130 ? '10' : '09'),
    IDENT_BEM_IMOB: d.identificacaoBem,
    IND_ORIG_CRED: d.indOrigCred ?? '0',
    IND_UTIL_BEM_IMOB: d.utilizacao,
    ...extra,
    PARC_OPER_NAO_BC_CRED: fmtCentavos(parcela),
    CST_PIS: pis.cst,
    VL_BC_PIS: pis.base,
    ALIQ_PIS: pis.aliq,
    VL_PIS: pis.valor,
    CST_COFINS: cofins.cst,
    VL_BC_COFINS: cofins.base,
    ALIQ_COFINS: cofins.aliq,
    VL_COFINS: cofins.valor,
    COD_CTA: (d.contaContabil ?? '').trim(),
    COD_CCUS: d.centroCusto ?? '',
    DESC_BEM_IMOB: d.descricao ?? '',
  });
}

// ---------------------------------------------------------------------------
// Importação
// ---------------------------------------------------------------------------

function acharNota(cands: Escrituracao[], d: ItensEmNotaImport): { e: Escrituracao; c100: Registro } | string {
  const lista = d.periodo ? cands.filter((x) => periodoIso(x.periodo) === d.periodo) : cands;
  if (d.periodo && !lista.length) return `Nenhuma escrituração carregada do período ${d.periodo} para este CNPJ.`;
  const chave = soDigitos(d.nota.chave);
  const numero = d.nota.numero ? normNum(d.nota.numero) : '';
  const serie = d.nota.serie !== undefined ? normNum(d.nota.serie) : null;
  const doc = soDigitos(d.nota.cnpjCpfParticipante);
  const achadas: { e: Escrituracao; c100: Registro }[] = [];
  for (const e of lista) {
    for (const b of e.raiz.filhos) {
      if (b.reg !== 'C001') continue;
      for (const est of b.filhos)
        for (const c100 of est.filhos) {
          if (c100.reg !== 'C100') continue;
          const g = (c: string) => c100.campos[idx('C100', c)] ?? '';
          if (chave) {
            if (g('CHV_NFE') === chave) achadas.push({ e, c100 });
          } else if (normNum(g('NUM_DOC')) === numero && (serie === null || normNum(g('SER')) === serie)) {
            if (!doc || documentoDoParticipante(e, est, g('COD_PART')) === doc) achadas.push({ e, c100 });
          }
        }
    }
  }
  if (!achadas.length) return `Nota ${chave || numero} não encontrada nas escriturações carregadas.`;
  if (achadas.length > 1) return `Mais de uma nota corresponde a ${chave || numero}; informe a chave ou o CNPJ do participante.`;
  const sit = achadas[0].c100.campos[idx('C100', 'COD_SIT')];
  if (SIT_SEM_ITENS.has(sit)) return `A nota ${chave || numero} está cancelada/denegada/inutilizada (situação ${sit}) e não pode receber itens.`;
  return achadas[0];
}

/**
 * Importa o pacote nas escriturações (as de mesmo CNPJ do pacote), como UMA operação
 * desfazível. Lança erro só se o pacote em si for inválido (formato, versão, CNPJ);
 * problemas de cada documento vão para `ignorados`.
 */
export function importarPacote(escrituracoes: Escrituracao[], pacote: PacoteImportacao): ResultadoImportacaoDetalhado {
  const { gerais, porDocumento } = validarPacote(pacote);
  if (gerais.length) throw new Error(gerais.join(' '));
  const cnpj = soDigitos(pacote.cnpj);
  const res: ResultadoImportacaoDetalhado = { incluidos: 0, ignorados: [], porEscrituracao: {}, avisos: [], pendentesTributacao: 0, semAliquota: 0 };
  const cands = escrituracoes.filter((e) => temEstabelecimento(e, cnpj));
  const indicesDocs = new Map<Escrituracao, IndiceDocs>();
  const ixDe = (e: Escrituracao) => {
    let ix = indicesDocs.get(e);
    if (!ix) indicesDocs.set(e, (ix = indexarDocs(e)));
    return ix;
  };
  const ignorar = (i: number, d: DocumentoImport, motivo: string) => res.ignorados.push({ indice: i, referencia: d?.referencia, motivo });

  executar(`Importação de ${pacote.documentos.length} documento(s)${pacote.origem ? ` (${pacote.origem})` : ''}`, () => {
    pacote.documentos.forEach((d, i) => {
      const erros = porDocumento.get(i);
      if (erros) return ignorar(i, d, erros.join(' '));
      if (!cands.length) return ignorar(i, d, `Nenhuma escrituração carregada tem o estabelecimento CNPJ ${cnpj}.`);
      const avisos: string[] = [];
      let e: Escrituracao;
      if (d.tipo === 'itens') {
        const achada = acharNota(cands, d);
        if (typeof achada === 'string') return ignorar(i, d, achada);
        e = achada.e;
        const oper = achada.c100.campos[idx('C100', 'IND_OPER')] === '0' ? 'entrada' : 'saida';
        const errosItens: string[] = [];
        d.itens.forEach((it, k) => validarItem(it, k, oper, errosItens));
        if (errosItens.length) return ignorar(i, d, errosItens.join(' '));
        const ponto = pontoDeSalvamento();
        try {
          criarItensEmNota(e, achada.c100, d, avisos);
        } catch (err) {
          voltarAte(ponto);
          return ignorar(i, d, (err as Error).message);
        }
        contarPendentes(d.itens, oper, res);
      } else {
        const esc = escolher(cands, d);
        if (typeof esc === 'string') return ignorar(i, d, esc);
        e = esc;
        const ix = ixDe(e);
        // duplicata
        if (d.tipo === 'servico' || d.tipo === 'imobilizado') {
          let criadoA: Registro;
          const ponto = pontoDeSalvamento();
          try {
            if (d.tipo === 'servico') {
              const chave = (d.chave ?? '').trim();
              if (chave && ix.chaves.has(`A100|${chave}`)) return ignorar(i, d, `Nota de serviço já existe na escrituração ${periodoIso(e.periodo)} (mesma chave/código ${chave}).`);
              const oper = d.operacao === 'contratado' ? '0' : '1';
              const emit = d.emissao === 'propria' ? '0' : '1';
              const kn = chaveA100(oper, emit, d.situacao ?? '00', d.serie ?? '', d.numero, soDigitos(d.participante?.cnpjCpf));
              if (ix.numeros.has(kn)) return ignorar(i, d, `Nota de serviço já existe na escrituração ${periodoIso(e.periodo)} (série ${d.serie ?? ''}, número ${d.numero}).`);
              criadoA = criarServico(e, cnpj, d, avisos);
              if (chave) ix.chaves.add(`A100|${chave}`);
              ix.numeros.add(kn);
              for (const it of d.itens ?? []) if (d.operacao === 'contratado' && it.pis?.cst === '98' && !centavosRapido(num(it.pis.base, 2, 'base'))) res.pendentesTributacao++;
            } else {
              const r = montarImobilizado(d, avisos);
              if (ix.imob.has(chaveImob(r))) return ignorar(i, d, `Bem do imobilizado idêntico já existe na escrituração ${periodoIso(e.periodo)}.`);
              inserir(e, estabNoBloco(e, 'F001', 'F010', cnpj), r);
              ix.imob.add(chaveImob(r));
              criadoA = r;
            }
          } catch (err) {
            voltarAte(ponto);
            return ignorar(i, d, (err as Error).message);
          }
          void criadoA;
          contarSemAliquota(d, res);
          res.incluidos++;
          res.porEscrituracao[e.id] = (res.porEscrituracao[e.id] ?? 0) + 1;
          for (const m of avisos) res.avisos.push({ indice: i, referencia: d.referencia, mensagem: m });
          return;
        }
        const regDoc = d.tipo === 'nota' ? 'C100' : d.tipo === 'frete' ? 'D100' : d.tipo === 'energia' ? 'C500' : 'F100';
        if (d.tipo !== 'f100') {
          const chave = soDigitos(d.chave);
          if (chave && ix.chaves.has(chave)) return ignorar(i, d, `Documento já existe na escrituração ${periodoIso(e.periodo)} (mesma chave ${chave}).`);
          const mod = d.modelo ?? (d.tipo === 'nota' ? '55' : d.tipo === 'frete' ? '57' : '06');
          const partDoc = soDigitos(d.participante?.cnpjCpf);
          const kn = chaveNumero(regDoc, mod, d.serie ?? '', d.numero, partDoc);
          if (partDoc && ix.numeros.has(kn))
            return ignorar(i, d, `Documento já existe na escrituração ${periodoIso(e.periodo)} (modelo ${mod}, série ${d.serie ?? ''}, número ${d.numero}, participante ${partDoc}).`);
        }
        if (d.tipo === 'f100') {
          const kf = chaveF100Import(e, cnpj, d);
          if (kf && ix.f100.has(kf)) return ignorar(i, d, `Operação F100 idêntica já existe na escrituração ${periodoIso(e.periodo)}.`);
        }
        let criado: Registro;
        const ponto = pontoDeSalvamento();
        try {
          if (d.tipo === 'nota') {
            criado = criarNota(e, cnpj, d, avisos);
            contarPendentes(d.itens ?? [], d.operacao, res);
          } else if (d.tipo === 'frete') {
            criado = criarFrete(e, cnpj, d, avisos);
            for (const c of d.creditos) if (c.cst === '98' && !centavosRapido(num(c.base, 2, 'base'))) res.pendentesTributacao++;
          } else if (d.tipo === 'energia') criado = criarEnergia(e, cnpj, d, avisos);
          else criado = criarF100(e, cnpj, d, avisos);
        } catch (err) {
          voltarAte(ponto);
          return ignorar(i, d, (err as Error).message);
        }
        // registra no índice para pegar duplicatas dentro do próprio pacote
        if (d.tipo === 'f100') ix.f100.add(chaveF100(criado));
        else {
          const g = (c: string) => criado.campos[idx(criado.reg, c)] ?? '';
          const ch = soDigitos(d.chave);
          if (ch) ix.chaves.add(ch);
          ix.numeros.add(chaveNumero(regDoc, g('COD_MOD'), g('SER'), g('NUM_DOC'), soDigitos(d.participante?.cnpjCpf)));
        }
      }
      contarSemAliquota(d, res);
      res.incluidos++;
      res.porEscrituracao[e.id] = (res.porEscrituracao[e.id] ?? 0) + 1;
      for (const m of avisos) res.avisos.push({ indice: i, referencia: d.referencia, mensagem: m });
    });
  });
  const cst98 = res.pendentesTributacao - res.semAliquota;
  if (cst98) {
    res.avisos.push({
      indice: -1,
      mensagem: `${cst98} item(ns)/crédito(s) de entrada ficaram com CST 98 e base zero: defina a tributação de PIS/COFINS por regra.`,
    });
  }
  if (res.semAliquota) {
    res.avisos.push({
      indice: -1,
      mensagem:
        `${res.semAliquota} item(ns)/crédito(s)/operação(ões) com CST de crédito (50–66) ou de receita tributada (01/02) vieram sem alíquota de PIS/COFINS ` +
        `e entraram com alíquota e valor zerados: o editor não supõe alíquota. Defina a alíquota por regra (a verificação acusa CST_ALIQUOTA_ZERO até lá).`,
    });
  }
  return res;
}

/** Conta as linhas do documento importado que exigem alíquota e vieram sem ela. */
function contarSemAliquota(d: DocumentoImport, res: ResultadoImportacaoDetalhado): void {
  const falta = (p?: { cst?: string; aliquota?: unknown }, c?: { cst?: string; aliquota?: unknown }) => faltaAliquota(p?.cst, p?.aliquota) || faltaAliquota(c?.cst, c?.aliquota);
  let n = 0;
  switch (d.tipo) {
    case 'nota':
    case 'itens':
    case 'servico':
      for (const it of d.itens ?? []) if (falta(it.pis, it.cofins)) n++;
      break;
    case 'frete':
    case 'energia':
      for (const c of d.creditos ?? []) if (faltaAliquota(c.cst, c.aliquotaPis) || faltaAliquota(c.cst, c.aliquotaCofins)) n++;
      break;
    case 'f100':
    case 'imobilizado':
      if (falta(d.pis, d.cofins)) n++;
      break;
  }
  if ((d.tipo === 'nota' || d.tipo === 'servico') && (d.situacao === '02' || ['03', '04', '05'].includes(d.situacao ?? ''))) n = 0; // cancelado: sem itens
  res.semAliquota += n;
  res.pendentesTributacao += n;
}

function contarPendentes(itens: ItemImport[], oper: 'entrada' | 'saida', res: ResultadoImportacaoDetalhado): void {
  if (oper !== 'entrada') return;
  for (const it of itens) if (it.pis?.cst === '98' && !centavosRapido(num(it.pis.base, 2, 'base'))) res.pendentesTributacao++;
}
