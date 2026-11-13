/**
 * Utilitários sem dependência do modelo: números, datas, documentos (CNPJ/CPF/chave)
 * e conversões rápidas usadas nos filtros da grade.
 */
import { deEscala, paraEscala } from './dec';

/** Só os dígitos de um texto ("12.345.678/0001-90" → "12345678000190"). */
export function soDigitos(s: string | null | undefined): string {
  return (s ?? '').replace(/\D+/g, '');
}

/** Valida o dígito verificador de um CNPJ (14 dígitos). */
export function cnpjValido(c: string): boolean {
  if (!/^\d{14}$/.test(c) || /^(\d)\1{13}$/.test(c)) return false;
  const calc = (n: number) => {
    let soma = 0;
    let peso = n - 7;
    for (let i = 0; i < n; i++) {
      soma += Number(c[i]) * peso--;
      if (peso < 2) peso = 9;
    }
    const r = soma % 11;
    return r < 2 ? 0 : 11 - r;
  };
  return calc(12) === Number(c[12]) && calc(13) === Number(c[13]);
}

/** Valida o dígito verificador de um CPF (11 dígitos). */
export function cpfValido(c: string): boolean {
  if (!/^\d{11}$/.test(c) || /^(\d)\1{10}$/.test(c)) return false;
  for (const n of [9, 10]) {
    let soma = 0;
    for (let i = 0; i < n; i++) soma += Number(c[i]) * (n + 1 - i);
    const r = ((soma * 10) % 11) % 10;
    if (r !== Number(c[n])) return false;
  }
  return true;
}

/** Dígito verificador (módulo 11) dos 43 primeiros dígitos de uma chave de NF-e/CT-e. */
export function dvChave(chave43: string): number {
  let soma = 0;
  let peso = 2;
  for (let i = chave43.length - 1; i >= 0; i--) {
    soma += Number(chave43[i]) * peso;
    peso = peso === 9 ? 2 : peso + 1;
  }
  const r = soma % 11;
  return r < 2 ? 0 : 11 - r;
}

/** Chave de acesso (NF-e, CT-e, NF3-e...) com 44 dígitos e dígito verificador correto. */
export function chaveValida(chave: string): boolean {
  if (!/^\d{44}$/.test(chave)) return false;
  return dvChave(chave.slice(0, 43)) === Number(chave[43]);
}

/** "AAAA-MM-DD" (ou "AAAA-MM-DDTHH:MM...") → "DDMMAAAA". Devolve "" se inválida. */
export function isoParaSped(iso: string | null | undefined): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec((iso ?? '').trim());
  if (!m) return '';
  const s = m[3] + m[2] + m[1];
  return dataSpedValida(s) ? s : '';
}

/** "DDMMAAAA" → "AAAA-MM-DD". */
export function spedParaIso(s: string): string {
  return s.length === 8 ? `${s.slice(4)}-${s.slice(2, 4)}-${s.slice(0, 2)}` : '';
}

/** "DDMMAAAA" → "DD/MM/AAAA" (para exibir). */
export function spedParaBr(s: string): string {
  return s.length === 8 ? `${s.slice(0, 2)}/${s.slice(2, 4)}/${s.slice(4)}` : s;
}

/** A data DDMMAAAA existe no calendário? */
export function dataSpedValida(s: string): boolean {
  if (!/^\d{8}$/.test(s)) return false;
  const d = Number(s.slice(0, 2));
  const m = Number(s.slice(2, 4));
  const a = Number(s.slice(4));
  if (m < 1 || m > 12 || d < 1 || a < 1900) return false;
  const dias = new Date(Date.UTC(a, m, 0)).getUTCDate();
  return d <= dias;
}

/**
 * Data DDMMAAAA → número AAAAMMDD (para comparar), sem alocar strings.
 * Devolve NaN se o texto não tiver 8 dígitos.
 */
