/**
 * Aba Regras: filtro + ações salvos com nome, para aplicar em TODOS os meses
 * carregados de uma vez — é esse o ganho sobre o PVA, onde cada mês é editado à mão.
 *
 * A regra pode ser exportada em JSON e usada em outro cliente ou em outra sessão.
 */
import { useEffect, useMemo, useState } from 'react';
import type { AcaoTributacao } from '../core/edicao';
import { TIPOS_LINHA_CADASTRO, TIPOS_LINHA_TODOS, type TipoLinhaTodos } from '../core/linhas';

const ehCadastro = (t: TipoLinhaTodos) => (TIPOS_LINHA_CADASTRO as readonly TipoLinhaTodos[]).includes(t);
import type { Escrituracao } from '../core/modelo';
import {
  aplicarRegra,
  aplicarRegras,
  exportarRegras,
  importarRegras,
  novaRegra,
  previsualizarRegra,
  validarRegra,
  type Acao,
  type Regra,
  type ResultadoRegra,
} from '../core/regras';
import { montarAcaoTributacao, paraFormTributacao, resumirAcao, resumirRegra } from './acoes';
import { baixarTexto } from './baixar';
import { Dialogo } from './Dialogo';
import { ConstrutorFiltros } from './ConstrutorFiltros';
import { montarFiltros, paraFormFiltro, type FormFiltro } from './filtros';
import { FormularioDefinirCampo, FormularioExcluir, FormularioTributacao } from './FormulariosAcao';
import { inteiro, periodoLegivel, ROTULO_TIPO } from './formato';
import { textoAviso } from './apuracaoUi';
import { Previa } from './Previa';

/** Regra<TipoLinhaTodos> "pré-preenchida" vinda da aba Documentos (botão "Salvar como regra"). */
export interface RascunhoRegra {
  tipoLinha: TipoLinhaTodos;
  filtros: FormFiltro[];
  busca: string;
  acoes: Acao[];
}

interface Edicao {
  id?: string;
  nome: string;
  descricao: string;
  tipoLinha: TipoLinhaTodos;
  filtros: FormFiltro[];
  busca: string;
  acoes: Acao[];
  ativa: boolean;
}

function paraEdicao(r: Regra<TipoLinhaTodos>): Edicao {
  return {
    id: r.id,
    nome: r.nome,
    descricao: r.descricao ?? '',
    tipoLinha: r.tipoLinha,
    filtros: (r.filtros ?? []).map(paraFormFiltro),
    busca: r.busca?.texto ?? '',
    acoes: r.acoes ?? [],
    ativa: r.ativa,
  };
}

function paraRegra(e: Edicao): Regra<TipoLinhaTodos> {
  const base = {
    nome: e.nome.trim() || 'Regra sem nome',
    descricao: e.descricao.trim() || undefined,
    tipoLinha: e.tipoLinha,
    filtros: montarFiltros(e.filtros),
    busca: e.busca.trim() ? { texto: e.busca.trim() } : undefined,
    acoes: e.acoes,
    ativa: e.ativa,
  };
  return e.id ? { id: e.id, ...base } : novaRegra(base);
}

export interface TelaRegrasProps {
  escrituracoes: Escrituracao[];
  regras: Regra<TipoLinhaTodos>[];
  aoMudarRegras: (r: Regra<TipoLinhaTodos>[]) => void;
  mudou: () => void;
  rascunho: RascunhoRegra | null;
  aoConsumirRascunho: () => void;
}

