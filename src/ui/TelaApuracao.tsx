/**
 * Tela de apuração: mostra, mês a mês, o antes e o depois de crédito, débito e
 * valor a recolher. É onde o contador confere se a edição fez o efeito esperado
 * antes de levar o arquivo para o PVA.
 */
import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import type { ResumoApuracao, ResumoTributo } from '../core/apuracao/contrato';
import type { Escrituracao } from '../core/modelo';
import { exportarExcel } from './exportarExcel';

export interface MesApuracao {
  escrituracao: Escrituracao;
  /** Como está agora (depois das edições). */
  atual: ResumoApuracao;
  /** Como veio no arquivo original. Ausente quando não foi possível capturar. */
  original?: ResumoApuracao;
  /** A apuração não foi recalculada (perfil não suportado): o bloco M ficou como veio. */
  naoRecalculada?: boolean;
}

export interface TelaApuracaoProps {
  meses: MesApuracao[];
  desatualizada: boolean;
}

const brl = (centavos: number) =>
  (centavos / 100).toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

const mesLegivel = (periodo: string) => `${periodo.slice(4)}/${periodo.slice(0, 4)}`;

/** Diferença formatada com sinal e cor (crédito a mais / imposto a menos é bom). */
function Delta({ de, para, bomQuando }: { de: number; para: number; bomQuando: 'sobe' | 'desce' }) {
  const d = para - de;
  if (d === 0) return <span className="fraco">—</span>;
  const bom = bomQuando === 'sobe' ? d > 0 : d < 0;
  return (
    <span className={`delta ${bom ? 'bom' : 'ruim'}`}>
      {d > 0 ? '+' : '−'}
      {brl(Math.abs(d))}
    </span>
  );
}

function creditoTotal(t: ResumoTributo): number {
  return t.creditos.reduce((s, c) => s + c.disponivel, 0);
}

