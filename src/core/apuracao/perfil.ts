/**
 * Perfil de escrituração suportado pelo motor e recusa segura.
 *
 * Se o arquivo tem registros que afetam a apuração e que o motor não implementa, o
 * recálculo é recusado (o bloco M fica como veio). Melhor recusar que gerar apuração errada.
 */
import { filhosDe, get, listar, percorrer, type Aviso, type Escrituracao } from '../modelo';
import type { Fontes } from './fontes';
import { cstComum } from './rateio';
import type { Tributo } from './tributos';
import { aliqEsc, SITUACOES_FORA } from './util';

/** Registros cuja presença impede o recálculo (o motor não sabe apurá-los). */
const IMPEDITIVOS: Record<string, string> = {
  C180: 'consolidação de vendas por item (C180/C181/C185)',
  C190: 'consolidação de aquisições/devoluções por item (C190/C191/C195)',
  C380: 'notas de venda a consumidor consolidadas (C380)',
  C395: 'notas de aquisição com crédito (C395/C396)',
  C400: 'cupons fiscais de ECF (C400/C481/C485)',
  C490: 'consolidação de cupons fiscais (C490)',
  C600: 'consolidação de documentos de energia/água/gás emitidos (C600)',
  C800: 'cupons fiscais eletrônicos CF-e SAT (C800)',
  C860: 'cupons fiscais eletrônicos CF-e SAT consolidados (C860)',
  D300: 'bilhetes de passagem (D300)',
  D350: 'ECF de transporte de passageiros (D350)',
  D600: 'serviços de comunicação prestados (D600)',
  F150: 'crédito sobre estoque de abertura (F150)',
  F200: 'atividade imobiliária (F200/F205/F210)',
  F500: 'regime de caixa (F500)',
  F510: 'regime de caixa por unidade de medida (F510)',
  F550: 'regime de competência do lucro presumido (F550)',
  F560: 'regime de competência por unidade de medida (F560)',
  F800: 'créditos transferidos por sucessão (F800)',
  I100: 'instituições financeiras e assemelhadas (bloco I)',
  M211: 'sociedades cooperativas (M211)',
  M611: 'sociedades cooperativas (M611)',
  M300: 'contribuição diferida em períodos anteriores (M300)',
  M700: 'contribuição diferida em períodos anteriores (M700)',
  M350: 'PIS sobre folha de salários (M350)',
  '1300': 'controle de valores retidos na fonte (1300)',
  '1700': 'controle de valores retidos na fonte (1700)',
};

const TIPOS_CRED_SUPORTADOS = new Set(['01', '02', '06', '07', '08']);
const COD_CONT_SUPORTADOS = new Set(['01', '02']);

/** Verificação estrutural (independe do tributo). Erros = recusa. */
export function verificarPerfil(e: Escrituracao): Aviso[] {
  const avisos: Aviso[] = [];
  const presentes = new Set<string>();
  for (const r of percorrer(e.raiz)) {
    presentes.add(r.reg);
    if (r.reg === 'C175' && (r.pai?.reg !== 'C100' || get(r.pai, 'COD_MOD') !== '65')) {
      avisos.push({ nivel: 'erro', codigo: 'APURACAO_REGISTRO_NAO_SUPORTADO', mensagem: 'Apuração não recalculada: há C175 sem uma NFC-e (C100 modelo 65) correspondente.' });
      break;
    }
    if (r.reg === 'C100' && get(r, 'COD_MOD') === '65' && !SITUACOES_FORA.has(get(r, 'COD_SIT')) &&
      r.filhos.some((f) => f.reg === 'C175') && r.filhos.some((f) => f.reg === 'C170')) {
      avisos.push({ nivel: 'erro', codigo: 'APURACAO_REGISTRO_NAO_SUPORTADO', mensagem: 'Apuração não recalculada: há NFC-e com C175 e C170 no mesmo documento, com risco de contar a receita em duplicidade.' });
      break;
    }
    if ((r.reg === 'D201' || r.reg === 'D205') && r.pai?.reg !== 'D200') {
      avisos.push({ nivel: 'erro', codigo: 'APURACAO_REGISTRO_NAO_SUPORTADO', mensagem: `Apuração não recalculada: há ${r.reg} sem o resumo diário D200 correspondente.` });
      break;
    }
    if (r.reg === 'D200' && !SITUACOES_FORA.has(get(r, 'COD_SIT')) && !r.filhos.some((f) => f.reg === 'D201' || f.reg === 'D205')) {
      avisos.push({ nivel: 'erro', codigo: 'APURACAO_REGISTRO_NAO_SUPORTADO', mensagem: 'Apuração não recalculada: há resumo diário D200 sem os detalhes D201/D205.' });
      break;
    }
  }
  const impedem = Object.entries(IMPEDITIVOS).filter(([reg]) => presentes.has(reg));
  for (const [reg, desc] of impedem) {
    avisos.push({
      nivel: 'erro',
      codigo: 'APURACAO_REGISTRO_NAO_SUPORTADO',
      mensagem: `Apuração não recalculada: o arquivo tem ${desc}, que o motor não sabe apurar (registro ${reg}). O bloco M foi mantido como veio.`,
    });
  }
  const r0110 = listar(e, '0110')[0];
  if (!r0110) {
    avisos.push({ nivel: 'erro', codigo: 'APURACAO_SEM_0110', mensagem: 'Apuração não recalculada: registro 0110 ausente.' });
    return avisos;
  }
  const inc = get(r0110, 'COD_INC_TRIB');
  if (inc !== '1') {
    avisos.push({
      nivel: 'erro',
      codigo: 'APURACAO_REGIME_NAO_SUPORTADO',
      mensagem: `Apuração não recalculada: 0110 COD_INC_TRIB = ${inc} (${inc === '2' ? 'regime cumulativo' : 'regimes cumulativo e não cumulativo'}). O motor só apura o regime exclusivamente não cumulativo.`,
    });
  }
  const apro = get(r0110, 'IND_APRO_CRED');
  if (apro === '2' && !filhosDe(r0110, '0111').length) {
    avisos.push({
      nivel: 'erro',
      codigo: 'APURACAO_SEM_0111',
      mensagem: 'Apuração não recalculada: rateio proporcional (0110 IND_APRO_CRED = 2) sem o registro 0111 de receita bruta.',
    });
  }
  return avisos;
}