export function TelaRegras({ escrituracoes, regras, aoMudarRegras, mudou, rascunho, aoConsumirRascunho }: TelaRegrasProps) {
  const [edicao, setEdicao] = useState<Edicao | null>(null);
  const [previa, setPrevia] = useState<{ resultado: ResultadoRegra; tipo: TipoLinhaTodos; regra?: Regra<TipoLinhaTodos> } | null>(null);
  const [resultados, setResultados] = useState<ResultadoRegra[] | null>(null);
  const [erro, setErro] = useState<string | null>(null);
  const [importadas, setImportadas] = useState<string | null>(null);

  useEffect(() => {
    if (!rascunho) return;
    setEdicao({
      nome: '',
      descricao: '',
      tipoLinha: rascunho.tipoLinha,
      filtros: rascunho.filtros,
      busca: rascunho.busca,
      acoes: rascunho.acoes,
      ativa: true,
    });
    aoConsumirRascunho();
  }, [rascunho, aoConsumirRascunho]);

  const periodos = useMemo(() => escrituracoes.map((e) => periodoLegivel(e.periodo)), [escrituracoes]);

  const salvar = () => {
    if (!edicao) return;
    const r = paraRegra(edicao);
    const erros = validarRegra(r);
    if (erros.length) {
      setErro(erros.join(' '));
      return;
    }
    aoMudarRegras(edicao.id ? regras.map((x) => (x.id === r.id ? r : x)) : [...regras, r]);
    setEdicao(null);
    setErro(null);
  };

  const verPrevia = (r: Regra<TipoLinhaTodos>) => {
    setPrevia({ resultado: previsualizarRegra(escrituracoes, r), tipo: r.tipoLinha, regra: r });
  };

  const aplicar = (r: Regra<TipoLinhaTodos>) => {
    const res = aplicarRegra(escrituracoes, r);
    setResultados([res]);
    setPrevia(null);
    mudou();
  };

  const aplicarTodas = () => {
    const res = aplicarRegras(escrituracoes, regras);
    setResultados(res);
    mudou();
  };

  const duplicar = (r: Regra<TipoLinhaTodos>) => {
    const { id: _ignorado, ...resto } = r;
    aoMudarRegras([...regras, novaRegra({ ...resto, nome: `${r.nome} (cópia)` })]);
  };
  const excluir = (r: Regra<TipoLinhaTodos>) => aoMudarRegras(regras.filter((x) => x.id !== r.id));
  const alternarAtiva = (r: Regra<TipoLinhaTodos>) => aoMudarRegras(regras.map((x) => (x.id === r.id ? { ...x, ativa: !x.ativa } : x)));

  const importarArquivo = async (arquivo: File) => {
    try {
      const lidas = importarRegras(await arquivo.text(), { todosOsTipos: true });
      const ids = new Set(regras.map((r) => r.id));
      aoMudarRegras([
        ...regras,
        ...lidas.map((r) => {
          if (!ids.has(r.id)) return r;
          // a mesma regra já está aqui: entra como cópia, com o nome marcado
          const { id: _ignorado, ...resto } = r;
          return novaRegra({ ...resto, nome: `${r.nome} (importada)` });
        }),
      ]);
      setErro(null);
      setImportadas(`${lidas.length} regra(s) importada(s) de ${arquivo.name}.`);
    } catch (err) {
      setErro((err as Error)?.message ?? String(err));
    }
  };

  const ativas = regras.filter((r) => r.ativa).length;

  return (
    <div className="apuracao">
      <div className="aviso info">
        Cada regra vale para{' '}
        <strong>{escrituracoes.length === 1 ? 'o mês carregado' : `todos os ${escrituracoes.length} meses carregados`}</strong>
        {periodos.length > 1 && ` (${periodos[0]} a ${periodos[periodos.length - 1]})`} de uma vez. É isso que o PVA não faz: lá a mesma correção teria de ser
        repetida mês a mês. As regras ficam guardadas neste navegador e podem ser exportadas em JSON.
      </div>

      <div className="barra-secao envolve">
        <button
          className="primario"
          onClick={() =>
            setEdicao({ nome: '', descricao: '', tipoLinha: 'item', filtros: [], busca: '', acoes: [{ tipo: 'tributacao' }], ativa: true })
          }
        >
          Nova regra
        </button>
        <button onClick={aplicarTodas} disabled={!ativas || !escrituracoes.length}>
          Aplicar todas as ativas ({ativas})
        </button>
        <span className="espaco" />
        <button onClick={() => baixarTexto(exportarRegras(regras), 'regras-sped-contribuicoes.json', 'application/json')} disabled={!regras.length}>
          Exportar regras
        </button>
        <label className="botao-arquivo">
          Importar regras
          <input
            type="file"
            accept=".json,application/json"
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void importarArquivo(f);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}

      {importadas && (
        <div className="aviso info">
          {importadas}{' '}
          <button className="ligacao" onClick={() => setImportadas(null)}>
            ok
          </button>
        </div>
      )}

      {resultados && (
        <div className="aviso info">
          <strong>Resultado da aplicação</strong>
          <ul className="lista-erros">
            {resultados.map((r, i) => (
              <li key={i}>
                {r.nome}: {r.erros.length ? `erro — ${r.erros.join(' ')}` : `${inteiro(r.linhas)} linha(s) em ${r.porEscrituracao.filter((p) => p.linhas).length} mês(es)`}
                {r.excluidas > 0 && `, ${inteiro(r.excluidas)} excluída(s)`}
                {r.avisos.length > 0 && (
                  <div className="aviso alerta forte">
                    <ul className="lista-erros">
                      {r.avisos.map((a, k) => (
                        <li key={k}>{textoAviso(a)}</li>
                      ))}
                    </ul>
                  </div>
                )}
              </li>
            ))}
          </ul>
          <button className="ligacao" onClick={() => setResultados(null)}>
            ok
          </button>
        </div>
      )}

      <div className="tabela-rolagem">
        <table className="tabela">
          <thead>
            <tr>
              <th style={{ width: 60 }}>Ativa</th>
              <th>Regra</th>
              <th>O que faz</th>
              <th style={{ width: 300 }} />
            </tr>
          </thead>
          <tbody>
            {regras.map((r) => (
              <tr key={r.id}>
                <td>
                  <input type="checkbox" checked={r.ativa} onChange={() => alternarAtiva(r)} aria-label={`Regra<TipoLinhaTodos> ${r.nome} ativa`} />
                </td>
                <td>
                  <strong>{r.nome}</strong>
                  <div className="fraco">{ROTULO_TIPO[r.tipoLinha]}</div>
                  {r.descricao && <div className="fraco">{r.descricao}</div>}
                </td>
                <td className="resumo-regra">{resumirRegra(r)}</td>
                <td>
                  <button onClick={() => verPrevia(r)} disabled={!escrituracoes.length} title="Mostra o efeito em todos os meses; o botão de aplicar fica na prévia">
                    Prévia e aplicar
                  </button>
                  <button onClick={() => setEdicao(paraEdicao(r))}>Editar</button>
                  <button onClick={() => duplicar(r)}>Duplicar</button>
                  <button className="perigo" onClick={() => excluir(r)}>
                    Excluir
                  </button>
                </td>
              </tr>
            ))}
            {!regras.length && (
              <tr>
                <td colSpan={4} className="fraco">
                  Nenhuma regra salva. Crie uma aqui ou selecione linhas na aba Documentos, aplique a alteração e use "Salvar como regra".
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {edicao && (
        <EditorRegra
          edicao={edicao}
          aoMudar={setEdicao}
          aoFechar={() => {
            setEdicao(null);
            setErro(null);
          }}
          aoSalvar={salvar}
          aoVerPrevia={() => {
            const r = paraRegra(edicao);
            const erros = validarRegra(r);
            if (erros.length) {
              setErro(erros.join(' '));
              return;
            }
            setPrevia({ resultado: previsualizarRegra(escrituracoes, r), tipo: r.tipoLinha });
            setErro(null);
          }}
          erro={erro}
          temArquivos={escrituracoes.length > 0}
        />
      )}

      {previa && (
        <Dialogo
          titulo={`Prévia: ${previa.resultado.nome}`}
          subtitulo="Nada foi alterado ainda."
          aoFechar={() => setPrevia(null)}
          tamanho="largo"
          rodape={
            <>
              {previa.regra && !previa.resultado.erros.length && (
                <button className="primario" onClick={() => aplicar(previa.regra!)}>
                  Aplicar em todos os meses
                </button>
              )}
              <span className="espaco" />
              <button onClick={() => setPrevia(null)}>Fechar</button>
            </>
          }
        >
          <Previa resultado={previa.resultado} tipo={previa.tipo} />
        </Dialogo>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Editor de uma regra
// ---------------------------------------------------------------------------

interface EditorRegraProps {
  edicao: Edicao;
  aoMudar: (e: Edicao) => void;
  aoFechar: () => void;
  aoSalvar: () => void;
  aoVerPrevia: () => void;
  erro: string | null;
  temArquivos: boolean;
}

function EditorRegra({ edicao, aoMudar, aoFechar, aoSalvar, aoVerPrevia, erro, temArquivos }: EditorRegraProps) {
  const set = (m: Partial<Edicao>) => aoMudar({ ...edicao, ...m });
  const trocarAcao = (i: number, a: Acao) => set({ acoes: edicao.acoes.map((x, k) => (k === i ? a : x)) });
  const removerAcao = (i: number) => set({ acoes: edicao.acoes.filter((_, k) => k !== i) });

  return (
    <Dialogo
      titulo={edicao.id ? 'Editar regra' : 'Nova regra'}
      subtitulo="Vale para todos os meses carregados."
      aoFechar={aoFechar}
      tamanho="largo"
      rodape={
        <>
          <button className="primario" onClick={aoSalvar}>
            Salvar regra
          </button>
          <button onClick={aoVerPrevia} disabled={!temArquivos}>
            Prévia
          </button>
          <span className="espaco" />
          <button onClick={aoFechar}>Cancelar</button>
        </>
      }
    >
      <div className="campos">
        <div className="campo">
          <label htmlFor="regra-nome">Nome da regra</label>
          <input
            id="regra-nome"
            type="text"
            value={edicao.nome}
            placeholder="Ex.: Crédito de insumo em CFOP 1101"
            onChange={(e) => set({ nome: e.target.value })}
          />
        </div>
        <div className="campo">
          <label htmlFor="regra-tipo">Tipo de linha</label>
          <select
            id="regra-tipo"
            value={edicao.tipoLinha}
            onChange={(e) => {
              const t = e.target.value as TipoLinhaTodos;
              // cadastro não aceita "Alterar tributação": começa por "Definir campo"
              set({ tipoLinha: t, filtros: [], acoes: [ehCadastro(t) ? { tipo: 'definirCampo', campo: '', valor: '' } : { tipo: 'tributacao' }] });
            }}
          >
            {TIPOS_LINHA_TODOS.map((t) => (
              <option key={t} value={t}>
                {ROTULO_TIPO[t]}
              </option>
            ))}
          </select>
        </div>
        <div className="campo largura-total">
          <label htmlFor="regra-descricao">Observação (opcional)</label>
          <input id="regra-descricao" type="text" value={edicao.descricao} onChange={(e) => set({ descricao: e.target.value })} />
        </div>
      </div>

      <h4>Em quais linhas (filtro)</h4>
      <ConstrutorFiltros
        tipo={edicao.tipoLinha}
        filtros={edicao.filtros}
        aoMudar={(f) => set({ filtros: f })}
        busca={edicao.busca}
        aoMudarBusca={(b) => set({ busca: b })}
      />

      <h4>O que fazer</h4>
      {edicao.acoes.map((a, i) => (
        <div className="bloco-acao" key={i}>
          <div className="barra-secao">
            <strong>
              Ação {i + 1}:{' '}
              {a.tipo === 'tributacao' ? 'alterar tributação' : a.tipo === 'definirCampo' ? 'definir campo' : 'excluir linhas'}
            </strong>
            <span className="fraco">{resumirAcao(edicao.tipoLinha, a)}</span>
            <span className="espaco" />
            <button className="ligacao" onClick={() => removerAcao(i)} aria-label={`Remover ação ${i + 1}`}>
              remover
            </button>
          </div>
          {a.tipo === 'tributacao' && (
            <FormularioTributacao
              tipo={edicao.tipoLinha}
              form={paraFormTributacao(a as AcaoTributacao)}
              aoMudar={(f) => trocarAcao(i, montarAcaoTributacao(f))}
            />
          )}
          {a.tipo === 'definirCampo' && (
            <FormularioDefinirCampo
              tipo={edicao.tipoLinha}
              campo={a.campo}
              valor={a.valor}
              aoMudar={(campo, valor) => trocarAcao(i, { tipo: 'definirCampo', campo, valor })}
            />
          )}
          {a.tipo === 'excluir' && (
            <FormularioExcluir
              tipo={edicao.tipoLinha}
              excluirNotaVazia={a.excluirNotaVazia !== false}
              aoMudar={(v) => trocarAcao(i, { tipo: 'excluir', excluirNotaVazia: v })}
            />
          )}
        </div>
      ))}
      <div className="barra-secao">
        {!ehCadastro(edicao.tipoLinha) && <button onClick={() => set({ acoes: [...edicao.acoes, { tipo: 'tributacao' }] })}>+ Alterar tributação</button>}
        <button onClick={() => set({ acoes: [...edicao.acoes, { tipo: 'definirCampo', campo: '', valor: '' }] })}>+ Definir campo</button>
        <button onClick={() => set({ acoes: [...edicao.acoes, { tipo: 'excluir' }] })}>+ Excluir</button>
      </div>

      {erro && <div className="aviso erro">{erro}</div>}
    </Dialogo>
  );
}
