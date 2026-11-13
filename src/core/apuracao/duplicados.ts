/**
 * Registros do bloco M com chave repetida (achado 19 da revisão).
 *
 * Chaves pelo Guia Prático 1.35:
 * - M210/M610: COD_CONT + ALIQ_x_QUANT + ALIQ_x ("um registro M210 em relação a cada
 *   alíquota"); dois com a mesma chave não são válidos → consolidados num só (ajustes,
 *   diferimentos e filhos somados) com aviso. Mesmo COD_CONT e alíquota percentual mas
 *   alíquota em reais diferente é chave diferente e legítima; o motor não separa por ela → recusa.
 * - M100/M500: "um registro M100 para cada tipo de crédito e alíquota" → COD_CRED + alíquota
 *   repetidos são consolidados (ajustes M110 manuais e crédito diferido somados) com aviso.
 * - M105/M505: "um registro M105 para cada CST" do tipo de crédito → NAT_BC_CRED + CST
 *   repetidos sob o mesmo M100 são refeitos num só pelo recálculo (registro todo derivado); avisa.
 * - M400/M800: um por CST (é o que o PVA gera). Mesmo CST com a mesma conta → consolidado
 *   (refeito dos documentos); com contas diferentes o motor não sabe dividir a receita por
 *   conta → recusa.
 * - M410/M810: NAT_REC + COD_CTA + DESC_COMPL. Mesma natureza com conta ou descrição
 *   diferentes é legítimo, mas o motor agrupa só por natureza → recusa. Chave inteira
 *   repetida → consolidada (refeita) com aviso.
 */
import { paraEscala } from '../dec';
import { filhosDe, get, inserirFilho, listar, removerRegistro, type Aviso, type Escrituracao, type Registro } from '../modelo';
import type { Tributo } from './tributos';
import { agrupar, aliqEsc, cent, fmtAliq, setCent } from './util';

const aliq = (r: Registro, t: Tributo) => aliqEsc(get(r, `ALIQ_${t.sfx}`)).toString();
const aliqQuant = (r: Registro, t: Tributo) => paraEscala(get(r, `ALIQ_${t.sfx}_QUANT`), 4).toString();

function grupos(regs: Registro[], chave: (r: Registro) => string): Registro[][] {
  const m = new Map<string, Registro[]>();
  for (const r of regs) agrupar(m, chave(r), r);
  return [...m.values()].filter((g) => g.length > 1);
}

/** Casos legítimos (ou que o motor não sabe consolidar): erros que recusam o recálculo. */
export function recusasChaveRepetida(e: Escrituracao, t: Tributo): Aviso[] {
  const erros: Aviso[] = [];
  const erro = (m: string) => erros.push({ nivel: 'erro', codigo: 'APURACAO_CHAVE_REPETIDA', mensagem: `Apuração não recalculada (${t.nome}): ${m}` });
  const m200 = listar(e, t.M200)[0];
  if (m200) {
    for (const g of grupos(filhosDe(m200, t.M210), (r) => `${get(r, 'COD_CONT')}|${aliq(r, t)}`)) {
      if (new Set(g.map((r) => aliqQuant(r, t))).size > 1) {
        erro(`há ${g.length} ${t.M210} com COD_CONT ${get(g[0], 'COD_CONT')} e alíquota ${fmtAliq(aliqEsc(get(g[0], `ALIQ_${t.sfx}`)))}% que diferem só na alíquota em reais; o motor não separa as receitas por ela.`);
      }
    }
  }
  for (const g of grupos(listar(e, t.M400), (r) => get(r, `CST_${t.sfx}`))) {
    const contas = [...new Set(g.map((r) => get(r, 'COD_CTA')))];
    if (contas.length > 1) {
      erro(`há ${g.length} ${t.M400} do CST ${get(g[0], `CST_${t.sfx}`)} com contas contábeis diferentes (${contas.join(', ')}); o motor não sabe dividir a receita por conta.`);
    }
  }
  for (const m400 of listar(e, t.M400)) {
    for (const g of grupos(filhosDe(m400, t.M410), (r) => get(r, 'NAT_REC'))) {
      const chaves = new Set(g.map((r) => `${get(r, 'COD_CTA')}|${get(r, 'DESC_COMPL')}`));
      if (chaves.size > 1) {
        erro(
          `o ${t.M400} do CST ${get(m400, `CST_${t.sfx}`)} tem ${g.length} ${t.M410} da natureza ${get(g[0], 'NAT_REC')} com conta ou descrição diferentes ` +
            `(chave do guia: NAT_REC + COD_CTA + DESC_COMPL). É válido, mas o motor agrupa a receita só pela natureza e juntaria as linhas.`,
        );
      }
    }
  }
  return erros;
}

