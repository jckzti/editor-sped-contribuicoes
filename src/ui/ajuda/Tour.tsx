/**
 * Motor do tour guiado (sem biblioteca): destaca o elemento `data-tour` do passo com
 * um recorte que escurece o resto, posiciona o balão sem sair da tela, troca de aba
 * quando o passo pede, e funciona por teclado (→/Enter avança, ← volta, Esc fecha,
 * Tab fica dentro do balão).
 *
 * Âncora que não existe na tela não quebra nada: o passo aparece no centro.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { PassoTour, TelaTour } from './passosTour';
import { foraDaTela, posicionarBalao, recorte, type PosicaoBalao, type Retangulo } from './posicao';
import { TextoRico } from './TextoRico';
import './ajuda.css';

export interface TourProps {
  passos: PassoTour[];
  /** `concluiu` = chegou ao fim (false = pulou ou fechou). */
  aoFechar: (concluiu: boolean) => void;
  /** Troca de aba antes de mostrar o passo (o App passa a função que muda a aba). */
  aoIrPara?: (tela: TelaTour, passo: PassoTour) => void;
  /** Há arquivo carregado? Sem dados, o tour roda em modo demonstrativo. */
  temDados: boolean;
  /** "Ler no manual": abre a seção do manual (o tour fecha). */
  aoAbrirManual?: (secao: string) => void;
  /** Passo inicial. */
  inicio?: number;
}

/** Primeiro elemento visível com uma das âncoras, na ordem dada. */
export function acharAncora(ancoras: string[]): HTMLElement | null {
  if (typeof document === 'undefined') return null;
  for (const a of ancoras) {
    for (const el of document.querySelectorAll<HTMLElement>(`[data-tour="${CSS.escape(a)}"]`)) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && r.height > 0) return el;
    }
  }
  return null;
}

const tamanhoTela = () => ({ width: window.innerWidth, height: window.innerHeight });
const comoRetangulo = (r: DOMRect): Retangulo => ({ top: r.top, left: r.left, width: r.width, height: r.height });

export interface BalaoTourProps {
  passo: PassoTour;
  indice: number;
  total: number;
  temDados: boolean;
  destacado: boolean;
  aoVoltar: () => void;
  aoAvancar: () => void;
  aoPular: () => void;
  aoAbrirManual?: (secao: string) => void;
}

/** O balão em si (sem posição): separado para poder ser desenhado nos testes. */
export function BalaoTour({ passo, indice, total, temDados, destacado, aoVoltar, aoAvancar, aoPular, aoAbrirManual }: BalaoTourProps) {
  const ultimo = indice === total - 1;
  const texto = !temDados && passo.textoSemDados ? passo.textoSemDados : passo.texto;
  return (
    <>
      <div className="tour-topo">
        <span className="tour-contagem" aria-live="polite">
          {indice + 1} de {total}
        </span>
        {!temDados && <span className="tour-demo">modo demonstrativo</span>}
        <span className="espaco" />
        <button className="ligacao" onClick={aoPular}>
          Pular tour
        </button>
      </div>
      <h2 id="tour-titulo" className="tour-titulo">
        {passo.titulo}
      </h2>
      <p id="tour-texto" className="tour-texto">
        <TextoRico texto={texto} />
      </p>
      {!destacado && passo.ancoras.length > 0 && temDados && (
        <p className="tour-nota fraco">Este elemento aparece quando a tela estiver no ponto certo (por exemplo, com linhas selecionadas).</p>
      )}
      <div className="tour-rodape">
        {aoAbrirManual && passo.secaoManual && (
          <button className="ligacao" onClick={() => aoAbrirManual(passo.secaoManual!)}>
            Ler no manual
          </button>
        )}
        <span className="espaco" />
        <button onClick={aoVoltar} disabled={indice === 0}>
          Voltar
        </button>
        <button className="primario" onClick={aoAvancar} data-tour-proximo="">
          {ultimo ? 'Concluir' : 'Próximo'}
        </button>
      </div>
    </>
  );
}

