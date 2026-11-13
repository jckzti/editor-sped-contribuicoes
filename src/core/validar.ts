/**
 * Verificações baratas antes de levar o arquivo ao PVA: pegam o que o PVA recusaria
 * (ou o que provavelmente é engano de edição). Não substituem a validação do PVA.
 *
 * Checagens:
 * - REF_*: referência a cadastro inexistente (0150, 0200, 0190, 0400, 0500);
 * - OBRIGATORIO: campo obrigatório vazio em registro novo ou editado;
 * - VALOR_TRIBUTO: valor de PIS/COFINS ≠ base × alíquota (tolerância 1 centavo) em registro novo/editado;
 * - CST_CREDITO_SAIDA / CST_RECEITA_ENTRADA: CST incompatível com a operação da nota;
 * - CFOP_OPERACAO: CFOP de entrada em nota de saída ou vice-versa;
 * - CFOP_SEM_NAT_BC: item de entrada com CST de crédito cujo CFOP não tem base de crédito
 *   na tabela (`config.cfopNatBc`), que a apuração não saberá classificar;
 * - CHAVE_DV: chave de NF-e/CT-e com dígito verificador inválido em documento novo/editado;
 * - DATA_PERIODO: documento novo/editado com nenhuma das duas datas (emissão, entrada/saída)
 *   no período (erro) ou com a data de entrada/saída depois do fim do período estando a de
 *   emissão dentro (alerta); F100 com data depois do fim do período (erro);
 * - DATA_ENTRADA_ANTES_EMISSAO: data de entrada/saída anterior à de emissão (erro);
 * - DATA_ENTRADA_OBRIGATORIA: nota de entrada (C100) sem DT_E_S (erro);
 * - CST_CREDITO_BASE_ZERO / CST_RECEITA_BASE_ZERO: CST 50–66 ou 01/02 com base zero numa operação
 *   de valor > 0 (erro; todos os registros, não só os editados);
 * - CST_ALIQUOTA_ZERO: CST 50–66 ou 01/02 com base preenchida e alíquota zero (erro; todos os registros);
 * - NUMERO_INVALIDO: campo numérico com texto fora do formato do SPED (erro);
 * - nota de serviço (A100/A170): referências, CST × operação (contratado/prestado), valor ≈ base ×
 *   alíquota, datas (emissão ou execução no período); NAT_BC_CRED_AUSENTE em crédito (A170/F120/F130);
 * - IMOBILIZADO_BASE: F120/F130 editado com base fora da regra do guia (alerta).
 */
import { indices } from './cadastros';
import cfopCredito from './cfopCredito.json';
import { cstCredito, cstReceita } from './construir';
import { mulAliq, paraEscala } from './dec';
import { descreverRegistro, documentoDe } from './edicao';
import { idx, leiaute, type Aviso, type Escrituracao, type Registro } from './modelo';
import { conferirImobilizado } from './imobilizado';
import { centavosRapido, chaveValida, dataSpedParaNumero, spedParaBr } from './util';

export interface AvisoValidacao extends Aviso {
  /** Documento a que o aviso se refere (ex.: "NF 39327 série 001 (entrada)"). */
  documento?: string;
  /** Registro com problema (para a interface navegar até ele). */
  registro?: Registro;
}

/** Tabela CFOP → NAT_BC_CRED a partir da tabela oficial (usada quando não há configuração). */
export function cfopNatBcPadrao(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [cod, cfops] of Object.entries(cfopCredito.porCodigo as Record<string, string[]>)) for (const c of cfops) out[c] ??= cod;
  return out;
}

const SIT_SEM_DADOS = new Set(['02', '03', '04', '05']);

