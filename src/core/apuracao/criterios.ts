/**
 * Critérios da apuração: escolhas que dependem do caso e que NÃO têm padrão. Quem faz o
 * trabalho escolhe, para a sessão (todas as empresas) ou por empresa (CNPJ). Enquanto uma
 * empresa tiver critério pendente, o recálculo dela é recusado (`CRITERIOS_PENDENTES`).
 *
 * - `CRITERIOS`: catálogo (pergunta, explicação, opções e consequência fiscal de cada uma)
 *   para a interface montar a tela sem inventar texto. Não recomenda nenhuma opção.
 * - `criteriosDe` / `definirCriterio` / `criteriosPendentes`: leitura, escolha e pendências.
 * - `indiciosCriterios`: o que os arquivos ORIGINAIS mostram sobre como a empresa fazia.
 *   É informação para a pessoa decidir; nunca é aplicado sozinho.
 */
import type { Escrituracao } from '../modelo';
import type { ConfigApuracao, EscolhasCriterios, IdCriterio } from './contrato';
import { estadoDe } from './estado';
import { reais } from './util';

export type { EscolhasCriterios, IdCriterio } from './contrato';

export interface OpcaoCriterio {
  valor: string | boolean;
  rotulo: string;
  /** O que acontece na apuração e no que fica declarado, escolhendo esta opção. */
  consequencia: string;
}

export interface Criterio {
  id: IdCriterio;
  pergunta: string;
  explicacao: string;
  opcoes: OpcaoCriterio[];
}

export const IDS_CRITERIOS: IdCriterio[] = ['saldoCredor', 'ordemUsoCredito', 'receitaBruta0111', 'preservarRetencaoCredito'];

