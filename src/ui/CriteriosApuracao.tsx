/**
 * Rotina "Critérios da apuração": as escolhas que dependem do caso (saldo credor, ordem de
 * uso dos créditos, 0111, crédito guardado no original). Nenhuma opção vem marcada; o que
 * o arquivo original indica aparece como informação. Só "Confirmar critérios" grava.
 *
 * Também o resumo das escolhas (aba Apuração e Conferência).
 */
import { useMemo, useState } from 'react';
import type { Escrituracao } from '../core/modelo';
import { baixarTexto } from './baixar';
import { CRITERIOS, criteriosDe, criteriosExigidos, indiciosCriterios, type ConfigApuracao, type EscolhasCriterios, type IdCriterio } from '../core/apuracao';
import {
  escolhasCompletas,
  escolhasParaCarregadas,
  exportarCriterios,
  importarCriterios,
  motivoNaoAplica,
  rotuloEscolha,
  ROTULO_CURTO,
  type ValorCriterio,
} from './criterios';
import type { DialogoProps } from './Dialogo';
import { cnpjLegivel, periodoLegivel } from './formato';

function agrupar(escrituracoes: Escrituracao[]): { cnpj: string; nome: string; meses: Escrituracao[] }[] {
  const m = new Map<string, Escrituracao[]>();
  for (const e of escrituracoes) m.set(e.cnpj, [...(m.get(e.cnpj) ?? []), e]);
  return [...m.entries()].map(([cnpj, meses]) => ({ cnpj, nome: meses[0].nome, meses }));
}

export interface CriteriosApuracaoProps {
  escrituracoes: Escrituracao[];
  config: ConfigApuracao;
  /** Escolhas que aparecem preenchidas para CONFIRMAR (importadas ou lembradas), por CNPJ. */
  preenchidas?: Record<string, EscolhasCriterios>;
  /** CNPJs que estão em "lembrar para esta empresa". */
  lembradas: Set<string>;
  /** Por que a rotina abriu (ex.: "Para recalcular, responda..."). */
  motivo?: string;
  aoConfirmar: (escolhas: Record<string, EscolhasCriterios>, lembrar: Set<string>) => void;
  aoFechar: () => void;
}

function PainelCriterios({ subtitulo, children, rodape }: Pick<DialogoProps, 'subtitulo' | 'children' | 'rodape'>) {
  return <div className="apuracao">
    <p className="fraco">{subtitulo}</p>
    {children}
    <div className="barra-secao envolve">{rodape}</div>
  </div>;
}

