/**
 * Painel de ação em lote: aparece quando há linhas selecionadas na grade.
 *
 * Toda ação passa por uma PRÉVIA (quantas linhas, variação de PIS/COFINS por mês e
 * amostra antes/depois) antes de ser aplicada. Depois de aplicar, oferece salvar a
 * mesma ação como regra, para repetir em outros meses ou em outro cliente.
 */
import { useMemo, useState } from 'react';
import { exportarLinhasCsv } from '../core/csv';
import type { Coluna, LinhaQualquer, TipoLinhaTodos, Totais } from '../core/linhas';
import { diagnosticarBaseIcms } from '../core/edicao';
import { aplicarAcoes, previsualizarAcoes, type Acao, type ResultadoRegra } from '../core/regras';
import { formTributacaoVazia, formTributacaoVazio, montarAcaoTributacao, type FormTributacao } from './acoes';
import { Dialogo } from './Dialogo';
import { FormularioDefinirCampo, FormularioExcluir, FormularioTributacao } from './FormulariosAcao';
import { brl, brlSinal, inteiro } from './formato';
import { Previa } from './Previa';
import { baixarTexto } from './baixar';

type Qual = 'tributacao' | 'definirCampo' | 'excluir';

const TITULO: Record<Qual, string> = {
  tributacao: 'Alterar tributação',
  definirCampo: 'Definir campo',
  excluir: 'Excluir linhas',
};

export interface PainelLoteProps {
  tipo: TipoLinhaTodos;
  quantidade: number;
  /** Materializa as linhas selecionadas (só é chamada ao clicar). */
  linhasSelecionadas: () => LinhaQualquer[];
  /** Totais da seleção, quando foi possível calcular sem travar a tela. */
  totais: Totais | null;
  colunasVisiveis: Coluna[];
  aoLimpar: () => void;
  /**
   * Chamado depois de aplicar. Quem recebe sobe a versão e mostra o resultado: o
   * painel some junto com a seleção (que é refeita), então o aviso não pode ficar aqui.
   */
  aoAplicar: (resultado: ResultadoRegra, acoes: Acao[]) => void;
  /** Cadastro (participante, produto): sem "Alterar tributação" (o motor recusa). */
  cadastro?: boolean;
}