export const CRITERIOS: Criterio[] = [
  {
    id: 'saldoCredor',
    pergunta: 'Quando os créditos do mês forem maiores que o débito, o saldo credor deve ser levado para os meses seguintes carregados?',
    explicacao:
      'O saldo credor de PIS/Pasep e Cofins é controlado nos registros 1100/1500, que cada mês traz dos meses anteriores. ' +
      'Quando uma edição muda o crédito de um mês, muda também o saldo que ele deixa para os meses seguintes.',
    opcoes: [
      {
        valor: 'encadear',
        rotulo: 'Levar o saldo para os meses seguintes (1100/1500)',
        consequencia:
          'O editor refaz o 1100/1500 de cada mês seguinte carregado do mesmo CNPJ a partir do mês anterior recalculado: cada mês desconta ' +
          'o saldo que de fato sobrou. Os 1100/1500 dos meses seguintes mudam sempre que um mês anterior muda. Mês não carregado no meio ' +
          'da sequência é avisado (o saldo pula de um mês carregado para o próximo).',
      },
      {
        valor: 'somente-mes',
        rotulo: 'Registrar o saldo só no próprio mês, sem aproveitar adiante',
        consequencia:
          'O saldo do mês fica no M100/M500 e no 1100/1500 do próprio período; os 1100/1500 de períodos anteriores que cada arquivo traz ' +
          'ficam como vieram. Se um deles não bater com o mês de origem carregado e recalculado, o recálculo dá erro naquele mês: ele estaria ' +
          'descontando crédito que não existe mais (ou deixando de usar crédito que existe).',
      },
    ],
  },
  {
    id: 'ordemUsoCredito',
    pergunta: 'Ao descontar créditos da contribuição do mês, em que ordem usar os créditos disponíveis?',
    explicacao:
      'Os créditos do grupo 100 (vinculados à receita tributada no mercado interno) só podem ser descontados da contribuição. ' +
      'Os dos grupos 200 (receita não tributada no mercado interno) e 300 (exportação) que sobrarem podem também ser objeto de pedido de ' +
      'ressarcimento ou de compensação. A ordem de uso define quais créditos sobram como saldo credor.',
    opcoes: [
      {
        valor: 'anteriores-primeiro',
        rotulo: 'Primeiro os créditos de meses anteriores (1100/1500), depois os do mês',
        consequencia:
          'Os saldos mais antigos são consumidos primeiro, de qualquer grupo (inclusive 200/300). Sobram como saldo credor os créditos ' +
          'apurados no próprio mês.',
      },
      {
        valor: 'mes-primeiro',
        rotulo: 'Primeiro os créditos do próprio mês, depois os de meses anteriores',
        consequencia:
          'Os créditos apurados no mês são consumidos primeiro (101, 102... 201... 301..., em ordem de código), e só depois os saldos ' +
          'anteriores. Sobram os saldos mais antigos, que continuam no 1100/1500.',
      },
      {
        valor: 'tributados-primeiro',
        rotulo: 'Primeiro os créditos do grupo 100 (receita tributada) de todos os meses, depois os dos grupos 200/300',
        consequencia:
          'Os créditos só descontáveis (1xx) são consumidos do mais antigo ao do mês antes de tocar nos dos grupos 200/300. Sobram como ' +
          'saldo credor, de preferência, os créditos que podem ser ressarcidos ou compensados.',
      },
    ],
  },
  {
    id: 'receitaBruta0111',
    pergunta: 'Quando uma edição mudar a receita dos documentos, o registro 0111 (receita bruta do rateio) deve acompanhar?',
    explicacao:
      'Os créditos comuns a mais de um tipo de receita (CST 53 a 56 e 63 a 66) são rateados entre os grupos 100, 200 e 300 na ' +
      'proporção da receita bruta informada no 0111. Reclassificar receita (por exemplo, de CST 01 para 04 no monofásico) muda essa proporção.',
    opcoes: [
      {
        valor: 'ajustar-pelo-delta',
        rotulo: 'Ajustar o 0111 pela variação da receita editada',
        consequencia:
          'O 0111 recebe a diferença de receita dos itens de nota (C170) por tipo (tributada, não tributada e exportação) em relação ao ' +
          'arquivo original; receita que não está nos itens fica como estava. O rateio passa a usar a nova proporção e o recálculo mostra ' +
          'os valores de antes e depois.',
      },
      {
        valor: 'manter',
        rotulo: 'Manter o 0111 como está no arquivo',
        consequencia:
          'O rateio continua com a proporção do 0111 original (ou com o que for editado nele à mão). Se a receita por tipo dos documentos ' +
          'mudou, o recálculo alerta que o rateio usa a proporção antiga e que o 0111 declarado não corresponde aos documentos.',
      },
    ],
  },
  {
    id: 'preservarRetencaoCredito',
    pergunta: 'O arquivo original deixou crédito sem descontar havendo contribuição a recolher. Manter essa retenção?',
    explicacao:
      'No original, parte do crédito ficou como saldo credor (SLD_CRED do M100/M500) mesmo com contribuição a pagar no mês, o que ' +
      'costuma indicar crédito guardado para pedido de ressarcimento ou compensação. Só é perguntado para a empresa em que isso aparece.',
    opcoes: [
      {
        valor: true,
        rotulo: 'Manter a mesma proporção descontada no original',
        consequencia:
          'Cada tipo de crédito desconta a mesma proporção do disponível que o original descontou; o resto continua como saldo credor ' +
          'no 1100/1500 e a contribuição a recolher fica maior.',
      },
      {
        valor: false,
        rotulo: 'Descontar o máximo possível',
        consequencia:
          'O crédito que o original guardava passa a ser descontado até zerar a contribuição: o valor a recolher diminui e o saldo ' +
          'credor guardado diminui (o recálculo avisa quanto, com o código CREDITO_RETIDO).',
      },
    ],
  },
];

const valido = (id: IdCriterio, v: unknown) => CRITERIOS.find((c) => c.id === id)!.opcoes.some((o) => o.valor === v);

/** Critérios que valem para a empresa: os da sessão, sobrepostos pelos da empresa. */
export function criteriosDe(config: ConfigApuracao, cnpj: string): EscolhasCriterios {
  const out: EscolhasCriterios = {};
  const empresa = config.criteriosPorCnpj?.[cnpj] ?? {};
  for (const id of IDS_CRITERIOS) {
    const v = empresa[id] !== undefined ? empresa[id] : config[id];
    if (v !== undefined) (out as Record<string, unknown>)[id] = v;
  }
  return out;
}

/**
 * Escolhe um critério e devolve a configuração NOVA (não altera a recebida).
 * `cnpj` null = para todas as empresas (nível da sessão; apaga a escolha própria das
 * empresas para esse critério). `valor` undefined = desfaz a escolha.
 * Lança erro se o valor não for uma das opções de `CRITERIOS`.
 */
