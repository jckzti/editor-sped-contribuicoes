/**
 * Ponto de ligação do tour com o App: o botão "Tour guiado", o convite discreto
 * "O sistema mudou: ver o que há de novo" e a abertura automática na primeira visita.
 *
 * Uso no App (ver INTEGRACAO.md): <ControleTour temDados={...} aoIrPara={...} aoAbrirManual={...} />
 */
import { useCallback, useEffect, useState } from 'react';
import { marcarVisto, situacaoTour, versaoVista } from './memoriaTour';
import { NOVIDADES, PASSOS_TOUR, VERSAO_TOUR, type PassoTour, type TelaTour } from './passosTour';
import { Tour } from './Tour';
import './ajuda.css';

/**
 * Passos do "o que há de novo" para quem viu a versão `vista`: um passo de abertura
 * com o resumo das versões novas, seguido dos passos que mudaram. Sem registro de
 * novidades, devolve o tour inteiro.
 */
export function passosNovidades(vista: number, atual = VERSAO_TOUR, novidades = NOVIDADES, passos = PASSOS_TOUR): PassoTour[] {
  const resumos: string[] = [];
  const ids = new Set<string>();
  for (let v = vista + 1; v <= atual; v++) {
    const n = novidades[v];
    if (!n) continue;
    resumos.push(n.resumo);
    n.passos.forEach((id) => ids.add(id));
  }
  if (!resumos.length) return passos;
  const abertura: PassoTour = { id: 'novidades', titulo: 'O que há de novo', texto: resumos.join(' '), tela: null, ancoras: [] };
  return [abertura, ...passos.filter((p) => ids.has(p.id))];
}

export interface ControleTourProps {
  /** Há arquivo carregado (fora disso, o tour roda em modo demonstrativo). */
  temDados: boolean;
  /** Troca a aba do App. */
  aoIrPara?: (tela: TelaTour, passo: PassoTour) => void;
  /** Abre a aba Manual na seção pedida. */
  aoAbrirManual?: (secao: string) => void;
  /** Pedido externo para abrir o tour (ex.: botão do Manual): mude o número para abrir. */
  pedidoAbrir?: number;
  /** Só para a demonstração e os testes: versão do roteiro e novidades (padrão: as de passosTour.ts). */
  versaoAtual?: number;
  novidades?: typeof NOVIDADES;
}

export function ControleTour({ temDados, aoIrPara, aoAbrirManual, pedidoAbrir, versaoAtual = VERSAO_TOUR, novidades = NOVIDADES }: ControleTourProps) {
  const [situacao, setSituacao] = useState(() => situacaoTour(versaoAtual));
  const [passos, setPassos] = useState<PassoTour[] | null>(null);

  // primeira visita: abre sozinho
  useEffect(() => {
    if (situacao === 'primeira-vez') setPassos(PASSOS_TOUR);
    // só ao montar
  }, []);

  useEffect(() => {
    if (pedidoAbrir) setPassos(PASSOS_TOUR);
  }, [pedidoAbrir]);

  const fechar = useCallback(() => {
    marcarVisto(versaoAtual);
    setSituacao('em-dia');
    setPassos(null);
  }, [versaoAtual]);

  return (
    <>
      {situacao === 'novidades' && !passos && (
        <span className="tour-convite" role="status">
          <button className="ligacao" onClick={() => setPassos(passosNovidades(versaoVista(), versaoAtual, novidades))}>
            O sistema mudou: ver o que há de novo
          </button>
          <button className="ligacao tour-convite-fechar" onClick={fechar} aria-label="Dispensar o aviso de novidades" title="Dispensar">
            ×
          </button>
        </span>
      )}
      <button onClick={() => setPassos(PASSOS_TOUR)} data-tour="botao-tour" title="Mostra, passo a passo, como usar o sistema">
        Tour guiado
      </button>
      {passos && <Tour passos={passos} temDados={temDados} aoIrPara={aoIrPara} aoAbrirManual={aoAbrirManual} aoFechar={fechar} />}
    </>
  );
}
