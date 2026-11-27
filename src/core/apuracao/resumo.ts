/** Resumo da apuração lido do bloco M como está na árvore. */
import { get, listar, type Escrituracao } from '../modelo';
import type { ResumoApuracao, ResumoTributo } from './contrato';
import { COFINS, PIS, type Tributo } from './tributos';
import { cent } from './util';

function resumoTributo(e: Escrituracao, t: Tributo): ResumoTributo {
  const creditos = listar(e, t.M100).map((r) => ({
    codCred: get(r, 'COD_CRED'),
    aliquota: get(r, `ALIQ_${t.sfx}`),
    base: cent(r, `VL_BC_${t.sfx}`),
    credito: cent(r, 'VL_CRED'),
    ajustesAcrescimo: cent(r, 'VL_AJUS_ACRES'),
    ajustesReducao: cent(r, 'VL_AJUS_REDUC'),
    disponivel: cent(r, 'VL_CRED_DISP'),
    descontado: cent(r, 'VL_CRED_DESC'),
    saldo: cent(r, 'SLD_CRED'),
  }));
  const contribuicoes = listar(e, t.M210).map((r) => ({
    codCont: get(r, 'COD_CONT'),
    aliquota: get(r, `ALIQ_${t.sfx}`),
    receitaBruta: cent(r, 'VL_REC_BRT'),
    base: cent(r, 'VL_BC_CONT_AJUS'),
    contribuicao: cent(r, 'VL_CONT_PER'),
  }));
  const m200 = listar(e, t.M200)[0];
  const v = (c: string) => (m200 ? cent(m200, c) : 0);
  return {
    creditos,
    contribuicoes,
    contribuicaoNaoCumulativa: v('VL_TOT_CONT_NC_PER'),
    creditoDescontado: v('VL_TOT_CRED_DESC'),
    creditoDescontadoAnteriores: v('VL_TOT_CRED_DESC_ANT'),
    contribuicaoCumulativa: v('VL_TOT_CONT_CUM_PER'),
    aRecolher: v('VL_TOT_CONT_REC'),
    aRecolherNaoCumulativo: v('VL_CONT_NC_REC'),
    aRecolherCumulativo: v('VL_CONT_CUM_REC'),
    saldoCredor: creditos.reduce((s, c) => s + c.saldo, 0),
  };
}

export function lerResumo(e: Escrituracao): ResumoApuracao {
  return { pis: resumoTributo(e, PIS), cofins: resumoTributo(e, COFINS) };
}
