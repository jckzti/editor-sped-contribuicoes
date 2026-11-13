/**
 * Grade virtualizada: desenha só as linhas visíveis, para aguentar centenas de
 * milhares de registros (todos os meses carregados de uma vez).
 *
 * É genérica de propósito: não conhece SPED. Recebe a quantidade de linhas, as
 * colunas e funções para ler o valor de uma célula. Quem usa é `TelaGrade`.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { alternarSelecao, alternarTudo, selecionada, tamanhoSelecao, type SelecaoLinhas } from './selecao';

export interface ColunaGrade {
  id: string;
  rotulo: string;
  /** Alinhamento e formatação da célula. */
  tipo?: 'texto' | 'numero' | 'data' | 'codigo';
  largura?: number;
  editavel?: boolean;
  /** Dica exibida ao passar o mouse no cabeçalho. */
  ajuda?: string;
  /** O sistema recalcula esta coluna a partir de outras (marcada com ƒ no cabeçalho). */
  calculada?: boolean;
}

export type EstadoCelula = 'normal' | 'editada' | 'nova' | 'erro';

export interface GradeProps {
  colunas: ColunaGrade[];
  totalLinhas: number;
  /** Texto a exibir na célula (já formatado). */
  valor: (linha: number, colunaId: string) => string;
  /** Texto ao passar o mouse na célula (ex.: valor original do campo editado). */
  dica?: (linha: number, colunaId: string) => string | undefined;
  /** Valor que vai para a caixa de edição (padrão: o texto exibido). */
  valorEdicao?: (linha: number, colunaId: string) => string;
  /** Destaque da célula (campo alterado, registro novo, erro de validação). */
  estadoCelula?: (linha: number, colunaId: string) => EstadoCelula;
  /** Destaque da linha inteira (ex.: registro novo ou excluído). */
  estadoLinha?: (linha: number) => 'normal' | 'nova' | 'editada';
  selecao: SelecaoLinhas;
  aoMudarSelecao: (s: SelecaoLinhas) => void;
  /** Chamado ao confirmar a edição de uma célula. Devolva uma mensagem de erro para recusar. */
  aoEditar?: (linha: number, colunaId: string, valor: string) => string | void;
  /** Ordenação atual e troca ao clicar no cabeçalho. */
  ordem?: { coluna: string; desc: boolean } | null;
  aoOrdenar?: (coluna: string) => void;
  /** Linha de totais fixa no rodapé (por coluna). */
  rodape?: (colunaId: string) => string;
  alturaLinha?: number;
  /** Mensagem quando não há linhas. */
  vazio?: React.ReactNode;
}

// A regra de seleção (quem fica marcado a cada clique) é pura e vive em `selecao.ts`.
export { indicesSelecionados, selecaoVazia, selecionada, tamanhoSelecao, type SelecaoLinhas } from './selecao';

const LARGURA_PADRAO = 120;
const LARGURA_MARCADOR = 40;

