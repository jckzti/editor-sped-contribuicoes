import { useState } from 'react';
import { fmtCentavos } from '../core/dec';
import { listar, type Escrituracao, type Registro } from '../core/modelo';
import { editarSaldoCredor, lerSaldoCredor, planejarSaldoCredor, saldoCredorEditado, TIPOS_CREDITO, type EdicaoSaldoCredor } from '../core/saldosCredores';
import { Dialogo } from './Dialogo';
import { brl, cnpjLegivel, periodoLegivel } from './formato';

const COLUNAS = [
  ['credito', 'Valor do crédito'],
  ['utilizadoAnterior', 'Utilizado em meses anteriores'],
  ['saldoAnterior', 'Saldo Anterior'],
  ['utilizadoMes', 'Utilizado no mês'],
  ['ressarcimento', 'Pedido de ressarcimento no mês'],
  ['saldo', 'Saldo a utilizar'],
] as const;
const CAMPOS_EDITAVEIS = COLUNAS.filter(
  (coluna): coluna is Exclude<typeof COLUNAS[number], readonly ['saldoAnterior' | 'saldo', string]> =>
    coluna[0] !== 'saldoAnterior' && coluna[0] !== 'saldo',
);

function EdicaoSaldo({ e, registro, aoFechar, mudou }: { e: Escrituracao; registro: Registro; aoFechar: () => void; mudou: () => void }) {
  const atual = lerSaldoCredor(e, registro);
  const [dados, setDados] = useState<EdicaoSaldoCredor>(() => ({
    periodo: atual.periodo, codigo: atual.codigo, credito: fmtCentavos(atual.credito),
    utilizadoAnterior: fmtCentavos(atual.utilizadoAnterior), utilizadoMes: fmtCentavos(atual.utilizadoMes),
    ressarcimento: fmtCentavos(atual.ressarcimento),
  }));
  const [falha, setFalha] = useState<string | null>(null);
  let previa: ReturnType<typeof planejarSaldoCredor> | null = null;
  let erro: string | null = null;
  try { previa = planejarSaldoCredor(e, registro, dados); }
  catch (ex) { erro = (ex as Error).message; }
  const mudar = (campo: keyof EdicaoSaldoCredor, valor: string) => {
    setDados((v) => ({ ...v, [campo]: valor }));
    setFalha(null);
  };
  const aplicar = () => {
    try {
      if (editarSaldoCredor(e, registro, dados)) mudou();
      aoFechar();
    } catch (ex) { setFalha((ex as Error).message); }
  };
  return <Dialogo titulo={'Editar crédito · ' + registro.reg} aoFechar={aoFechar} rodape={<>
    <button type="button" className="primario" disabled={!previa} onClick={aplicar}>Aplicar edição</button>
    <button type="button" onClick={aoFechar}>Cancelar</button>
  </>}>
    <div className="saldo-credor-campos">
      <label>Período do crédito<input type="month" value={dados.periodo} onChange={(ev) => mudar('periodo', ev.currentTarget.value)} /></label>
      <label>Tipo do crédito<select value={dados.codigo} onChange={(ev) => mudar('codigo', ev.currentTarget.value)}>
        {!Object.hasOwn(TIPOS_CREDITO, dados.codigo) && <option value={dados.codigo}>{dados.codigo || 'Escolha um tipo'}</option>}
        {Object.entries(TIPOS_CREDITO).map(([codigo, nome]) => <option key={codigo} value={codigo}>{codigo} · {nome}</option>)}
      </select></label>
      {CAMPOS_EDITAVEIS.map(([campo, rotulo]) => <label key={campo}>{rotulo}
        <input type="text" inputMode="decimal" value={dados[campo]} onChange={(ev) => mudar(campo, ev.currentTarget.value)} />
      </label>)}
    </div>
    <p className="fraco">Outras utilizações no mês: {brl(atual.outrasUtilizacoes)}</p>
    <p aria-live="polite"><strong>Saldo Anterior: {previa ? brl(previa.saldoAnterior) : '—'} · Saldo a utilizar: {previa ? brl(previa.saldo) : '—'}</strong></p>
    {(erro || falha) && <p className="aviso erro" role="alert">{falha ?? erro}</p>}
    <p className="fraco">O editor preserva a edição manual e deixa o recálculo do mês para o PVA. Confira o bloco M e os saldos dos meses seguintes.</p>
  </Dialogo>;
}

