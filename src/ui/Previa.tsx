/**
 * Prévia de uma ação em lote ou de uma regra: quantas linhas, a variação de PIS e
 * COFINS mês a mês e a amostra antes/depois. Nada foi alterado ainda.
 */
import { Fragment } from 'react';
import { coluna, type TipoLinhaTodos } from '../core/linhas';
import type { ResultadoRegra } from '../core/regras';
import { textoAviso } from './apuracaoUi';
import { alvosDasColunas } from './celulas';
import { brl, brlSinal, inteiro, numeroLegivel, periodoLegivel } from './formato';

export interface PreviaProps {
  resultado: ResultadoRegra;
  tipo: TipoLinhaTodos;
}

/** Avisos vindos do motor numa prévia ou resultado de regra, em destaque. */
export function AvisosDoMotor({ avisos, titulo }: { avisos: readonly unknown[]; titulo: string }) {
  if (!avisos?.length) return null;
  return (
    <div className="aviso alerta forte" role="alert">
      <strong>
        {titulo} ({avisos.length})
      </strong>
      <ul className="lista-erros">
        {avisos.map((a, i) => (
          <li key={i}>{textoAviso(a)}</li>
        ))}
      </ul>
    </div>
  );
}

export function Previa({ resultado: r, tipo }: PreviaProps) {
  if (r.erros.length) {
    return (
      <div className="aviso erro">
        <strong>Não foi possível calcular a prévia:</strong>
        <ul className="lista-erros">
          {r.erros.map((e, i) => (
            <li key={i}>{e}</li>
          ))}
        </ul>
      </div>
    );
  }

  const meses = r.porEscrituracao.filter((p) => p.linhas > 0);
  // valores da amostra no mesmo formato da grade (milhar e duas casas)
  const alvos = alvosDasColunas(tipo === 'nota' ? 'item' : tipo);
  const fmt = (c: string, v: string) => (alvos.get(c)?.dec ? numeroLegivel(v) : v);
  const semEfeito = r.linhas === 0;
  // cadastro (participante, produto) não tem PIS/COFINS: só a contagem e a amostra
  const cadastro = tipo === 'participante' || tipo === 'produto';

  return (
    <div className="previa" data-tour="previa">
      {/* Avisos do motor primeiro: são o que pode mudar a decisão de aplicar (ex.: base que já exclui o ICMS). */}
      <AvisosDoMotor avisos={r.avisos} titulo="Atenção antes de aplicar" />

      {semEfeito ? (
        <div className="aviso alerta">Nenhuma linha atende ao filtro: nada seria alterado.</div>
      ) : (
        <div className="cartoes">
          {/* Sem verde/vermelho: nas entradas o valor é crédito (subir é bom), nas saídas é débito (subir é ruim). */}
          <div className="cartao">
            <span className="rotulo">Linhas afetadas</span>
            <strong className="num">{inteiro(r.linhas)}</strong>
            <span className="fraco">
              em {meses.length} {meses.length === 1 ? 'mês' : 'meses'}
              {r.excluidas > 0 && ` · ${inteiro(r.excluidas)} excluída(s)`}
            </span>
          </div>
{!cadastro && (
          <>
          <div className="cartao">
            <span className="rotulo" title="Soma do valor de PIS das linhas: nas entradas é crédito, nas saídas é débito. O efeito no valor a recolher aparece na aba Apuração, depois de recalcular.">
              Variação do valor de PIS nas linhas
            </span>
            <strong className="num">{brlSinal(r.delta.valorPis)}</strong>
            <span className="fraco">base {brlSinal(r.delta.basePis)}</span>
          </div>
          <div className="cartao">
            <span className="rotulo" title="Soma do valor de COFINS das linhas: nas entradas é crédito, nas saídas é débito. O efeito no valor a recolher aparece na aba Apuração, depois de recalcular.">
              Variação do valor de COFINS nas linhas
            </span>
            <strong className="num">{brlSinal(r.delta.valorCofins)}</strong>
            <span className="fraco">base {brlSinal(r.delta.baseCofins)}</span>
          </div>
          </>
          )}
        </div>
      )}

      {!cadastro && meses.length > 0 && (
        <>
          <h4>Efeito por mês</h4>
          <div className="tabela-rolagem baixa">
            <table className="tabela compacta">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th className="num">Linhas</th>
                  <th className="num">Excluídas</th>
                  <th className="num">Base PIS</th>
                  <th className="num">PIS</th>
                  <th className="num">Base COFINS</th>
                  <th className="num">COFINS</th>
                </tr>
              </thead>
              <tbody>
                {meses.map((p) => (
                  <tr key={p.escrituracaoId}>
                    <td>{periodoLegivel(p.periodo)}</td>
                    <td className="num">{inteiro(p.linhas)}</td>
                    <td className="num">{p.excluidas ? inteiro(p.excluidas) : <span className="fraco">—</span>}</td>
                    <td className="num">{brlSinal(p.delta.basePis)}</td>
                    <td className="num">{brlSinal(p.delta.valorPis)}</td>
                    <td className="num">{brlSinal(p.delta.baseCofins)}</td>
                    <td className="num">{brlSinal(p.delta.valorCofins)}</td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <th>Total</th>
                  <th className="num">{inteiro(r.linhas)}</th>
                  <th className="num">{r.excluidas ? inteiro(r.excluidas) : '—'}</th>
                  <th className="num">{brlSinal(r.delta.basePis)}</th>
                  <th className="num">{brlSinal(r.delta.valorPis)}</th>
                  <th className="num">{brlSinal(r.delta.baseCofins)}</th>
                  <th className="num">{brlSinal(r.delta.valorCofins)}</th>
                </tr>
              </tfoot>
            </table>
          </div>
        </>
      )}

      {r.amostra.length > 0 && (
        <>
          <h4>Amostra: antes e depois ({r.amostra.length} primeiras linhas)</h4>
          <div className="tabela-rolagem baixa">
            <table className="tabela compacta">
              <thead>
                <tr>
                  <th>Mês</th>
                  <th>Documento</th>
                  <th />
                  {r.colunasAmostra.map((c) => (
                    <th key={c} className="num">
                      {coluna(tipo === 'nota' ? 'item' : tipo, c)?.rotulo ?? c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {r.amostra.map((a, i) => (
                  <Fragment key={i}>
                    <tr className="amostra-antes">
                      <td rowSpan={2}>{periodoLegivel(a.periodo)}</td>
                      <td rowSpan={2}>{a.documento}</td>
                      <td className="fraco">antes</td>
                      {r.colunasAmostra.map((c) => (
                        <td key={c} className="num">
                          {fmt(c, a.antes[c] ?? '')}
                        </td>
                      ))}
                    </tr>
                    <tr className="amostra-depois">
                      <td className="fraco">{a.excluida ? 'excluída' : 'depois'}</td>
                      {r.colunasAmostra.map((c) => {
                        const antes = a.antes[c] ?? '';
                        const depois = a.depois[c] ?? '';
                        const mudou = !a.excluida && antes !== depois;
                        return (
                          <td key={c} className={`num${mudou ? ' mudou' : ''}`}>
                            {a.excluida ? <span className="fraco">—</span> : fmt(c, depois)}
                          </td>
                        );
                      })}
                    </tr>
                  </Fragment>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
      {!semEfeito && !cadastro && (
        <p className="fraco">
          Base de PIS depois: {brl(r.porEscrituracao.reduce((s, p) => s + p.depois.basePis, 0))} (antes{' '}
          {brl(r.porEscrituracao.reduce((s, p) => s + p.antes.basePis, 0))}).
        </p>
      )}
    </div>
  );
}