/** Pares (base, alíquota, valor) por registro, para conferir valor = base × alíquota. */
const TRIBUTOS: Record<string, [string, string, string][]> = {
  C170: [
    ['VL_BC_PIS', 'ALIQ_PIS', 'VL_PIS'],
    ['VL_BC_COFINS', 'ALIQ_COFINS', 'VL_COFINS'],
  ],
  F100: [
    ['VL_BC_PIS', 'ALIQ_PIS', 'VL_PIS'],
    ['VL_BC_COFINS', 'ALIQ_COFINS', 'VL_COFINS'],
  ],
  D101: [['VL_BC_PIS', 'ALIQ_PIS', 'VL_PIS']],
  D105: [['VL_BC_COFINS', 'ALIQ_COFINS', 'VL_COFINS']],
  C501: [['VL_BC_PIS', 'ALIQ_PIS', 'VL_PIS']],
  C505: [['VL_BC_COFINS', 'ALIQ_COFINS', 'VL_COFINS']],
  A170: [
    ['VL_BC_PIS', 'ALIQ_PIS', 'VL_PIS'],
    ['VL_BC_COFINS', 'ALIQ_COFINS', 'VL_COFINS'],
  ],
  F120: [
    ['VL_BC_PIS', 'ALIQ_PIS', 'VL_PIS'],
    ['VL_BC_COFINS', 'ALIQ_COFINS', 'VL_COFINS'],
  ],
  F130: [
    ['VL_BC_PIS', 'ALIQ_PIS', 'VL_PIS'],
    ['VL_BC_COFINS', 'ALIQ_COFINS', 'VL_COFINS'],
  ],
};

/**
 * Datas por documento. `entrada` = a outra data que pode estar no período; `ordem` = ela
 * não pode ser anterior à de emissão (C100, D100 e C500; no A100 o guia não exige).
 */
const DATAS: Record<string, { doc: string; entrada?: string; ordem?: boolean }> = {
  C100: { doc: 'DT_DOC', entrada: 'DT_E_S', ordem: true },
  D100: { doc: 'DT_DOC', entrada: 'DT_A_P', ordem: true },
  C500: { doc: 'DT_DOC', entrada: 'DT_ENT', ordem: true },
  A100: { doc: 'DT_DOC', entrada: 'DT_EXE_SERV' },
  F100: { doc: 'DT_OPER' },
};

const CHAVES: Record<string, string> = { C100: 'CHV_NFE', D100: 'CHV_CTE', C500: 'CHV_DOCe' };

/**
 * [campo CST, campo base, campo de base em quantidade, campo do valor da operação] por
 * registro, para a checagem de base zero (só acusa se o valor da operação for > 0).
 */
const BASES_CST: Record<string, [string, string, string | null, string][]> = {
  C170: [
    ['CST_PIS', 'VL_BC_PIS', 'QUANT_BC_PIS', 'VL_ITEM'],
    ['CST_COFINS', 'VL_BC_COFINS', 'QUANT_BC_COFINS', 'VL_ITEM'],
  ],
  F100: [
    ['CST_PIS', 'VL_BC_PIS', null, 'VL_OPER'],
    ['CST_COFINS', 'VL_BC_COFINS', null, 'VL_OPER'],
  ],
  D101: [['CST_PIS', 'VL_BC_PIS', null, 'VL_ITEM']],
  D105: [['CST_COFINS', 'VL_BC_COFINS', null, 'VL_ITEM']],
  C501: [['CST_PIS', 'VL_BC_PIS', null, 'VL_ITEM']],
  C505: [['CST_COFINS', 'VL_BC_COFINS', null, 'VL_ITEM']],
  A170: [
    ['CST_PIS', 'VL_BC_PIS', null, 'VL_ITEM'],
    ['CST_COFINS', 'VL_BC_COFINS', null, 'VL_ITEM'],
  ],
  F120: [
    ['CST_PIS', 'VL_BC_PIS', null, 'VL_OPER_DEP'],
    ['CST_COFINS', 'VL_BC_COFINS', null, 'VL_OPER_DEP'],
  ],
  F130: [
    ['CST_PIS', 'VL_BC_PIS', null, 'VL_BC_CRED'],
    ['CST_COFINS', 'VL_BC_COFINS', null, 'VL_BC_CRED'],
  ],
};

/** Texto numérico no formato do SPED (vírgula decimal, sem milhar). */
const NUMERO_SPED = /^-?\d+(,\d+)?$/;