export function Tour({ passos, aoFechar, aoIrPara, temDados, aoAbrirManual, inicio = 0 }: TourProps) {
  const [indice, setIndice] = useState(() => Math.min(Math.max(0, inicio), Math.max(0, passos.length - 1)));
  const [alvo, setAlvo] = useState<Retangulo | null>(null);
  const [pos, setPos] = useState<PosicaoBalao | null>(null);
  const [montado, setMontado] = useState(false);
  const balao = useRef<HTMLDivElement>(null);
  const elemento = useRef<HTMLElement | null>(null);
  const anterior = useRef<Element | null>(null);
  const passo = passos[indice];

  useEffect(() => {
    setMontado(true);
    anterior.current = document.activeElement;
    return () => (anterior.current as HTMLElement | null)?.focus?.();
  }, []);

  const medir = useCallback(() => {
    const el = elemento.current;
    setAlvo(el && el.isConnected ? comoRetangulo(el.getBoundingClientRect()) : null);
  }, []);

  // troca de passo: muda de aba, espera a tela desenhar e procura a âncora
  useEffect(() => {
    if (!passo) return;
    if (passo.tela && temDados && aoIrPara) aoIrPara(passo.tela, passo);
    elemento.current = null;
    setAlvo(null);
    // procura em intervalos curtos (não em quadros de animação, que o navegador segura
    // em aba de fundo): a aba nova leva alguns milissegundos para aparecer
    let tentativas = 0;
    let espera = 0;
    const procurar = () => {
      const el = acharAncora(passo.ancoras);
      if (el) {
        elemento.current = el;
        if (foraDaTela(comoRetangulo(el.getBoundingClientRect()), tamanhoTela())) el.scrollIntoView({ block: 'center', inline: 'nearest' });
        medir();
        return;
      }
      if (++tentativas < 25) espera = window.setTimeout(procurar, 40);
    };
    procurar();
    return () => window.clearTimeout(espera);
    // aoIrPara de fora pode mudar a cada render do App: o passo é que manda
  }, [indice, passo, temDados, medir]);

  // acompanha rolagem, redimensionamento e mudança de tamanho do elemento
  useEffect(() => {
    let quadro = 0;
    const agendar = () => {
      cancelAnimationFrame(quadro);
      quadro = requestAnimationFrame(medir);
    };
    window.addEventListener('resize', agendar);
    window.addEventListener('scroll', agendar, true);
    const obs = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(agendar) : null;
    if (elemento.current) obs?.observe(elemento.current);
    if (balao.current) obs?.observe(balao.current);
    return () => {
      cancelAnimationFrame(quadro);
      window.removeEventListener('resize', agendar);
      window.removeEventListener('scroll', agendar, true);
      obs?.disconnect();
    };
  }, [medir, alvo === null, montado]);

  // posiciona o balão depois de saber o tamanho dele
  useLayoutEffect(() => {
    const b = balao.current;
    if (!b) return;
    const tela = tamanhoTela();
    setPos(posicionarBalao(alvo ? recorte(alvo, tela) : null, { width: b.offsetWidth, height: b.offsetHeight }, tela));
  }, [alvo, indice, montado]);

  // foco no botão principal a cada passo (depois que o balão fica visível: elemento
  // escondido não recebe foco)
  const posicionado = pos !== null;
  useEffect(() => {
    if (posicionado) balao.current?.querySelector<HTMLElement>('[data-tour-proximo]')?.focus();
  }, [indice, posicionado]);

  const avancar = useCallback(() => {
    if (indice >= passos.length - 1) aoFechar(true);
    else setIndice(indice + 1);
  }, [indice, passos.length, aoFechar]);
  const voltar = useCallback(() => setIndice((i) => Math.max(0, i - 1)), []);
  const pular = useCallback(() => aoFechar(false), [aoFechar]);

  // teclado
  useEffect(() => {
    const tecla = (ev: KeyboardEvent) => {
      const dentro = !!balao.current && balao.current.contains(ev.target as Node);
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        ev.preventDefault();
        pular();
      } else if (ev.key === 'ArrowRight') {
        ev.preventDefault();
        avancar();
      } else if (ev.key === 'ArrowLeft') {
        ev.preventDefault();
        voltar();
      } else if (ev.key === 'Tab' && balao.current) {
        const focaveis = [...balao.current.querySelectorAll<HTMLElement>('button:not(:disabled), a[href]')];
        if (!focaveis.length) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (!dentro) {
          ev.preventDefault();
          primeiro.focus();
        } else if (!ev.shiftKey && document.activeElement === ultimo) {
          ev.preventDefault();
          primeiro.focus();
        } else if (ev.shiftKey && document.activeElement === primeiro) {
          ev.preventDefault();
          ultimo.focus();
        }
      }
    };
    document.addEventListener('keydown', tecla, true);
    return () => document.removeEventListener('keydown', tecla, true);
  }, [avancar, voltar, pular]);

  if (!montado || !passo || typeof document === 'undefined') return null;

  const tela = tamanhoTela();
  const r = alvo ? recorte(alvo, tela) : null;

  return createPortal(
    <div className="tour" data-lado={pos?.lado ?? 'centro'}>
      {/* bloqueia cliques na tela durante o tour; o recorte escurece tudo menos o elemento */}
      <div className={`tour-cortina${r ? ' com-recorte' : ''}`} onMouseDown={(ev) => ev.preventDefault()} />
      {r && <div className="tour-recorte" style={{ top: r.top, left: r.left, width: r.width, height: r.height }} />}
      <div
        ref={balao}
        className="tour-balao"
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-titulo"
        aria-describedby="tour-texto"
        style={pos ? { top: pos.top, left: pos.left } : { visibility: 'hidden', top: 0, left: 0 }}
      >
        <BalaoTour
          passo={passo}
          indice={indice}
          total={passos.length}
          temDados={temDados}
          destacado={!!r}
          aoVoltar={voltar}
          aoAvancar={avancar}
          aoPular={pular}
          aoAbrirManual={
            aoAbrirManual
              ? (secao) => {
                  aoFechar(false);
                  aoAbrirManual(secao);
                }
              : undefined
          }
        />
      </div>
    </div>,
    document.body,
  );
}
