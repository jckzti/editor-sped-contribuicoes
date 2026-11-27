/**
 * Estado da sessão para o React.
 *
 * O motor altera a árvore de registros no lugar (sem criar objetos novos), então a
 * interface não pode depender de identidade de objeto para re-renderizar: guardamos
 * um contador de VERSÃO que sobe depois de qualquer operação (edição, regra,
 * importação, desfazer, refazer, recálculo) e entra nas dependências dos `useMemo`.
 *
 * Também fica aqui o estado da APURAÇÃO: o bloco M só é refeito em `recalcular`, e o
 * recálculo não entra no histórico. Qualquer mudança no histórico (editar, aplicar,
 * importar, desfazer, refazer) ou nas opções da apuração deixa o bloco M desatualizado
 * até o próximo recálculo; o download recalcula antes quando isso acontece.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { ConfigApuracao } from '../core/apuracao';
import type { Escrituracao } from '../core/modelo';
import { aoMudarHistorico, desfazer, historico, limparHistorico, refazer, usoHistorico, type UsoHistorico } from '../core/operacao';
import { recalcular, type RelatorioRecalculo } from '../core/recalcular';
import { adicionarArquivo, criarSessao, removerEscrituracao, type Sessao } from '../core/sessao';
import { fraseHistorico } from './apuracaoUi';
import { criteriosDe, definirCriterio, type EscolhasCriterios, type IdCriterio } from '../core/apuracao';
import { estadoDe } from '../core/estado';
import { gravarSessaoLocal, lerSessaoLocal } from './persistencia';

export interface ErroArquivo {
  nomeArquivo: string;
  mensagem: string;
}

export interface EstadoSessao {
  sessao: Sessao;
  escrituracoes: Escrituracao[];
  /** Sobe a cada operação: use nas dependências dos `useMemo`. */
  versao: number;
  /** Chame depois de qualquer alteração feita pelo motor. */
  mudou: () => void;
  carregando: string | null;
  restaurando: boolean;
  erroPersistencia: string | null;
  errosArquivo: ErroArquivo[];
  limparErrosArquivo: () => void;
  carregarArquivos: (arquivos: File[]) => Promise<void>;
  fechar: (id: string) => void;
  desfazerAgora: () => void;
  refazerAgora: () => void;
  podeDesfazer: boolean;
  podeRefazer: boolean;
  descricaoDesfazer: string;
  descricaoRefazer: string;
  /** "Desfazer disponível para as últimas N ações (...)". */
  fraseHistorico: string;
  uso: UsoHistorico;
  /** Relatório do último recálculo (null = ainda não recalculado nesta sessão). */
  relatorios: RelatorioRecalculo[] | null;
  /** Houve edição (ou mudança de opção) depois do último recálculo: o bloco M está velho. */
  apuracaoDesatualizada: boolean;
  /**
   * Recalcula totais, cadastros, bloco M e contadores, empresa por empresa (cada CNPJ com os
   * seus critérios). `cnpjs` limita as empresas (padrão: todas). Lança erro se faltar
   * critério ou se o motor falhar: quem chama confere `criteriosPendentes` antes.
   */
  recalcularApuracao: (cnpjs?: Set<string>) => RelatorioRecalculo[];
  /** Grava os critérios confirmados na rotina; se algum mudou, a apuração fica desatualizada. */
  confirmarCriterios: (escolhas: Record<string, EscolhasCriterios>) => void;
  mudarConfig: (m: Partial<ConfigApuracao>) => void;
}

/** Devolve o fio de execução ao navegador (para a tela não congelar entre arquivos). */
function respirar(): Promise<void> {
  return new Promise((r) => setTimeout(r, 0));
}