export function CriteriosApuracao({ escrituracoes, config, preenchidas, lembradas, motivo, aoConfirmar, aoFechar }: CriteriosApuracaoProps) {
  const empresas = useMemo(() => agrupar(escrituracoes), [escrituracoes]);
  const indicios = useMemo(() => indiciosCriterios(escrituracoes), [escrituracoes]);
  const aplicaveis = useMemo(() => Object.fromEntries(empresas.map((g) => [g.cnpj, criteriosExigidos(g.meses)])) as Record<string, IdCriterio[]>, [empresas]);

  const [rascunho, setRascunho] = useState<Record<string, EscolhasCriterios>>(() =>
    Object.fromEntries(empresas.map((g) => [g.cnpj, { ...criteriosDe(config, g.cnpj), ...(preenchidas?.[g.cnpj] ?? {}) }])),
  );
  const [mesmas, setMesmas] = useState(false);
  const [lembrar, setLembrar] = useState<Set<string>>(() => new Set([...lembradas].filter((c) => empresas.some((g) => g.cnpj === c))));
  const [avisosImport, setAvisosImport] = useState<string[]>(
    preenchidas && Object.keys(preenchidas).length ? ['Escolhas preenchidas a partir de um arquivo ou de "lembrar para esta empresa": confira e confirme.'] : [],
  );
  const [erro, setErro] = useState<string | null>(null);

  const varias = empresas.length > 1;
  const visiveis = varias && mesmas ? [empresas[0]] : empresas;

  const escolher = (cnpj: string, id: IdCriterio, valor: ValorCriterio) =>
    setRascunho((r) => {
      const alvos = varias && mesmas ? empresas.map((g) => g.cnpj) : [cnpj];
      const novo = { ...r };
      for (const c of alvos) novo[c] = { ...novo[c], [id]: valor };
      return novo;
    });

  const ligarMesmas = (v: boolean) => {
    setMesmas(v);
    if (v) {
      // copia as escolhas da primeira empresa para as demais (a pessoa vê e confirma)
      const base = rascunho[empresas[0].cnpj] ?? {};
      setRascunho(Object.fromEntries(empresas.map((g) => [g.cnpj, { ...base }])));
    }
  };

  const completas = empresas.every((g) => escolhasCompletas(rascunho[g.cnpj] ?? {}, aplicaveis[g.cnpj]));
  const faltam = empresas.reduce((n, g) => n + aplicaveis[g.cnpj].filter((id) => !escolhasCompletas(rascunho[g.cnpj] ?? {}, [id])).length, 0);

  const exportar = () => {
    const nomes = Object.fromEntries(empresas.map((g) => [g.cnpj, g.nome]));
    baixarTexto(exportarCriterios(rascunho, nomes), 'criterios-apuracao.json', 'application/json');
  };

  const importar = async (f: File) => {
    try {
      const lido = importarCriterios(await f.text());
      const dist = escolhasParaCarregadas(
        empresas.map((g) => g.cnpj),
        lido,
      );
      setRascunho((r) => {
        const novo = { ...r };
        for (const [c, e] of Object.entries(dist.porCnpj)) novo[c] = { ...e };
        return novo;
      });
      setMesmas(false);
      setAvisosImport([`Escolhas lidas de ${f.name}: nada vale até você clicar em "Confirmar critérios".`, ...lido.avisos, ...dist.avisos]);
      setErro(null);
    } catch (err) {
      setErro((err as Error)?.message ?? String(err));
    }
  };

  return (
    <PainelCriterios
      subtitulo="Estas escolhas dependem do caso: o editor não tem padrão para elas. Nada vem marcado."
      rodape={
        <>
          <button className="primario" disabled={!completas} onClick={() => aoConfirmar(rascunho, lembrar)} title={completas ? '' : `Falta responder ${faltam}`}>
            Confirmar critérios
          </button>
          {!completas && <span className="fraco">falta responder {faltam}</span>}
          <span className="espaco" />
          <button onClick={exportar} title="Salva as escolhas desta tela em JSON, para reaproveitar em outro trabalho">
            Exportar escolhas
          </button>
          <label className="botao-arquivo" title="Preenche a tela com escolhas salvas antes; você confere e confirma">
            Importar escolhas
            <input
              type="file"
              accept=".json,application/json"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) void importar(f);
                e.target.value = '';
              }}
            />
          </label>
          <button onClick={aoFechar}>Cancelar</button>
        </>
      }
    >
      {motivo && <div className="aviso alerta">{motivo}</div>}
      {avisosImport.length > 0 && (
        <div className="aviso info">
          <ul className="lista-erros">
            {avisosImport.map((a, i) => (
              <li key={i}>{a}</li>
            ))}
          </ul>
        </div>
      )}
      {erro && <div className="aviso erro">{erro}</div>}

      {varias && (
        <label className="linha-opcao">
          <input type="checkbox" checked={mesmas} onChange={(e) => ligarMesmas(e.target.checked)} />
          Usar as mesmas escolhas para todas as {empresas.length} empresas carregadas
        </label>
      )}

      {visiveis.map((g) => {
        const escolhas = (rascunho[g.cnpj] ?? {}) as Record<IdCriterio, ValorCriterio | undefined>;
        const ind = indicios[g.cnpj] ?? {};
        const periodos = g.meses.map((m) => m.periodo).sort();
        return (
          <section key={g.cnpj} className="criterios-empresa">
            <h4>
              {varias && mesmas ? `Todas as ${empresas.length} empresas` : `${g.nome} · ${cnpjLegivel(g.cnpj)}`}{' '}
              <span className="fraco">
                ({periodos.length === 1 ? periodoLegivel(periodos[0]) : `${periodoLegivel(periodos[0])} a ${periodoLegivel(periodos[periodos.length - 1])}`})
              </span>
            </h4>
            {CRITERIOS.map((c) => {
              const naoAplica = varias && mesmas ? (empresas.every((x) => motivoNaoAplica(c.id, x.meses)) ? motivoNaoAplica(c.id, g.meses) : null) : motivoNaoAplica(c.id, g.meses);
              if (naoAplica) {
                return (
                  <p key={c.id} className="fraco criterio-nao-aplica">
                    <strong>{ROTULO_CURTO[c.id]}:</strong> não se aplica — {naoAplica}
                  </p>
                );
              }
              const i = ind[c.id];
              const nome = `crit-${g.cnpj}-${c.id}`;
              return (
                <fieldset key={c.id} className={`criterio${escolhas[c.id] === undefined ? ' pendente' : ''}`}>
                  <legend>{c.pergunta}</legend>
                  <p className="fraco">{c.explicacao}</p>
                  {i && (
                    <p className="indicio">
                      <strong>O que o arquivo original indica</strong> (informação, não é aplicado):{' '}
                      {i.valor !== undefined && <>{rotuloEscolha(c.id, i.valor)}. </>}
                      {i.evidencia}
                    </p>
                  )}
                  {c.opcoes.map((o) => (
                    <label key={String(o.valor)} className="opcao-criterio">
                      <input type="radio" name={nome} checked={escolhas[c.id] === o.valor} onChange={() => escolher(g.cnpj, c.id, o.valor)} />
                      <span>
                        <strong>{o.rotulo}</strong>
                        <span className="fraco"> — {o.consequencia}</span>
                      </span>
                    </label>
                  ))}
                </fieldset>
              );
            })}
            {!(varias && mesmas) && (
              <label className="linha-opcao">
                <input
                  type="checkbox"
                  checked={lembrar.has(g.cnpj)}
                  onChange={(e) =>
                    setLembrar((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(g.cnpj);
                      else n.delete(g.cnpj);
                      return n;
                    })
                  }
                />
                Lembrar estas escolhas para esta empresa neste navegador (aparecem preenchidas para confirmar no próximo trabalho)
              </label>
            )}
          </section>
        );
      })}
    </PainelCriterios>
  );
}

