import { centavos, paraEscala, ratearPartes } from '../core/dec';
import { filhosDe, get, listar, type Escrituracao } from '../core/modelo';
import { COFINS, PIS, type IdTributo } from '../core/apuracao/tributos';
import tabelas from '../core/tabelas.json';

export interface ValoresCredito {
  base: number | null;
  credito: number;
  ajuste: number;
}

export interface NaturezaCredito extends ValoresCredito {
  codigo: string;
  descricao: string;
  csts: (ValoresCredito & { cst: string })[];
}

const naturezaDaBase = tabelas.natBcCred as Record<string, string>;

export function creditosPorNatureza(e: Escrituracao, tributo: IdTributo): NaturezaCredito[] {
  const t = tributo === 'pis' ? PIS : COFINS;
  const { sfx } = t;
  const naturezas = new Map<string, Map<string, ValoresCredito>>();
  const adicionar = (natureza: string, cst: string, base: number | null, credito: number, ajuste: number) => {
    let csts = naturezas.get(natureza);
    if (!csts) naturezas.set(natureza, csts = new Map());
    const v = csts.get(cst) ?? { base: null, credito: 0, ajuste: 0 };
    if (base !== null) v.base = (v.base ?? 0) + base;
    v.credito += credito;
    v.ajuste += ajuste;
    csts.set(cst, v);
  };

  for (const pai of listar(e, t.M100)) {
    const credito = centavos(get(pai, 'VL_CRED'));
    const porQuantidade = paraEscala(get(pai, `ALIQ_${sfx}_QUANT`), 4) !== 0n;
    const detalhes = filhosDe(pai, t.M105).map((r) => {
      const codigo = get(r, 'NAT_BC_CRED');
      const cst = get(r, `CST_${sfx}`);
      const base = get(r, `VL_BC_${sfx}`);
      const baseEmReais = base === '' ? null : centavos(base);
      const peso = porQuantidade ? Number(paraEscala(get(r, `QUANT_BC_${sfx}`), 3)) : baseEmReais ?? 0;
      return { codigo, cst, base: baseEmReais, peso };
    });
    const parcelas = ratearPartes(credito, detalhes.map((d) => d.peso));
    detalhes.forEach((d, i) => adicionar(d.codigo, d.cst, d.base, parcelas[i], 0));
    const semBase = credito - parcelas.reduce((s, v) => s + v, 0);
    if (!detalhes.length || semBase) {
      const basePai = get(pai, `VL_BC_${sfx}`);
      adicionar('', '', detalhes.length || basePai === '' ? null : centavos(basePai), semBase, 0);
    }

    const ajustes = filhosDe(pai, t.M110);
    const liquido = ajustes.reduce((s, r) => {
      const indicador = get(r, 'IND_AJ');
      const valor = centavos(get(r, 'VL_AJ'));
      return s + (indicador === '1' ? valor : indicador === '0' ? -valor : 0);
    }, 0);
    const codigos = new Set(detalhes.map((d) => d.codigo));
    const csts = new Set(detalhes.map((d) => d.cst));
    const codigo = codigos.size === 1 ? detalhes[0].codigo : '';
    if (liquido) adicionar(codigo, codigo && csts.size === 1 ? detalhes[0].cst : '', null, 0, liquido);

    // O pai pode trazer ajustes sem detalhamento. A diferença fica sem vínculo.
    const ajustePai = ['VL_AJUS_ACRES', 'VL_AJUS_REDUC'].map((campo) => get(pai, campo));
    if (ajustePai.some((valor) => valor !== '')) {
      const diferenca = centavos(ajustePai[0]) - centavos(ajustePai[1]) - liquido;
      if (diferenca) adicionar('', '', null, 0, diferenca);
    }
  }

  return [...naturezas].sort(([a], [b]) => (a || '\uffff').localeCompare(b || '\uffff')).map(([codigo, porCst]) => {
    const csts = [...porCst].sort(([a], [b]) => (a || '\uffff').localeCompare(b || '\uffff')).map(([cst, v]) => ({ cst, ...v }));
    return {
      codigo,
      descricao: codigo ? (Object.hasOwn(naturezaDaBase, codigo) ? naturezaDaBase[codigo] : 'Código fora da tabela 4.3.7') : 'Créditos ou ajustes sem natureza identificada',
      base: csts.some((v) => v.base !== null) ? csts.reduce((s, v) => s + (v.base ?? 0), 0) : null,
      credito: csts.reduce((s, v) => s + v.credito, 0),
      ajuste: csts.reduce((s, v) => s + v.ajuste, 0),
      csts,
    };
  });
}
