/**
 * Construtor de filtros: coluna + operador + valor, vários filtros exigidos ao mesmo
 * tempo (E lógico), mais a busca livre. É o mesmo componente usado na aba Documentos
 * e no editor de regras.
 */
import { useMemo } from 'react';
import { coluna, colunas, OPERADORES, type Coluna, type Operador, type TipoLinhaTodos } from '../core/linhas';
import { filtroCompleto, novoFormFiltro, operadoresDaColuna, OPERADORES_SEM_VALOR, opcoesDaColuna, type FormFiltro } from './filtros';

const ROTULO_ORIGEM: Record<Coluna['origem'], string> = {
  escrituracao: 'Mês / estabelecimento',
  documento: 'Documento',
  participante: 'Participante',
  registro: 'Linha',
  complemento: 'PIS / COFINS',
  produto: 'Produto',
};

const ORDEM_ORIGEM: Coluna['origem'][] = ['escrituracao', 'documento', 'participante', 'registro', 'complemento', 'produto'];

export interface ConstrutorFiltrosProps {
  tipo: TipoLinhaTodos;
  filtros: FormFiltro[];
  aoMudar: (f: FormFiltro[]) => void;
  busca?: string;
  aoMudarBusca?: (t: string) => void;
  /** "1.234 de 6.921 linhas". */
  contagem?: { filtradas: number; total: number };
}

export function ConstrutorFiltros({ tipo, filtros, aoMudar, busca, aoMudarBusca, contagem }: ConstrutorFiltrosProps) {
  const grupos = useMemo(() => {
    const porOrigem = new Map<Coluna['origem'], Coluna[]>();
    for (const c of colunas(tipo)) {
      const lista = porOrigem.get(c.origem) ?? [];
      lista.push(c);
      porOrigem.set(c.origem, lista);
    }
    return ORDEM_ORIGEM.filter((o) => porOrigem.has(o)).map((o) => ({ origem: o, colunas: porOrigem.get(o)! }));
  }, [tipo]);

  const trocar = (i: number, mudanca: Partial<FormFiltro>) => {
    const novos = filtros.map((f, k) => (k === i ? { ...f, ...mudanca } : f));
    aoMudar(novos);
  };

  const acrescentar = () => aoMudar([...filtros, novoFormFiltro('periodo')]);
  const remover = (i: number) => aoMudar(filtros.filter((_, k) => k !== i));
  const limpar = () => {
    aoMudar([]);
    aoMudarBusca?.('');
  };

  const ativos = filtros.filter(filtroCompleto).length + (busca?.trim() ? 1 : 0);

  return (
    <div className="filtros" data-tour="filtros">
      {filtros.map((f, i) => {
        const col = coluna(tipo, f.coluna);
        const ops = operadoresDaColuna(col);
        const opcoes = opcoesDaColuna(col);
        const semValor = OPERADORES_SEM_VALOR.includes(f.op);
        const listaDeCodigos = !!opcoes && (f.op === 'igual' || f.op === 'diferente');
        return (
          <div className="filtro" key={f.id}>
            <label className="oculto" htmlFor={`col-${f.id}`}>
              Coluna do filtro {i + 1}
            </label>
            <select id={`col-${f.id}`} value={f.coluna} onChange={(e) => trocar(i, { coluna: e.target.value, valor: '', valor2: '' })}>
              {grupos.map((g) => (
                <optgroup key={g.origem} label={ROTULO_ORIGEM[g.origem]}>
                  {g.colunas.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.rotulo}
                    </option>
                  ))}
                </optgroup>
              ))}
            </select>
            <label className="oculto" htmlFor={`op-${f.id}`}>
              Operador do filtro {i + 1}
            </label>
            <select id={`op-${f.id}`} value={f.op} onChange={(e) => trocar(i, { op: e.target.value as Operador })}>
              {ops.map((o) => (
                <option key={o} value={o}>
                  {OPERADORES[o]}
                </option>
              ))}
            </select>
            {!semValor && (
              <>
                <label className="oculto" htmlFor={`val-${f.id}`}>
                  Valor do filtro {i + 1}
                </label>
                {listaDeCodigos ? (
                  <select id={`val-${f.id}`} className="largo" value={f.valor} onChange={(e) => trocar(i, { valor: e.target.value })}>
                    <option value="">escolha…</option>
                    {opcoes!.map((o) => (
                      <option key={o.codigo} value={o.codigo}>
                        {o.codigo} — {o.descricao}
                      </option>
                    ))}
                  </select>
                ) : (
                  <input
                    id={`val-${f.id}`}
                    type="text"
                    value={f.valor}
                    placeholder={f.op === 'em' ? 'lista separada por vírgula' : col?.tipo === 'data' ? 'DD/MM/AAAA' : ''}
                    onChange={(e) => trocar(i, { valor: e.target.value })}
                  />
                )}
                {f.op === 'entre' && (
                  <>
                    <span className="fraco">e</span>
                    <input
                      type="text"
                      aria-label={`Limite superior do filtro ${i + 1}`}
                      value={f.valor2}
                      onChange={(e) => trocar(i, { valor2: e.target.value })}
                    />
                  </>
                )}
              </>
            )}
            {opcoes && f.valor && opcoes.some((o) => o.codigo === f.valor) && !listaDeCodigos && (
              <span className="fraco">{opcoes.find((o) => o.codigo === f.valor)!.descricao}</span>
            )}
            <button className="ligacao" onClick={() => remover(i)} aria-label={`Remover filtro ${i + 1}`}>
              remover
            </button>
          </div>
        );
      })}
      <div className="filtro">
        <button onClick={acrescentar}>+ Filtro</button>
        {aoMudarBusca && (
          <>
            <label className="oculto" htmlFor="busca-livre">
              Busca livre
            </label>
            <input
              id="busca-livre"
              type="search"
              className="largo"
              placeholder="Buscar em qualquer texto ou código…"
              value={busca ?? ''}
              onChange={(e) => aoMudarBusca(e.target.value)}
            />
          </>
        )}
        {contagem && (
          <span className="fraco num">
            {contagem.filtradas.toLocaleString('pt-BR')} de {contagem.total.toLocaleString('pt-BR')} linhas
          </span>
        )}
        {ativos > 0 && (
          <button className="ligacao" onClick={limpar}>
            limpar filtros
          </button>
        )}
      </div>
    </div>
  );
}