export interface ResumoCriteriosProps {
  escrituracoes: Escrituracao[];
  config: ConfigApuracao;
  /** Abre a rotina; ausente = só leitura. */
  aoAlterar?: () => void;
  titulo?: string;
}

/** As escolhas feitas, por empresa (ou o que falta). */
export function ResumoCriterios({ escrituracoes, config, aoAlterar, titulo = 'Critérios da apuração' }: ResumoCriteriosProps) {
  const empresas = agrupar(escrituracoes);
  return (
    <div className="resumo-criterios" data-tour="criterios-apuracao">
      <div className="barra-secao">
        <strong>{titulo}</strong>
        <span className="espaco" />
        {aoAlterar && <button onClick={aoAlterar}>alterar</button>}
      </div>
      {empresas.map((g) => {
        const e = criteriosDe(config, g.cnpj) as Record<IdCriterio, ValorCriterio | undefined>;
        const aplic = criteriosExigidos(g.meses);
        return (
          <div key={g.cnpj}>
            {empresas.length > 1 && (
              <div className="fraco">
                {g.nome} · {cnpjLegivel(g.cnpj)}
              </div>
            )}
            <ul className="lista-criterios">
              {CRITERIOS.map((c) => (
                <li key={c.id}>
                  <span className="fraco">{ROTULO_CURTO[c.id]}:</span>{' '}
                  {!aplic.includes(c.id) ? (
                    <span className="fraco">não se aplica</span>
                  ) : e[c.id] === undefined ? (
                    <span className="etiqueta alerta">não escolhido</span>
                  ) : (
                    <strong>{rotuloEscolha(c.id, e[c.id])}</strong>
                  )}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}
