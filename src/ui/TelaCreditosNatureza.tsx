import { Fragment, useMemo, useState } from 'react';
import type { IdTributo } from '../core/apuracao/tributos';
import type { Escrituracao } from '../core/modelo';
import { creditosPorNatureza, type ValoresCredito } from './creditosNatureza';
import { brl, brlSinal, cnpjLegivel, periodoLegivel } from './formato';

function Valores({ base, credito, ajuste }: ValoresCredito) {
  return <>
    <td className="num">{base === null ? '—' : brl(base)}</td>
    <td className="num">{brl(credito)}</td>
    <td className="num">{brlSinal(ajuste)}</td>
    <td className="num forte">{brl(credito + ajuste)}</td>
  </>;
}

export function TelaCreditosNatureza({ escrituracoes, versao }: { escrituracoes: Escrituracao[]; versao: number }) {
  const [escolha, setEscolha] = useState('');
  const [tributo, setTributo] = useState<IdTributo>('pis');
  const [abertas, setAbertas] = useState<ReadonlySet<string>>(() => new Set());
  const ordenadas = useMemo(() => [...escrituracoes].sort((a, b) => a.periodo.localeCompare(b.periodo) || a.cnpj.localeCompare(b.cnpj)), [escrituracoes]);
  const e = ordenadas.find((m) => m.id === escolha) ?? ordenadas[ordenadas.length - 1];
  const linhas = useMemo(() => e ? creditosPorNatureza(e, tributo) : [], [e, tributo, versao]);
  const total = linhas.reduce<ValoresCredito>((s, linha) => ({
    base: linha.base === null ? s.base : (s.base ?? 0) + linha.base,
    credito: s.credito + linha.credito,
    ajuste: s.ajuste + linha.ajuste,
  }), { base: null, credito: 0, ajuste: 0 });
  const multiempresa = ordenadas.some((m) => m.cnpj !== e?.cnpj);
  const periodosRepetidos = new Set(ordenadas.map((m) => m.periodo)).size !== ordenadas.length;

  return (
    <div className="apuracao">
      <div className="barra-secao envolve">
        <label>Mês{' '}
          <select value={e?.id ?? ''} onChange={(ev) => setEscolha(ev.currentTarget.value)}>
            {ordenadas.map((m) => <option key={m.id} value={m.id}>
              {periodoLegivel(m.periodo)}
              {multiempresa && ' · ' + m.nome + ' (' + cnpjLegivel(m.cnpj) + ')'}
              {periodosRepetidos && ' · ' + m.nomeArquivo}
            </option>)}
          </select>
        </label>
        <label>Tributo{' '}
          <select value={tributo} onChange={(ev) => setTributo(ev.currentTarget.value === 'cofins' ? 'cofins' : 'pis')}>
            <option value="pis">PIS/Pasep</option>
            <option value="cofins">Cofins</option>
          </select>
        </label>
      </div>
      {linhas.length > 0 ? (
        <div className="tabela-rolagem" role="region" aria-label="Créditos por natureza" tabIndex={0}>
          <table className="tabela compacta">
            <caption className="fraco">Valores em R$ para {e && periodoLegivel(e.periodo)}</caption>
            <thead><tr>
              <th scope="col">Código</th>
              <th scope="col">Natureza da base de cálculo</th>
              <th scope="col" className="num">Base de cálculo</th>
              <th scope="col" className="num">Crédito</th>
              <th scope="col" className="num">Ajuste</th>
              <th scope="col" className="num">Crédito ajustado</th>
            </tr></thead>
            <tbody>{linhas.map((linha) => {
              const aberta = abertas.has(linha.codigo);
              return <Fragment key={linha.codigo}>
                <tr>
                  <th scope="row">{linha.codigo ? (
                    <button type="button" aria-label={linha.codigo + ' ' + linha.descricao + ' por CST'} aria-expanded={aberta}
                      onClick={() => setAbertas((v) => {
                        const novo = new Set(v);
                        if (novo.has(linha.codigo)) novo.delete(linha.codigo);
                        else novo.add(linha.codigo);
                        return novo;
                      })}>{aberta ? '▾' : '▸'} {linha.codigo}</button>
                  ) : '—'}</th>
                  <td>{linha.descricao}</td>
                  <Valores {...linha} />
                </tr>
                {aberta && linha.csts.map((v) => <tr className="credito-natureza-cst" key={v.cst}>
                  <th scope="row" colSpan={2}>{v.cst ? 'CST ' + v.cst : v.credito || v.base !== null ? 'Sem CST identificado' : 'Ajuste sem CST identificado'}</th>
                  <Valores {...v} />
                </tr>)}
              </Fragment>;
            })}</tbody>
            <tfoot><tr>
              <th scope="row" colSpan={2}>Total do mês</th>
              <Valores {...total} />
            </tr></tfoot>
          </table>
        </div>
      ) : <p className="fraco">Nenhum crédito escriturado para o mês e o tributo selecionados.</p>}
    </div>
  );
}
