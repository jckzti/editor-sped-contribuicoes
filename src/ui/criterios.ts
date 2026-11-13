/**
 * Critérios da apuração: a parte da TELA. O catálogo, as escolhas, as pendências e os
 * indícios vêm do motor (`src/core/apuracao/criterios.ts`); aqui ficam os textos curtos,
 * a trilha `criterios-usados.txt` e o exportar/importar das escolhas (que só valem depois
 * de confirmadas na rotina).
 *
 * Funções puras (fora a leitura das escriturações), testadas em `criterios.test.ts`.
 */
import { CRITERIOS, criteriosDe, criteriosExigidos, type ConfigApuracao, type EscolhasCriterios, type IdCriterio } from '../core/apuracao';
import type { Escrituracao } from '../core/modelo';
import { cnpjLegivel, periodoLegivel } from './formato';

export type ValorCriterio = string | boolean;

export const CRITERIO_POR_ID = Object.fromEntries(CRITERIOS.map((c) => [c.id, c])) as Record<IdCriterio, (typeof CRITERIOS)[number]>;

/** Nome curto de cada critério, para resumos. */
export const ROTULO_CURTO: Record<IdCriterio, string> = {
  saldoCredor: 'Saldo credor',
  ordemUsoCredito: 'Ordem de uso dos créditos',
  receitaBruta0111: 'Receita bruta do 0111',
  preservarRetencaoCredito: 'Crédito guardado no original',
};

/** A opção existe no catálogo do motor. */
export function valorValido(id: IdCriterio, valor: unknown): boolean {
  return CRITERIO_POR_ID[id].opcoes.some((o) => o.valor === valor);
}

/** Rótulo da opção escolhida (ou "não escolhido"). */
export function rotuloEscolha(id: IdCriterio, valor: ValorCriterio | undefined): string {
  if (valor === undefined) return 'não escolhido';
  return CRITERIO_POR_ID[id].opcoes.find((o) => o.valor === valor)?.rotulo ?? String(valor);
}

/** Por que o critério não é perguntado para a empresa (null = é perguntado). */
export function motivoNaoAplica(id: IdCriterio, meses: Escrituracao[]): string | null {
  if (criteriosExigidos(meses).includes(id)) return null;
  return id === 'preservarRetencaoCredito'
    ? 'em nenhum mês o arquivo original guardou crédito havendo contribuição a recolher.'
    : 'o motor não exige esta escolha para esta empresa.';
}

/** Todas as escolhas exigidas estão respondidas (com opção válida)? */
export function escolhasCompletas(escolhas: EscolhasCriterios, exigidos: IdCriterio[]): boolean {
  return exigidos.every((id) => valorValido(id, escolhas[id]));
}

/** Empresas (CNPJ) que precisam de recálculo para baixar: as que têm algum mês alterado. */
export function cnpjsAlterados(escrituracoes: Escrituracao[]): Set<string> {
  return new Set(escrituracoes.filter((e) => e.alterada).map((e) => e.cnpj));
}

function porCnpj(escrituracoes: Escrituracao[]): Map<string, Escrituracao[]> {
  const m = new Map<string, Escrituracao[]>();
  for (const e of escrituracoes) m.set(e.cnpj, [...(m.get(e.cnpj) ?? []), e]);
  return m;
}

// ---------------------------------------------------------------------------
// Exportar / importar (as escolhas importadas só valem depois de confirmadas)
// ---------------------------------------------------------------------------

export interface ArquivoCriterios {
  formato: 'sped-contrib-criterios';
  versao: 1;
  exportadoEm: string;
  empresas: { cnpj: string; nome: string; escolhas: EscolhasCriterios }[];
}

export function exportarCriterios(escolhas: Record<string, EscolhasCriterios>, nomes: Record<string, string>, agora = new Date()): string {
  const arq: ArquivoCriterios = {
    formato: 'sped-contrib-criterios',
    versao: 1,
    exportadoEm: agora.toISOString(),
    empresas: Object.entries(escolhas).map(([cnpj, e]) => ({ cnpj, nome: nomes[cnpj] ?? '', escolhas: e })),
  };
  return JSON.stringify(arq, null, 2);
}

