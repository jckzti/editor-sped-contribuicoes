/**
 * Aba Manual: índice lateral, busca no texto e uma âncora por seção (#manual-<id>).
 * O conteúdo está em `conteudoManual.ts`; este componente só desenha.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { buscarSecoes, termosDaBusca } from './busca';
import { GRUPOS, SECOES, type Bloco, type Secao } from './conteudoManual';
import { TextoRico } from './TextoRico';
import './ajuda.css';

export interface TelaManualProps {
  /** Seção para abrir (id de `conteudoManual.ts`). Também lê `#manual-<id>` do endereço. */
  secaoInicial?: string;
  /** Mostra o botão "Rever o tour guiado". */
  aoAbrirTour?: () => void;
}

const PREFIXO = 'manual-';

function idDoEndereco(): string | undefined {
  if (typeof location === 'undefined') return undefined;
  return location.hash.startsWith(`#${PREFIXO}`) ? decodeURIComponent(location.hash.slice(PREFIXO.length + 1)) : undefined;
}

function BlocoManual({ bloco, termos, ir }: { bloco: Bloco; termos: string[]; ir: (id: string) => void }) {
  const t = (texto: string) => <TextoRico texto={texto} termos={termos} aoIrParaSecao={ir} />;
  switch (bloco.tipo) {
    case 'p':
      return <p>{t(bloco.texto)}</p>;
    case 'subtitulo':
      return <h3>{t(bloco.texto)}</h3>;
    case 'lista':
      return (
        <ul>
          {bloco.itens.map((x, i) => (
            <li key={i}>{t(x)}</li>
          ))}
        </ul>
      );
    case 'passos':
      return (
        <ol>
          {bloco.itens.map((x, i) => (
            <li key={i}>{t(x)}</li>
          ))}
        </ol>
      );
    case 'alerta':
      return <div className={`aviso ${bloco.nivel === 'info' ? 'info' : 'alerta'} manual-alerta`}>{t(bloco.texto)}</div>;
    case 'tabela':
      return (
        <div className="manual-tabela">
          <table className="tabela compacta">
            <thead>
              <tr>
                {bloco.cabecalho.map((c, i) => (
                  <th key={i}>{c}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {bloco.linhas.map((l, i) => (
                <tr key={i}>
                  {l.map((c, k) => (
                    <td key={k}>{t(c)}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      );
  }
}

export function TelaManual({ secaoInicial, aoAbrirTour }: TelaManualProps) {
  const [busca, setBusca] = useState('');
  const [ativa, setAtiva] = useState<string>(secaoInicial ?? SECOES[0].id);
  const conteudo = useRef<HTMLDivElement>(null);

  const termos = useMemo(() => termosDaBusca(busca), [busca]);
  const achadas = useMemo(() => buscarSecoes(busca), [busca]);
  const visiveis = useMemo(() => new Set(achadas.map((s) => s.id)), [achadas]);

  const rolarPara = useCallback((id: string) => {
    const el = typeof document !== 'undefined' ? document.getElementById(PREFIXO + id) : null;
    if (!el) return;
    el.scrollIntoView({ block: 'start', behavior: 'smooth' });
    setAtiva(id);
    try {
      history.replaceState(null, '', `#${PREFIXO}${id}`);
    } catch {
      /* endereço não pode mudar (iframe sandbox): a rolagem basta */
    }
  }, []);

  /** Ir para uma seção (pelo índice ou por link interno). Se a busca a esconde, limpa a busca. */
  const ir = useCallback(
    (id: string) => {
      if (!SECOES.some((s) => s.id === id)) return;
      if (!visiveis.has(id)) {
        setBusca('');
        setTimeout(() => rolarPara(id), 0);
      } else rolarPara(id);
    },
    [visiveis, rolarPara],
  );

  // seção pedida ao abrir (prop ou endereço)
  useEffect(() => {
    const alvo = secaoInicial ?? idDoEndereco();
    if (alvo && SECOES.some((s) => s.id === alvo)) setTimeout(() => rolarPara(alvo), 0);
  }, [secaoInicial, rolarPara]);

  // índice acompanha a rolagem
  useEffect(() => {
    const raiz = conteudo.current;
    if (!raiz || typeof IntersectionObserver === 'undefined') return;
    const obs = new IntersectionObserver(
      (entradas) => {
        const topo = entradas.filter((e) => e.isIntersecting).sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (topo) setAtiva(topo.target.id.slice(PREFIXO.length));
      },
      { root: raiz, rootMargin: '0px 0px -70% 0px' },
    );
    raiz.querySelectorAll('section.manual-secao').forEach((s) => obs.observe(s));
    return () => obs.disconnect();
  }, [achadas]);

  return (
    <div className="manual">
      <nav className="manual-indice" aria-label="Índice do manual">
        <label className="oculto" htmlFor="manual-busca">
          Buscar no manual
        </label>
        <input
          id="manual-busca"
          type="search"
          placeholder="Buscar no manual (ex.: saldo credor, CST 98)…"
          value={busca}
          onChange={(e) => setBusca(e.target.value)}
        />
        {busca.trim() && (
          <p className="fraco manual-contagem" role="status">
            {achadas.length === 0 ? 'Nada encontrado.' : achadas.length === 1 ? '1 seção encontrada' : `${achadas.length} seções encontradas`}
          </p>
        )}
        {GRUPOS.map((g) => {
          const doGrupo = SECOES.filter((s) => s.grupo === g.id && visiveis.has(s.id));
          if (!doGrupo.length) return null;
          return (
            <div key={g.id} className="manual-grupo">
              <div className="manual-grupo-titulo">{g.titulo}</div>
              <ul>
                {doGrupo.map((s) => (
                  <li key={s.id}>
                    <a
                      href={`#${PREFIXO}${s.id}`}
                      className={ativa === s.id ? 'ativa' : undefined}
                      aria-current={ativa === s.id ? 'location' : undefined}
                      title={s.resumo}
                      onClick={(ev) => {
                        ev.preventDefault();
                        ir(s.id);
                      }}
                    >
                      {s.titulo}
                    </a>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
        {aoAbrirTour && (
          <button className="manual-tour" onClick={aoAbrirTour}>
            Rever o tour guiado
          </button>
        )}
      </nav>

      <div className="manual-conteudo" ref={conteudo}>
        {achadas.length === 0 && (
          <div className="aviso info">
            Nada encontrado para "{busca.trim()}". Tente outra palavra, um código de aviso (ex.: CREDITO_RETIDO) ou um registro (ex.: 0111).{' '}
            <button className="ligacao" onClick={() => setBusca('')}>
              limpar busca
            </button>
          </div>
        )}
        {achadas.map((s: Secao) => (
          <section key={s.id} id={PREFIXO + s.id} className="manual-secao" aria-labelledby={`${PREFIXO}${s.id}-titulo`}>
            <h2 id={`${PREFIXO}${s.id}-titulo`}>
              <TextoRico texto={s.titulo} termos={termos} />
              <a className="manual-ancora" href={`#${PREFIXO}${s.id}`} aria-label={`Endereço da seção ${s.titulo}`} onClick={(ev) => {
                ev.preventDefault();
                rolarPara(s.id);
              }}>
                #
              </a>
            </h2>
            <p className="manual-resumo fraco">
              <TextoRico texto={s.resumo} termos={termos} />
            </p>
            {s.blocos.map((b, i) => (
              <BlocoManual key={i} bloco={b} termos={termos} ir={ir} />
            ))}
          </section>
        ))}
      </div>
    </div>
  );
}
