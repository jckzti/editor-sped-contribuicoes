/**
 * Aba Conferência: o que olhar antes de levar o arquivo ao PVA.
 *
 * Por mês: as verificações do editor (agrupadas por gravidade e por tipo de
 * problema), a lista do que mudou desde a abertura (com reverter registro) e o
 * download. A validação que vale é a do PVA — a tela diz isso.
 */
import { useMemo, useState } from 'react';
import { diferencas, restaurarExcluido, reverterRegistro, type Diferenca } from '../core/edicao';
import type { Escrituracao } from '../core/modelo';
import type { Sessao } from '../core/sessao';
import { validar, type AvisoValidacao } from '../core/validar';
import { leiaute } from '../core/modelo';
import { TITULO_VALIDACAO } from './apuracaoUi';
import { ResumoCriterios } from './CriteriosApuracao';
import { cnpjLegivel, inteiro, numeroLegivel, periodoLegivel } from './formato';

/** Inclusões e exclusões primeiro: são poucas e se perderiam no meio de milhares de edições. */
const ORDEM_TIPO_DIF: Record<Diferenca['tipo'], number> = { excluido: 0, incluido: 1, editado: 2 };

/** Valor do campo como o contador lê (milhar e duas casas nos valores). */
function valorDoCampo(reg: string, campo: string, v: string): string {
  if (!v) return '(vazio)';
  const def = leiaute.registros[reg]?.campos.find((c) => c.nome === campo);
  return def?.tipo === 'N' && def.dec ? numeroLegivel(v) : v;
}

/** Descrição do campo (para o title). */
function descricaoCampo(reg: string, campo: string): string | undefined {
  return leiaute.registros[reg]?.campos.find((c) => c.nome === campo)?.descricao;
}

const ROTULO_NIVEL: Record<AvisoValidacao['nivel'], string> = { erro: 'Erros', alerta: 'Alertas', info: 'Informações' };
const ROTULO_TIPO_DIF: Record<Diferenca['tipo'], string> = { editado: 'editado', incluido: 'incluído', excluido: 'excluído' };

/** Acima disso a verificação não roda sozinha (são muitos registros). */
const LIMITE_AUTOMATICO = 12;

export interface TelaConferenciaProps {
  sessao: Sessao;
  escrituracoes: Escrituracao[];
  versao: number;
  mudou: () => void;
  /** Houve edição depois do último recálculo (o download vai recalcular antes). */
  desatualizada: boolean;
  /** Gera e baixa (recalculando antes se a apuração estiver desatualizada). */
  aoBaixar: (lista: Escrituracao[]) => void;
  aoAbrirCriterios: () => void;
}