export function dataSpedParaNumero(s: string): number {
  if (s.length !== 8) return NaN;
  let dd = 0;
  let mm = 0;
  let aaaa = 0;
  for (let i = 0; i < 8; i++) {
    const c = s.charCodeAt(i) - 48;
    if (c < 0 || c > 9) return NaN;
    if (i < 2) dd = dd * 10 + c;
    else if (i < 4) mm = mm * 10 + c;
    else aaaa = aaaa * 10 + c;
  }
  return aaaa * 10000 + mm * 100 + dd;
}

/**
 * Data digitada pelo usuário ("31/03/2025", "2025-03-31", "31032025") → número AAAAMMDD.
 * NaN se não reconhecer.
 */
export function dataUsuarioParaNumero(v: string | number): number {
  const s = String(v).trim();
  let m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (m) return Number(m[3] + m[2] + m[1]);
  m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return Number(m[1] + m[2] + m[3]);
  if (/^\d{8}$/.test(s)) return dataSpedParaNumero(s);
  return NaN;
}

/**
 * Converte texto numérico (vírgula ou ponto decimal) em number sem alocar.
 * Aceita sinal. Vazio ou inválido → NaN. Usado para filtrar/ordenar a grade.
 */
export function numeroRapido(s: string): number {
  const n = s.length;
  if (n === 0) return NaN;
  let i = 0;
  let neg = false;
  if (s.charCodeAt(0) === 45 /* - */) {
    neg = true;
    i = 1;
  }
  let int = 0;
  let frac = 0;
  let div = 1;
  let ponto = false;
  let digitos = 0;
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      digitos++;
      if (ponto) {
        frac = frac * 10 + (c - 48);
        div *= 10;
      } else int = int * 10 + (c - 48);
    } else if ((c === 44 || c === 46) && !ponto) ponto = true;
    else return NaN;
  }
  if (!digitos) return NaN;
  const v = int + frac / div;
  return neg ? -v : v;
}

/**
 * Texto numérico (vírgula ou ponto decimal; sinal opcional) → inteiro escalado por 10^6
 * (micro-unidades), sem ponto flutuante na parte fracionária: "1,61" → 1610000. Para
 * comparar valores exatamente (filtros "igual a", "entre"...): `numeroRapido` faz a conta em
 * ponto flutuante e "1,61" não sai igual a 1.61. Casas além da 6ª são arredondadas meio
 * para cima. Vazio ou inválido → NaN. Exato até ~9 bilhões; acima disso, aproximado.
 */
export function numeroEscalado(s: string): number {
  const n = s.length;
  if (n === 0) return NaN;
  let i = 0;
  let neg = false;
  if (s.charCodeAt(0) === 45 /* - */) {
    neg = true;
    i = 1;
  }
  let int = 0;
  let frac = 0;
  let casas = -1;
  let arred = 0;
  let digitos = 0;
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c >= 48 && c <= 57) {
      digitos++;
      const d = c - 48;
      if (casas < 0) int = int * 10 + d;
      else {
        if (casas < 6) frac = frac * 10 + d;
        else if (casas === 6) arred = d >= 5 ? 1 : 0;
        casas++;
      }
    } else if ((c === 44 || c === 46) && casas < 0) casas = 0;
    else return NaN;
  }
  if (!digitos) return NaN;
  for (let k = Math.max(casas, 0); k < 6; k++) frac *= 10;
  const v = int * 1_000_000 + frac + arred;
  return neg ? -v : v;
}

/**
 * Texto do SPED → centavos (number), meio para cima, sem BigInt (rápido para somar
 * centenas de milhares de linhas). Vazio vale 0. Seguro para valores até ~90 trilhões.
 * Espaços nas pontas são ignorados. Texto que não é número (letras, dois separadores
 * como "1.234,56", só sinal...) → NaN: nunca vira 0 em silêncio. Quem soma deve tratar
 * (os totais não são regravados; a verificação aponta NUMERO_INVALIDO).
 */
