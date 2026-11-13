/**
 * Ponte entre os formulários de ação em lote (tributação, definir campo, excluir) e
 * os tipos `Acao` do motor, mais o resumo das ações e das regras em português.
 *
 * Funções puras, testadas em `acoes.test.ts`.
 */
import type { AcaoTributacao, ModoBase } from '../core/edicao';
import { coluna, type TipoLinhaTodos } from '../core/linhas';
import type { Acao, Regra } from '../core/regras';
import { resumirFiltros } from './filtros';
import { descricaoNatBcCred, ROTULO_TIPO } from './formato';

/** Modo da base no formulário ("fixo" = o usuário digita o valor). */
export type ModoBaseForm = 'manter' | 'valor-item' | 'valor-item-menos-desconto' | 'valor-item-menos-desconto-menos-icms' | 'zero' | 'fixo';

export const MODOS_BASE: { valor: ModoBaseForm; rotulo: string }[] = [
  { valor: 'manter', rotulo: 'Não alterar a base' },
  { valor: 'valor-item', rotulo: 'Valor do item' },
  { valor: 'valor-item-menos-desconto', rotulo: 'Valor do item menos o desconto' },
  { valor: 'valor-item-menos-desconto-menos-icms', rotulo: 'Valor do item menos desconto e ICMS' },
  { valor: 'zero', rotulo: 'Zero' },
  { valor: 'fixo', rotulo: 'Valor fixo (digitar)' },
];

export const ROTULO_MODO_BASE: Record<ModoBaseForm, string> = Object.fromEntries(
  MODOS_BASE.map((m) => [m.valor, m.rotulo]),
) as Record<ModoBaseForm, string>;

/** Formulário de "Alterar tributação". Campo vazio = não alterar. */
export interface FormTributacao {
  cstPis: string;
  cstCofins: string;
  aliqPis: string;
  aliqCofins: string;
  modoBase: ModoBaseForm;
  baseValor: string;
  natBcCred: string;
  /** Origem do crédito (IND_ORIG_CRED): '' = não alterar, '0' mercado interno, '1' importação. */
  indOrigCred: '' | '0' | '1';
  conta: string;
  /** "padrao" deixa o motor decidir (recalcula quando base ou alíquota mudaram). */
  recalcular: 'padrao' | 'sempre' | 'nunca';
  zerarSemCredito: boolean;
}

export function formTributacaoVazio(): FormTributacao {
  return {
    cstPis: '',
    cstCofins: '',
    aliqPis: '',
    aliqCofins: '',
    modoBase: 'manter',
    baseValor: '',
    natBcCred: '',
    indOrigCred: '',
    conta: '',
    recalcular: 'padrao',
    zerarSemCredito: false,
  };
}

/** O formulário não altera nada? (para desabilitar a prévia) */
export function formTributacaoVazia(f: FormTributacao): boolean {
  return (
    !f.cstPis.trim() &&
    !f.cstCofins.trim() &&
    !f.aliqPis.trim() &&
    !f.aliqCofins.trim() &&
    f.modoBase === 'manter' &&
    !f.natBcCred.trim() &&
    !f.indOrigCred &&
    !f.conta.trim() &&
    f.recalcular === 'padrao' &&
    !f.zerarSemCredito
  );
}

function modoBaseDoForm(f: FormTributacao): ModoBase | undefined {
  if (f.modoBase === 'manter') return undefined;
  if (f.modoBase === 'fixo') return { valor: f.baseValor.trim() };
  return f.modoBase;
}

/** Monta a `AcaoTributacao` só com o que o usuário preencheu. */
export function montarAcaoTributacao(f: FormTributacao): AcaoTributacao {
  const a: AcaoTributacao = { tipo: 'tributacao' };
  if (f.cstPis.trim()) a.cstPis = f.cstPis.trim();
  if (f.cstCofins.trim()) a.cstCofins = f.cstCofins.trim();
  if (f.aliqPis.trim()) a.aliqPis = f.aliqPis.trim();
  if (f.aliqCofins.trim()) a.aliqCofins = f.aliqCofins.trim();
  const base = modoBaseDoForm(f);
  if (base !== undefined) a.base = base;
  if (f.natBcCred.trim()) a.natBcCred = f.natBcCred.trim();
  if (f.indOrigCred) a.indOrigCred = f.indOrigCred;
  if (f.conta.trim()) a.conta = f.conta.trim();
  if (f.recalcular === 'sempre') a.recalcularValor = true;
  if (f.recalcular === 'nunca') a.recalcularValor = false;
  if (f.zerarSemCredito) a.zerarSemCredito = true;
  return a;
}

