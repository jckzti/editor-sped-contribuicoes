/**
 * Formulários das ações em lote, compartilhados entre o painel de seleção da grade
 * (aba Documentos) e o editor de regras (aba Regras).
 *
 * São só formulários: quem usa monta a ação com `montarAcaoTributacao` e chama a
 * prévia (`previsualizarAcoes` / `previsualizarRegra`) antes de aplicar.
 */
import { colunas, type TipoLinhaTodos } from '../core/linhas';
import { CSTS_SEM_VALOR } from '../core/edicao';
import { MODOS_BASE, type FormTributacao } from './acoes';
import { codigosEmOrdem, TABELA_CST, TABELA_NAT_BC_CRED } from './formato';

/** Tipos de linha cujos registros têm o campo NAT_BC_CRED. */
const TEM_NAT_BC: TipoLinhaTodos[] = ['frete', 'energia', 'f100', 'servico', 'imobDepreciacao', 'imobAquisicao'];
/** Tipos de linha cujos registros têm IND_ORIG_CRED (origem do crédito). */
const TEM_ORIG_CRED: TipoLinhaTodos[] = ['servico', 'imobDepreciacao', 'imobAquisicao'];

export interface FormularioTributacaoProps {
  tipo: TipoLinhaTodos;
  form: FormTributacao;
  aoMudar: (f: FormTributacao) => void;
}

