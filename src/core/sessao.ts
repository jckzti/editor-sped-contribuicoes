/**
 * Abertura de arquivos e estado de sessão (sem React).
 *
 * Uso típico pela interface:
 *   const s = criarSessao();
 *   adicionarArquivo(s, bytes, nome);            // para cada arquivo
 *   ... linhasDeTodas(s.escrituracoes, 'item'), editarCampos, aplicarRegra, importarPacote ...
 *   recalcular(s.escrituracoes, s.config);       // antes de gerar os arquivos
 *   const { nome, bytes } = gerarArquivo(e);
 */
import { aprenderConfig, configPadrao, registrarOriginal, type ConfigApuracao } from './apuracao';
import { estadoDe } from './estado';
import { escreverSped, nomeArquivoSaida } from './escritor';
import { lerSped } from './leitor';
import type { Aviso, Escrituracao } from './modelo';
import { limparHistorico } from './operacao';
import type { Regra } from './regras';
import { periodoIso } from './util';
import { cfopNatBcPadrao } from './validar';

/** Versões de leiaute (COD_VER do 0000) para as quais o editor foi feito. */
export const VERSOES_LEIAUTE = ['006'];

/** Confere se é EFD-Contribuições e devolve avisos de perfil (versão, regime, retificadora). Lança erro se não for. */
export function verificarPerfil(e: Escrituracao): Aviso[] {
  const c = e.raiz.campos;
  const avisos: Aviso[] = [];
  const tem = (reg: string) => e.raiz.filhos.some((f) => f.reg === reg || f.filhos.some((g) => g.reg === reg));
  if (!/^\d{8}$/.test(c[5] ?? '') || !/^\d{8}$/.test(c[6] ?? '') || !tem('M001')) {
    throw new Error('O arquivo não parece ser uma EFD-Contribuições (registro 0000 fora do formato ou sem bloco M). Pode ser uma EFD ICMS/IPI ou outro SPED.');
  }
  const ver = c[1] ?? '';
  if (!VERSOES_LEIAUTE.includes(ver)) {
    avisos.push({ nivel: 'alerta', codigo: 'VERSAO_LEIAUTE', mensagem: `Versão de leiaute ${ver} (o editor segue a versão ${VERSOES_LEIAUTE.join('/')} do Guia Prático 1.35). Confira o resultado no PVA.` });
  }
  if (c[2] === '1') avisos.push({ nivel: 'info', codigo: 'RETIFICADORA', mensagem: `Escrituração retificadora (recibo anterior ${c[4] || 'não informado'}).` });
  const r0110 = e.raiz.filhos.find((f) => f.reg === '0001')?.filhos.find((f) => f.reg === '0110');
  if (!r0110) avisos.push({ nivel: 'alerta', codigo: 'SEM_0110', mensagem: 'Arquivo sem registro 0110 (regime de apuração).' });
  else {
    const [, inc, apro, tipoCont] = r0110.campos;
    if (inc === '2') avisos.push({ nivel: 'alerta', codigo: 'REGIME_CUMULATIVO', mensagem: 'Regime cumulativo: não há créditos de PIS/COFINS; regras de crédito não se aplicam a este arquivo.' });
    if (inc === '3') avisos.push({ nivel: 'info', codigo: 'REGIME_MISTO', mensagem: 'Regimes não cumulativo e cumulativo no mesmo arquivo.' });
    if (apro === '2') avisos.push({ nivel: 'info', codigo: 'RATEIO_PROPORCIONAL', mensagem: 'Créditos apropriados por rateio proporcional da receita bruta (0111).' });
    if (tipoCont === '2') avisos.push({ nivel: 'info', codigo: 'ALIQ_UNIDADE', mensagem: 'Apuração por alíquotas específicas (por unidade de medida).' });
  }
  return avisos;
}

/**
 * Lê o arquivo (.txt da EFD-Contribuições, bytes ISO-8859-1), verifica o perfil,
 * captura o estado original para edição (resíduos de totais, uso de cadastros) e
 * registra o original na apuração. Lança erro se não for EFD-Contribuições.
 */
export function abrirEscrituracao(bytes: Uint8Array, nomeArquivo: string): Escrituracao {
  const e = lerSped(bytes, nomeArquivo);
  e.avisos.push(...verificarPerfil(e));
  estadoDe(e);
  try {
    registrarOriginal(e);
  } catch (err) {
    if (!/não implementad/i.test(String((err as Error)?.message))) {
      e.avisos.push({ nivel: 'alerta', codigo: 'APURACAO_ORIGINAL', mensagem: `Não foi possível registrar a apuração original: ${(err as Error).message}` });
    }
  }
  return e;
}