/** Caminho inverso: regra salva → formulário (para o editor de regras). */
export function paraFormTributacao(a: AcaoTributacao): FormTributacao {
  const f = formTributacaoVazio();
  f.cstPis = a.cstPis ?? a.cst ?? '';
  f.cstCofins = a.cstCofins ?? a.cst ?? '';
  f.aliqPis = a.aliqPis === undefined ? '' : String(a.aliqPis);
  f.aliqCofins = a.aliqCofins === undefined ? '' : String(a.aliqCofins);
  if (a.base !== undefined) {
    if (typeof a.base === 'object') {
      f.modoBase = 'fixo';
      f.baseValor = String(a.base.valor);
    } else {
      f.modoBase = a.base;
    }
  }
  f.natBcCred = a.natBcCred ?? '';
  f.indOrigCred = a.indOrigCred ?? '';
  f.conta = a.conta ?? '';
  f.recalcular = a.recalcularValor === true ? 'sempre' : a.recalcularValor === false ? 'nunca' : 'padrao';
  f.zerarSemCredito = !!a.zerarSemCredito;
  return f;
}

// ---------------------------------------------------------------------------
// Resumo em português
// ---------------------------------------------------------------------------

/** "Valor do item menos desconto e ICMS" → "valor do item menos desconto e ICMS" (siglas intactas). */
function minusculaInicial(t: string): string {
  return t.charAt(0).toLowerCase() + t.slice(1);
}

function resumirTributacao(a: AcaoTributacao): string {
  const p: string[] = [];
  const cstPis = a.cstPis ?? a.cst;
  const cstCofins = a.cstCofins ?? a.cst;
  if (cstPis && cstPis === cstCofins) p.push(`CST ${cstPis}`);
  else {
    if (cstPis) p.push(`CST PIS ${cstPis}`);
    if (cstCofins) p.push(`CST COFINS ${cstCofins}`);
  }
  if (a.aliqPis !== undefined) p.push(`alíquota PIS ${a.aliqPis}%`);
  if (a.aliqCofins !== undefined) p.push(`alíquota COFINS ${a.aliqCofins}%`);
  if (a.base !== undefined) {
    p.push(
      typeof a.base === 'object'
        ? `base fixa ${a.base.valor}`
        : `base = ${minusculaInicial(ROTULO_MODO_BASE[a.base as ModoBaseForm] ?? String(a.base))}`,
    );
  }
  if (a.natBcCred) {
    const d = descricaoNatBcCred(a.natBcCred);
    p.push(`base de crédito ${a.natBcCred}${d ? ` (${d.replace(/\.$/, '').slice(0, 40)}…)` : ''}`);
  }
  if (a.indOrigCred) p.push(`origem do crédito ${a.indOrigCred === '1' ? 'importação' : 'mercado interno'}`);
  if (a.conta) p.push(`conta contábil ${a.conta}`);
  if (a.recalcularValor === true) p.push('recalcular valor pela base × alíquota');
  if (a.recalcularValor === false) p.push('sem recalcular o valor');
  if (a.zerarSemCredito) p.push('zerar base/alíquota/valor em CST sem crédito');
  return p.length ? `alterar tributação: ${p.join(', ')}` : 'alterar tributação (nada preenchido)';
}

/** Uma ação em português. */
export function resumirAcao(tipo: TipoLinhaTodos, a: Acao): string {
  switch (a.tipo) {
    case 'tributacao':
      return resumirTributacao(a);
    case 'definirCampo': {
      const col = coluna(tipo, a.campo) ?? coluna(tipo, `C170.${a.campo}`);
      return `definir ${col?.rotulo ?? a.campo} = "${a.valor}"`;
    }
    case 'excluir':
      return a.excluirNotaVazia === false ? 'excluir as linhas (mantendo notas sem item)' : 'excluir as linhas (e as notas que ficarem sem item)';
    default:
      return 'ação desconhecida';
  }
}

export function resumirAcoes(tipo: TipoLinhaTodos, acoes: Acao[]): string {
  if (!acoes?.length) return 'nenhuma ação';
  return acoes.map((a) => resumirAcao(tipo, a)).join('; ');
}

/** A regra inteira em uma frase, para a lista de regras. */
export function resumirRegra(r: Regra<TipoLinhaTodos>): string {
  const tipo = ROTULO_TIPO[r.tipoLinha] ?? r.tipoLinha;
  return `${tipo}: onde ${resumirFiltros(r.tipoLinha, r.filtros ?? [], r.busca?.texto)} → ${resumirAcoes(r.tipoLinha, r.acoes ?? [])}`;
}
