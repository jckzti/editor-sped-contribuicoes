/**
 * Texto com a marcação mínima do manual e do tour: **negrito**, `código` e
 * [texto](#id-da-secao), com realce opcional dos termos da busca.
 */
import { Fragment, type ReactNode } from 'react';
import { realcar } from './busca';

type Pedaco = { tipo: 'texto' | 'negrito' | 'codigo'; texto: string } | { tipo: 'link'; texto: string; alvo: string };

/** Quebra o texto nos pedaços de marcação (função pura, testada). */
export function interpretar(texto: string): Pedaco[] {
  const out: Pedaco[] = [];
  const re = /\*\*(.+?)\*\*|`([^`]+)`|\[([^\]]+)\]\(#([a-z0-9-]+)\)/g;
  let ultimo = 0;
  for (let m = re.exec(texto); m; m = re.exec(texto)) {
    if (m.index > ultimo) out.push({ tipo: 'texto', texto: texto.slice(ultimo, m.index) });
    if (m[1] !== undefined) out.push({ tipo: 'negrito', texto: m[1] });
    else if (m[2] !== undefined) out.push({ tipo: 'codigo', texto: m[2] });
    else out.push({ tipo: 'link', texto: m[3], alvo: m[4] });
    ultimo = m.index + m[0].length;
  }
  if (ultimo < texto.length) out.push({ tipo: 'texto', texto: texto.slice(ultimo) });
  return out;
}

export interface TextoRicoProps {
  texto: string;
  /** Termos da busca para realçar (já normalizados). */
  termos?: string[];
  /** Clique num link interno [texto](#secao). Sem isso, o link vira texto. */
  aoIrParaSecao?: (id: string) => void;
}

export function TextoRico({ texto, termos = [], aoIrParaSecao }: TextoRicoProps) {
  const marcar = (t: string): ReactNode =>
    realcar(t, termos).map((p, i) => (p.marca ? <mark key={i}>{p.texto}</mark> : <Fragment key={i}>{p.texto}</Fragment>));
  return (
    <>
      {interpretar(texto).map((p, i) => {
        if (p.tipo === 'negrito') return <strong key={i}>{marcar(p.texto)}</strong>;
        if (p.tipo === 'codigo') return <code key={i}>{marcar(p.texto)}</code>;
        if (p.tipo === 'link') {
          if (!aoIrParaSecao) return <Fragment key={i}>{marcar(p.texto)}</Fragment>;
          return (
            <a
              key={i}
              href={`#manual-${p.alvo}`}
              onClick={(ev) => {
                ev.preventDefault();
                aoIrParaSecao(p.alvo);
              }}
            >
              {marcar(p.texto)}
            </a>
          );
        }
        return <Fragment key={i}>{marcar(p.texto)}</Fragment>;
      })}
    </>
  );
}
