/**
 * Aba Apuração: o antes e o depois de crédito, contribuição e valor a recolher,
 * mês a mês, mais o botão de recalcular o bloco M, as opções da apuração e as
 * pendências de natureza da receita.
 */
import { useMemo, useRef, useState, type ReactNode } from 'react';
import { definirNaturezaReceita, pendenciasNaturezaReceita, resumoApuracao, resumoOriginal, type PendenciaNaturezaReceita } from '../core/apuracao';
import { campoAlterado, get, idx, listar, type Escrituracao } from '../core/modelo';
import { centavos } from '../core/dec';
import type { RelatorioRecalculo } from '../core/recalcular';
import type { Sessao } from '../core/sessao';
import { linhasDe } from '../core/linhas';
import { agruparAvisos, AVISOS_DE_CRITERIO, mesesNaoRecalculados } from './apuracaoUi';
import { ResumoCriterios } from './CriteriosApuracao';
import type { criteriosPendentes } from '../core/apuracao';
import { CRITERIO_POR_ID, ROTULO_CURTO } from './criterios';

type PendenciaCriterios = ReturnType<typeof criteriosPendentes>[number];
import { brl, cnpjLegivel, inteiro, periodoLegivel, plural } from './formato';
import { TelaApuracao, type MesApuracao } from './TelaApuracao';
import { TelaCreditosNatureza } from './TelaCreditosNatureza';

const SUBABAS = [
  { id: 'bloco-m', rotulo: 'Bloco M' },
  { id: 'mensagens', rotulo: 'Mensagens' },
  { id: 'criterios', rotulo: 'Critérios da apuração' },
  { id: 'rateio', rotulo: 'Rateio (0111)' },
  { id: 'creditos-natureza', rotulo: 'Créditos por Natureza' },
] as const;
export type SubabaApuracao = typeof SUBABAS[number]['id'];

const CAMPOS_RATEIO = [
  ['REC_BRU_NCUM_TRIB_MI', 'Mercado interno tributado'],
  ['REC_BRU_NCUM_NT_MI', 'Mercado interno não tributado'],
  ['REC_BRU_NCUM_EXP', 'Exportação'],
  ['REC_BRU_CUM', 'Cumulativa'],
  ['REC_BRU_TOTAL', 'Receita total'],
] as const;

function TelaRateio({ escrituracoes }: Pick<TelaApuracaoAbaProps, 'escrituracoes'>) {
  const mostrarEmpresa = new Set(escrituracoes.map((e) => e.cnpj)).size > 1;
  const ordenadas = [...escrituracoes].sort((a, b) => a.periodo.localeCompare(b.periodo) || a.cnpj.localeCompare(b.cnpj));
  return (
    <div className="tabela-rolagem">
      <table className="tabela compacta">
        <caption>Receita bruta por mês · valores do 0111 em R$</caption>
        <thead><tr><th scope="col">Mês</th>{mostrarEmpresa && <th scope="col">Empresa</th>}
          {CAMPOS_RATEIO.map(([campo, rotulo]) => <th key={campo} scope="col" className="num">{rotulo}</th>)}
          <th scope="col">Situação</th>
        </tr></thead>
        <tbody>{ordenadas.map((e) => {
          const r = listar(e, '0111')[0];
          const ajustado = r && CAMPOS_RATEIO.some(([campo]) => campoAlterado(r, idx(r.reg, campo)));
          return <tr key={e.id}>
            <th scope="row">{periodoLegivel(e.periodo)}</th>
            {mostrarEmpresa && <td>{e.nome} ({cnpjLegivel(e.cnpj)})</td>}
            {CAMPOS_RATEIO.map(([campo]) => <td key={campo} className="num">{r ? brl(centavos(get(r, campo))) : '—'}</td>)}
            <td>{!r ? 'Sem registro 0111' : ajustado ? 'Ajustado' : 'Original'}</td>
          </tr>;
        })}</tbody>
      </table>
    </div>
  );
}