/**
 * Verifica a escrituração. `cfopNatBc` (da `ConfigApuracao`) define quais CFOPs têm base
 * de crédito; sem ela, usa a tabela oficial de CFOP geradores de crédito.
 */
export function validar(e: Escrituracao, opcoes: { cfopNatBc?: Record<string, string> } = {}): AvisoValidacao[] {
  const out: AvisoValidacao[] = [];
  const cfopNatBc = opcoes.cfopNatBc ?? cfopNatBcPadrao();
  const ix = indices(e);
  const temPlano = ix.contas.size > 0;
  const ini = dataSpedParaNumero(e.dtIni);
  const fim = dataSpedParaNumero(e.dtFim);

  const aviso = (nivel: Aviso['nivel'], codigo: string, mensagem: string, r: Registro) => {
    const d = documentoDe(r);
    out.push({ nivel, codigo, mensagem, documento: d ? descreverRegistro(d) : undefined, registro: r });
  };

  const visita = (r: Registro, estCnpj: string) => {
    const def = leiaute.registros[r.reg];
    const g = (c: string) => r.campos[idx(r.reg, c)] ?? '';
    const tocado = r.estado === 'novo' || r.estado === 'editado';
    const cad = ix.estabs.get(estCnpj) ?? ix.padrao;

    // referências a cadastro e números fora do formato
    if (def) {
      for (let i = 1; i < def.campos.length; i++) {
        const c = def.campos[i];
        const v = r.campos[i];
        if (!v) continue;
        if (c.tipo === 'N' && c.dec !== null && c.dec !== undefined && !NUMERO_SPED.test(v)) {
          aviso('erro', 'NUMERO_INVALIDO', `${r.reg}: ${c.nome} = "${v}" não é um número no formato do SPED (vírgula decimal, sem separador de milhar).`, r);
        }
        if (c.nome === 'COD_PART' && !cad.part.has(v)) aviso('erro', 'REF_0150', `Participante ${v} não existe no cadastro (0150).`, r);
        else if (c.nome === 'COD_ITEM' && !cad.item.has(v)) aviso('erro', 'REF_0200', `Item ${v} não existe no cadastro (0200).`, r);
        else if (c.nome === 'UNID' && !cad.unid.has(v)) aviso('erro', 'REF_0190', `Unidade ${v} não existe no cadastro (0190).`, r);
        else if (c.nome === 'COD_NAT' && !cad.nat.has(v)) aviso('erro', 'REF_0400', `Natureza da operação ${v} não existe no cadastro (0400).`, r);
        else if (c.nome === 'COD_CTA' && temPlano && !ix.contas.has(v)) aviso('erro', 'REF_0500', `Conta contábil ${v} não existe no plano de contas (0500).`, r);
      }
    }

    // obrigatórios em registro novo/editado
    if (tocado && def) {
      const isento = r.reg === 'C100' && SIT_SEM_DADOS.has(g('COD_SIT'));
      if (!isento) {
        def.campos.forEach((c, i) => {
          if (c.obrig === 'S' && !(r.campos[i] ?? '')) aviso('erro', 'OBRIGATORIO', `${r.reg}: campo obrigatório ${c.nome} (${c.descricao}) vazio.`, r);
        });
      }
    }

    // valor = base × alíquota
    if (tocado && TRIBUTOS[r.reg]) {
      for (const [b, a, v] of TRIBUTOS[r.reg]) {
        const base = g(b);
        const aliq = g(a);
        if (!base && !aliq) continue;
        const baseC = centavosRapido(base);
        const atual = centavosRapido(g(v));
        if (!Number.isFinite(baseC) || !Number.isFinite(atual)) continue; // NUMERO_INVALIDO já aponta
        const esperado = mulAliq(baseC, aliq);
        if (Math.abs(esperado - atual) > 1) {
          aviso('alerta', 'VALOR_TRIBUTO', `${r.reg}: ${v} = ${g(v) || '0'}, mas ${b} × ${a} = ${(esperado / 100).toFixed(2).replace('.', ',')}.`, r);
        }
      }
    }

    // itens: CST × operação, CFOP × operação, CFOP sem base de crédito
    if (r.reg === 'C170' && r.pai) {
      const oper = r.pai.campos[idx('C100', 'IND_OPER')];
      const cfop = g('CFOP');
      for (const t of ['CST_PIS', 'CST_COFINS']) {
        const cst = g(t);
        if (oper === '1' && cstCredito(cst)) aviso('erro', 'CST_CREDITO_SAIDA', `${t} ${cst} é de crédito, mas a nota é de saída.`, r);
        if (oper === '0' && cstReceita(cst)) aviso('erro', 'CST_RECEITA_ENTRADA', `${t} ${cst} é de receita, mas a nota é de entrada.`, r);
      }
      if (cfop) {
        if (oper === '0' && !'123'.includes(cfop[0])) aviso('erro', 'CFOP_OPERACAO', `CFOP ${cfop} é de saída, mas a nota é de entrada.`, r);
        if (oper === '1' && !'567'.includes(cfop[0])) aviso('erro', 'CFOP_OPERACAO', `CFOP ${cfop} é de entrada, mas a nota é de saída.`, r);
        if (oper === '0' && cstCredito(g('CST_PIS')) && !cfopNatBc[cfop]) {
          aviso('alerta', 'CFOP_SEM_NAT_BC', `Item com CST ${g('CST_PIS')} (crédito), mas o CFOP ${cfop} não tem base de crédito (NAT_BC_CRED) na tabela de configuração.`, r);
        }
      }
    }

    // nota de serviço: CST × tipo de operação; base de crédito obrigatória no crédito
    if (r.reg === 'A170' && r.pai) {
      const oper = r.pai.campos[idx('A100', 'IND_OPER')];
      for (const t of ['CST_PIS', 'CST_COFINS']) {
        const cst = g(t);
        if (oper === '1' && cstCredito(cst)) aviso('erro', 'CST_CREDITO_SAIDA', `${t} ${cst} é de crédito, mas o serviço é prestado (receita).`, r);
        if (oper === '0' && cstReceita(cst)) aviso('erro', 'CST_RECEITA_ENTRADA', `${t} ${cst} é de receita, mas o serviço é contratado.`, r);
      }
    }
    if ((r.reg === 'F120' || r.reg === 'F130') && (cstReceita(g('CST_PIS')) || cstReceita(g('CST_COFINS')))) {
      aviso('erro', 'CST_RECEITA_ENTRADA', `${r.reg}: CST de receita em bem do imobilizado (use CST de crédito 50–66 ou sem crédito).`, r);
    }
    if ((r.reg === 'A170' || r.reg === 'F120' || r.reg === 'F130') && (cstCredito(g('CST_PIS')) || cstCredito(g('CST_COFINS'))) && !g('NAT_BC_CRED')) {
      aviso('erro', 'NAT_BC_CRED_AUSENTE', `${r.reg}: CST de crédito sem o código da base de cálculo do crédito (NAT_BC_CRED).`, r);
    }
    // imobilizado editado: campos derivados conforme o guia
    if (tocado && (r.reg === 'F120' || r.reg === 'F130')) {
      for (const m of conferirImobilizado(r)) aviso('alerta', 'IMOBILIZADO_BASE', `${r.reg}: ${m}`, r);
    }

    // CST de crédito (50–66) ou de receita tributada (01/02) com base zero: não gera crédito/débito
    if (BASES_CST[r.reg]) {
      for (const [cstC, baseC, quantC, valorC] of BASES_CST[r.reg]) {
        const cst = g(cstC);
        if (!cst || (!cstCredito(cst) && cst !== '01' && cst !== '02')) continue;
        if (quantC && g(quantC)) continue; // base em quantidade
        if (centavosRapido(g(baseC)) !== 0) {
          // base preenchida e alíquota zero: não gera crédito/débito (ex.: importado sem alíquota — o editor não supõe)
          const aliqC = baseC.replace('VL_BC_', 'ALIQ_');
          if (paraEscala(g(aliqC), 4) === 0n) {
            aviso(
              'erro',
              'CST_ALIQUOTA_ZERO',
              `${cstC} ${cst} com ${baseC} = ${g(baseC)} e alíquota zero: não gera ${cstCredito(cst) ? 'crédito' : 'débito'}. Defina a alíquota (${aliqC}).`,
              r,
            );
          }
          continue;
        }
        if (!(centavosRapido(g(valorC)) > 0)) continue; // operação de valor zero não tem o que tributar
        if (cstCredito(cst)) aviso('erro', 'CST_CREDITO_BASE_ZERO', `CST de crédito com base de cálculo zero: ${cstC} ${cst} com ${baseC} = ${g(baseC) || 'vazio'} (não gera crédito).`, r);
        else aviso('erro', 'CST_RECEITA_BASE_ZERO', `CST de receita tributada com base de cálculo zero: ${cstC} ${cst} com ${baseC} = ${g(baseC) || 'vazio'} (não gera débito).`, r);
      }
    }

    // documentos novos/editados: chave e datas (guia: C100 campos 10/11, D100 11/12, C500 08/09)
    if (tocado && DATAS[r.reg]) {
      const ch = CHAVES[r.reg];
      if (ch && g(ch) && !chaveValida(g(ch))) aviso('erro', 'CHAVE_DV', `Chave ${g(ch)} inválida (dígito verificador ou tamanho).`, r);
      const { doc, entrada } = DATAS[r.reg];
      const dDoc = g(doc);
      const dEnt = entrada ? g(entrada) : '';
      const nDoc = dDoc ? dataSpedParaNumero(dDoc) : NaN;
      const nEnt = dEnt ? dataSpedParaNumero(dEnt) : NaN;
      const noPeriodo = (n: number) => n >= ini && n <= fim;
      const isento = r.reg === 'C100' && SIT_SEM_DADOS.has(g('COD_SIT'));
      if (!entrada) {
        if (dDoc && nDoc > fim) aviso('erro', 'DATA_PERIODO', `${doc} ${spedParaBr(dDoc)} é posterior ao fim do período (${spedParaBr(e.dtFim)}).`, r);
      } else if (!isento) {
        if (r.reg === 'C100' && g('IND_OPER') === '0' && !dEnt) {
          aviso('erro', 'DATA_ENTRADA_OBRIGATORIA', `${entrada} (data de entrada) é obrigatória nas notas de entrada.`, r);
        }
        if (dDoc && !noPeriodo(nDoc) && !(dEnt && noPeriodo(nEnt))) {
          aviso(
            'erro',
            'DATA_PERIODO',
            `Nenhuma das datas está no período (${spedParaBr(e.dtIni)} a ${spedParaBr(e.dtFim)}): ${doc} ${spedParaBr(dDoc)}${dEnt ? `, ${entrada} ${spedParaBr(dEnt)}` : ''}. O PVA exige a data do documento ou a de entrada/saída dentro do período.`,
            r,
          );
        } else if (DATAS[r.reg].ordem && dEnt && nEnt > fim) {
          aviso('alerta', 'DATA_PERIODO', `${entrada} ${spedParaBr(dEnt)} é posterior ao fim do período (${spedParaBr(e.dtFim)}); aceito porque ${doc} ${spedParaBr(dDoc)} está no período. Confira.`, r);
        }
        if (DATAS[r.reg].ordem && dDoc && dEnt && nEnt < nDoc) {
          aviso('erro', 'DATA_ENTRADA_ANTES_EMISSAO', `${entrada} ${spedParaBr(dEnt)} é anterior a ${doc} ${spedParaBr(dDoc)} (a data de entrada/saída deve ser igual ou posterior à de emissão).`, r);
        }
      }
    }

    for (const f of r.filhos) visita(f, /^.010$/.test(r.reg) ? r.campos[1] ?? '' : estCnpj);
  };

  for (const bloco of e.raiz.filhos) {
    if (bloco.reg === '0001' || bloco.reg === '0000') continue;
    visita(bloco, '');
  }
  return out;
}