/** Verificação por tributo, com as operações já extraídas. */
export function verificarFontes(e: Escrituracao, t: Tributo, f: Fontes): Aviso[] {
  const avisos: Aviso[] = [];
  const erro = (codigo: string, mensagem: string) => avisos.push({ nivel: 'erro', codigo, mensagem: `Apuração não recalculada (${t.nome}): ${mensagem}` });
  if (f.cfopsSemNatureza.size) {
    erro(
      'APURACAO_CFOP_SEM_NAT_BC',
      `itens C170 com CST de crédito nos CFOP ${[...f.cfopsSemNatureza].sort().join(', ')}, que não estão na tabela CFOP → NAT_BC_CRED. Inclua-os em config.cfopNatBc.`,
    );
  }
  const semNat = f.creditos.filter((c) => c.origem !== 'C170' && !c.natBc);
  if (semNat.length) erro('APURACAO_SEM_NAT_BC', `${semNat.length} registro(s) ${[...new Set(semNat.map((c) => c.origem))].join('/')} de crédito sem NAT_BC_CRED.`);
  if (f.creditos.some((c) => c.quantidade) || f.receitas.some((r) => r.quantidade)) {
    erro('APURACAO_QUANTIDADE', 'há operações com base em quantidade (alíquota em reais), que o motor não apura.');
  }
  const cst03 = f.receitas.filter((r) => r.cst === '03');
  if (cst03.length) erro('APURACAO_CST_03', `${cst03.length} operação(ões) com CST 03 (alíquota por unidade de medida), que o motor não apura.`);
  const cst05 = f.receitas.filter((r) => r.cst === '05' && r.aliq !== 0n);
  if (cst05.length) erro('APURACAO_CST_05', `${cst05.length} operação(ões) com CST 05 (substituição tributária) com alíquota, que o motor não apura.`);
  const r0110 = listar(e, '0110')[0];
  if (r0110 && get(r0110, 'IND_APRO_CRED') === '1') {
    const comuns = f.creditos.filter((c) => cstComum(c.cst));
    if (comuns.length) {
      erro(
        'APURACAO_APROPRIACAO_DIRETA',
        `apropriação direta (0110 IND_APRO_CRED = 1) com ${comuns.length} crédito(s) comuns a mais de um tipo de receita (CST 53–56/63–66); a parcela de cada tipo vem da contabilidade de custos e não pode ser recalculada.`,
      );
    }
  }
  for (const m100 of listar(e, t.M100)) {
    const cc = get(m100, 'COD_CRED');
    if (get(m100, 'IND_CRED_ORI') === '1') erro('APURACAO_CREDITO_SUCESSAO', `${t.M100} ${cc} de crédito oriundo de sucessão (IND_CRED_ORI = 1).`);
    else if (!TIPOS_CRED_SUPORTADOS.has(cc.slice(1))) erro('APURACAO_TIPO_CREDITO', `${t.M100} com COD_CRED ${cc}, que o motor não gera a partir dos documentos.`);
    else if (get(m100, `QUANT_BC_${t.sfx}`) && aliqEsc(get(m100, `ALIQ_${t.sfx}_QUANT`)) !== 0n) erro('APURACAO_QUANTIDADE', `${t.M100} ${cc} em quantidade.`);
  }
  for (const m210 of listar(e, t.M210)) {
    const cc = get(m210, 'COD_CONT');
    if (!COD_CONT_SUPORTADOS.has(cc)) erro('APURACAO_COD_CONT', `${t.M210} com COD_CONT ${cc}, que o motor não gera a partir dos documentos.`);
  }
  return avisos;
}
