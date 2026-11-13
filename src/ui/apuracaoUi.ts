/**
 * Textos e agrupamentos da apuração e do histórico para a tela (funções puras,
 * testadas em `apuracaoUi.test.ts`).
 */
import type { Aviso } from '../core/modelo';
import type { UsoHistorico } from '../core/operacao';
import type { RelatorioRecalculo } from '../core/recalcular';
import { periodoLegivel } from './formato';

/** Frase do rodapé do histórico, montada como sugere o JSDoc de `usoHistorico`. */
export function fraseHistorico(u: UsoHistorico): string {
  let frase = u.paraDesfazer
    ? u.paraDesfazer === 1
      ? 'Desfazer disponível para a última ação'
      : `Desfazer disponível para as últimas ${u.paraDesfazer} ações`
    : 'Nada a desfazer';
  if (u.truncado) {
    frase +=
      u.motivoTruncamento === 'memoria'
        ? ' (o histórico mais antigo foi descartado para economizar memória)'
        : ' (o histórico mais antigo foi descartado pelo limite de ações)';
  }
  return frase;
}

/** Um mês cujo bloco M não foi refeito, com o(s) motivo(s) dado(s) pelo motor. */
export interface MesNaoRecalculado {
  escrituracaoId: string;
  periodo: string;
  nomeArquivo: string;
  motivos: string[];
}

/**
 * Meses em que o motor se recusou a apurar (perfil não suportado): o bloco M ficou como
 * veio no arquivo. O motivo vem dos avisos de nível "erro" do recálculo (eles dizem qual
 * registro impediu, ex.: "registro C175").
 */
export function mesesNaoRecalculados(relatorios: RelatorioRecalculo[] | null): MesNaoRecalculado[] {
  const out: MesNaoRecalculado[] = [];
  for (const r of relatorios ?? []) {
    if (!r.apuracao || r.apuracao.recalculada) continue;
    const motivos = r.apuracao.avisos.filter((a) => a.nivel === 'erro').map((a) => a.mensagem);
    out.push({
      escrituracaoId: r.escrituracaoId,
      periodo: r.periodo,
      nomeArquivo: r.nomeArquivo,
      motivos: motivos.length ? motivos : ['O motor não informou o motivo.'],
    });
  }
  return out;
}

/** Título legível de cada código de aviso do recálculo (o resto aparece pela mensagem). */
export const TITULO_AVISO: Record<string, string> = {
  ESTORNO_AUSENTE: 'Notas que talvez devessem ter estorno de crédito',
  CREDITO_RETIDO: 'Crédito que o arquivo original guardava passou a ser descontado',
  NATUREZA_RECEITA_PENDENTE: 'Receita sem natureza da receita (M410/M810)',
  APURACAO_NAO_CONFERIDA: 'Apurado por regra do guia, ainda não conferido contra arquivo real',
  LACUNA_DE_MESES: 'Saldo credor encadeado com meses faltando',
  PERIODO_REPETIDO: 'Mesmo período carregado mais de uma vez',
  '0111_AJUSTADO': 'Receita bruta do 0111 ajustada',
  RETENCAO_MAIOR_QUE_CONTRIBUICAO: 'Retenções maiores que a contribuição do mês',
  ESTORNO_SEM_CREDITO: 'Estorno sem crédito para abater',
  M205_SEM_COD_REC: 'Valor a recolher sem código de receita (M205/M605)',
  M205_VARIOS: 'Valor a recolher com vários códigos de receita',
  APURACAO_ERRO: 'Erro no recálculo da apuração',
  APURACAO_INDISPONIVEL: 'Apuração indisponível',
  CRITERIOS_PENDENTES: 'Critérios da apuração não escolhidos',
  SALDO_CREDOR_DIVERGENTE: 'Saldo credor de meses anteriores não bate com o mês de origem recalculado',
  SALDO_CREDOR_NAO_LEVADO: 'Saldo credor que o mês anterior deixou e este mês não traz',
  '0111_DESATUALIZADO': 'O 0111 não acompanha a receita editada (rateio com proporção antiga)',
  APURACAO_RATEIO_SEM_RECEITA: 'Rateio proporcional sem receita no 0111',
  APURACAO_PRESUMIDO_AMBIGUO: 'Crédito presumido: não dá para decidir entre 06 e 07',
  PRESUMIDO_TIPO_SUPOSTO: 'Crédito presumido com tipo suposto',
  ESTORNO_AMBIGUO: 'Estorno com mais de uma nota possível',
  NATUREZA_RECEITA_AMBIGUA: 'Natureza da receita com mais de uma divisão possível',
  CREDITO_ALIQ_DIFERENCIADA_NOVO: 'Crédito de alíquota diferenciada que o original não tinha',
};

/** Algum mês do recálculo foi recusado por falta de critério? */
export function faltouCriterio(relatorios: RelatorioRecalculo[] | null): boolean {
  return (relatorios ?? []).some((r) => r.avisos.some((a) => a.codigo === 'CRITERIOS_PENDENTES'));
}

/** Avisos cuja saída passa por rever um critério da apuração (a tela oferece o botão). */
export const AVISOS_DE_CRITERIO = new Set(['CRITERIOS_PENDENTES', 'CREDITO_RETIDO', 'SALDO_CREDOR_DIVERGENTE', '0111_DESATUALIZADO', 'SALDO_CREDOR_NAO_LEVADO']);