export function definirCriterio<K extends IdCriterio>(config: ConfigApuracao, cnpj: string | null, id: K, valor: EscolhasCriterios[K] | undefined): ConfigApuracao {
  if (valor !== undefined && !valido(id, valor)) throw new Error(`Valor "${String(valor)}" não é uma opção do critério ${id}.`);
  const porCnpj: Record<string, EscolhasCriterios> = {};
  for (const [c, e] of Object.entries(config.criteriosPorCnpj ?? {})) porCnpj[c] = { ...e };
  const novo: ConfigApuracao = { ...config, criteriosPorCnpj: porCnpj };
  if (cnpj === null) {
    if (valor === undefined) delete novo[id];
    else (novo as unknown as Record<string, unknown>)[id] = valor;
    for (const e of Object.values(porCnpj)) delete e[id];
  } else {
    const e = (porCnpj[cnpj] ??= {});
    if (valor === undefined) delete e[id];
    else e[id] = valor;
  }
  for (const [c, e] of Object.entries(porCnpj)) if (!Object.keys(e).length) delete porCnpj[c];
  return novo;
}

/** O original da escrituração guardou crédito havendo contribuição a recolher (mesmo indício do CREDITO_RETIDO)? */
function retidos(e: Escrituracao): { tributo: string; codCred: string; guardado: number }[] {
  const est = estadoDe(e);
  if (!est) return [];
  const out: { tributo: string; codCred: string; guardado: number }[] = [];
  for (const [id, nome] of [['pis', 'PIS/Pasep'], ['cofins', 'Cofins']] as const) {
    for (const [cc, r] of Object.entries(est.tributos[id].retencaoOriginal)) {
      if (r.disponivel > r.descontado) out.push({ tributo: nome, codCred: cc, guardado: r.disponivel - r.descontado });
    }
  }
  return out;
}

/** Critérios exigidos para a empresa (preservarRetencaoCredito só se algum original dela reteve crédito). */
export function criteriosExigidos(escrituracoesDaEmpresa: Escrituracao[]): IdCriterio[] {
  const ids: IdCriterio[] = ['saldoCredor', 'ordemUsoCredito', 'receitaBruta0111'];
  if (escrituracoesDaEmpresa.some((e) => retidos(e).length)) ids.push('preservarRetencaoCredito');
  return ids;
}

/** Critérios que faltam escolher, por empresa (só empresas com pendência). */
export function criteriosPendentes(config: ConfigApuracao, escrituracoes: Escrituracao[]): { cnpj: string; nome: string; pendentes: IdCriterio[] }[] {
  const out: { cnpj: string; nome: string; pendentes: IdCriterio[] }[] = [];
  for (const [cnpj, lista] of porEmpresa(escrituracoes)) {
    const esc = criteriosDe(config, cnpj);
    const pendentes = criteriosExigidos(lista).filter((id) => esc[id] === undefined);
    if (pendentes.length) out.push({ cnpj, nome: lista[0].nome, pendentes });
  }
  return out;
}

function porEmpresa(escrituracoes: Escrituracao[]): Map<string, Escrituracao[]> {
  const m = new Map<string, Escrituracao[]>();
  for (const e of [...escrituracoes].sort((a, b) => (a.periodo < b.periodo ? -1 : a.periodo > b.periodo ? 1 : 0))) {
    const l = m.get(e.cnpj);
    if (l) l.push(e);
    else m.set(e.cnpj, [e]);
  }
  return m;
}

const mesAno = (aaaamm: string) => `${aaaamm.slice(4, 6)}/${aaaamm.slice(0, 4)}`;
const perLegivel = (mmaaaa: string) => `${mmaaaa.slice(0, 2)}/${mmaaaa.slice(2)}`;
const proximo = (aaaamm: string) => {
  let a = Number(aaaamm.slice(0, 4));
  let m = Number(aaaamm.slice(4, 6)) + 1;
  if (m > 12) {
    m = 1;
    a++;
  }
  return `${a}${String(m).padStart(2, '0')}`;
};

export type IndiciosEmpresa = Partial<Record<IdCriterio, { valor: string | boolean; evidencia: string }>>;

/**
 * O que os arquivos ORIGINAIS de cada empresa mostram sobre os critérios, com a evidência
 * em uma frase. Só aparece o critério sobre o qual há indício. Não é aplicado sozinho.
 */
