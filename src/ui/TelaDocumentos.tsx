/**
 * Aba Documentos: a tela principal. Mostra todas as linhas de todos os meses
 * carregados em uma grade só, com filtros, totais e ação em lote.
 *
 * Desempenho: filtrar, ordenar e somar só acontecem quando filtros, busca,
 * ordenação, tipo de linha ou a versão dos dados mudam. A grade lê cada célula
 * por índice, sem criar array por linha; a seleção só é materializada ao clicar
 * em uma ação.
 */
import { useEffect, useMemo, useRef, useState } from 'react';
import { editarCampos } from '../core/edicao';
import { coluna, colunas, filtrar, linhasDe, linhasDeTodas, ordenar, somar, valorExibicao, type Coluna, type LinhaQualquer, type TipoLinhaTodos } from '../core/linhas';
import type { Escrituracao } from '../core/modelo';
import { avisosUltimaOperacao } from '../core/operacao';
import type { Acao, ResultadoRegra } from '../core/regras';
import { resumirAcoes } from './acoes';
import { alvosDasColunas, chaveDeEdicao, COLUNAS_CALCULADAS, colunasPadrao, dicaDaCelula, estadoDaCelula, estadoDaLinha, textoDaCelula } from './celulas';
import { ConstrutorFiltros } from './ConstrutorFiltros';
import { explicacaoTipoVazio, inteiro, ROTULO_TIPO, totalDaColuna } from './formato';
import { montarFiltros, type FormFiltro } from './filtros';
import { Grade, type ColunaGrade } from './Grade';
import { exportarExcel } from './exportarExcel';
import { indicesSelecionados, mesmoConjunto, selecaoVazia, tamanhoSelecao, type SelecaoLinhas } from './selecao';
import { ImportarDocumentos } from './ImportarDocumentos';
import { PainelLote } from './PainelLote';
import { textoAviso } from './apuracaoUi';
import { AvisosDoMotor } from './Previa';
import type { Preferencias } from './preferencias';

/** Mesma linha do arquivo (o objeto de linha é refeito a cada alteração; os registros, não). */
const mesmaLinha = (x: LinhaQualquer, y: LinhaQualquer) => x.reg === y.reg && x.pis === y.pis && x.cofins === y.cofins && x.e === y.e;

/** Acima disso, somar a seleção toda na hora atrasaria o clique. */
const LIMITE_SOMA_SELECAO = 100_000;

/** Última ação em lote aplicada (com o filtro de então, para "Salvar como regra"). */
export interface AplicadoLote {
  resultado: ResultadoRegra;
  acoes: Acao[];
  avisos: string[];
  tipo: TipoLinhaTodos;
  filtros: FormFiltro[];
  busca: string;
  /**
   * A seleção era exatamente o que o filtro mostrava (selecionar tudo, sem desmarcar
   * nada). Só assim "salvar como regra" repete o mesmo efeito: a regra guarda o
   * FILTRO, não as linhas clicadas uma a uma.
   */
  selecaoEraOFiltro: boolean;
}

/**
 * Estado da aba que precisa sobreviver à troca de aba (filtro, busca, ordenação e o
 * aviso da última ação): fica no App, não aqui.
 */
export interface EstadoDocumentos {
  filtros: FormFiltro[];
  busca: string;
  ordem: { coluna: string; desc: boolean } | null;
  aplicado: AplicadoLote | null;
}

export const estadoDocumentosInicial = (): EstadoDocumentos => ({ filtros: [], busca: '', ordem: null, aplicado: null });

export interface TelaDocumentosProps {
  estado: EstadoDocumentos;
  aoMudarEstado: (m: Partial<EstadoDocumentos>) => void;
  escrituracoes: Escrituracao[];
  versao: number;
  mudou: () => void;
  prefs: Preferencias;
  aoMudarPrefs: (p: Partial<Preferencias>) => void;
  /** Tipos de linha oferecidos no seletor desta tela (Documentos ou Cadastros). */
  tipos: readonly TipoLinhaTodos[];
  /** Tipo mostrado agora e troca (cada tela guarda o seu nas preferências). */
  tipo: TipoLinhaTodos;
  aoTrocarTipo: (t: TipoLinhaTodos) => void;
  /** Tela de cadastros: sem "Alterar tributação" e sem importar documentos. */
  cadastro?: boolean;
  aoSalvarComoRegra: (tipo: TipoLinhaTodos, filtros: FormFiltro[], busca: string, acoes: Acao[]) => void;
}

