/**
 * Aba Apuração: o antes e o depois de crédito, contribuição e valor a recolher,
 * mês a mês, mais o botão de recalcular o bloco M, as opções da apuração e as
 * pendências de natureza da receita.
 */
import { useMemo, useState } from 'react';
import { definirNaturezaReceita, pendenciasNaturezaReceita, resumoApuracao, resumoOriginal, type PendenciaNaturezaReceita } from '../core/apuracao';
import type { Escrituracao } from '../core/modelo';
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
}

export function TelaApuracaoAba({ sessao, escrituracoes, versao, relatorios, desatualizada, aoRecalcular, pendencias: pendCriterios, aoAbrirCriterios }: TelaApuracaoAbaProps) {
  const [erro, setErro] = useState<string | null>(null);
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

  return (
    <div className="apuracao">
      <div className="barra-secao envolve">
        <button className="primario" data-tour="recalcular-apuracao" onClick={recalcularAgora} disabled={!escrituracoes.length}>
          Recalcular apuração
        </button>
        <span className="fraco">
          O bloco M (apuração) só muda quando você recalcula; o botão Baixar recalcula sozinho se precisar.
          {alteradas > 0 && ` ${plural(alteradas, 'mês alterado', 'meses alterados')} desde a carga.`}
        </span>
      </div>

      {desatualizada && (
        <div className="aviso alerta forte" role="status">
          <strong>Apuração desatualizada.</strong>{' '}
          {relatorios
            ? 'Houve edição (ou mudança de opção) depois do último recálculo: os valores abaixo ainda são os de antes dela.'
            : 'Houve edição depois da carga: os valores abaixo ainda são os do bloco M original.'}{' '}
          Clique em "Recalcular apuração" para ver o efeito das edições.
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
              Escolher os critérios e recalcular
            </button>
          ) : (
            'Para esses meses, ajuste a apuração no PVA depois de importar o arquivo.'
          )}
        </div>
      )}

      {naoConferidos.servico + naoConferidos.f120 + naoConferidos.f130 > 0 && (
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

      {pendCriterios.length > 0 ? (
        <div className="aviso alerta forte" data-tour="criterios-apuracao">
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
      ) : (
        <ResumoCriterios escrituracoes={escrituracoes} config={sessao.config} aoAlterar={aoAbrirCriterios} />
      )}

      {erro && <div className="aviso erro">{erro}</div>}

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

      {!relatorios && <p className="fraco">Clique em "Recalcular apuração" para refazer o bloco M com as edições e ver o antes e o depois.</p>}

      <TelaApuracao meses={meses} />
    </div>
  );
}
