/**
 * Aritmética decimal exata para valores do SPED.
 *
 * Valores monetários são tratados como inteiros em centavos (number), o que é
 * seguro até ~90 trilhões de reais. Multiplicações (base × alíquota, rateio)
 * usam BigInt para não perder precisão. Arredondamento: meio para cima
 * (half-up), que é o que reproduz os valores do PVA/ERP na amostra.
 *
 * Formato de texto do SPED: vírgula decimal, sem separador de milhar e sem
 * zeros à direita ("12424517,7", "140", "0").
 */

/** Converte texto do SPED em inteiro escalado por 10^casas (half-up se houver casas a mais). */
export function paraEscala(s: string | undefined | null, casas: number): bigint {
  if (!s) return 0n;
  let t = s.trim();
  if (!t) return 0n;
  let neg = false;
  if (t[0] === '-') {
    neg = true;
    t = t.slice(1);
  }
  const [intStr, fracRaw = ''] = t.replace('.', ',').split(',');
  const frac = fracRaw.padEnd(casas + 1, '0');
  let v = BigInt((intStr || '0') + frac.slice(0, casas) || '0');
  if (frac.charCodeAt(casas) >= 53 /* '5' */) v += 1n;
  return neg ? -v : v;
}

/** Formata inteiro escalado por 10^casas no padrão do SPED (sem zeros à direita). */
export function deEscala(v: bigint, casas: number): string {
  const neg = v < 0n;
  const abs = (neg ? -v : v).toString().padStart(casas + 1, '0');
  const int = abs.slice(0, abs.length - casas);
  const frac = abs.slice(abs.length - casas).replace(/0+$/, '');
  return (neg ? '-' : '') + int + (frac ? ',' + frac : '');
}

/** Texto do SPED → centavos. Campo vazio vale 0. */
export function centavos(s: string | undefined | null): number {
  return Number(paraEscala(s, 2));
}

/** Centavos → texto do SPED ("0" para zero). */
export function fmtCentavos(c: number): string {
  if (!Number.isFinite(c)) throw new Error(`Valor monetário inválido (${String(c)}): há campo numérico com texto que não é número.`);
  return deEscala(BigInt(Math.round(c)), 2);
}

/** Divisão inteira com arredondamento meio para cima (denominador > 0). */
export function divArred(numerador: bigint, denominador: bigint): bigint {
  if (denominador === 0n) return 0n;
  const neg = numerador < 0n !== denominador < 0n;
  const n = numerador < 0n ? -numerador : numerador;
  const d = denominador < 0n ? -denominador : denominador;
  const q = (2n * n + d) / (2n * d);
  return neg ? -q : q;
}

/** base (centavos) × alíquota percentual (texto, até 4 casas) → centavos, half-up. */
export function mulAliq(baseCent: number, aliqPercentual: string | undefined | null): number {
  const aliq = paraEscala(aliqPercentual, 4); // 1,65% → 16500
  return Number(divArred(BigInt(Math.round(baseCent)) * aliq, 1_000_000n));
}

/** total × parte ÷ denominador, em centavos, half-up. Usado no rateio proporcional. */
export function ratear(totalCent: number, parteCent: number, denominadorCent: number): number {
  if (!denominadorCent) return 0;
  return Number(
    divArred(BigInt(Math.round(totalCent)) * BigInt(Math.round(parteCent)), BigInt(Math.round(denominadorCent))),
  );
}

/**
 * Divide `totalCent` em parcelas proporcionais a `partes` cuja soma é exatamente o total
 * (método do maior resto: cada parcela recebe a parte inteira e os centavos que sobram vão
 * para as maiores frações; empate fica com a parte que vem antes). Partes ≤ 0 recebem 0.
 * Com duas partes, dá o mesmo que arredondar cada uma meio para cima quando essas somam o total.
 */
export function ratearPartes(totalCent: number, partes: number[]): number[] {
  const out = partes.map(() => 0);
  const denom = partes.reduce((s, p) => s + (p > 0 ? p : 0), 0);
  if (denom <= 0) return out;
  const t = BigInt(Math.round(totalCent));
  const neg = t < 0n;
  const abs = neg ? -t : t;
  const d = BigInt(Math.round(denom));
  const restos: { i: number; r: bigint }[] = [];
  let soma = 0n;
  partes.forEach((p, i) => {
    if (p <= 0) return;
    const num = abs * BigInt(Math.round(p));
    const q = num / d;
    soma += q;
    out[i] = Number(q);
    restos.push({ i, r: num % d });
  });
  restos.sort((a, b) => (a.r === b.r ? a.i - b.i : a.r > b.r ? -1 : 1));
  for (let k = 0; soma < abs && k < restos.length; k++, soma++) out[restos[k].i]++;
  return neg ? out.map((v) => -v) : out;
}

/** Quantidade × valor unitário etc.: multiplica dois textos decimais e devolve centavos. */
export function mulParaCentavos(a: string, b: string, casasA = 5, casasB = 6): number {
  const prod = paraEscala(a, casasA) * paraEscala(b, casasB);
  return Number(divArred(prod, 10n ** BigInt(casasA + casasB - 2)));
}

/** Compara dois textos numéricos do SPED pelo valor ("1,50" == "1,5", "" == "0"). */
export function mesmoValor(a: string | undefined, b: string | undefined, casas = 6): boolean {
  return paraEscala(a, casas) === paraEscala(b, casas);
}