export function TelaDocumentos({ estado, aoMudarEstado, escrituracoes, versao, mudou, prefs, aoMudarPrefs, aoSalvarComoRegra, tipos, tipo, aoTrocarTipo, cadastro }: TelaDocumentosProps) {
  const { filtros, busca, ordem, aplicado } = estado;
  const setFiltros = (f: FormFiltro[]) => aoMudarEstado({ filtros: f });
  const setBusca = (b: string) => aoMudarEstado({ busca: b });
  const setOrdem = (o: EstadoDocumentos['ordem']) => aoMudarEstado({ ordem: o });
  const setAplicado = (a: AplicadoLote | null) => aoMudarEstado({ aplicado: a });
  const [selecao, setSelecao] = useState<SelecaoLinhas>(selecaoVazia);
  const [importando, setImportando] = useState(false);

  // contagem de cada tipo de linha (para o seletor): soma os tamanhos, sem juntar arrays
  const contagens = useMemo(() => {
    const out = {} as Record<TipoLinhaTodos, number>;
    for (const t of tipos) out[t] = escrituracoes.reduce((n, e) => n + linhasDe(e, t).length, 0);
    return out;
  }, [escrituracoes, versao, tipos]);

  const linhasBase = useMemo(() => linhasDeTodas(escrituracoes, tipo), [escrituracoes, tipo, versao]);

  const filtrosMotor = useMemo(() => montarFiltros(filtros), [filtros]);

  const filtradas = useMemo(() => {
    try {
      return filtrar(linhasBase, filtrosMotor, busca);
    } catch {
      return linhasBase;
    }
  }, [linhasBase, filtrosMotor, busca]);

  const linhas = useMemo(() => (ordem ? ordenar(filtradas, [{ coluna: ordem.coluna, desc: ordem.desc }]) : filtradas), [filtradas, ordem]);

  const totais = useMemo(() => somar(linhas), [linhas]);

  // A seleção é por índice: só vale para este conjunto de linhas, nesta ordem. Filtro,
  // busca, ordenação ou tipo de linha que mudam o conjunto limpam a seleção. Uma nova
  // renderização com as mesmas linhas (ex.: depois de editar uma célula, que só sobe a
  // `versao`) mantém a seleção. Como cada alteração refaz os objetos de linha, compara-se
  // o registro do arquivo que cada linha aponta (milissegundos, mesmo com centenas de milhares).
  const linhasAnteriores = useRef(linhas);
  useEffect(() => {
    if (mesmoConjunto(linhasAnteriores.current, linhas, mesmaLinha)) return;
    linhasAnteriores.current = linhas;
    setSelecao(selecaoVazia());
  }, [linhas]);

  const todasColunas = useMemo(() => colunas(tipo), [tipo]);
  const visiveis = useMemo(() => {
    const escolhidas = prefs.colunas[tipo];
    const existentes = new Map(todasColunas.map((c) => [c.id, c]));
    const ids = escolhidas?.filter((id) => existentes.has(id));
    const lista = (ids?.length ? ids : colunasPadrao(tipo)).map((id) => existentes.get(id)!);
    return lista;
  }, [tipo, prefs.colunas, todasColunas]);

  const colunasGrade = useMemo<ColunaGrade[]>(
    () =>
      visiveis.map((c) => {
        const calculada = COLUNAS_CALCULADAS[tipo]?.[c.id];
        return {
          id: c.id,
          rotulo: c.rotulo,
          tipo: c.tipo,
          largura: c.largura,
          editavel: c.editavel,
          calculada: !!calculada,
          ajuda: calculada ? `Calculado pelo sistema: ${calculada}. ${c.descricao ?? ''}` : (c.descricao ?? c.rotulo),
        };
      }),
    [visiveis, tipo],
  );

  const alvos = useMemo(() => alvosDasColunas(tipo), [tipo]);
  const colunasPorId = useMemo(() => new Map(todasColunas.map((c) => [c.id, c])), [todasColunas]);

  const quantidadeSelecionada = tamanhoSelecao(selecao, linhas.length);
const aoExportarExcel = () => {
  const cabecalhos = visiveis.map((c) => c.rotulo);

  const dados = linhas.map((linha) =>
    visiveis.map((c) =>
      textoDaCelula(linha, c.id, alvos.get(c.id))
    )
  );

  const periodo = escrituracoes.length === 1
    ? escrituracoes[0].periodo
    : 'multiplos-periodos';

  exportarExcel(
    `documentos-${tipo}-${periodo}`,
    'Documentos',
    cabecalhos,
    dados
  );
};
  const totaisSelecao = useMemo(() => {
    if (!quantidadeSelecionada || quantidadeSelecionada > LIMITE_SOMA_SELECAO) return null;
    const idx = indicesSelecionados(selecao, linhas.length);
    const sel: LinhaQualquer[] = new Array(idx.length);
    for (let i = 0; i < idx.length; i++) sel[i] = linhas[idx[i]];
    return somar(sel);
  }, [selecao, linhas, quantidadeSelecionada]);

  const linhasSelecionadas = (): LinhaQualquer[] => {
    const idx = indicesSelecionados(selecao, linhas.length);
    const sel: LinhaQualquer[] = new Array(idx.length);
    for (let i = 0; i < idx.length; i++) sel[i] = linhas[idx[i]];
    return sel;
  };

  const trocarTipo = (t: TipoLinhaTodos) => {
    aoTrocarTipo(t);
    aoMudarEstado({ filtros: [], busca: '', ordem: null });
    setSelecao(selecaoVazia());
  };

  const alternarColuna = (id: string) => {
    const atuais = visiveis.map((c) => c.id);
    const novas = atuais.includes(id) ? atuais.filter((x) => x !== id) : todasColunas.filter((c) => atuais.includes(c.id) || c.id === id).map((c) => c.id);
    aoMudarPrefs({ colunas: { ...prefs.colunas, [tipo]: novas } });
  };

  const aoEditar = (iLinha: number, colunaId: string, novo: string): string | void => {
    const l = linhas[iLinha];
    const chave = chaveDeEdicao(tipo, colunaId);
    if (!l) return 'Linha não encontrada.';
    if (!chave) return 'Esta coluna não pode ser editada (vem do cadastro ou da nota).';
    const res = editarCampos(l, { [chave]: novo }, `Edição de ${coluna(tipo, colunaId)?.rotulo ?? colunaId}`);
    if (!res.ok) return res.erros[0]?.mensagem ?? 'Valor inválido.';
    mudou();
  };

  if (!escrituracoes.length) return null;

  return (
    <>
      <div className="barra-secao envolve">
        <div className="seletor" data-tour="tipo-linha">
          {tipos.map((t) => (
            <button key={t} className={t === tipo ? 'ativa' : ''} onClick={() => trocarTipo(t)}>
              {ROTULO_TIPO[t]} <span className="num">({inteiro(contagens[t])})</span>
            </button>
          ))}
        </div>
        <span className="espaco" />
        <details className="menu-colunas">
          <summary>Colunas ({visiveis.length} de {todasColunas.length})</summary>
          <div className="menu-colunas-lista">
            {todasColunas.map((c: Coluna) => (
              <label key={c.id}>
                <input type="checkbox" checked={visiveis.some((v) => v.id === c.id)} onChange={() => alternarColuna(c.id)} />
                {c.rotulo} <span className="fraco">{c.id}</span>
              </label>
            ))}
            <button className="ligacao" onClick={() => aoMudarPrefs({ colunas: { ...prefs.colunas, [tipo]: colunasPadrao(tipo) } })}>
              voltar ao padrão
            </button>
          </div>
        </details>
        {!cadastro && (
  <button onClick={aoExportarExcel} disabled={linhas.length === 0}>
    Exportar Excel ({inteiro(linhas.length)})
  </button>
)}
      </div>

      <ConstrutorFiltros
        tipo={tipo}
        filtros={filtros}
        aoMudar={setFiltros}
        busca={busca}
        aoMudarBusca={setBusca}
        contagem={{ filtradas: linhas.length, total: linhasBase.length }}
      />

      {aplicado && aplicado.tipo === tipo && (
        <div className="aviso info barra-secao envolve">
          <span>
            Aplicado em {inteiro(aplicado.resultado.linhas)} linha(s): {resumirAcoes(tipo, aplicado.acoes)}.
            {aplicado.resultado.excluidas > 0 && ` ${inteiro(aplicado.resultado.excluidas)} linha(s) excluída(s).`}
          </span>
          <span className="espaco" />
          {aplicado.selecaoEraOFiltro ? (
            <button
              data-tour="salvar-como-regra"
              onClick={() => aoSalvarComoRegra(aplicado.tipo, aplicado.filtros, aplicado.busca, aplicado.acoes)}
              title="Abre a aba Regras com este filtro e esta ação, para repetir em outros meses ou em outro cliente"
            >
              Salvar como regra
            </button>
          ) : (
            <span className="fraco" title="A regra guarda o filtro, não as linhas clicadas: filtre as linhas desejadas e use o selecionar tudo">
              linhas escolhidas à mão: para salvar como regra, filtre e selecione tudo
            </span>
          )}
          <button className="ligacao" onClick={() => setAplicado(null)}>
            ok
          </button>
        </div>
      )}
      {aplicado && aplicado.tipo === tipo && <AvisosDoMotor avisos={aplicado.avisos} titulo="Avisos da alteração aplicada" />}

      {(tipo === 'imobDepreciacao' || tipo === 'imobAquisicao') && (
        <div className="aviso info">
          <strong>Imobilizado: o que é dado de entrada e o que o sistema calcula.</strong>{' '}
          {tipo === 'imobDepreciacao'
            ? 'Dado de entrada: encargo de depreciação do mês, parcela sem direito a crédito, CST, alíquotas e o restante. Calculado (colunas em itálico, marcadas com ƒ): base = encargo − parcela sem crédito; valor = base × alíquota.'
            : 'Dado de entrada: valor de aquisição, parcela sem direito a crédito, nº de parcelas (IND_NR_PARC), CST, alíquotas e o restante. Calculado (colunas em itálico, marcadas com ƒ): base do crédito = aquisição − parcela sem crédito; base do mês = base do crédito ÷ nº de meses (1 = 1, 2 = 12, 3 = 24, 4 = 48, 5 = 6); valor = base do mês × alíquota. Com IND_NR_PARC 9 (outra periodicidade) o arquivo não diz o nº de meses: a base do mês é digitada e a ação avisa.'}{' '}
          Editar um dado de entrada refaz as colunas calculadas na hora (dá para desfazer).
        </div>
      )}

      <Grade
        colunas={colunasGrade}
        totalLinhas={linhas.length}
        valor={(i, colunaId) => textoDaCelula(linhas[i], colunaId, alvos.get(colunaId))}
        valorEdicao={(i, colunaId) => valorExibicao(linhas[i], colunaId)}
        dica={(i, colunaId) => dicaDaCelula(linhas[i], colunasPorId.get(colunaId), alvos.get(colunaId))}
        estadoCelula={(i, colunaId) => estadoDaCelula(linhas[i], alvos.get(colunaId))}
        estadoLinha={(i) => estadoDaLinha(linhas[i])}
        selecao={selecao}
        aoMudarSelecao={setSelecao}
        aoEditar={aoEditar}
        ordem={ordem}
        aoOrdenar={(c) => setOrdem(ordem?.coluna === c ? (ordem.desc ? null : { coluna: c, desc: true }) : { coluna: c, desc: false })}
        rodape={(colunaId) => totalDaColuna(colunaId, totais, colunasGrade[0]?.id ?? '')}
        vazio={linhasBase.length ? 'Nenhuma linha atende aos filtros.' : explicacaoTipoVazio(tipo, escrituracoes.length)}
      />

      {quantidadeSelecionada > 0 && (
        <PainelLote
          tipo={tipo}
          cadastro={cadastro}
          quantidade={quantidadeSelecionada}
          linhasSelecionadas={linhasSelecionadas}
          totais={totaisSelecao}
          colunasVisiveis={visiveis}
          aoLimpar={() => setSelecao(selecaoVazia())}
          aoAplicar={(resultado, acoes) => {
            setAplicado({
              resultado,
              acoes,
              avisos: [...resultado.avisos.map(textoAviso), ...avisosUltimaOperacao().map((a) => a.mensagem)],
              tipo,
              filtros,
              busca,
              selecaoEraOFiltro: selecao.tudo && selecao.indices.size === 0,
            });
            setSelecao(selecaoVazia());
            mudou();
          }}
        />
      )}

      {importando && (
        <ImportarDocumentos
          escrituracoes={escrituracoes}
          aoFechar={() => setImportando(false)}
          aoImportar={mudou}
        />
      )}
    </>
  );
}
