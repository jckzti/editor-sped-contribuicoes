import { useEffect, useMemo, useState } from 'react';
import { cnpjLegivel, plural } from './formato';
import type { ArquivoCatalogo } from './persistencia';

interface Props {
  catalogo: ArquivoCatalogo[];
  carregando: string | null;
  restaurando: boolean;
  erro: string | null;
  errosArquivo: { nomeArquivo: string; mensagem: string }[];
  aoImportar: (arquivos: File[]) => void;
  aoAbrir: (ids: string[]) => void;
  aoLimparErro: () => void;
}

interface Empresa {
  cnpj: string;
  nome: string;
  arquivos: ArquivoCatalogo[];
}

function periodo(m: string): string {
  return m.length === 6 ? `${m.slice(0, 4)}-${m.slice(4)}` : m;
}

export function Biblioteca({ catalogo, carregando, restaurando, erro, errosArquivo, aoImportar, aoAbrir, aoLimparErro }: Props) {
  const [selecionados, setSelecionados] = useState<Record<string, string[]>>({});
  const [sobre, setSobre] = useState(false);
  const empresas = useMemo(() => {
    const grupos = new Map<string, Empresa>();
    for (const arquivo of catalogo) {
      const empresa = grupos.get(arquivo.cnpj) ?? { cnpj: arquivo.cnpj, nome: arquivo.empresa, arquivos: [] };
      empresa.arquivos.push(arquivo);
      grupos.set(arquivo.cnpj, empresa);
    }
    return [...grupos.values()].sort((a, b) => a.nome.localeCompare(b.nome) || a.cnpj.localeCompare(b.cnpj));
  }, [catalogo]);

  useEffect(() => {
    setSelecionados((atual) => {
      const novo = { ...atual };
      for (const e of empresas) {
        const idsAtuais = new Set(e.arquivos.map((a) => a.id));
        novo[e.cnpj] = (novo[e.cnpj] ?? []).filter((id) => idsAtuais.has(id));
      }
      return novo;
    });
  }, [empresas]);

  const alternar = (cnpj: string, id: string) => {
    setSelecionados((atual) => {
      const ids = atual[cnpj] ?? [];
      return { ...atual, [cnpj]: ids.includes(id) ? ids.filter((i) => i !== id) : [...ids, id] };
    });
  };

  return (
    <main className="biblioteca">
      <header className="biblioteca-topo">
        <div>
          <h1>Escolha a empresa e os períodos</h1>
          <p className="fraco">Marque os meses que vai trabalhar. Você pode abrir só um mês ou vários da mesma empresa.</p>
        </div>
      </header>

      <div
        className={`biblioteca-importar-area${sobre ? ' sobre' : ''}`}
        onDragOver={(e) => { e.preventDefault(); setSobre(true); }}
        onDragLeave={() => setSobre(false)}
        onDrop={(e) => {
          e.preventDefault();
          setSobre(false);
          if (!restaurando && !carregando) {
            const arquivos = [...e.dataTransfer.files].filter((f) => /\.txt$/i.test(f.name));
            if (arquivos.length) aoImportar(arquivos);
          }
        }}
      >
        <span>{carregando ?? 'Arraste arquivos .txt para cá ou'}</span>
        <label className="botao-arquivo biblioteca-importar" data-tour="carregar-arquivos">
          <span>Adicionar arquivos</span>
          <input
            type="file"
            multiple
            accept=".txt,text/plain"
            disabled={restaurando || !!carregando}
            onChange={(e) => {
              const arquivos = [...(e.target.files ?? [])];
              if (arquivos.length) aoImportar(arquivos);
              e.target.value = '';
            }}
          />
        </label>
      </div>

      {restaurando && <div className="aviso info">Lendo a lista de empresas salvas neste navegador...</div>}
      {erro && <div className="aviso alerta">{erro}</div>}
      {errosArquivo.length > 0 && (
        <div className="aviso erro">
          <strong>Arquivos que não puderam ser adicionados:</strong>
          <ul className="lista-erros">
            {errosArquivo.map((e, i) => <li key={`${e.nomeArquivo}-${i}`}><strong>{e.nomeArquivo}</strong>: {e.mensagem}</li>)}
          </ul>
          <button className="ligacao" onClick={aoLimparErro}>ok</button>
        </div>
      )}

      {!restaurando && empresas.length === 0 ? (
        <section className="biblioteca-vazia">
          <strong>Nenhum arquivo salvo ainda</strong>
          <span>Adicione arquivos .txt da EFD-Contribuições. Depois escolha a empresa e os meses nesta tela.</span>
        </section>
      ) : (
        <div className="biblioteca-lista">
          {empresas.map((e) => {
            const marcados = selecionados[e.cnpj] ?? [];
            const ids = e.arquivos.map((a) => a.id);
            const todos = ids.length > 0 && ids.every((id) => marcados.includes(id));
            return (
              <section className="biblioteca-empresa" key={e.cnpj}>
                <header>
                  <div>
                    <h2>{e.nome || 'Empresa sem nome'}</h2>
                    <span className="fraco">CNPJ {cnpjLegivel(e.cnpj)} · {plural(e.arquivos.length, 'período salvo', 'períodos salvos')}</span>
                  </div>
                  <div className="biblioteca-acoes">
                    <button onClick={() => setSelecionados((atual) => ({ ...atual, [e.cnpj]: todos ? [] : ids }))}>
                      {todos ? 'Limpar seleção' : 'Selecionar todos'}
                    </button>
                    <button className="primario" disabled={!marcados.length || !!carregando || restaurando} onClick={() => aoAbrir(marcados)}>
                      Abrir {marcados.length ? plural(marcados.length, 'período', 'períodos') : 'períodos'}
                    </button>
                  </div>
                </header>
                <div className="biblioteca-periodos">
                  {[...e.arquivos].sort((a, b) => b.periodo.localeCompare(a.periodo)).map((a) => (
                    <label key={a.id} className="biblioteca-periodo">
                      <input type="checkbox" checked={marcados.includes(a.id)} onChange={() => alternar(e.cnpj, a.id)} disabled={!!carregando || restaurando} />
                      <span>{periodo(a.periodo)}</span>
                      {a.alterada && <span className="etiqueta alerta">editado</span>}
                      {a.apuracaoDesatualizada && <span className="etiqueta desatualizada">apuração pendente</span>}
                    </label>
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
      <p className="fraco biblioteca-privacidade">Os arquivos permanecem neste navegador. Remover os dados do site nas configurações do navegador apaga a biblioteca.</p>
    </main>
  );
}