export interface TelaApuracaoAbaProps {
  sessao: Sessao;
  escrituracoes: Escrituracao[];
  versao: number;
  /** Último recálculo da sessão (guardado fora da aba para não se perder ao trocar de aba). */
  relatorios: RelatorioRecalculo[] | null;
  /** Houve edição depois do último recálculo. */
  desatualizada: boolean;
  /** Recalcula, ou abre a rotina de critérios se faltar escolha (devolve se recalculou). */
  aoRecalcular: () => boolean;
  /** Empresas com critério da apuração sem escolha. */
  pendencias: PendenciaCriterios[];
  aoAbrirCriterios: () => void;
  subaba: SubabaApuracao;
  aoTrocarSubaba: (subaba: SubabaApuracao) => void;
  criterios?: ReactNode;
  erroExterno?: string | null;
}

export function TelaApuracaoAba({ sessao, escrituracoes, versao, relatorios, desatualizada, aoRecalcular, pendencias: pendCriterios, aoAbrirCriterios, subaba, aoTrocarSubaba, criterios, erroExterno }: TelaApuracaoAbaProps) {
  const [erro, setErro] = useState<string | null>(null);
  const abas = useRef<HTMLDivElement>(null);
  const [natDigitada, setNatDigitada] = useState<Record<string, string>>({});

  const naoRecalculados = useMemo(() => mesesNaoRecalculados(relatorios), [relatorios]);

  const meses = useMemo<MesApuracao[]>(() => {
    const nao = new Set(naoRecalculados.map((m) => m.escrituracaoId));
    const out: MesApuracao[] = [];
    for (const e of escrituracoes) {
      try {
        out.push({
          escrituracao: e,
          atual: resumoApuracao(e),
          original: resumoOriginal(e),
          naoRecalculada: nao.has(e.id),
        });
      } catch {
        /* perfil sem bloco M legível: o mês não entra no quadro */
      }
    }
    return out;
  }, [escrituracoes, versao, naoRecalculados]);

  const grupos = useMemo(() => agruparAvisos(relatorios), [relatorios]);

  // Serviços (A170) e imobilizado (F120/F130) foram apurados pelas regras do Guia, sem
  // arquivo real para conferir: a tela avisa sempre que houver algum carregado.
  const naoConferidos = useMemo(() => {
    const conta = (t: 'servico' | 'imobDepreciacao' | 'imobAquisicao') => escrituracoes.reduce((n, e) => n + linhasDe(e, t).length, 0);
    return { servico: conta('servico'), f120: conta('imobDepreciacao'), f130: conta('imobAquisicao') };
  }, [escrituracoes, versao]);

  const pendencias = useMemo(() => {
    const out: { e: Escrituracao; p: PendenciaNaturezaReceita }[] = [];
    for (const e of escrituracoes) for (const p of pendenciasNaturezaReceita(e)) out.push({ e, p });
    return out;
  }, [escrituracoes, versao, relatorios]);

  const recalcularAgora = () => {
    try {
      aoRecalcular();
      setErro(null);
    } catch (err) {
      setErro((err as Error)?.message ?? String(err));
      aoTrocarSubaba('mensagens');
    }
  };


  const atribuirNatureza = (e: Escrituracao, p: PendenciaNaturezaReceita) => {
    const chave = `${e.id}|${p.cst}|${p.chave}`;
    const cod = (natDigitada[chave] ?? '').trim();
    if (!cod) return;
    definirNaturezaReceita(e, p.cst, p.chave, cod);
    setNatDigitada((n) => ({ ...n, [chave]: '' }));
    recalcularAgora();
  };

  const alteradas = escrituracoes.filter((e) => e.alterada).length;
  const meses_ = (lista: string[]) => (lista.length > 6 ? `${lista.length} meses` : lista.join(', '));
  const alertaNaoConferidos = naoConferidos.servico + naoConferidos.f120 + naoConferidos.f130 > 0;
  const erroVisivel = erro ?? erroExterno;
  const totalMensagens = grupos.length + [desatualizada, naoRecalculados.length, alertaNaoConferidos, pendCriterios.length, erroVisivel, pendencias.length].filter(Boolean).length;

  return (
    <div className="apuracao">
      <div className="barra-secao envolve subabas-apuracao" ref={abas} role="tablist" aria-label="Subabas de Apuração">
        {SUBABAS.map(({ id, rotulo }, i) => (
          <button key={id} id={'apuracao-aba-' + id} role="tab" aria-controls={'apuracao-painel-' + id} aria-selected={subaba === id}
            tabIndex={subaba === id ? 0 : -1} className={subaba === id ? 'primario' : ''} onClick={() => aoTrocarSubaba(id)}
            onKeyDown={(ev) => {
              const destinos: Record<string, number> = { ArrowRight: (i + 1) % SUBABAS.length, ArrowLeft: (i + SUBABAS.length - 1) % SUBABAS.length, Home: 0, End: SUBABAS.length - 1 };
              const destino = destinos[ev.key];
              if (destino === undefined) return;
              ev.preventDefault();
              aoTrocarSubaba(SUBABAS[destino].id);
              abas.current?.querySelectorAll<HTMLButtonElement>('button')[destino]?.focus();
            }}>
            {rotulo}{id === 'mensagens' && totalMensagens > 0 && ' (' + inteiro(totalMensagens) + ')'}
          </button>
        ))}
      </div>
      <section className="apuracao" role="tabpanel" id="apuracao-painel-bloco-m" aria-labelledby="apuracao-aba-bloco-m" hidden={subaba !== 'bloco-m'}>
        <div className="barra-secao envolve">
          <button className="primario" data-tour="recalcular-apuracao" onClick={recalcularAgora} disabled={!escrituracoes.length}>
            Recalcular apuração
          </button>
          <span className="fraco">
            O bloco M (apuração) só muda quando você recalcula; o botão Baixar recalcula sozinho se precisar.
            {alteradas > 0 && ` ${plural(alteradas, 'mês alterado', 'meses alterados')} desde a carga.`}
          </span>
        </div>
        <TelaApuracao meses={meses} desatualizada={desatualizada} />
      </section>

      <section className="apuracao" role="tabpanel" id="apuracao-painel-mensagens" aria-labelledby="apuracao-aba-mensagens" hidden={subaba !== 'mensagens'}>
        {!totalMensagens && <p className="fraco">Nenhuma mensagem de apuração.</p>}
        {desatualizada && (
          <div className="aviso alerta forte" role="status">
            <strong>Apuração desatualizada.</strong>{' '}
            {relatorios
              ? 'Houve edição ou mudança de opção depois do último recálculo. Os valores do Bloco M ainda são os de antes dela.'
              : 'Houve edição depois da carga. Os valores ainda são os do bloco M original.'}{' '}
            Use "Recalcular apuração" na subaba Bloco M para ver o efeito das edições.
          </div>
        )}

        {naoRecalculados.length > 0 && (
          <div className="aviso erro forte" role="alert">
            <strong>
              Apuração NÃO recalculada em {plural(naoRecalculados.length, 'mês', 'meses')}: o bloco M desses meses ficou exatamente como veio no arquivo e
              não reflete as edições.
            </strong>
            <ul className="lista-erros">
              {naoRecalculados.map((m) => (
                <li key={m.escrituracaoId}>
                  <strong>{periodoLegivel(m.periodo)}</strong> <span className="fraco">({m.nomeArquivo})</span>: {m.motivos.join(' ')}
                </li>
              ))}
            </ul>
            {naoRecalculados.some((m) => m.motivos.some((x) => /critério/i.test(x))) ? (
              <button className="primario" onClick={aoAbrirCriterios}>
                Rever critérios da apuração
              </button>
            ) : (
              'Para esses meses, ajuste a apuração no PVA depois de importar o arquivo.'
            )}
          </div>
        )}

        {alertaNaoConferidos && (
          <div className="aviso alerta forte">
            <strong>Parte da apuração ainda não foi conferida contra arquivo real.</strong> Há{' '}
            {[
              naoConferidos.servico && `${inteiro(naoConferidos.servico)} item(ns) de nota de serviço (A170)`,
              naoConferidos.f120 && `${inteiro(naoConferidos.f120)} crédito(s) de depreciação do imobilizado (F120)`,
              naoConferidos.f130 && `${inteiro(naoConferidos.f130)} crédito(s) de aquisição do imobilizado (F130)`,
            ]
              .filter(Boolean)
              .join(', ')}
            . O editor apura esses registros pelas regras do Guia Prático, mas ainda não houve arquivo real para comparar: confira no PVA os créditos
            (M100/M105 e M500/M505) e, no serviço prestado, a receita (M210/M610).
          </div>
        )}

        {pendCriterios.length > 0 && (
          <div className="aviso alerta forte">
            <strong>Critérios da apuração pendentes.</strong> Estas escolhas dependem do caso e o editor não tem padrão para elas; sem elas a apuração não é
            recalculada (meses não alterados podem ser baixados como vieram).
            <ul className="lista-erros">
              {pendCriterios.map((p) => (
                <li key={p.cnpj}>
                  {p.nome} ({cnpjLegivel(p.cnpj)}): falta {p.pendentes.map((id) => ROTULO_CURTO[id].toLowerCase()).join(', ')}
                </li>
              ))}
            </ul>
            <button className="primario" onClick={aoAbrirCriterios} title={pendCriterios.flatMap((p) => p.pendentes.map((id) => CRITERIO_POR_ID[id].pergunta)).join('\n')}>
              Responder os critérios
            </button>
          </div>
        )}

        {erroVisivel && <div className="aviso erro" role="alert">{erroVisivel}</div>}

        {pendencias.length > 0 && (
          <div className="aviso alerta">
            <strong>Natureza da receita pendente ({inteiro(pendencias.length)})</strong>
            <p>
              Receita não tributada sem natureza da receita (M410/M810) conhecida. Informe o código da tabela 4.3.10 (PIS) / 4.3.11 (COFINS) do Guia Prático; o
              código vale para PIS e COFINS e para todos os meses do mesmo CNPJ.
            </p>
            <div className="tabela-rolagem baixa">
              <table className="tabela compacta">
                <thead>
                  <tr>
                    <th>Mês</th>
                    <th>CST</th>
                    <th>Receita</th>
                    <th className="num">Valor</th>
                    <th>Natureza da receita</th>
                  </tr>
                </thead>
                <tbody>
                  {pendencias.map(({ e, p }) => {
                    const chave = `${e.id}|${p.cst}|${p.chave}`;
                    return (
                      <tr key={chave}>
                        <td>{periodoLegivel(e.periodo)}</td>
                        <td>{p.cst}</td>
                        <td>{p.descricao}</td>
                        <td className="num">{brl(p.valor)}</td>
                        <td>
                          <input
                            type="text"
                            size={6}
                            aria-label={`Código da natureza da receita para ${p.descricao}`}
                            value={natDigitada[chave] ?? ''}
                            onChange={(ev) => setNatDigitada((n) => ({ ...n, [chave]: ev.target.value }))}
                          />
                          <button onClick={() => atribuirNatureza(e, p)} disabled={!(natDigitada[chave] ?? '').trim()}>
                            Atribuir
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {grupos.map((g) => (
          <div key={g.nivel + g.codigo} className={`aviso ${g.nivel}`}>
            <strong>{g.titulo || (g.nivel === 'erro' ? 'Erro do recálculo' : g.nivel === 'alerta' ? 'Alerta do recálculo' : 'Informação do recálculo')}</strong>
            {g.orientacao && <p>{g.orientacao}</p>}
            <ul className="lista-erros">
              {g.ocorrencias.map((o, i) => (
                <li key={i}>
                  {o.mensagem} <span className="fraco">({meses_(o.meses)})</span>
                </li>
              ))}
            </ul>
            {AVISOS_DE_CRITERIO.has(g.codigo) && <button onClick={aoAbrirCriterios}>Rever os critérios da apuração</button>}
          </div>
        ))}

      </section>
      <section role="tabpanel" id="apuracao-painel-criterios" aria-labelledby="apuracao-aba-criterios" hidden={subaba !== 'criterios'} data-tour="criterios-formulario">
        {criterios ?? <ResumoCriterios escrituracoes={escrituracoes} config={sessao.config} aoAlterar={aoAbrirCriterios} />}
        {!criterios && pendCriterios.length > 0 && <button onClick={aoAbrirCriterios}>Responder os critérios</button>}
      </section>
      <section role="tabpanel" id="apuracao-painel-rateio" aria-labelledby="apuracao-aba-rateio" hidden={subaba !== 'rateio'} data-tour="rateio-0111">
        {subaba === 'rateio' && <TelaRateio escrituracoes={escrituracoes} />}
      </section>
      <section className="apuracao" role="tabpanel" id="apuracao-painel-creditos-natureza" aria-labelledby="apuracao-aba-creditos-natureza"
        hidden={subaba !== 'creditos-natureza'} data-tour="creditos-por-natureza">
        <TelaCreditosNatureza escrituracoes={escrituracoes} versao={versao} />
      </section>
    </div>
  );
}