export function indiciosCriterios(escrituracoes: Escrituracao[]): Record<string, IndiciosEmpresa> {
  const out: Record<string, IndiciosEmpresa> = {};
  for (const [cnpj, lista] of porEmpresa(escrituracoes)) {
    const ind: IndiciosEmpresa = {};
    const estados = lista.map((e) => ({ e, est: estadoDe(e) })).filter((x) => !!x.est) as { e: Escrituracao; est: NonNullable<ReturnType<typeof estadoDe>> }[];

    // saldo credor: os originais traziam 1100/1500 de períodos anteriores?
    const comAnteriores = estados.filter((x) => x.est.fatosSaldo.anteriores.some((a) => a.usado > 0 || a.sobra > 0));
    if (comAnteriores.length) {
      const ex = comAnteriores[0];
      const a = ex.est.fatosSaldo.anteriores.find((y) => y.usado > 0 || y.sobra > 0)!;
      ind.saldoCredor = {
        valor: 'encadear',
        evidencia:
          `O original de ${mesAno(ex.e.periodo)} traz ${a.tributo === 'PIS/Pasep' ? '1100' : '1500'} do período ${perLegivel(a.per)} (crédito ${a.codCred}, ` +
          `R$ ${reais(a.usado)} usados no mês)` +
          (comAnteriores.length > 1 ? `, e outros ${comAnteriores.length - 1} mês(es) também trazem saldo de períodos anteriores` : '') +
          ': a empresa levava o saldo credor adiante.',
      };
    } else {
      const quebra = estados.find(
        (x) => x.est.fatosSaldo.proprios.length && estados.some((y) => y.e.periodo === proximo(x.e.periodo)),
      );
      if (quebra) {
        const total = quebra.est.fatosSaldo.proprios.reduce((s, p) => s + p.saldo, 0);
        ind.saldoCredor = {
          valor: 'somente-mes',
          evidencia: `O original de ${mesAno(quebra.e.periodo)} termina com saldo credor de R$ ${reais(total)} e o de ${mesAno(proximo(quebra.e.periodo))}, carregado, não traz esse crédito em 1100/1500.`,
        };
      }
    }

    // ordem de uso: como os originais consumiram os créditos quando havia dos dois tipos
    const votos = estados.flatMap((x) => x.est.fatosSaldo.ordem.map((o) => ({ ...o, periodo: x.e.periodo })));
    if (votos.length) {
      const ant = votos.filter((v) => v.voto === 'anteriores-primeiro');
      const mes = votos.filter((v) => v.voto === 'mes-primeiro');
      const ganhou = ant.length >= mes.length ? ant : mes;
      if (ant.length !== mes.length) {
        const meses = [...new Set(ganhou.map((v) => mesAno(v.periodo)))].join(', ');
        ind.ordemUsoCredito = {
          valor: ganhou[0].voto,
          evidencia:
            ganhou[0].voto === 'anteriores-primeiro'
              ? `Em ${meses} o original usou crédito de períodos anteriores enquanto sobrava crédito do próprio mês` +
                (mes.length ? ` (o contrário aparece em ${mes.length} caso(s))` : '') + '.'
              : `Em ${meses} o original usou o crédito do próprio mês enquanto sobrava crédito de períodos anteriores` +
                (ant.length ? ` (o contrário aparece em ${ant.length} caso(s))` : '') + '.',
        };
      }
    }

    // 0111: o original batia com a receita dos itens de nota por tipo?
    const com0111 = estados.filter((x) => x.est.original0111);
    if (com0111.length) {
      const bate = (x: (typeof com0111)[number]) => {
        const o = x.est.original0111!;
        const r = x.est.receitaOriginal;
        return o[0] === r.trib && o[1] === r.nt && o[2] === r.exp;
      };
      const iguais = com0111.filter(bate);
      const ex = com0111.find((x) => !bate(x)) ?? com0111[0];
      const o = ex.est.original0111!;
      const r = ex.est.receitaOriginal;
      ind.receitaBruta0111 =
        iguais.length === com0111.length
          ? {
              valor: 'ajustar-pelo-delta',
              evidencia: `Nos ${com0111.length} mês(es) carregados, o 0111 original é igual à receita dos itens de nota por tipo: a empresa formava o 0111 a partir dos documentos.`,
            }
          : {
              valor: 'manter',
              evidencia:
                `O 0111 original de ${mesAno(ex.e.periodo)} (tributada R$ ${reais(o[0])}, não tributada R$ ${reais(o[1])}, exportação R$ ${reais(o[2])}) ` +
                `não é igual à receita dos itens de nota (R$ ${reais(r.trib)}, R$ ${reais(r.nt)}, R$ ${reais(r.exp)}): a empresa informava o 0111 por outra fonte.`,
            };
    }

    // retenção de crédito
    for (const x of estados) {
      const r = retidos(x.e);
      if (!r.length) continue;
      ind.preservarRetencaoCredito = {
        valor: true,
        evidencia: `No original de ${mesAno(x.e.periodo)}, o crédito ${r[0].codCred} (${r[0].tributo}) tinha R$ ${reais(r[0].guardado)} guardados como saldo credor havendo contribuição a recolher.`,
      };
      break;
    }
    out[cnpj] = ind;
  }
  return out;
}