export function PainelLote({ tipo, quantidade, linhasSelecionadas, totais, colunasVisiveis, aoLimpar, aoAplicar, cadastro }: PainelLoteProps) {
  const [qual, setQual] = useState<Qual | null>(null);
  const [formTrib, setFormTrib] = useState<FormTributacao>(formTributacaoVazio);
  const [campo, setCampo] = useState('');
  const [valorCampo, setValorCampo] = useState('');
  const [excluirNotaVazia, setExcluirNotaVazia] = useState(true);
  const [previa, setPrevia] = useState<ResultadoRegra | null>(null);
  const [erro, setErro] = useState<string | null>(null);

  const acao = useMemo((): Acao | null => {
    if (qual === 'tributacao') return formTributacaoVazia(formTrib) ? null : montarAcaoTributacao(formTrib);
    if (qual === 'definirCampo') return campo ? { tipo: 'definirCampo', campo, valor: valorCampo } : null;
    if (qual === 'excluir') return { tipo: 'excluir', excluirNotaVazia };
    return null;
  }, [qual, formTrib, campo, valorCampo, excluirNotaVazia]);

  // Antes de tirar o ICMS da base: em quantos itens a base já está sem ICMS (o desconto do
  // ERP pode ser o próprio ICMS). Materializa a seleção só quando esse modo é escolhido.
  const modoIcms = qual === 'tributacao' && formTrib.modoBase === 'valor-item-menos-desconto-menos-icms' && (tipo === 'item' || tipo === 'nota');
  const diagnostico = useMemo(
    () => (modoIcms ? diagnosticarBaseIcms(linhasSelecionadas()) : null),
    // a seleção muda junto com `quantidade` (linhasSelecionadas é refeita a cada render)
    [modoIcms, quantidade],
  );

  const fechar = () => {
    setQual(null);
    setPrevia(null);
    setErro(null);
  };

  const abrir = (q: Qual) => {
    setQual(q);
    setPrevia(null);
    setErro(null);
  };

  const verPrevia = () => {
    if (!acao) return;
    try {
      setPrevia(previsualizarAcoes(linhasSelecionadas(), [acao]));
      setErro(null);
    } catch (err) {
      setErro((err as Error)?.message ?? String(err));
    }
  };

  const aplicar = () => {
    if (!acao) return;
    try {
      const r = aplicarAcoes(linhasSelecionadas(), [acao], `${TITULO[qual!]} em ${inteiro(quantidade)} linha(s)`);
      if (r.erros.length) {
        setErro(r.erros.join(' '));
        return;
      }
      fechar();
      aoAplicar(r, [acao]);
    } catch (err) {
      setErro((err as Error)?.message ?? String(err));
    }
  };

  const exportarCsv = () => {
    const linhas = linhasSelecionadas();
    const csv = exportarLinhasCsv(linhas, colunasVisiveis);
    baixarTexto(csv, `selecao_${tipo}_${linhas.length}_linhas.csv`, 'text/csv;charset=utf-8');
  };

  return (
    <div className="painel-lote" data-tour="painel-lote">
      <div className="barra-secao">
        <strong>
          {inteiro(quantidade)} {quantidade === 1 ? 'linha selecionada' : 'linhas selecionadas'}
        </strong>
        {cadastro ? null : totais ? (
          <span className="fraco num">
            base de PIS R$ {brl(totais.basePis)} · PIS R$ {brl(totais.valorPis)} · base de COFINS R$ {brl(totais.baseCofins)} · COFINS R${' '}
            {brl(totais.valorCofins)}
          </span>
        ) : (
          <span className="fraco">seleção grande: os totais da seleção não foram somados para não travar a tela</span>
        )}
        <span className="espaco" />
        {!cadastro && <button onClick={() => abrir('tributacao')}>Alterar tributação</button>}
        <button onClick={() => abrir('definirCampo')}>Definir campo</button>
        <button className="perigo" onClick={() => abrir('excluir')}>
          Excluir
        </button>
        <button onClick={exportarCsv}>Exportar seleção para CSV</button>
        <button className="ligacao" onClick={aoLimpar}>
          limpar seleção
        </button>
      </div>

      {qual && (
        <Dialogo
          titulo={TITULO[qual]}
          subtitulo={`${inteiro(quantidade)} linha(s) selecionada(s) em todos os meses carregados`}
          aoFechar={fechar}
          tamanho="largo"
          rodape={
            <>
              {previa && !previa.erros.length && (
                <button className="primario" onClick={aplicar}>
                  Aplicar
                </button>
              )}
              <button onClick={verPrevia} disabled={!acao}>
                {previa ? 'Atualizar prévia' : 'Ver prévia'}
              </button>
              <span className="espaco" />
              <button onClick={fechar}>Cancelar</button>
            </>
          }
        >
          {qual === 'tributacao' && (
            <FormularioTributacao
              tipo={tipo}
              form={formTrib}
              aoMudar={(f) => {
                setFormTrib(f);
                // a prévia mostrada deixou de valer: "Aplicar" só volta depois de ver a nova
                setPrevia(null);
              }}
            />
          )}
          {qual === 'definirCampo' && (
            <FormularioDefinirCampo
              tipo={tipo}
              campo={campo}
              valor={valorCampo}
              aoMudar={(c, v) => {
                setCampo(c);
                setValorCampo(v);
                setPrevia(null);
              }}
            />
          )}
          {qual === 'excluir' && (
            <>
              <div className="aviso alerta">
                Vão ser excluídas {inteiro(quantidade)} linha(s){tipo === 'item' && excluirNotaVazia ? ', e as notas que ficarem sem nenhum item' : ''}. Confira
                a prévia antes de aplicar; dá para desfazer depois.
              </div>
              <FormularioExcluir
                tipo={tipo}
                excluirNotaVazia={excluirNotaVazia}
                aoMudar={(v) => {
                  setExcluirNotaVazia(v);
                  setPrevia(null);
                }}
              />
            </>
          )}
          {diagnostico && diagnostico.itens > 0 && (
            <div className={`aviso ${diagnostico.baseJaExcluiIcms || diagnostico.descontoDiferenteIcms ? 'alerta forte' : 'info'}`}>
              <strong>Diagnóstico da base antes de tirar o ICMS</strong> ({inteiro(diagnostico.itens)} itens, {inteiro(diagnostico.comIcms)} com ICMS)
              <ul className="lista-erros">
                {diagnostico.baseJaExcluiIcms > 0 && (
                  <li>
                    Em <strong>{inteiro(diagnostico.baseJaExcluiIcms)}</strong> a base de PIS/COFINS atual <strong>já exclui o ICMS</strong>: a ação não muda esses
                    itens.
                  </li>
                )}
                {diagnostico.descontoIgualIcms > 0 && (
                  <li>
                    Em {inteiro(diagnostico.descontoIgualIcms)} o desconto do item (VL_DESC) é igual ao ICMS: o ERP grava o ICMS no desconto
                    {diagnostico.escrituracoesDescontoEhIcms > 0 && ` (padrão reconhecido em ${inteiro(diagnostico.escrituracoesDescontoEhIcms)} mês(es))`}.
                  </li>
                )}
                {diagnostico.descontoDiferenteIcms > 0 && (
                  <li>
                    Em <strong>{inteiro(diagnostico.descontoDiferenteIcms)}</strong> o desconto é diferente do ICMS: nesses a ação tira o desconto <em>e</em> o ICMS.
                  </li>
                )}
                <li>
                  A ação mudaria a base de <strong>{inteiro(diagnostico.mudariam)}</strong> item(ns) (variação da base {brlSinal(diagnostico.variacaoBase)}).
                </li>
              </ul>
            </div>
          )}
          {erro && <div className="aviso erro">{erro}</div>}
          {!acao && qual !== 'excluir' && <p className="fraco">Preencha o que deve ser alterado para ver a prévia.</p>}
          {previa && <Previa resultado={previa} tipo={tipo} />}
        </Dialogo>
      )}
    </div>
  );
}
