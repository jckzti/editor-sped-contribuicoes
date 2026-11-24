/**
 * Tela inicial: receber os arquivos .txt da EFD-Contribuições.
 *
 * Só entrega os arquivos escolhidos a quem chamou; não sabe ler SPED.
 */
import { useRef, useState } from 'react';

export interface CarregarProps {
  aoEscolher: (arquivos: File[]) => void;
  /** Mostrado enquanto os arquivos estão sendo lidos. */
  carregando?: string | null;
  /** Já há arquivos carregados: a tela vira um painel menor. */
  compacto?: boolean;
}

export function Carregar({ aoEscolher, carregando, compacto }: CarregarProps) {
  const [sobre, setSobre] = useState(false);
  const input = useRef<HTMLInputElement>(null);

  const receber = (lista: FileList | null) => {
    if (!lista) return;
    const arquivos = [...lista].filter((f) => /\.txt$/i.test(f.name));
    if (arquivos.length) aoEscolher(arquivos);
  };

  return (
    <div
      className={`carregar${sobre ? ' sobre' : ''}${compacto ? ' compacto' : ''}`}
      data-tour="carregar-arquivos"
      onDragOver={(e) => {
        e.preventDefault();
        setSobre(true);
      }}
      onDragLeave={() => setSobre(false)}
      onDrop={(e) => {
        e.preventDefault();
        setSobre(false);
        receber(e.dataTransfer.files);
      }}
    >
      <input
        ref={input}
        type="file"
        multiple
        accept=".txt,text/plain"
        hidden
        onChange={(e) => {
          receber(e.target.files);
          e.target.value = '';
        }}
      />
      {carregando ? (
        <p className="estado">{carregando}</p>
      ) : (
        <>
          {!compacto && <h1>Editor SPED Contribuições</h1>}
          <p>
            {compacto ? 'Acrescentar mais meses' : 'Arraste aqui os arquivos .txt da escrituração'}
            {!compacto && <span className="fraco"> (um por mês, pode ser vários de uma vez)</span>}
          </p>
          <button className="primario" onClick={() => input.current?.click()}>
            Escolher arquivos
          </button>
          {!compacto && (
            <p className="fraco privacidade">
              Os arquivos são lidos pelo próprio navegador. Nada é enviado para servidor nenhum, e
              fechar esta aba apaga tudo.
            </p>
          )}
        </>
      )}
    </div>
  );
}