export function TelaApuracao({ meses, desatualizada }: TelaApuracaoProps) {
  const [tributo, setTributo] = useState<'pis' | 'cofins'>('pis');
  const [aberto, setAberto] = useState<string | null>(null);
  const listaMeses = useRef<HTMLDivElement>(null);
  const [rolagem, setRolagem] = useState({ disponivel: false, fim: false });
  const temMeses = meses.length > 0;

  useEffect(() => {
    const lista = listaMeses.current;
    const tabela = lista?.querySelector('table');
    if (!lista || !tabela) return;
    const medir = () => {
      const disponivel = lista.clientHeight > 0 && lista.scrollHeight > lista.clientHeight + 1;
      const fim = disponivel && lista.scrollTop + lista.clientHeight >= lista.scrollHeight - 2;
      setRolagem((atual) => atual.disponivel === disponivel && atual.fim === fim ? atual : { disponivel, fim });
    };
    const observador = new ResizeObserver(medir);
    observador.observe(lista);
    observador.observe(tabela);
    lista.addEventListener('scroll', medir, { passive: true });
    medir();
    return () => {
      observador.disconnect();
      lista.removeEventListener('scroll', medir);
    };
  }, [temMeses]);

  const ordenados = useMemo(
    () => [...meses].sort((a, b) => a.escrituracao.periodo.localeCompare(b.escrituracao.periodo)),
    [meses],
  );

  const totais = useMemo(() => {
    const soma = (f: (m: MesApuracao) => number) => ordenados.reduce((s, m) => s + f(m), 0);
    const t = (m: MesApuracao) => m.atual[tributo];
    const o = (m: MesApuracao) => m.original?.[tributo] ?? m.atual[tributo];
    return {
      creditoAntes: soma((m) => creditoTotal(o(m))),
      creditoDepois: soma((m) => creditoTotal(t(m))),
      debitoAntes: soma((m) => o(m).contribuicaoNaoCumulativa + o(m).contribuicaoCumulativa),
      debitoDepois: soma((m) => t(m).contribuicaoNaoCumulativa + t(m).contribuicaoCumulativa),
      recolherNcAntes: soma((m) => o(m).aRecolherNaoCumulativo),
      recolherNcDepois: soma((m) => t(m).aRecolherNaoCumulativo),
      recolherCumAntes: soma((m) => o(m).aRecolherCumulativo),
      recolherCumDepois: soma((m) => t(m).aRecolherCumulativo),
      saldoDepois: soma((m) => t(m).saldoCredor),
    };
  }, [ordenados, tributo]);

  if (!temMeses) return <p className="fraco">Nenhum mês carregado.</p>;

  const aoExportarExcel = () => {
    const cabecalhos = [
      'Mês', 'CNPJ', 'Crédito original', 'Crédito atual', 'Variação do crédito',
      'Contribuição original', 'Contribuição atual', 'Variação da contribuição',
        'A recolher original', 'A recolher atual', 'Variação a recolher',
        'A recolher não cumulativo original', 'A recolher não cumulativo atual', 'Variação não cumulativa',
        'A recolher cumulativo original', 'A recolher cumulativo atual', 'Variação cumulativa',
        'Saldo credor atual', 'Situação',
    ];
    const linhas = ordenados.map((m) => {
      const atual = m.atual[tributo];
      const original = m.original?.[tributo] ?? atual;
      const creditoAntes = creditoTotal(original);
      const creditoDepois = creditoTotal(atual);
      const contribuicaoAntes = original.contribuicaoNaoCumulativa + original.contribuicaoCumulativa;
      const contribuicaoDepois = atual.contribuicaoNaoCumulativa + atual.contribuicaoCumulativa;
      const valores = [
        creditoAntes, creditoDepois, creditoDepois - creditoAntes,
        contribuicaoAntes, contribuicaoDepois, contribuicaoDepois - contribuicaoAntes,
        original.aRecolher, atual.aRecolher, atual.aRecolher - original.aRecolher,
        original.aRecolherNaoCumulativo, atual.aRecolherNaoCumulativo, atual.aRecolherNaoCumulativo - original.aRecolherNaoCumulativo,
        original.aRecolherCumulativo, atual.aRecolherCumulativo, atual.aRecolherCumulativo - original.aRecolherCumulativo,
        atual.saldoCredor,
      ];
      const situacao = [
        m.naoRecalculada ? 'Não recalculado' : '',
        desatualizada ? 'Apuração desatualizada' : '',
        m.original ? '' : 'Original indisponível; comparação usa o valor atual',
      ].filter(Boolean).join(' · ');
      return [mesLegivel(m.escrituracao.periodo), m.escrituracao.cnpj, ...valores.map((v) => v / 100), situacao];
    });
    exportarExcel(`apuracao-${tributo}`, tributo === 'pis' ? 'PIS-Pasep' : 'COFINS', cabecalhos, linhas);
  };

  return (
    <div className="apuracao">
      <div className="barra-secao">
        <div className="seletor">
          <button className={tributo === 'pis' ? 'ativa' : ''} onClick={() => setTributo('pis')}>
            PIS/Pasep
          </button>
          <button className={tributo === 'cofins' ? 'ativa' : ''} onClick={() => setTributo('cofins')}>
            COFINS
          </button>
        </div>
        <button onClick={aoExportarExcel}>Exportar Excel ({ordenados.length})</button>
        <span className="espaco" />
        <span className="fraco">
          {ordenados.length} {ordenados.length === 1 ? 'mês' : 'meses'}
        </span>
      </div>

      <div className="cartoes" data-tour="apuracao-quadro">
        <div className="cartao">
          <span className="rotulo">Crédito disponível</span>
          <strong className="num">{brl(totais.creditoDepois)}</strong>
          <Delta de={totais.creditoAntes} para={totais.creditoDepois} bomQuando="sobe" />
        </div>
        <div className="cartao">
          <span className="rotulo">Contribuição apurada</span>
          <strong className="num">{brl(totais.debitoDepois)}</strong>
          <Delta de={totais.debitoAntes} para={totais.debitoDepois} bomQuando="desce" />
        </div>
        <div className="cartao destaque">
          <span className="rotulo">A recolher não cumulativo</span>
          <strong className="num">{brl(totais.recolherNcDepois)}</strong>
          <Delta de={totais.recolherNcAntes} para={totais.recolherNcDepois} bomQuando="desce" />
        </div>
        <div className="cartao destaque">
          <span className="rotulo">A recolher cumulativo</span>
          <strong className="num">{brl(totais.recolherCumDepois)}</strong>
          <Delta de={totais.recolherCumAntes} para={totais.recolherCumDepois} bomQuando="desce" />
        </div>
        {totais.saldoDepois > 0 && (
          <div className="cartao">
            <span className="rotulo">Saldo credor</span>
            <strong className="num">{brl(totais.saldoDepois)}</strong>
          </div>
        )}
      </div>

      <div className="barra-secao apuracao-lista-cabecalho">
        <strong>Apuração por mês</strong>
        {rolagem.disponivel && <button aria-controls="apuracao-lista-meses" onClick={() => {
          const lista = listaMeses.current;
          if (!lista) return;
          const alturaCabecalho = lista.querySelector('thead')?.getBoundingClientRect().height ?? 0;
          lista.scrollTop = rolagem.fim ? 0 : lista.scrollTop + Math.max(1, lista.clientHeight - alturaCabecalho);
        }}>{rolagem.fim ? 'Voltar ao início ↑' : 'Rolar para baixo ↓'}</button>}
      </div>
      <div className="tabela-rolagem apuracao-lista-meses" id="apuracao-lista-meses" ref={listaMeses}
        role="region" aria-label="Apuração por mês" tabIndex={rolagem.disponivel ? 0 : undefined}>
        <table className="tabela">
          <thead>
            <tr>
              <th>Mês</th>
              <th className="num">Crédito</th>
              <th className="num">Variação</th>
              <th className="num">Contribuição</th>
              <th className="num">Variação</th>
              <th className="num">A recolher não cumulativo</th>
              <th className="num" aria-label="Variação do valor não cumulativo a recolher">Variação</th>
              <th className="num">A recolher cumulativo</th>
              <th className="num" aria-label="Variação do valor cumulativo a recolher">Variação</th>
              <th className="num">Saldo credor</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {ordenados.map((m) => {
              const t = m.atual[tributo];
              const o = m.original?.[tributo] ?? t;
              const id = m.escrituracao.id;
              const exp = aberto === id;
              return (
                <Fragment key={id}>
                  <tr className={m.escrituracao.alterada ? 'alterada' : undefined}>
                    <td>
                      {mesLegivel(m.escrituracao.periodo)}
                      {m.naoRecalculada && (
                        <span className="etiqueta erro" title="O bloco M deste mês ficou como veio no arquivo. Consulte a subaba Mensagens.">
                          não recalculado
                        </span>
                      )}
                    </td>
                    <td className="num">{brl(creditoTotal(t))}</td>
                    <td className="num">
                      <Delta de={creditoTotal(o)} para={creditoTotal(t)} bomQuando="sobe" />
                    </td>
                    <td className="num">{brl(t.contribuicaoNaoCumulativa + t.contribuicaoCumulativa)}</td>
                    <td className="num">
                      <Delta
                        de={o.contribuicaoNaoCumulativa + o.contribuicaoCumulativa}
                        para={t.contribuicaoNaoCumulativa + t.contribuicaoCumulativa}
                        bomQuando="desce"
                      />
                    </td>
                    <td className="num forte">{brl(t.aRecolherNaoCumulativo)}</td>
                    <td className="num">
                      <Delta de={o.aRecolherNaoCumulativo} para={t.aRecolherNaoCumulativo} bomQuando="desce" />
                    </td>
                    <td className="num forte">{brl(t.aRecolherCumulativo)}</td>
                    <td className="num">
                      <Delta de={o.aRecolherCumulativo} para={t.aRecolherCumulativo} bomQuando="desce" />
                    </td>
                    <td className="num">{t.saldoCredor ? brl(t.saldoCredor) : <span className="fraco">—</span>}</td>
                    <td>
                      <button className="ligacao" onClick={() => setAberto(exp ? null : id)}>
                        {exp ? 'fechar' : 'detalhar'}
                      </button>
                    </td>
                  </tr>
                  {exp && (
                    <tr className="detalhe">
                      <td colSpan={11}>
                        <div className="detalhe-grade">
                          <div>
                            <h4>Créditos por tipo</h4>
                            <table className="tabela compacta">
                              <thead>
                                <tr>
                                  <th>Tipo</th>
                                  <th className="num">Alíq.</th>
                                  <th className="num">Base</th>
                                  <th className="num">Crédito</th>
                                  <th className="num">Ajustes</th>
                                  <th className="num">Disponível</th>
                                  <th className="num">Descontado</th>
                                  <th className="num">Saldo</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.creditos.map((c) => (
                                  <tr key={c.codCred + c.aliquota}>
                                    <td>{c.codCred}</td>
                                    <td className="num">{c.aliquota}</td>
                                    <td className="num">{brl(c.base)}</td>
                                    <td className="num">{brl(c.credito)}</td>
                                    <td className="num">
                                      {c.ajustesAcrescimo || c.ajustesReducao ? (
                                        <>
                                          {c.ajustesAcrescimo ? '+' + brl(c.ajustesAcrescimo) : ''}
                                          {c.ajustesReducao ? ' −' + brl(c.ajustesReducao) : ''}
                                        </>
                                      ) : (
                                        <span className="fraco">—</span>
                                      )}
                                    </td>
                                    <td className="num">{brl(c.disponivel)}</td>
                                    <td className="num">{brl(c.descontado)}</td>
                                    <td className="num">{c.saldo ? brl(c.saldo) : <span className="fraco">—</span>}</td>
                                  </tr>
                                ))}
                                {!t.creditos.length && (
                                  <tr>
                                    <td colSpan={8} className="fraco">
                                      Sem crédito apurado.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                          </div>
                          <div>
                            <h4>Contribuição por tipo</h4>
                            <table className="tabela compacta">
                              <thead>
                                <tr>
                                  <th>Tipo</th>
                                  <th className="num">Alíq.</th>
                                  <th className="num">Receita</th>
                                  <th className="num">Base</th>
                                  <th className="num">Contribuição</th>
                                </tr>
                              </thead>
                              <tbody>
                                {t.contribuicoes.map((c) => (
                                  <tr key={c.codCont + c.aliquota}>
                                    <td>{c.codCont}</td>
                                    <td className="num">{c.aliquota}</td>
                                    <td className="num">{brl(c.receitaBruta)}</td>
                                    <td className="num">{brl(c.base)}</td>
                                    <td className="num">{brl(c.contribuicao)}</td>
                                  </tr>
                                ))}
                                {!t.contribuicoes.length && (
                                  <tr>
                                    <td colSpan={5} className="fraco">
                                      Sem contribuição apurada.
                                    </td>
                                  </tr>
                                )}
                              </tbody>
                            </table>
                            {t.creditoDescontadoAnteriores > 0 && (
                              <p className="fraco">
                                Crédito de meses anteriores usado: {brl(t.creditoDescontadoAnteriores)}
                              </p>
                            )}
                          </div>
                        </div>
                      </td>
                    </tr>
                  )}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