export function Grade({
  colunas,
  totalLinhas,
  valor,
  dica,
  valorEdicao,
  estadoCelula,
  estadoLinha,
  selecao,
  aoMudarSelecao,
  aoEditar,
  ordem,
  aoOrdenar,
  rodape,
  alturaLinha = 28,
  vazio,
}: GradeProps) {
  const ref = useRef<HTMLDivElement>(null);
  const cabecalhoRef = useRef<HTMLDivElement>(null);
  const rodapeRef = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [altura, setAltura] = useState(600);
  const [larguras, setLarguras] = useState<Record<string, number>>({});
  const [editando, setEditando] = useState<{ linha: number; coluna: string; valor: string; erro?: string } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    const obs = new ResizeObserver(() => setAltura(el.clientHeight));
    obs.observe(el);
    setAltura(el.clientHeight);
    return () => obs.disconnect();
  }, []);

  // volta ao topo quando o conjunto de linhas muda de tamanho drasticamente (novo filtro)
  useEffect(() => {
    if (ref.current && scrollTop > totalLinhas * alturaLinha) {
      ref.current.scrollTop = 0;
      setScrollTop(0);
    }
  }, [totalLinhas, alturaLinha, scrollTop]);

  const larguraDe = useCallback(
    (c: ColunaGrade) => larguras[c.id] ?? c.largura ?? LARGURA_PADRAO,
    [larguras],
  );

  const larguraTotal = useMemo(
    () => colunas.reduce((s, c) => s + larguraDe(c), LARGURA_MARCADOR),
    [colunas, larguraDe],
  );

  const margem = 8;
  const primeira = Math.max(0, Math.floor(scrollTop / alturaLinha) - margem);
  const visiveis = Math.ceil(altura / alturaLinha) + margem * 2;
  const ultima = Math.min(totalLinhas, primeira + visiveis);

  /**
   * Seleção antes do último clique que mexeu nela. O duplo clique que abre a edição
   * de uma célula conta o primeiro clique como seleção; ao abrir a edição, volta a
   * seleção para o que era, para a linha não ficar marcada só por ter sido editada.
   */
  const antesDoClique = useRef<{ linha: number; selecao: SelecaoLinhas } | null>(null);

  const clicarLinha = (i: number, ev: React.MouseEvent) => {
    const alvo = ev.target as HTMLElement;
    const naCaixa = alvo.classList.contains('grade-caixa');
    // clique dentro da célula em edição (a caixa de texto) não mexe na seleção
    if (alvo.tagName === 'INPUT' && !naCaixa) return;
    // o segundo clique de um duplo clique já está tratado (edição); a caixa conta cada clique
    if (ev.detail > 1 && !naCaixa && !ev.shiftKey) return;
    antesDoClique.current = { linha: i, selecao };
    aoMudarSelecao(alternarSelecao(selecao, i, { shift: ev.shiftKey, total: totalLinhas }));
  };

  const abrirEdicao = (i: number, c: ColunaGrade) => {
    if (!c.editavel || !aoEditar) return;
    const antes = antesDoClique.current;
    if (antes && antes.linha === i) aoMudarSelecao(antes.selecao);
    antesDoClique.current = null;
    setEditando({ linha: i, coluna: c.id, valor: (valorEdicao ?? valor)(i, c.id) });
  };

  const marcarTudo = () => aoMudarSelecao(alternarTudo(selecao, totalLinhas));

  const confirmarEdicao = () => {
    if (!editando || !aoEditar) return setEditando(null);
    const erro = aoEditar(editando.linha, editando.coluna, editando.valor);
    if (erro) setEditando({ ...editando, erro });
    else setEditando(null);
  };

  const redimensionar = (id: string, ev: React.MouseEvent) => {
    ev.preventDefault();
    ev.stopPropagation();
    const x0 = ev.clientX;
    const l0 = larguras[id] ?? colunas.find((c) => c.id === id)?.largura ?? LARGURA_PADRAO;
    const mover = (e: MouseEvent) => setLarguras((l) => ({ ...l, [id]: Math.max(50, l0 + e.clientX - x0) }));
    const soltar = () => {
      window.removeEventListener('mousemove', mover);
      window.removeEventListener('mouseup', soltar);
    };
    window.addEventListener('mousemove', mover);
    window.addEventListener('mouseup', soltar);
  };

  const linhas = [];
  for (let i = primeira; i < ultima; i++) {
    const sel = selecionada(selecao, i);
    const est = estadoLinha?.(i) ?? 'normal';
    linhas.push(
      <div
        key={i}
        className={`grade-linha${sel ? ' sel' : ''}${est !== 'normal' ? ' l-' + est : ''}`}
        style={{ top: i * alturaLinha, height: alturaLinha }}
        onClick={(ev) => clicarLinha(i, ev)}
        // Shift + clique não pode também selecionar o texto entre as duas linhas
        onMouseDown={(ev) => {
          if (ev.shiftKey && (ev.target as HTMLElement).tagName !== 'INPUT') ev.preventDefault();
        }}
      >
        <div className="grade-celula marcador" style={{ width: LARGURA_MARCADOR }}>
          {/* o clique (do mouse ou da barra de espaço) sobe até a linha, que decide */}
          <input type="checkbox" className="grade-caixa" checked={sel} onChange={() => undefined} aria-label={`Selecionar a linha ${i + 1}`} />
        </div>
        {colunas.map((c) => {
          const editandoEsta = editando?.linha === i && editando.coluna === c.id;
          const ec = estadoCelula?.(i, c.id) ?? 'normal';
          return (
            <div
              key={c.id}
              className={`grade-celula t-${c.tipo ?? 'texto'}${ec !== 'normal' ? ' c-' + ec : ''}`}
              style={{ width: larguraDe(c) }}
              title={editandoEsta ? editando.erro : dica?.(i, c.id)}
              onDoubleClick={() => abrirEdicao(i, c)}
            >
              {editandoEsta ? (
                <input
                  autoFocus
                  className={editando.erro ? 'erro' : ''}
                  value={editando.valor}
                  onChange={(e) => setEditando({ ...editando, valor: e.target.value, erro: undefined })}
                  onBlur={confirmarEdicao}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') confirmarEdicao();
                    if (e.key === 'Escape') setEditando(null);
                  }}
                />
              ) : (
                valor(i, c.id)
              )}
            </div>
          );
        })}
      </div>,
    );
  }

  const marcadosTodos = totalLinhas > 0 && tamanhoSelecao(selecao, totalLinhas) === totalLinhas;

  return (
    <div className="grade" data-tour="grade">
      {editando?.erro && (
        <div className="aviso erro grade-erro-edicao" role="alert">
          <strong>Valor recusado:</strong> {editando.erro} <span className="fraco">(corrija e tecle Enter, ou Esc para cancelar)</span>
        </div>
      )}
      <div className="grade-cabecalho" ref={cabecalhoRef} style={{ width: larguraTotal }}>
        <div className="grade-celula marcador" data-tour="selecionar-tudo" style={{ width: LARGURA_MARCADOR }}>
          <input
            type="checkbox"
            checked={marcadosTodos}
            ref={(el) => {
              if (el) el.indeterminate = !marcadosTodos && tamanhoSelecao(selecao, totalLinhas) > 0;
            }}
            onChange={marcarTudo}
            aria-label="Selecionar todas as linhas filtradas"
            title="Selecionar tudo o que está filtrado"
          />
        </div>
        {colunas.map((c) => (
          <div
            key={c.id}
            className={`grade-celula cabecalho t-${c.tipo ?? 'texto'}${c.calculada ? ' calculada' : ''}`}
            style={{ width: larguraDe(c) }}
            title={c.ajuda ?? c.rotulo}
            onClick={() => aoOrdenar?.(c.id)}
          >
            <span>{c.calculada ? `ƒ ${c.rotulo}` : c.rotulo}</span>
            {ordem?.coluna === c.id && <span className="seta">{ordem.desc ? '▼' : '▲'}</span>}
            <span className="puxador" onMouseDown={(ev) => redimensionar(c.id, ev)} />
          </div>
        ))}
      </div>
      <div
        className="grade-corpo"
        ref={ref}
        onScroll={(e) => {
          const el = e.target as HTMLDivElement;
          setScrollTop(el.scrollTop);
          // cabeçalho e rodapé ficam fora da área de rolagem: acompanham o deslocamento lateral
          const x = `translateX(${-el.scrollLeft}px)`;
          if (cabecalhoRef.current) cabecalhoRef.current.style.transform = x;
          if (rodapeRef.current) rodapeRef.current.style.transform = x;
        }}
      >
        <div style={{ height: totalLinhas * alturaLinha, width: larguraTotal, position: 'relative' }}>{linhas}</div>
        {totalLinhas === 0 && <div className="grade-vazio">{vazio ?? 'Nenhuma linha.'}</div>}
      </div>
      {rodape && (
        <div className="grade-rodape" ref={rodapeRef} style={{ width: larguraTotal }}>
          <div className="grade-celula marcador" style={{ width: LARGURA_MARCADOR }} />
          {colunas.map((c) => (
            <div key={c.id} className={`grade-celula t-${c.tipo ?? 'texto'}`} style={{ width: larguraDe(c) }}>
              {rodape(c.id)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