/** O que fazer, em uma frase, para alguns avisos (mostrado abaixo do título). */
export const ORIENTACAO_AVISO: Record<string, string> = {
  ESTORNO_AUSENTE:
    'O arquivo original já não tinha esses estornos e o editor manteve assim. Se deveriam existir, inclua o ajuste no PVA ou confira com quem fez a escrituração.',
  CREDITO_RETIDO:
    'No original parte do crédito ficava guardada (saldo credor), provavelmente para ressarcimento ou compensação. Se for para continuar guardada, reveja o critério do crédito guardado e recalcule.',
  CRITERIOS_PENDENTES: 'Escolha os critérios da apuração da empresa e recalcule: o motor não usa padrão para eles.',
  SALDO_CREDOR_DIVERGENTE:
    'Com "registrar só no próprio mês", o 1100/1500 do mês seguinte continua como veio e já não bate com o mês de origem recalculado. Para o saldo acompanhar as edições, troque o critério para levar o saldo aos meses seguintes e recalcule.',
  '0111_DESATUALIZADO': 'Use o critério "ajustar o 0111 pela variação da receita editada" ou corrija o 0111 à mão, e recalcule.',
  APURACAO_PRESUMIDO_AMBIGUO: 'O arquivo não mostra se o crédito presumido é do tipo 06 ou 07: confira o enquadramento e ajuste no PVA.',
  ESTORNO_AMBIGUO: 'Mais de uma nota tem o mesmo número e data: confira no PVA se o estorno ficou na nota certa.',
};

export interface GrupoAviso {
  codigo: string;
  nivel: Aviso['nivel'];
  /** Vazio quando o código não tem título próprio: a tela mostra só as mensagens. */
  titulo: string;
  orientacao?: string;
  /** Mensagem do motor → meses em que apareceu. */
  ocorrencias: { mensagem: string; meses: string[] }[];
}

const PESO_NIVEL: Record<Aviso['nivel'], number> = { erro: 0, alerta: 1, info: 2 };

/**
 * Avisos de todos os meses agrupados por código (erros primeiro), com a mesma mensagem
 * juntando os meses. Os erros que só dizem "não recalculada" ficam de fora: a tela os
 * mostra no quadro de meses não recalculados.
 */
export function agruparAvisos(relatorios: RelatorioRecalculo[] | null): GrupoAviso[] {
  const grupos = new Map<string, GrupoAviso>();
  for (const r of relatorios ?? []) {
    const naoRecalc = r.apuracao?.recalculada === false;
    for (const a of r.avisos) {
      if (naoRecalc && a.nivel === 'erro' && r.apuracao?.avisos.includes(a)) continue;
      const chave = `${a.nivel}|${a.codigo}`;
      let g = grupos.get(chave);
      if (!g) {
        g = { codigo: a.codigo, nivel: a.nivel, titulo: TITULO_AVISO[a.codigo] ?? '', orientacao: ORIENTACAO_AVISO[a.codigo], ocorrencias: [] };
        grupos.set(chave, g);
      }
      const mes = periodoLegivel(r.periodo);
      const o = g.ocorrencias.find((x) => x.mensagem === a.mensagem);
      if (o) {
        if (!o.meses.includes(mes)) o.meses.push(mes);
      } else g.ocorrencias.push({ mensagem: a.mensagem, meses: [mes] });
    }
  }
  return [...grupos.values()].sort((a, b) => PESO_NIVEL[a.nivel] - PESO_NIVEL[b.nivel] || (a.titulo || a.codigo).localeCompare(b.titulo || b.codigo));
}

/** Título legível dos códigos da verificação do editor (aba Conferência). */
export const TITULO_VALIDACAO: Record<string, string> = {
  REF_0150: 'Participante sem cadastro (0150)',
  REF_0190: 'Unidade sem cadastro (0190)',
  REF_0200: 'Item sem cadastro (0200)',
  REF_0400: 'Natureza da operação sem cadastro (0400)',
  REF_0500: 'Conta contábil fora do plano de contas (0500)',
  OBRIGATORIO: 'Campo obrigatório vazio',
  VALOR_TRIBUTO: 'Valor de PIS/COFINS diferente de base × alíquota',
  CST_CREDITO_SAIDA: 'CST de crédito em nota de saída',
  CST_RECEITA_ENTRADA: 'CST de receita em nota de entrada',
  CFOP_OPERACAO: 'CFOP não combina com entrada/saída da nota',
  CFOP_SEM_NAT_BC: 'CFOP sem base de crédito configurada',
  CHAVE_DV: 'Chave de NF-e inválida',
  DATA_PERIODO: 'Data fora do período da escrituração',
  CST_CREDITO_BASE_ZERO: 'CST de crédito com base de cálculo zero',
  CST_RECEITA_BASE_ZERO: 'CST de receita tributada com base de cálculo zero',
  NUMERO_INVALIDO: 'Campo numérico fora do formato do SPED',
  DATA_ENTRADA_ANTES_EMISSAO: 'Data de entrada anterior à emissão',
  DATA_ENTRADA_OBRIGATORIA: 'Data de entrada/saída não informada',
  CST_ALIQUOTA_ZERO: 'CST de crédito ou de receita tributada com alíquota zero',
  NAT_BC_CRED_AUSENTE: 'CST de crédito sem a natureza da base de crédito (NAT_BC_CRED)',
  IMOBILIZADO_BASE: 'Base do imobilizado fora da regra do Guia',
  VERIFICACAO_FALHOU: 'A verificação não pôde ser feita',
};

/** Texto de um aviso do motor (hoje `string`; aceita também `{ mensagem }`). */
export function textoAviso(a: unknown): string {
  if (typeof a === 'string') return a;
  if (a && typeof a === 'object' && 'mensagem' in a) return String((a as { mensagem: unknown }).mensagem);
  return String(a);
}