/** Lê o arquivo de critérios. Valores que não são opção do catálogo são descartados (com aviso). */
export function importarCriterios(json: string | unknown): { porCnpj: Record<string, EscolhasCriterios>; nomes: Record<string, string>; avisos: string[] } {
  let d: unknown;
  try {
    d = typeof json === 'string' ? JSON.parse(json) : json;
  } catch {
    throw new Error('O arquivo não é um JSON válido.');
  }
  const a = d as Partial<ArquivoCriterios>;
  if (a?.formato !== 'sped-contrib-criterios' || !Array.isArray(a.empresas)) throw new Error('Arquivo não é de critérios da apuração do editor (formato "sped-contrib-criterios").');
  const porCnpjOut: Record<string, EscolhasCriterios> = {};
  const nomes: Record<string, string> = {};
  const avisos: string[] = [];
  for (const emp of a.empresas) {
    const cnpj = String(emp?.cnpj ?? '').replace(/\D/g, '');
    if (!cnpj) continue;
    const limpas: Record<string, ValorCriterio> = {};
    for (const c of CRITERIOS) {
      const v = (emp.escolhas as Record<string, unknown> | undefined)?.[c.id];
      if (v === undefined) continue;
      if (valorValido(c.id, v)) limpas[c.id] = v as ValorCriterio;
      else avisos.push(`${cnpjLegivel(cnpj)}: a escolha "${String(v)}" para "${c.pergunta}" não é uma opção válida e ficou em branco.`);
    }
    porCnpjOut[cnpj] = limpas as EscolhasCriterios;
    nomes[cnpj] = String(emp.nome ?? '');
  }
  return { porCnpj: porCnpjOut, nomes, avisos };
}

/**
 * Distribui escolhas importadas pelas empresas carregadas: a do mesmo CNPJ; se o arquivo
 * tiver uma empresa só e ela for outra, as escolhas dela valem como ponto de partida para
 * todas (com aviso, porque é reaproveitamento entre clientes).
 */
export function escolhasParaCarregadas(
  cnpjsCarregados: string[],
  importado: { porCnpj: Record<string, EscolhasCriterios>; nomes: Record<string, string> },
): { porCnpj: Record<string, EscolhasCriterios>; avisos: string[] } {
  const out: Record<string, EscolhasCriterios> = {};
  const avisos: string[] = [];
  const doArquivo = Object.keys(importado.porCnpj);
  for (const c of cnpjsCarregados) {
    if (importado.porCnpj[c]) out[c] = { ...importado.porCnpj[c] };
    else if (doArquivo.length === 1) {
      out[c] = { ...importado.porCnpj[doArquivo[0]] };
      avisos.push(
        `${cnpjLegivel(c)} recebeu as escolhas de outra empresa (${importado.nomes[doArquivo[0]] || cnpjLegivel(doArquivo[0])}): confira antes de confirmar.`,
      );
    }
  }
  if (!Object.keys(out).length) avisos.push('Nenhuma empresa do arquivo corresponde às carregadas: nada foi preenchido.');
  return { porCnpj: out, avisos };
}

// ---------------------------------------------------------------------------
// Trilha: criterios-usados.txt
// ---------------------------------------------------------------------------

/** Texto que acompanha o download com as escolhas por empresa, a data e os meses. */
export function textoCriteriosUsados(config: ConfigApuracao, escrituracoes: Escrituracao[], agora = new Date()): string {
  const l: string[] = [];
  const data = agora.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
  l.push('CRITÉRIOS DA APURAÇÃO USADOS NESTE TRABALHO');
  l.push(`Gerado pelo Editor EFD-Contribuições em ${data}.`);
  l.push('Escolhas feitas pela pessoa que fez o trabalho; o editor não aplica padrão para estes critérios.');
  for (const [cnpj, meses] of porCnpj(escrituracoes)) {
    const e = criteriosDe(config, cnpj) as Record<IdCriterio, ValorCriterio | undefined>;
    const periodos = meses.map((m) => m.periodo).sort().map(periodoLegivel);
    l.push('');
    l.push(`Empresa: ${meses[0].nome} — CNPJ ${cnpjLegivel(cnpj)}`);
    l.push(`Meses: ${periodos.join(', ')}`);
    for (const c of CRITERIOS) {
      const nao = motivoNaoAplica(c.id, meses);
      l.push(`- ${c.pergunta}`);
      l.push(
        `  ${nao ? `Não se aplica: ${nao}` : e[c.id] === undefined ? 'Não escolhido: a apuração destes meses não foi recalculada pelo editor (o bloco M saiu como veio no arquivo).' : rotuloEscolha(c.id, e[c.id])}`,
      );
    }
  }
  return l.join('\r\n') + '\r\n';
}
