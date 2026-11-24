/**
 * Casca da aplicação: barra superior (o que está carregado, desfazer/refazer,
 * baixar) e as quatro abas — Documentos, Regras, Apuração e Conferência.
 *
 * Tudo roda no navegador: os arquivos não saem da máquina.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { TIPOS_LINHA, TIPOS_LINHA_CADASTRO, TIPOS_LINHA_DOCUMENTO, type TipoLinhaTodos } from '../core/linhas';
import type { Acao, Regra } from '../core/regras';
import type { Escrituracao } from '../core/modelo';
import { faltouCriterio, mesesNaoRecalculados, type MesNaoRecalculado } from './apuracaoUi';
import { baixarTexto, baixarVarias, type ResultadoDownload } from './baixar';
import { CriteriosApuracao } from './CriteriosApuracao';
import { criteriosDe, criteriosPendentes, type EscolhasCriterios } from '../core/apuracao';
import { cnpjsAlterados, textoCriteriosUsados } from './criterios';
import { Carregar } from './Carregar';
import { cnpjLegivel, inteiro, intervaloPeriodos, periodoLegivel, plural } from './formato';
import type { FormFiltro } from './filtros';
import {
  gravarCriteriosLembrados,
  gravarPreferencias,
  gravarRegrasSalvas,
  lerCriteriosLembrados,
  lerPreferencias,
  lerRegrasSalvas,
  type Preferencias,
} from './preferencias';
import { TelaApuracaoAba } from './TelaApuracaoAba';
import { TelaConferencia } from './TelaConferencia';
import { estadoDocumentosInicial, TelaDocumentos, type EstadoDocumentos } from './TelaDocumentos';
import { TelaRegras, type RascunhoRegra } from './TelaRegras';
import { useSessao } from './useSessao';
import { ControleTour } from './ajuda/ControleTour';
import type { TelaTour } from './ajuda/passosTour';
import { TelaManual } from './ajuda/TelaManual';

const ABAS = [
  { id: 'documentos', rotulo: 'Documentos' },
  { id: 'cadastros', rotulo: 'Cadastros' },
  { id: 'regras', rotulo: 'Regras' },
  { id: 'apuracao', rotulo: 'Apuração' },
  { id: 'conferencia', rotulo: 'Conferência' },
  { id: 'manual', rotulo: 'Manual' },
] as const;

/** Tipos de linha de cada aba de grade. */
const TIPOS_DOCUMENTOS: readonly TipoLinhaTodos[] = [...TIPOS_LINHA, ...TIPOS_LINHA_DOCUMENTO];
const TIPOS_CADASTROS: readonly TipoLinhaTodos[] = TIPOS_LINHA_CADASTRO;

/** Acima disso o navegador pode ficar lento (≈9,5 MB de memória por mês). */
const MESES_PESADO = 24;

/** O que aconteceu no último download, para o aviso no topo da tela. */
export interface AvisoDownload extends ResultadoDownload {
  /** A apuração estava desatualizada e foi recalculada antes de gerar. */
  recalculou: boolean;
  /** Meses baixados, alterados, cujo bloco M o motor não conseguiu refazer. */
  naoRecalculados: MesNaoRecalculado[];
  erro?: string;
  /** Download de um mês só: o criterios-usados.txt (só deste mês) oferecido à parte. */
  textoCriterios?: string;
}

/** O que fazer depois de confirmar os critérios (a rotina abriu no lugar desta ação). */
type AcaoPosCriterios = { tipo: 'recalcular' } | { tipo: 'baixar'; ids: string[] };

