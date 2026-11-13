/**
 * Caixa de diálogo simples: fundo escurecido, título, conteúdo e rodapé de botões.
 * Esc fecha, o foco vai para dentro ao abrir e volta ao fechar.
 */
import { useEffect, useRef } from 'react';

export interface DialogoProps {
  titulo: string;
  /** Texto pequeno abaixo do título. */
  subtitulo?: React.ReactNode;
  aoFechar: () => void;
  children: React.ReactNode;
  rodape?: React.ReactNode;
  /** "largo" para prévias com tabela. */
  tamanho?: 'normal' | 'largo';
}

export function Dialogo({ titulo, subtitulo, aoFechar, children, rodape, tamanho = 'normal' }: DialogoProps) {
  const caixa = useRef<HTMLDivElement>(null);
  const anterior = useRef<Element | null>(null);
  // `aoFechar` costuma ser uma função nova a cada renderização de quem usa o diálogo.
  // Guardada numa ref, o efeito abaixo roda uma vez só (ao abrir): se dependesse dela,
  // cada tecla digitada num campo refaria o efeito e tiraria o foco do campo (voltando
  // ao botão que abriu o diálogo e depois indo ao primeiro campo).
  const fecharRef = useRef(aoFechar);
  fecharRef.current = aoFechar;

  useEffect(() => {
    anterior.current = document.activeElement;
    const alvo = caixa.current?.querySelector<HTMLElement>('input, select, textarea, button');
    alvo?.focus();
    const tecla = (ev: KeyboardEvent) => {
      if (ev.key === 'Escape') {
        ev.stopPropagation();
        fecharRef.current();
      }
      if (ev.key === 'Tab' && caixa.current) {
        const focaveis = [...caixa.current.querySelectorAll<HTMLElement>('input, select, textarea, button, [tabindex]:not([tabindex="-1"])')].filter(
          (el) => !el.hasAttribute('disabled'),
        );
        if (!focaveis.length) return;
        const primeiro = focaveis[0];
        const ultimo = focaveis[focaveis.length - 1];
        if (!ev.shiftKey && document.activeElement === ultimo) {
          ev.preventDefault();
          primeiro.focus();
        } else if (ev.shiftKey && document.activeElement === primeiro) {
          ev.preventDefault();
          ultimo.focus();
        }
      }
    };
    document.addEventListener('keydown', tecla, true);
    return () => {
      document.removeEventListener('keydown', tecla, true);
      (anterior.current as HTMLElement | null)?.focus?.();
    };
  }, []);

  return (
    <div className="cortina" onMouseDown={(ev) => ev.target === ev.currentTarget && aoFechar()}>
      <div className={`dialogo${tamanho === 'largo' ? ' largo' : ''}`} role="dialog" aria-modal="true" aria-label={titulo} ref={caixa}>
        <div className="dialogo-topo">
          <div>
            <strong>{titulo}</strong>
            {subtitulo && <div className="fraco">{subtitulo}</div>}
          </div>
          <span className="espaco" />
          <button className="ligacao" onClick={aoFechar} aria-label="Fechar">
            fechar
          </button>
        </div>
        <div className="dialogo-corpo">{children}</div>
        {rodape && <div className="dialogo-rodape">{rodape}</div>}
      </div>
    </div>
  );
}