export function FormularioTributacao({ tipo, form, aoMudar }: FormularioTributacaoProps) {
  const set = (m: Partial<FormTributacao>) => aoMudar({ ...form, ...m });
  const temNatBc = TEM_NAT_BC.includes(tipo);
  const cstSemValor = (c: string) => c && CSTS_SEM_VALOR.has(c);

  return (
    <div className="campos">
      <div className="campo">
        <label htmlFor="cst-pis">CST PIS</label>
        <select id="cst-pis" value={form.cstPis} onChange={(e) => set({ cstPis: e.target.value })}>
          <option value="">não alterar</option>
          {codigosEmOrdem(TABELA_CST).map(([cod, desc]) => (
            <option key={cod} value={cod}>
              {cod} — {desc}
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="cst-cofins">CST COFINS</label>
        <select id="cst-cofins" value={form.cstCofins} onChange={(e) => set({ cstCofins: e.target.value })}>
          <option value="">não alterar</option>
          {codigosEmOrdem(TABELA_CST).map(([cod, desc]) => (
            <option key={cod} value={cod}>
              {cod} — {desc}
            </option>
          ))}
        </select>
      </div>
      <div className="campo curto">
        <label htmlFor="aliq-pis">Alíquota PIS (%)</label>
        <input id="aliq-pis" type="text" placeholder="não alterar (ex.: 1,65)" value={form.aliqPis} onChange={(e) => set({ aliqPis: e.target.value })} />
      </div>
      <div className="campo curto">
        <label htmlFor="aliq-cofins">Alíquota COFINS (%)</label>
        <input id="aliq-cofins" type="text" placeholder="não alterar (ex.: 7,6)" value={form.aliqCofins} onChange={(e) => set({ aliqCofins: e.target.value })} />
      </div>
      <div className="campo">
        <label htmlFor="modo-base">Base de cálculo</label>
        <select id="modo-base" value={form.modoBase} onChange={(e) => set({ modoBase: e.target.value as FormTributacao['modoBase'] })}>
          {MODOS_BASE.map((m) => (
            <option key={m.valor} value={m.valor}>
              {m.rotulo}
            </option>
          ))}
        </select>
      </div>
      {form.modoBase === 'fixo' && (
        <div className="campo curto">
          <label htmlFor="base-valor">Valor da base (R$)</label>
          <input id="base-valor" type="text" placeholder="0,00" value={form.baseValor} onChange={(e) => set({ baseValor: e.target.value })} />
        </div>
      )}
      <div className="campo">
        <label htmlFor="nat-bc">Natureza da base do crédito</label>
        <select id="nat-bc" value={form.natBcCred} disabled={!temNatBc} onChange={(e) => set({ natBcCred: e.target.value })}>
          <option value="">não alterar</option>
          {codigosEmOrdem(TABELA_NAT_BC_CRED).map(([cod, desc]) => (
            <option key={cod} value={cod}>
              {cod} — {desc}
            </option>
          ))}
        </select>
        {!temNatBc && <span className="fraco">O item de nota (C170) não tem este campo: na apuração a base do crédito vem do CFOP.</span>}
      </div>
      {TEM_ORIG_CRED.includes(tipo) && (
        <div className="campo">
          <label htmlFor="orig-cred">Origem do crédito</label>
          <select id="orig-cred" value={form.indOrigCred} onChange={(e) => set({ indOrigCred: e.target.value as FormTributacao['indOrigCred'] })}>
            <option value="">não alterar</option>
            <option value="0">0 — operação no mercado interno</option>
            <option value="1">1 — operação de importação</option>
          </select>
        </div>
      )}
      <div className="campo">
        <label htmlFor="conta">Conta contábil</label>
        <input id="conta" type="text" placeholder="não alterar" value={form.conta} onChange={(e) => set({ conta: e.target.value })} />
      </div>
      <div className="campo">
        <label htmlFor="recalcular">Valor de PIS/COFINS</label>
        <select id="recalcular" value={form.recalcular} onChange={(e) => set({ recalcular: e.target.value as FormTributacao['recalcular'] })}>
          <option value="padrao">recalcular quando base ou alíquota mudarem</option>
          <option value="sempre">recalcular sempre (base × alíquota)</option>
          <option value="nunca">não recalcular</option>
        </select>
      </div>
      <div className="campo largura-total">
        <label className="linha-opcao">
          <input type="checkbox" checked={form.zerarSemCredito} onChange={(e) => set({ zerarSemCredito: e.target.checked })} />
          Zerar base, alíquota e valor quando o CST não gerar crédito nem débito
        </label>
        {(cstSemValor(form.cstPis) || cstSemValor(form.cstCofins)) && !form.zerarSemCredito && (
          <span className="fraco">O CST escolhido não gera crédito nem débito: marque a opção acima para zerar base, alíquota e valor.</span>
        )}
      </div>
    </div>
  );
}

export interface FormularioDefinirCampoProps {
  tipo: TipoLinhaTodos;
  campo: string;
  valor: string;
  aoMudar: (campo: string, valor: string) => void;
}

export function FormularioDefinirCampo({ tipo, campo, valor, aoMudar }: FormularioDefinirCampoProps) {
  const editaveis = colunas(tipo).filter((c) => c.editavel);
  const col = editaveis.find((c) => c.id === campo);
  const opcoes = col?.valores ? codigosEmOrdem(col.valores) : null;
  return (
    <div className="campos">
      <div className="campo">
        <label htmlFor="definir-campo">Campo</label>
        <select id="definir-campo" value={campo} onChange={(e) => aoMudar(e.target.value, '')}>
          <option value="">escolha o campo…</option>
          {editaveis.map((c) => (
            <option key={c.id} value={c.id}>
              {c.rotulo} ({c.id})
            </option>
          ))}
        </select>
      </div>
      <div className="campo">
        <label htmlFor="definir-valor">Novo valor</label>
        {opcoes ? (
          <select id="definir-valor" value={valor} onChange={(e) => aoMudar(campo, e.target.value)}>
            <option value="">escolha…</option>
            {opcoes.map(([cod, desc]) => (
              <option key={cod} value={cod}>
                {cod} — {desc}
              </option>
            ))}
          </select>
        ) : (
          <input
            id="definir-valor"
            type="text"
            value={valor}
            placeholder={col?.tipo === 'data' ? 'DD/MM/AAAA' : col?.tipo === 'numero' ? '0,00' : ''}
            onChange={(e) => aoMudar(campo, e.target.value)}
          />
        )}
        {col?.descricao && <span className="fraco">{col.descricao}</span>}
      </div>
    </div>
  );
}

export interface FormularioExcluirProps {
  tipo: TipoLinhaTodos;
  excluirNotaVazia: boolean;
  aoMudar: (v: boolean) => void;
}

export function FormularioExcluir({ tipo, excluirNotaVazia, aoMudar }: FormularioExcluirProps) {
  return (
    <div className="campos">
      {tipo === 'item' && (
        <div className="campo largura-total">
          <label className="linha-opcao">
            <input type="checkbox" checked={excluirNotaVazia} onChange={(e) => aoMudar(e.target.checked)} />
            Excluir também as notas que ficarem sem nenhum item
          </label>
          <span className="fraco">Uma nota (C100) sem item é recusada pelo PVA; deixe marcado, salvo se você vai incluir itens depois.</span>
        </div>
      )}
      {(tipo === 'frete' || tipo === 'energia') && (
        <p className="fraco">
          Documento com um só par de PIS/COFINS sai inteiro; com vários pares, sai só o par selecionado.
        </p>
      )}
      {tipo === 'nota' && <p className="fraco">A nota sai com todos os seus itens.</p>}
    </div>
  );
}