export function App() {
  const s = useSessao();
  const [prefs, setPrefs] = useState<Preferencias>(lerPreferencias);
  const [regras, setRegras] = useState<Regra<TipoLinhaTodos>[]>(lerRegrasSalvas);
  const [rascunho, setRascunho] = useState<RascunhoRegra | null>(null);
  const [download, setDownload] = useState<AvisoDownload | null>(null);
  const [estadoDocs, setEstadoDocs] = useState<EstadoDocumentos>(estadoDocumentosInicial);
  const [secaoManual, setSecaoManual] = useState<string | undefined>();
  const [pedidoTour, setPedidoTour] = useState(0);
  const [rotina, setRotina] = useState<{ motivo?: string; acao?: AcaoPosCriterios; preenchidas?: Record<string, EscolhasCriterios> } | null>(null);
  const [acaoPendente, setAcaoPendente] = useState<AcaoPosCriterios | null>(null);
  const [erroApuracao, setErroApuracao] = useState<string | null>(null);
  const [lembrados, setLembrados] = useState<Record<string, EscolhasCriterios>>(lerCriteriosLembrados);
  // o aviso do último download ("apuração recalculada...") deixa de valer na próxima edição
  useEffect(() => {
    if (s.apuracaoDesatualizada) setDownload((d) => (d && !d.erro ? null : d));
  }, [s.apuracaoDesatualizada]);
  const mudarEstadoDocs = useCallback((m: Partial<EstadoDocumentos>) => setEstadoDocs((e) => ({ ...e, ...m })), []);
  const [estadoCad, setEstadoCad] = useState<EstadoDocumentos>(estadoDocumentosInicial);
  const mudarEstadoCad = useCallback((m: Partial<EstadoDocumentos>) => setEstadoCad((e) => ({ ...e, ...m })), []);
  const entrada = useRef<HTMLInputElement>(null);

  const aba = ABAS.some((a) => a.id === prefs.aba) ? prefs.aba : 'documentos';

  const mudarPrefs = useCallback((p: Partial<Preferencias>) => {
    setPrefs((atual) => {
      const novo = { ...atual, ...p };
      gravarPreferencias(novo);
      return novo;
    });
  }, []);

  const mudarRegras = useCallback(
    (r: Regra<TipoLinhaTodos>[]) => {
      setRegras(r);
      // Sessao.regras é só para salvar a sessão: guarda regras de qualquer tipo de linha
      s.sessao.regras = r as Regra[];
      gravarRegrasSalvas(r);
    },
    [s.sessao],
  );

  useEffect(() => {
    s.sessao.regras = regras as Regra[];
  }, [s.sessao, regras]);

  const { escrituracoes } = s;

  const resumo = useMemo(() => {
    if (!escrituracoes.length) return null;
    const cnpjs = [...new Set(escrituracoes.map((e) => e.cnpj))];
    const nomes = [...new Set(escrituracoes.map((e) => e.nome))];
    return {
      meses: escrituracoes.length,
      intervalo: intervaloPeriodos(escrituracoes.map((e) => e.periodo)),
      empresa: cnpjs.length === 1 ? `${nomes[0]} · ${cnpjLegivel(cnpjs[0])}` : `${cnpjs.length} empresas`,
      alteradas: escrituracoes.filter((e) => e.alterada).length,
    };
  }, [escrituracoes, s.versao]);

  const salvarComoRegra = useCallback(
    (tipo: TipoLinhaTodos, filtros: FormFiltro[], busca: string, acoes: Acao[]) => {
      setRascunho({ tipoLinha: tipo, filtros, busca, acoes });
      mudarPrefs({ aba: 'regras' });
    },
    [mudarPrefs],
  );

  const config = s.sessao.config;
  const pendencias = useMemo(() => criteriosPendentes(config, escrituracoes), [config, escrituracoes, s.versao]);

  /** Abre a rotina; escolhas lembradas entram preenchidas (para confirmar) nas empresas ainda sem escolha. */
  const abrirCriterios = useCallback(
    (motivo?: string, acao?: AcaoPosCriterios) => {
      const preenchidas: Record<string, EscolhasCriterios> = {};
      for (const e of escrituracoes) {
        if (lembrados[e.cnpj] && !Object.keys(criteriosDe(config, e.cnpj)).length) preenchidas[e.cnpj] = lembrados[e.cnpj];
      }
      setRotina({ motivo, acao, preenchidas });
    },
    [escrituracoes, lembrados, config],
  );

  /**
   * Gera e baixa os arquivos. Se houve edição depois do último recálculo, recalcula
   * ANTES (o bloco M gravado na árvore estaria velho); se o recálculo falhar, não baixa.
   * Só as empresas com mês alterado são recalculadas, e só elas precisam dos critérios:
   * mês não alterado sai como veio. Faltando critério, abre a rotina no lugar.
   */
  const baixar = useCallback(
    (lista: Escrituracao[]) => {
      if (!lista.length) return;
      const sessao = s.sessao;
      const cfg = sessao.config;
      const alvo = new Set([...cnpjsAlterados(sessao.escrituracoes)].filter((c) => lista.some((e) => e.cnpj === c)));
      let relatorios = s.relatorios;
      let recalculou = false;
      if (s.apuracaoDesatualizada && alvo.size) {
        const falta = criteriosPendentes(cfg, sessao.escrituracoes).filter((p) => alvo.has(p.cnpj));
        if (falta.length) {
          abrirCriterios('Para gerar o arquivo com as edições, a apuração precisa ser recalculada, e os critérios abaixo ainda não foram escolhidos.', {
            tipo: 'baixar',
            ids: lista.map((e) => e.id),
          });
          return;
        }
        try {
          relatorios = s.recalcularApuracao(alvo);
          recalculou = true;
          // o motor recusou alguma empresa por critério pendente: não baixa bloco M velho
          if (faltouCriterio(relatorios)) {
            abrirCriterios('O motor recusou o recálculo por falta de critério da apuração. Escolha os critérios abaixo.', { tipo: 'baixar', ids: lista.map((e) => e.id) });
            return;
          }
        } catch (err) {
          setDownload({
            arquivos: [],
            caracteresTrocados: 0,
            recalculou: false,
            naoRecalculados: [],
            erro: `O arquivo não foi gerado: a apuração não pôde ser recalculada (${(err as Error)?.message ?? String(err)}).`,
          });
          return;
        }
      }
      const ids = new Set(lista.filter((e) => e.alterada).map((e) => e.id));
      const naoRecalculados = mesesNaoRecalculados(relatorios).filter((m) => ids.has(m.escrituracaoId));
      const extras: Record<string, string> = lista.length > 1 ? { 'criterios-usados.txt': textoCriteriosUsados(cfg, lista) } : {};
      setDownload({
        ...baixarVarias(lista, undefined, extras),
        recalculou,
        naoRecalculados,
        textoCriterios: lista.length === 1 ? textoCriteriosUsados(cfg, lista) : undefined,
      });
    },
    [s, abrirCriterios],
  );

  /** "Recalcular apuração": com critério pendente, abre a rotina no lugar. Devolve se recalculou. */
  const recalcularOuPedirCriterios = useCallback((): boolean => {
    if (criteriosPendentes(s.sessao.config, s.sessao.escrituracoes).length) {
      abrirCriterios('Para recalcular a apuração, escolha antes os critérios abaixo.', { tipo: 'recalcular' });
      return false;
    }
    const r = s.recalcularApuracao();
    if (faltouCriterio(r)) abrirCriterios('O motor recusou o recálculo por falta de critério da apuração. Escolha os critérios abaixo.', { tipo: 'recalcular' });
    return true;
  }, [s, abrirCriterios]);

  // Ação que estava esperando os critérios: roda depois da confirmação, com a sessão já atualizada.
  useEffect(() => {
    if (!acaoPendente) return;
    setAcaoPendente(null);
    if (acaoPendente.tipo === 'recalcular') {
      try {
        recalcularOuPedirCriterios();
        setErroApuracao(null);
      } catch (err) {
        setErroApuracao((err as Error)?.message ?? String(err));
      }
    } else {
      const ids = new Set(acaoPendente.ids);
      baixar(s.sessao.escrituracoes.filter((e) => ids.has(e.id)));
    }
  }, [acaoPendente, recalcularOuPedirCriterios, baixar, s.sessao]);

  const confirmarCriterios = (escolhas: Record<string, EscolhasCriterios>, lembrar: Set<string>) => {
    s.confirmarCriterios(escolhas);
    const novos = { ...lembrados };
    for (const cnpj of Object.keys(escolhas)) {
      if (lembrar.has(cnpj)) novos[cnpj] = escolhas[cnpj];
      else delete novos[cnpj];
    }
    setLembrados(novos);
    gravarCriteriosLembrados(novos);
    const acao = rotina?.acao;
    setRotina(null);
    if (acao) setAcaoPendente(acao);
  };

  return (
    <div className="app">
      <div className="barra">
        <span className="titulo">Editor SPED Contribuições</span>
        {resumo ? (
          <span className="fraco resumo-carga" title={`${plural(resumo.meses, 'mês', 'meses')} · ${resumo.intervalo} · ${resumo.empresa}`}>
            {plural(resumo.meses, 'mês', 'meses')} · {resumo.intervalo} · {resumo.empresa}
          </span>
        ) : (
          <span className="fraco">nenhum arquivo carregado</span>
        )}

        <label className="botao-arquivo" data-tour="acrescentar-arquivos">
          <span className="rotulo-longo">Acrescentar arquivos</span>
          <span className="rotulo-curto">+ Arquivos</span>
          <input
            ref={entrada}
            type="file"
            multiple
            accept=".txt,text/plain"
            onChange={(e) => {
              const arquivos = [...(e.target.files ?? [])];
              if (arquivos.length) void s.carregarArquivos(arquivos);
              e.target.value = '';
            }}
          />
        </label>

        <button onClick={s.desfazerAgora} disabled={!s.podeDesfazer} title={`${s.descricaoDesfazer}\n${s.fraseHistorico}`} aria-label={s.descricaoDesfazer}>
          ↶<span className="rotulo-longo"> Desfazer</span>
        </button>
        <button onClick={s.refazerAgora} disabled={!s.podeRefazer} title={s.descricaoRefazer} aria-label={s.descricaoRefazer}>
          ↷<span className="rotulo-longo"> Refazer</span>
        </button>
        {resumo && <span className="fraco historico">{s.fraseHistorico}</span>}

        {resumo && resumo.alteradas > 0 && <span className="etiqueta alerta">{plural(resumo.alteradas, 'mês alterado', 'meses alterados')}</span>}
        {pendencias.length > 0 && (
          <button
            className="etiqueta desatualizada"
            onClick={() => abrirCriterios()}
            title={`Falta escolher: ${pendencias.map((p) => `${p.nome} (${p.pendentes.length})`).join(', ')}. Sem eles não dá para recalcular a apuração.`}
          >
            critérios da apuração pendentes
          </button>
        )}
        {s.apuracaoDesatualizada && (
          <button
            className="etiqueta desatualizada"
            onClick={() => mudarPrefs({ aba: 'apuracao' })}
            title="Houve edição depois do último recálculo: o bloco M ainda não reflete as edições. O botão Baixar recalcula antes de gerar o arquivo."
          >
            apuração desatualizada
          </button>
        )}

        <span className="espaco" />

        <ControleTour
          temDados={escrituracoes.length > 0}
          aoIrPara={(t: TelaTour) => mudarPrefs({ aba: t })}
          aoAbrirManual={(secao) => {
            setSecaoManual(secao);
            mudarPrefs({ aba: 'manual' });
          }}
          pedidoAbrir={pedidoTour}
        />

        <div className="abas" role="tablist">
          {ABAS.map((a) => (
            <button key={a.id} data-tour={`aba-${a.id}`} role="tab" aria-selected={aba === a.id} className={aba === a.id ? 'ativa' : ''} onClick={() => mudarPrefs({ aba: a.id })}>
              {a.rotulo}
            </button>
          ))}
        </div>

        <button
          className="primario"
          data-tour="baixar-arquivos"
          onClick={() => baixar(escrituracoes)}
          disabled={!escrituracoes.length}
          title={s.apuracaoDesatualizada ? 'Recalcula a apuração e depois gera os arquivos' : 'Gera os arquivos para importar no PVA'}
        >
          {s.apuracaoDesatualizada ? 'Recalcular e baixar' : 'Baixar arquivos'}
        </button>
      </div>

      <div className="conteudo">
        {s.carregando && <div className="aviso info estado">{s.carregando}</div>}

        {s.errosArquivo.length > 0 && (
          <div className="aviso erro">
            <strong>Arquivos que não puderam ser lidos:</strong>
            <ul className="lista-erros">
              {s.errosArquivo.map((e, i) => (
                <li key={i}>
                  <strong>{e.nomeArquivo}</strong>: {e.mensagem}
                </li>
              ))}
            </ul>
            <button className="ligacao" onClick={s.limparErrosArquivo}>
              ok
            </button>
          </div>
        )}

        {escrituracoes.length > MESES_PESADO && (
          <div className="aviso alerta">
            <strong>{plural(escrituracoes.length, 'mês carregado', 'meses carregados')} ao mesmo tempo.</strong> Cada mês ocupa cerca de 9,5 MB de memória e,
            acima de 24 meses, o navegador pode ficar lento (filtrar, selecionar e recalcular demoram mais). O recomendado é trabalhar um ano por vez.
          </div>
        )}

        {download && (
          <div className={`aviso ${download.erro || download.naoRecalculados.length ? 'erro forte' : download.caracteresTrocados > 0 ? 'alerta' : 'info'}`}>
            {download.erro ? (
              download.erro
            ) : (
              <>
                {download.recalculou && 'A apuração foi recalculada com as edições antes de gerar. '}
                {download.arquivos.length === 1
                  ? `Arquivo gerado: ${download.arquivos[0].nome}.`
                  : `${download.arquivos.length} arquivos gerados no .zip.`}
                {download.caracteresTrocados > 0 &&
                  ` ${inteiro(download.caracteresTrocados)} caractere(s) fora do ISO-8859-1 saíram como "?": confira descrições e nomes com acento ou símbolo estranho.`}{' '}
                Importe no PVA para validar e transmitir.
                {download.arquivos.length > 1 && ' O .zip traz também o criterios-usados.txt com as escolhas da apuração.'}
                {download.textoCriterios && (
                  <button className="ligacao" onClick={() => baixarTexto(download.textoCriterios!, 'criterios-usados.txt')}>
                    baixar também os critérios usados (.txt)
                  </button>
                )}
                {download.naoRecalculados.length > 0 && (
                  <p>
                    <strong>
                      Atenção: em {download.naoRecalculados.map((m) => periodoLegivel(m.periodo)).join(', ')} a apuração não pôde ser recalculada e o bloco M
                      saiu como estava no arquivo original, sem refletir as edições.
                    </strong>{' '}
                    O motivo está na aba Apuração; ajuste a apuração desses meses no PVA.
                  </p>
                )}
              </>
            )}
            <button className="ligacao" onClick={() => setDownload(null)}>
              ok
            </button>
          </div>
        )}

        {erroApuracao && (
          <div className="aviso erro">
            {erroApuracao}{' '}
            <button className="ligacao" onClick={() => setErroApuracao(null)}>
              ok
            </button>
          </div>
        )}

        {rotina && (
          <CriteriosApuracao
            escrituracoes={escrituracoes}
            config={config}
            preenchidas={rotina.preenchidas}
            lembradas={new Set(Object.keys(lembrados))}
            motivo={rotina.motivo}
            aoConfirmar={confirmarCriterios}
            aoFechar={() => setRotina(null)}
          />
        )}

        {aba === 'manual' ? (
          <TelaManual secaoInicial={secaoManual} aoAbrirTour={() => setPedidoTour((n) => n + 1)} />
        ) : !escrituracoes.length ? (
          <Carregar aoEscolher={(arquivos) => void s.carregarArquivos(arquivos)} carregando={s.carregando} />
        ) : aba === 'documentos' ? (
          <TelaDocumentos
            key="documentos"
            estado={estadoDocs}
            aoMudarEstado={mudarEstadoDocs}
            escrituracoes={escrituracoes}
            versao={s.versao}
            mudou={s.mudou}
            prefs={prefs}
            aoMudarPrefs={mudarPrefs}
            aoSalvarComoRegra={salvarComoRegra}
            tipos={TIPOS_DOCUMENTOS}
            tipo={TIPOS_DOCUMENTOS.includes(prefs.tipoLinha) ? prefs.tipoLinha : 'item'}
            aoTrocarTipo={(t) => mudarPrefs({ tipoLinha: t })}
          />
        ) : aba === 'cadastros' ? (
          <TelaDocumentos
            key="cadastros"
            cadastro
            estado={estadoCad}
            aoMudarEstado={mudarEstadoCad}
            escrituracoes={escrituracoes}
            versao={s.versao}
            mudou={s.mudou}
            prefs={prefs}
            aoMudarPrefs={mudarPrefs}
            aoSalvarComoRegra={salvarComoRegra}
            tipos={TIPOS_CADASTROS}
            tipo={TIPOS_CADASTROS.includes(prefs.tipoCadastro) ? prefs.tipoCadastro : 'participante'}
            aoTrocarTipo={(t) => mudarPrefs({ tipoCadastro: t })}
          />
        ) : aba === 'regras' ? (
          <TelaRegras
            escrituracoes={escrituracoes}
            regras={regras}
            aoMudarRegras={mudarRegras}
            mudou={s.mudou}
            rascunho={rascunho}
            aoConsumirRascunho={() => setRascunho(null)}
          />
        ) : aba === 'apuracao' ? (
          <TelaApuracaoAba
            sessao={s.sessao}
            escrituracoes={escrituracoes}
            versao={s.versao}
            relatorios={s.relatorios}
            desatualizada={s.apuracaoDesatualizada}
            aoRecalcular={recalcularOuPedirCriterios}
            pendencias={pendencias}
            aoAbrirCriterios={() => abrirCriterios()}
          />
        ) : (
          <TelaConferencia
            sessao={s.sessao}
            escrituracoes={escrituracoes}
            versao={s.versao}
            mudou={s.mudou}
            desatualizada={s.apuracaoDesatualizada}
            aoBaixar={baixar}
            aoAbrirCriterios={() => abrirCriterios()}
          />
        )}
      </div>
    </div>
  );
}