export function useSessao(): EstadoSessao {
  const ref = useRef<Sessao | null>(null);
  ref.current ??= criarSessao();
  const sessao = ref.current;

  const [versao, setVersao] = useState(0);
  const [carregando, setCarregando] = useState<string | null>(null);
  const [errosArquivo, setErrosArquivo] = useState<ErroArquivo[]>([]);
  const [hist, setHist] = useState(() => ({ lista: historico(), uso: usoHistorico() }));
  const [relatorios, setRelatorios] = useState<RelatorioRecalculo[] | null>(null);
  const [desatualizada, setDesatualizada] = useState(false);
  const [restaurando, setRestaurando] = useState(true);
  const [erroPersistencia, setErroPersistencia] = useState<string | null>(null);
  const recalculouRef = useRef(false);

  const mudou = useCallback(() => setVersao((v) => v + 1), []);

  // O histórico do motor é estado de módulo: se o App for remontado (recarga a quente em
  // desenvolvimento), ele guardaria ações de árvores que não existem mais. Sessão nova começa
  // com histórico vazio. Fica num efeito (não na renderização) e antes da assinatura abaixo,
  // para não marcar a apuração como desatualizada ao abrir.
  useEffect(() => {
    let ativo = true;
    void lerSessaoLocal().then((salva) => {
      if (!ativo) return;
      if (salva && Array.isArray(salva.escrituracoes) && salva.config) {
        sessao.config = salva.config;
        sessao.regras = Array.isArray(salva.regras) ? salva.regras : [];
        sessao.escrituracoes = salva.escrituracoes;
        for (const e of sessao.escrituracoes) estadoDe(e);
        setDesatualizada(salva.apuracaoDesatualizada ?? sessao.escrituracoes.some((e) => e.alterada));
        setRelatorios(salva.relatorios ?? null);
        mudou();
      }
      setRestaurando(false);
    }).catch((err) => {
      if (!ativo) return;
      setErroPersistencia((err as Error)?.message ?? String(err));
      setRestaurando(false);
    });
    return () => { ativo = false; };
  }, [sessao, mudou]);

  useEffect(() => {
    if (restaurando) return;
    let ativo = true;
    const timer = window.setTimeout(() => {
      void gravarSessaoLocal(sessao, desatualizada, relatorios).then(() => {
        if (ativo) setErroPersistencia(null);
      }).catch((err) => {
        if (ativo) setErroPersistencia((err as Error)?.message ?? String(err));
      });
    }, 250);
    return () => { ativo = false; window.clearTimeout(timer); };
  }, [sessao, versao, restaurando, sessao.config, sessao.regras, desatualizada, relatorios]);

  useEffect(() => {
    if (usoHistorico().operacoes) limparHistorico();
    setHist({ lista: historico(), uso: usoHistorico() });
  }, []);

  // Toda mudança no histórico é uma mudança nos documentos (ou a volta de uma): o bloco M
  // gravado na árvore deixa de corresponder a eles até recalcular.
  useEffect(
    () =>
      aoMudarHistorico(() => {
        setHist({ lista: historico(), uso: usoHistorico() });
        setDesatualizada(true);
      }),
    [],
  );

  const carregarArquivos = useCallback(
    async (arquivos: File[]) => {
      const erros: ErroArquivo[] = [];
      for (let i = 0; i < arquivos.length; i++) {
        const f = arquivos[i];
        setCarregando(`Lendo ${i + 1} de ${arquivos.length}: ${f.name}...`);
        await respirar();
        try {
          const bytes = new Uint8Array(await f.arrayBuffer());
          adicionarArquivo(sessao, bytes, f.name);
        } catch (err) {
          erros.push({ nomeArquivo: f.name, mensagem: (err as Error)?.message ?? String(err) });
        }
        setVersao((v) => v + 1);
      }
      setCarregando(null);
      // Com meses já editados, um mês novo muda o encadeamento do saldo credor.
      if (sessao.escrituracoes.some((e) => e.alterada)) setDesatualizada(true);
      if (erros.length) setErrosArquivo((e) => [...e, ...erros]);
    },
    [sessao],
  );

  const fechar = useCallback(
    (id: string) => {
      removerEscrituracao(sessao, id);
      mudou();
    },
    [sessao, mudou],
  );

  const desfazerAgora = useCallback(() => {
    desfazer();
    mudou();
  }, [mudou]);

  const refazerAgora = useCallback(() => {
    refazer();
    mudou();
  }, [mudou]);

  const recalcularApuracao = useCallback(
    (cnpjs?: Set<string>) => {
      // O motor aplica os critérios de cada empresa (config.criteriosPorCnpj) e recusa a
      // empresa com critério pendente (aviso CRITERIOS_PENDENTES, recalculada: false).
      const meses = cnpjs ? sessao.escrituracoes.filter((e) => cnpjs.has(e.cnpj)) : sessao.escrituracoes;
      const r = recalcular(meses, sessao.config, { todas: true });
      recalculouRef.current = true;
      const feitos = new Set(r.map((x) => x.escrituracaoId));
      setRelatorios((ant) => [...(ant ?? []).filter((x) => !feitos.has(x.escrituracaoId)), ...r]);
      // outras empresas que não entraram neste recálculo não mudam o estado "desatualizado"
      if (!cnpjs || sessao.escrituracoes.every((e) => cnpjs.has(e.cnpj) || !e.alterada)) setDesatualizada(false);
      mudou();
      return r;
    },
    [sessao, mudou],
  );

  const confirmarCriterios = useCallback(
    (escolhas: Record<string, EscolhasCriterios>) => {
      let cfg = sessao.config;
      let mudouAlgo = false;
      for (const [cnpj, e] of Object.entries(escolhas)) {
        const atual = criteriosDe(cfg, cnpj) as Record<IdCriterio, unknown>;
        for (const [id, v] of Object.entries(e) as [IdCriterio, EscolhasCriterios[IdCriterio]][]) {
          if (atual[id] === v) continue;
          cfg = definirCriterio(cfg, cnpj, id, v); // devolve configuração nova
          mudouAlgo = true;
        }
      }
      if (mudouAlgo) {
        sessao.config = cfg;
        // Só fica "desatualizada" se já houve recálculo ou edição: arquivo intocado continua
        // com o bloco M original, que é o que vai para o download.
        if (recalculouRef.current || sessao.escrituracoes.some((e) => e.alterada)) setDesatualizada(true);
      }
      mudou();
    },
    [sessao, mudou],
  );

  const mudarConfig = useCallback(
    (m: Partial<ConfigApuracao>) => {
      sessao.config = { ...sessao.config, ...m };
      setDesatualizada(true);
      mudou();
    },
    [sessao, mudou],
  );

  // `versao` entra de propósito: a lista é a mesma array mutada pelo motor.
  const escrituracoes = useMemo(() => sessao.escrituracoes.slice(), [sessao, versao]);

  const ultimo = hist.lista.desfazer[hist.lista.desfazer.length - 1];
  const proximo = hist.lista.refazer[hist.lista.refazer.length - 1];

  return {
    sessao,
    escrituracoes,
    versao,
    mudou,
    carregando,
    erroPersistencia,
    restaurando,
    errosArquivo,
    limparErrosArquivo: () => setErrosArquivo([]),
    carregarArquivos,
    fechar,
    desfazerAgora,
    refazerAgora,
    podeDesfazer: hist.uso.paraDesfazer > 0,
    podeRefazer: hist.uso.paraRefazer > 0,
    descricaoDesfazer: ultimo ? `Desfazer: ${ultimo.descricao}` : 'Nada para desfazer',
    descricaoRefazer: proximo ? `Refazer: ${proximo.descricao}` : 'Nada para refazer',
    fraseHistorico: fraseHistorico(hist.uso),
    uso: hist.uso,
    relatorios,
    apuracaoDesatualizada: desatualizada && escrituracoes.length > 0,
    recalcularApuracao,
    confirmarCriterios,
    mudarConfig,
  };
}
