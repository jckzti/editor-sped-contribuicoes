/**
 * Página de demonstração (SÓ desenvolvimento): http://localhost:5173/src/ui/ajuda/demo.html
 *
 * Monta o App real e simula a integração sem tocar nos arquivos dele: põe os
 * `data-tour` pelo DOM (seletores de `integracao.ts`), troca de aba clicando nos botões
 * e mostra o Manual num painel por cima. Não entra no build (o build só usa index.html).
 */
import { useCallback, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from '../App';
import '../estilo.css';
import { ControleTour } from './ControleTour';
import { ANCORAS_PENDENTES } from './integracao';
import { CHAVE_TOUR } from './memoriaTour';
import { VERSAO_TOUR, type TelaTour } from './passosTour';
import { TelaManual } from './TelaManual';

if (!import.meta.env.DEV) throw new Error('A demonstração do tour só roda em desenvolvimento.');

const ROTULO_ABA: Record<Exclude<TelaTour, 'manual'>, string> = {
  documentos: 'Documentos',
  regras: 'Regras',
  apuracao: 'Apuração',
  conferencia: 'Conferência',
};

/** Põe os atributos que a integração vai pôr no código. */
function aplicarAncoras() {
  for (const a of ANCORAS_PENDENTES) {
    document.querySelectorAll(a.seletorDemo).forEach((el) => {
      if (el.getAttribute('data-tour') !== a.ancora) el.setAttribute('data-tour', a.ancora);
    });
  }
}

function Demonstracao() {
  const [manual, setManual] = useState<string | null>(null);
  const [temDados, setTemDados] = useState(false);
  const [pedido, setPedido] = useState(0);
  const [simularNovidade, setSimularNovidade] = useState(false);
  const [chave, setChave] = useState(0);

  useEffect(() => {
    const atualizar = () => {
      aplicarAncoras();
      setTemDados(!!document.querySelector('.barra .resumo-carga'));
    };
    atualizar();
    const obs = new MutationObserver(atualizar);
    obs.observe(document.body, { childList: true, subtree: true });
    return () => obs.disconnect();
  }, []);

  const irPara = useCallback((t: TelaTour) => {
    if (t === 'manual') {
      setManual('o-que-e');
      return;
    }
    setManual(null);
    const botao = [...document.querySelectorAll<HTMLButtonElement>('.abas button')].find((b) => b.textContent === ROTULO_ABA[t]);
    botao?.click();
  }, []);

  const reiniciar = (versaoVista: number | null) => {
    try {
      if (versaoVista === null) localStorage.removeItem(CHAVE_TOUR);
      else localStorage.setItem(CHAVE_TOUR, JSON.stringify({ versaoVista }));
    } catch {
      /* sem armazenamento */
    }
    setSimularNovidade(versaoVista !== null);
    setChave((k) => k + 1);
  };

  return (
    <>
      <App />
      <div className="demo-ajuda" style={{ position: 'fixed', left: 8, bottom: 8, zIndex: 900, display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap', background: '#fffbe8', border: '1px solid #e0a800', borderRadius: 8, padding: '4px 8px', fontSize: 12 }}>
        <strong>Demonstração (só dev)</strong>
        <ControleTour
          key={chave}
          temDados={temDados}
          aoIrPara={irPara}
          aoAbrirManual={(s) => setManual(s)}
          pedidoAbrir={pedido}
          versaoAtual={simularNovidade ? VERSAO_TOUR + 1 : VERSAO_TOUR}
          novidades={simularNovidade ? { [VERSAO_TOUR + 1]: { resumo: 'Exemplo de novidade: o passo de filtrar ganhou um texto novo.', passos: ['filtrar'] } } : undefined}
        />
        <button data-demo="aba-manual" onClick={() => setManual(manual ? null : 'o-que-e')}>
          Manual
        </button>
        <button className="ligacao" onClick={() => reiniciar(null)} title="Apaga a marca de tour visto e remonta: o tour abre sozinho">
          primeira visita
        </button>
        <button className="ligacao" onClick={() => reiniciar(VERSAO_TOUR)} title="Finge que o roteiro subiu de versão: aparece o convite">
          simular novidade
        </button>
      </div>
      {manual && (
        <div style={{ position: 'fixed', inset: '48px 0 0 0', zIndex: 800, background: 'var(--fundo)', display: 'flex', flexDirection: 'column', padding: '10px 12px' }}>
          <div style={{ display: 'flex', marginBottom: 8 }}>
            <strong>Manual</strong>
            <span className="espaco" />
            <button onClick={() => setManual(null)}>Fechar o manual</button>
          </div>
          <TelaManual key={manual} secaoInicial={manual} aoAbrirTour={() => setPedido((n) => n + 1)} />
        </div>
      )}
    </>
  );
}

// a recarga a quente reexecuta este módulo: reaproveita a raiz em vez de criar outra
const global = window as unknown as { __raizDemoAjuda?: ReturnType<typeof createRoot> };
global.__raizDemoAjuda ??= createRoot(document.getElementById('root')!);
global.__raizDemoAjuda.render(<Demonstracao />);