/** Configuração padrão da apuração (com tabela oficial de CFOP se o motor de apuração ainda não existir). */
export function configInicial(): ConfigApuracao {
  try {
    return configPadrao();
  } catch {
    return { cfopNatBc: cfopNatBcPadrao(), estornos: [] }; // critérios: sem padrão (escolha explícita)
  }
}

export interface Sessao {
  /** Ordenadas por CNPJ e período. */
  escrituracoes: Escrituracao[];
  config: ConfigApuracao;
  regras: Regra[];
}

export function criarSessao(config?: ConfigApuracao): Sessao {
  return { escrituracoes: [], config: config ?? configInicial(), regras: [] };
}

/**
 * Abre um arquivo e o acrescenta à sessão (mantendo a ordem CNPJ + período) e
 * atualiza a configuração com o que o motor de apuração aprender dos arquivos.
 * Lança erro se o arquivo for inválido ou se o mesmo CNPJ/período já estiver carregado.
 */
export function adicionarArquivo(s: Sessao, bytes: Uint8Array, nomeArquivo: string): Escrituracao {
  const e = abrirEscrituracao(bytes, nomeArquivo);
  const dup = s.escrituracoes.find((x) => x.cnpj === e.cnpj && x.periodo === e.periodo);
  if (dup) throw new Error(`Já existe uma escrituração do CNPJ ${e.cnpj} no período ${periodoIso(e.periodo)} (${dup.nomeArquivo}).`);
  s.escrituracoes.push(e);
  s.escrituracoes.sort((a, b) => (a.cnpj + a.periodo).localeCompare(b.cnpj + b.periodo));
  try {
    s.config = aprenderConfig(s.escrituracoes, s.config);
  } catch {
    /* motor de apuração indisponível: mantém a configuração */
  }
  return e;
}

/** Tira a escrituração da sessão. O histórico de desfazer é esvaziado (pode referenciá-la). */
export function removerEscrituracao(s: Sessao, id: string): void {
  const i = s.escrituracoes.findIndex((e) => e.id === id);
  if (i < 0) return;
  s.escrituracoes.splice(i, 1);
  limparHistorico();
}

/** Parte serializável da sessão (configuração — inclusive os critérios da sessão e por empresa —, regras). */
export interface SessaoSalva {
  formato: 'sped-contrib-sessao';
  versao: 1;
  config: ConfigApuracao;
  regras: Regra[];
  /** Só para referência: quais arquivos estavam abertos. */
  arquivos: { id: string; nomeArquivo: string; cnpj: string; periodo: string; alterada: boolean }[];
}

export function sessaoSerializavel(s: Sessao): SessaoSalva {
  return {
    formato: 'sped-contrib-sessao',
    versao: 1,
    config: s.config,
    regras: s.regras,
    arquivos: s.escrituracoes.map((e) => ({ id: e.id, nomeArquivo: e.nomeArquivo, cnpj: e.cnpj, periodo: periodoIso(e.periodo), alterada: e.alterada })),
  };
}

/** Restaura configuração e regras salvas (os arquivos são reabertos à parte). */
export function restaurarSessao(s: Sessao, salvo: SessaoSalva): void {
  if (salvo?.formato !== 'sped-contrib-sessao' || salvo.versao !== 1) throw new Error('Arquivo de sessão inválido.');
  // Regras de estorno sem CNPJ em sessão salva antes de 13/11/2026 eram aprendidas de algum
  // arquivo (a interface não cria regra à mão) e valiam para qualquer CNPJ: são descartadas
  // e reaprendidas, com CNPJ, dos arquivos abertos.
  const estornos = (salvo.config.estornos ?? []).filter((r) => !!r.cnpj);
  s.config = { ...salvo.config, estornos };
  s.regras = salvo.regras ?? [];
  if (s.escrituracoes.length) {
    try {
      s.config = aprenderConfig(s.escrituracoes, s.config);
    } catch {
      /* motor de apuração indisponível */
    }
  }
}

/**
 * Gera o arquivo para download/importação no PVA (chame `recalcular` antes).
 * `caracteresInvalidos` > 0 indica texto fora do ISO-8859-1 trocado por "?".
 */
export function gerarArquivo(e: Escrituracao): { nome: string; bytes: Uint8Array; caracteresInvalidos: number } {
  const { bytes, caracteresInvalidos } = escreverSped(e);
  return { nome: nomeArquivoSaida(e), bytes, caracteresInvalidos };
}