export function TelaConferencia({ sessao, escrituracoes, versao, mudou, desatualizada, aoBaixar, aoAbrirCriterios }: TelaConferenciaProps) {
  const [verificar, setVerificar] = useState(escrituracoes.length <= LIMITE_AUTOMATICO);
  const [mostrarAutomaticas, setMostrarAutomaticas] = useState(false);
  const [aberto, setAberto] = useState<string | null>(escrituracoes.length === 1 ? escrituracoes[0].id : null);
  const [erroReverter, setErroReverter] = useState<string | null>(null);

  const verificacoes = useMemo(() => {
    if (!verificar) return null;
    const m = new Map<string, AvisoValidacao[]>();
    for (const e of escrituracoes) {
      try {
        m.set(e.id, validar(e, { cfopNatBc: sessao.config.cfopNatBc }));
      } catch (err) {
        m.set(e.id, [{ nivel: 'erro', codigo: 'VERIFICACAO_FALHOU', mensagem: `A verificação não pôde ser feita: ${(err as Error)?.message ?? String(err)}` }]);
      }
    }
    return m;
  }, [verificar, escrituracoes, versao, sessao.config]);

  const mudancas = useMemo(() => {
    const m = new Map<string, Diferenca[]>();
    for (const e of escrituracoes) m.set(e.id, diferencas(e).sort((a, b) => ORDEM_TIPO_DIF[a.tipo] - ORDEM_TIPO_DIF[b.tipo]));
    return m;
  }, [escrituracoes, versao]);

  const reverter = (e: Escrituracao, d: Diferenca) => {
    try {
      if (d.tipo === 'excluido') {
        if (!restaurarExcluido(e, d.registro)) {
          setErroReverter(`Não foi possível recolocar ${d.descricao}: o registro de cima dele também foi excluído. Restaure primeiro o de cima ou use Desfazer.`);
          return;
        }
      } else reverterRegistro({ e, reg: d.registro });
      setErroReverter(null);
    } catch (err) {
      setErroReverter((err as Error)?.message ?? String(err));
    }
    mudou();
  };

  if (!escrituracoes.length) return null;

  const totalErros = verificacoes ? [...verificacoes.values()].flat().filter((a) => a.nivel === 'erro').length : 0;

  return (
    <div className="apuracao">
      <div className="aviso info">
        <strong>A validação que vale é a do PVA.</strong> Esta tela pega o que o PVA costuma recusar e o que normalmente é engano de edição, mas não substitui o
        programa da Receita: gere o arquivo, importe no PVA, valide e transmita por lá. Preferências, regras e arquivos carregados e editados ficam guardados
        somente neste navegador.
      </div>

      <div className="barra-secao envolve" data-tour="conferencia-acoes">
        <button className="primario" onClick={() => aoBaixar(escrituracoes)}>
          {desatualizada ? 'Recalcular e baixar' : 'Baixar'} {escrituracoes.length > 1 ? `os ${escrituracoes.length} arquivos (.zip)` : 'o arquivo'}
        </button>
        {!verificar ? (
          <button onClick={() => setVerificar(true)}>Verificar os {escrituracoes.length} meses</button>
        ) : (
          <span className={totalErros ? 'etiqueta alerta' : 'fraco'}>
            {totalErros ? `${inteiro(totalErros)} erro(s) encontrados` : 'nenhum erro encontrado pelas verificações do editor'}
          </span>
        )}
        <span className="espaco" />
        <label className="linha-opcao">
          <input type="checkbox" checked={mostrarAutomaticas} onChange={(e) => setMostrarAutomaticas(e.target.checked)} />
          Mostrar também as mudanças automáticas (totais, cadastros, contadores, bloco M)
        </label>
      </div>

      {desatualizada && (
        <div className="aviso alerta forte">
          <strong>Apuração desatualizada:</strong> houve edição depois do último recálculo. Ao baixar, o editor recalcula o bloco M antes de gerar o arquivo;
          para conferir o antes e o depois primeiro, use a aba Apuração.
        </div>
      )}

      {erroReverter && <div className="aviso erro">{erroReverter}</div>}

      <ResumoCriterios
        escrituracoes={escrituracoes}
        config={sessao.config}
        aoAlterar={aoAbrirCriterios}
        titulo="Critérios da apuração usados neste trabalho"
      />

      {escrituracoes.map((e) => {
        const avisos = verificacoes?.get(e.id) ?? null;
        const difs = (mudancas.get(e.id) ?? []).filter((d) => mostrarAutomaticas || !d.automatico);
        const exp = aberto === e.id;
        const erros = avisos?.filter((a) => a.nivel === 'erro').length ?? 0;
        const alertas = avisos?.filter((a) => a.nivel === 'alerta').length ?? 0;
        return (
          <div className={`cartao-mes${e.alterada ? ' alterada' : ''}`} key={e.id}>
            <div className="barra-secao envolve">
              <strong>{periodoLegivel(e.periodo)}</strong>
              <span className="fraco">
                {e.nomeArquivo} · {cnpjLegivel(e.cnpj)}
              </span>
              {e.alterada && <span className="etiqueta alerta">alterado</span>}
              {avisos && (
                <span className="fraco">
                  {erros ? `${inteiro(erros)} erro(s)` : 'sem erros'}
                  {alertas ? ` · ${inteiro(alertas)} alerta(s)` : ''}
                </span>
              )}
              <span className="fraco">{difs.length ? `${inteiro(difs.length)} mudança(s)` : 'sem mudanças'}</span>
              <span className="espaco" />
              <button className="ligacao" onClick={() => setAberto(exp ? null : e.id)}>
                {exp ? 'fechar' : 'detalhar'}
              </button>
              <button onClick={() => aoBaixar([e])}>Baixar este mês</button>
            </div>

            {exp && (
              <div className="cartao-mes-corpo">
                {e.avisos.length > 0 && (
                  <>
                    <h4>Perfil do arquivo</h4>
                    <ul className="lista-erros">
                      {e.avisos.map((a, i) => (
                        <li key={i}>
                          <span className={`etiqueta ${a.nivel}`}>{a.nivel}</span> {a.mensagem}
                        </li>
                      ))}
                    </ul>
                  </>
                )}

                <h4>Verificações do editor</h4>
                {!avisos ? (
                  <p className="fraco">Não verificado ainda.</p>
                ) : !avisos.length ? (
                  <p className="fraco">Nada a apontar.</p>
                ) : (
                  (['erro', 'alerta', 'info'] as const).map((nivel) => {
                    const doNivel = avisos.filter((a) => a.nivel === nivel);
                    if (!doNivel.length) return null;
                    const porCodigo = new Map<string, AvisoValidacao[]>();
                    for (const a of doNivel) porCodigo.set(a.codigo, [...(porCodigo.get(a.codigo) ?? []), a]);
                    return (
                      <div key={nivel} className={`aviso ${nivel === 'erro' ? 'erro' : nivel === 'alerta' ? 'alerta' : 'info'}`}>
                        <strong>
                          {ROTULO_NIVEL[nivel]} ({inteiro(doNivel.length)})
                        </strong>
                        {[...porCodigo.entries()].map(([codigo, lista]) => (
                          <details key={codigo}>
                            <summary>
                              {TITULO_VALIDACAO[codigo] ?? codigo} — {inteiro(lista.length)} ocorrência(s) <span className="fraco">({codigo})</span>
                            </summary>
                            <ul className="lista-erros">
                              {lista.slice(0, 50).map((a, i) => (
                                <li key={i}>
                                  {a.documento && <span className="fraco">{a.documento}: </span>}
                                  {a.mensagem}
                                </li>
                              ))}
                              {lista.length > 50 && <li className="fraco">…e outras {inteiro(lista.length - 50)}.</li>}
                            </ul>
                          </details>
                        ))}
                      </div>
                    );
                  })
                )}

                <h4>O que mudou neste mês</h4>
                {!difs.length ? (
                  <p className="fraco">Nada mudou{mostrarAutomaticas ? '' : ' (fora as mudanças automáticas)'}.</p>
                ) : (
                  <div className="tabela-rolagem baixa">
                    <table className="tabela compacta">
                      <thead>
                        <tr>
                          <th>Registro</th>
                          <th>O que</th>
                          <th>Mudança</th>
                          <th />
                        </tr>
                      </thead>
                      <tbody>
                        {difs.slice(0, 300).map((d, i) => (
                          <tr key={i}>
                            <td>
                              {ROTULO_TIPO_DIF[d.tipo]} <span className="fraco">{d.reg}</span>
                            </td>
                            <td>{d.descricao}</td>
                            <td>
                              {d.tipo === 'editado' ? (
                                <ul className="lista-campos">
                                  {(d.campos ?? []).map((c, k) => (
                                    <li key={k}>
                                      <span title={descricaoCampo(d.reg, c.campo)}>{c.campo}</span>:{' '}
                                      <span className="antes">{valorDoCampo(d.reg, c.campo, c.antes)}</span> →{' '}
                                      <strong>{valorDoCampo(d.reg, c.campo, c.depois)}</strong>
                                    </li>
                                  ))}
                                </ul>
                              ) : (
                                <span className="fraco">{d.filhos ? `${inteiro(d.filhos)} registro(s) filho(s)` : '—'}</span>
                              )}
                            </td>
                            <td>
                              {!d.automatico && (
                                <button
                                  className="ligacao"
                                  onClick={() => reverter(e, d)}
                                  title={d.tipo === 'excluido' ? 'Recoloca o registro no lugar original' : d.tipo === 'incluido' ? 'Exclui o registro incluído' : 'Volta os campos ao valor do arquivo'}
                                >
                                  {d.tipo === 'excluido' ? 'restaurar' : 'reverter'}
                                </button>
                              )}
                            </td>
                          </tr>
                        ))}
                        {difs.length > 300 && (
                          <tr>
                            <td colSpan={4} className="fraco">
                              …e outras {inteiro(difs.length - 300)} mudanças.
                            </td>
                          </tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