export function centavosRapido(s: string | undefined): number {
  if (!s) return 0;
  let n = s.length;
  let i = 0;
  while (i < n && s.charCodeAt(i) === 32) i++;
  while (n > i && s.charCodeAt(n - 1) === 32) n--;
  if (i === n) return 0;
  let neg = false;
  if (s.charCodeAt(i) === 45) {
    neg = true;
    i++;
  }
  let int = 0;
  let casas = -1;
  let frac = 0;
  let arred = 0;
  let digitos = 0;
  for (; i < n; i++) {
    const c = s.charCodeAt(i);
    if (c === 44 || c === 46) {
      if (casas >= 0) return NaN; // dois separadores
      casas = 0;
      continue;
    }
    const d = c - 48;
    if (d < 0 || d > 9) return NaN;
    digitos++;
    if (casas < 0) int = int * 10 + d;
    else {
      if (casas < 2) frac = frac * 10 + d;
      else if (casas === 2) arred = d >= 5 ? 1 : 0;
      casas++;
    }
  }
  if (!digitos) return NaN;
  if (casas === 1) frac *= 10;
  else if (casas <= 0) frac = 0;
  const v = int * 100 + frac + arred;
  return neg ? -v : v;
}

/**
 * Normaliza número vindo do usuário ou de planilha para texto com ponto decimal e sem milhar.
 * Regras: se há vírgula, ela é o decimal e pontos são milhar ("1.234,56");
 * senão, um único ponto é decimal ("1234.56"); vários pontos são milhar ("1.234.567").
 * Devolve null se não for número.
 */
export function normalizarNumero(v: string | number | null | undefined): string | null {
  if (v === null || v === undefined) return null;
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) return null;
    // evita notação exponencial e ruído de ponto flutuante
    return v.toFixed(8).replace(/\.?0+$/, '') || '0';
  }
  let s = v.trim().replace(/\s+/g, '');
  if (!s) return null;
  if (s.includes(',')) s = s.replace(/\./g, '').replace(',', '.');
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, '');
  if (!/^-?\d*(\.\d*)?$/.test(s) || !/\d/.test(s)) return null;
  return s;
}

/** Quantidade de casas decimais de um número normalizado ("12.345" → 3). */
export function casasDecimais(normalizado: string): number {
  const i = normalizado.indexOf('.');
  return i < 0 ? 0 : normalizado.length - i - 1;
}

/**
 * Número (qualquer formato aceito por `normalizarNumero`) → texto do SPED com até `casas`
 * decimais (arredonda meio para cima), sem zeros à direita. null se inválido.
 */
export function paraTextoSped(v: string | number | null | undefined, casas: number): string | null {
  const n = normalizarNumero(v);
  if (n === null) return null;
  return deEscala(paraEscala(n, casas), casas);
}

/** Código IBGE da UF (2 primeiros dígitos do município) → sigla. */
export const UF_POR_CODIGO: Record<string, string> = {
  '11': 'RO', '12': 'AC', '13': 'AM', '14': 'RR', '15': 'PA', '16': 'AP', '17': 'TO',
  '21': 'MA', '22': 'PI', '23': 'CE', '24': 'RN', '25': 'PB', '26': 'PE', '27': 'AL', '28': 'SE', '29': 'BA',
  '31': 'MG', '32': 'ES', '33': 'RJ', '35': 'SP',
  '41': 'PR', '42': 'SC', '43': 'RS',
  '50': 'MS', '51': 'MT', '52': 'GO', '53': 'DF',
};

/** UF a partir do código IBGE do município (7 dígitos). "" se não reconhecer. */
export function ufDoMunicipio(codMun: string): string {
  return UF_POR_CODIGO[codMun.slice(0, 2)] ?? '';
}

/** "AAAAMM" → "AAAA-MM". */
export function periodoIso(periodo: string): string {
  return periodo.length === 6 ? `${periodo.slice(0, 4)}-${periodo.slice(4)}` : periodo;
}

/** Gera um identificador curto (para regras e operações). */
export function novoId(prefixo = ''): string {
  return prefixo + Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}