export function TelaSaldosCredores({ escrituracoes, mudou }: { escrituracoes: Escrituracao[]; mudou: () => void }) {
  const [mes, setMes] = useState('');
  const [tributo, setTributo] = useState<'1100' | '1500'>('1100');
  const [editar, setEditar] = useState<Registro | null>(null);
  const ordenadas = [...escrituracoes].sort((a, b) => a.periodo.localeCompare(b.periodo) || a.cnpj.localeCompare(b.cnpj));
  const e = ordenadas.find((x) => x.id === mes) ?? ordenadas[ordenadas.length - 1];
  if (!e) return <p className="fraco">Nenhum mês carregado.</p>;
  const identificar = new Set(ordenadas.map((x) => x.periodo)).size < ordenadas.length;
  const variasEmpresas = ordenadas.some((x) => x.cnpj !== e.cnpj);
  const linhas = listar(e, tributo).map((r, i) => ({ r, i, saldo: lerSaldoCredor(e, r) }))
    .sort((a, b) => a.saldo.periodo.localeCompare(b.saldo.periodo) || a.saldo.codigo.localeCompare(b.saldo.codigo));
  return <div className="apuracao" data-tour="saldos-credores">
    <div className="barra-secao envolve">
      <label>Mês da escrituração{' '}<select value={e.id} onChange={(ev) => { setMes(ev.currentTarget.value); setEditar(null); }}>
        {ordenadas.map((x) => <option key={x.id} value={x.id}>
          {periodoLegivel(x.periodo)}{variasEmpresas && ' · ' + x.nome + ' (' + cnpjLegivel(x.cnpj) + ')'}{identificar && ' · ' + x.nomeArquivo}
        </option>)}
      </select></label>
      <label>Tributo{' '}<select value={tributo} onChange={(ev) => { setTributo(ev.currentTarget.value === '1500' ? '1500' : '1100'); setEditar(null); }}>
        <option value="1100">PIS/Pasep (1100)</option><option value="1500">Cofins (1500)</option>
      </select></label>
    </div>
    {saldoCredorEditado(e) && <div className="aviso alerta" role="status">Este mês tem edição manual de saldo. Confira a apuração, os saldos seguintes e a consistência do arquivo no PVA.</div>}
    {linhas.length ? <div className="tabela-rolagem" role="region" aria-label="Saldos credores do mês" tabIndex={0}>
      <table className="tabela compacta">
        <thead><tr>
          <th scope="col">Período do crédito</th><th scope="col">Tipo do crédito</th>
          {COLUNAS.map(([campo, rotulo]) => <th key={campo} scope="col" className="num">{rotulo}</th>)}
          <th scope="col">Ação</th>
        </tr></thead>
        <tbody>{linhas.map(({ r, i, saldo }) => <tr key={i}>
          <th scope="row">{periodoLegivel(saldo.periodo)}</th>
          <td>{saldo.codigo} · {TIPOS_CREDITO[saldo.codigo] ?? 'Descrição indisponível'}</td>
          {COLUNAS.map(([campo]) => <td key={campo} className="num">{brl(saldo[campo])}</td>)}
          <td><button type="button" aria-label={'Editar crédito ' + saldo.codigo + ' de ' + periodoLegivel(saldo.periodo)} onClick={() => setEditar(r)}>Editar</button></td>
        </tr>)}</tbody>
        <tfoot><tr><th scope="row" colSpan={2}>Total do mês</th>
          {COLUNAS.map(([campo]) => <td key={campo} className="num forte">{brl(linhas.reduce((s, l) => s + l.saldo[campo], 0))}</td>)}
          <td />
        </tr></tfoot>
      </table>
    </div> : <p className="fraco">Nenhum registro {tributo} no mês selecionado.</p>}
    {editar && linhas.some((l) => l.r === editar) && <EdicaoSaldo e={e} registro={editar} aoFechar={() => setEditar(null)} mudou={mudou} />}
  </div>;
}