/**
 * Consolida as chaves repetidas que o leiaute não admite (antes de apurar). Altera a árvore
 * e acrescenta avisos `CHAVE_REPETIDA_CONSOLIDADA`.
 */
export function consolidarChaveRepetida(e: Escrituracao, t: Tributo, avisos: Aviso[]): void {
  const avisar = (m: string) =>
    avisos.push({ nivel: 'alerta', codigo: 'CHAVE_REPETIDA_CONSOLIDADA', mensagem: `${t.nome}: ${m} O leiaute não admite chave repetida; foram consolidados em um só registro. Confira.` });
  const s = t.sfx;

  // M210/M610: soma os ajustes e diferimentos informados e junta os filhos (M215/M220/M230)
  const m200 = listar(e, t.M200)[0];
  if (m200) {
    for (const g of grupos(filhosDe(m200, t.M210), (r) => `${get(r, 'COD_CONT')}|${aliq(r, t)}|${aliqQuant(r, t)}`)) {
      const [fica, ...sobram] = g;
      for (const r of sobram) {
        for (const c of [`VL_AJUS_ACRES_BC_${s}`, `VL_AJUS_REDUC_BC_${s}`, 'VL_AJUS_ACRES', 'VL_AJUS_REDUC', 'VL_CONT_DIFER', 'VL_CONT_DIFER_ANT']) {
          setCent(fica, c, cent(fica, c) + cent(r, c));
        }
        for (const f of [...r.filhos]) {
          removerRegistro(f);
          inserirFilho(fica, f);
        }
        removerRegistro(r);
      }
      avisar(`havia ${g.length} ${t.M210} com COD_CONT ${get(fica, 'COD_CONT')} e alíquota ${fmtAliq(aliqEsc(get(fica, `ALIQ_${s}`)))}% (ajustes, diferimentos e detalhamentos somados).`);
    }
  }

  // M100/M500: junta os ajustes manuais (M110/M510 e detalhes) e soma o crédito diferido
  const m001 = listar(e, 'M001')[0];
  if (m001) {
    for (const g of grupos(filhosDe(m001, t.M100), (r) => `${get(r, 'COD_CRED')}|${get(r, 'IND_CRED_ORI')}|${aliq(r, t)}`)) {
      const [fica, ...sobram] = g;
      for (const r of sobram) {
        setCent(fica, t.campoCredDif, cent(fica, t.campoCredDif) + cent(r, t.campoCredDif));
        for (const f of [...r.filhos]) {
          removerRegistro(f);
          if (f.reg === t.M110) inserirFilho(fica, f); // M105 é refeito dos documentos
        }
        removerRegistro(r);
      }
      avisar(`havia ${g.length} ${t.M100} do crédito ${get(fica, 'COD_CRED')} com alíquota ${fmtAliq(aliqEsc(get(fica, `ALIQ_${s}`)))}% (ajustes e crédito diferido somados).`);
    }
    // M105/M505: registro derivado; o recálculo refaz um só por NAT_BC_CRED + CST
    for (const m100 of filhosDe(m001, t.M100)) {
      for (const g of grupos(filhosDe(m100, t.M105), (r) => `${get(r, 'NAT_BC_CRED')}|${get(r, `CST_${s}`)}`)) {
        for (const r of g.slice(1)) removerRegistro(r);
        avisar(`havia ${g.length} ${t.M105} com NAT_BC_CRED ${get(g[0], 'NAT_BC_CRED')} e CST ${get(g[0], `CST_${s}`)} no crédito ${get(m100, 'COD_CRED')} (base refeita dos documentos).`);
      }
    }
  }

  // M400/M800 do mesmo CST e mesma conta; M410/M810 com a chave inteira repetida: refeitos dos documentos
  for (const g of grupos(listar(e, t.M400), (r) => get(r, `CST_${s}`))) {
    for (const r of g.slice(1)) removerRegistro(r);
    avisar(`havia ${g.length} ${t.M400} do CST ${get(g[0], `CST_${s}`)} (receita refeita dos documentos).`);
  }
  for (const m400 of listar(e, t.M400)) {
    for (const g of grupos(filhosDe(m400, t.M410), (r) => `${get(r, 'NAT_REC')}|${get(r, 'COD_CTA')}|${get(r, 'DESC_COMPL')}`)) {
      for (const r of g.slice(1)) removerRegistro(r);
      avisar(`havia ${g.length} ${t.M410} da natureza ${get(g[0], 'NAT_REC')} no CST ${get(m400, `CST_${s}`)} (receita refeita dos documentos).`);
    }
  }
}
