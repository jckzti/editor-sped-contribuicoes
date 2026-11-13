/**
 * Modelo em memória de uma escrituração EFD-Contribuições.
 *
 * O arquivo é uma árvore de registros (0000 é a raiz). Cada registro guarda os
 * campos como texto, exatamente como vieram do arquivo, para que um arquivo
 * não editado seja regravado byte a byte igual ao original.
 */
import leiauteJson from './leiaute.json';

export interface CampoLeiaute {
  n: number;
  nome: string;
  descricao: string;
  tipo: 'C' | 'N';
  tam: number | null;
  dec: number | null;
  obrig: string;
  valores?: Record<string, string>;
  obs?: string;
  fixo?: boolean;
}

export interface RegistroLeiaute {
  bloco: string;
  descricao: string;
  nivel: number;
  ocorrencia: string;
  pai: string | null;
  campos: CampoLeiaute[];
}

export interface Leiaute {
  versaoGuia: string;
  registros: Record<string, RegistroLeiaute>;
  ordem: string[];
}

export const leiaute = leiauteJson as unknown as Leiaute;

/** Posição de cada registro na ordem do leiaute (para ordenar irmãos de tipos diferentes). */
export const ordemRegistro: Record<string, number> = Object.fromEntries(leiaute.ordem.map((r, i) => [r, i]));

const indiceCampos: Record<string, Record<string, number>> = {};
/** Índice (base 0, REG = 0) do campo `nome` no registro `reg`. Lança erro se não existir. */
export function idx(reg: string, nome: string): number {
  let mapa = indiceCampos[reg];
  if (!mapa) {
    const def = leiaute.registros[reg];
    if (!def) throw new Error(`Registro ${reg} não existe no leiaute`);
    mapa = indiceCampos[reg] = Object.fromEntries(def.campos.map((c, i) => [c.nome, i]));
  }
  const i = mapa[nome];
  if (i === undefined) throw new Error(`Campo ${nome} não existe no registro ${reg}`);
  return i;
}

export type EstadoRegistro = 'original' | 'editado' | 'novo';

export interface Registro {
  /** Código do registro, ex.: "C170". Igual a campos[0]. */
  reg: string;
  /** Campos na ordem do leiaute; campos[0] é o próprio REG. */
  campos: string[];
  filhos: Registro[];
  pai: Registro | null;
  /** Ausente = original, sem alteração. */
  estado?: EstadoRegistro;
  /**
   * Valores originais dos campos alterados (índice do campo → valor como estava
   * no arquivo), para reverter e para destacar na tela.
   *
   * Prefira `campoAlterado` e `valorOriginal` a ler isto direto: a representação
   * pode mudar (medimos 520 bytes por registro editado neste formato, contra 144
   * em arrays paralelos; a troca vale ~150 MB num trabalho de 5 anos e está
   * registrada como otimização pendente).
   */
  antes?: Record<number, string>;
}

/** O campo (por índice) foi alterado em relação ao arquivo original? */
export function campoAlterado(r: Registro, i: number): boolean {
  return r.antes !== undefined && i in r.antes;
}

/** Valor do campo como estava no arquivo original, ou o valor atual se não foi alterado. */
export function valorOriginal(r: Registro, i: number): string {
  return r.antes?.[i] ?? r.campos[i] ?? '';
}

/** Índices dos campos alterados em relação ao original. */
export function camposAlterados(r: Registro): number[] {
  return r.antes ? Object.keys(r.antes).map(Number) : [];
}

export interface Aviso {
  nivel: 'erro' | 'alerta' | 'info';
  codigo: string;
  mensagem: string;
  /** Linha do arquivo original, quando aplicável. */
  linha?: number;
}

export interface Escrituracao {
  /** Identificador interno: CNPJ + período + sequência de carga. */
  id: string;
  nomeArquivo: string;
  raiz: Registro;
  cnpj: string;
  nome: string;
  /** DDMMAAAA como no arquivo. */
  dtIni: string;
  dtFim: string;
  /** AAAAMM, para ordenar e encadear meses. */
  periodo: string;
  /** O arquivo veio assinado (bytes depois do 9999) e a assinatura foi descartada. */
  assinaturaRemovida: boolean;
  /** Quebra de linha do original, preservada na gravação. */
  quebraLinha: '\r\n' | '\n';
  avisos: Aviso[];
  /** Houve alteração desde a carga (ou desde a última gravação). */
  alterada: boolean;
}

/** Lê o campo pelo nome. */
export function get(r: Registro, nome: string): string {
  return r.campos[idx(r.reg, nome)] ?? '';
}

/** Grava o campo pelo nome, registrando o valor anterior. Não dispara recálculo. */
export function set(r: Registro, nome: string, valor: string): void {
  const i = idx(r.reg, nome);
  const atual = r.campos[i] ?? '';
  if (atual === valor) return;
  if (r.estado !== 'novo') {
    r.antes ??= {};
    if (!(i in r.antes)) r.antes[i] = atual;
    else if (r.antes[i] === valor) delete r.antes[i];
    r.estado = Object.keys(r.antes).length ? 'editado' : undefined;
    if (!r.estado) delete r.antes;
  }
  r.campos[i] = valor;
}

/** Cria um registro novo com todos os campos vazios (ou os informados por nome). */
export function novoRegistro(reg: string, valores: Record<string, string> = {}): Registro {
  const def = leiaute.registros[reg];
  if (!def) throw new Error(`Registro ${reg} não existe no leiaute`);
  const campos = def.campos.map(() => '');
  campos[0] = reg;
  for (const [nome, v] of Object.entries(valores)) campos[idx(reg, nome)] = v;
  return { reg, campos, filhos: [], pai: null, estado: 'novo' };
}

/** Insere `filho` sob `pai` respeitando a ordem do leiaute entre irmãos (depois dos irmãos do mesmo tipo). */
export function inserirFilho(pai: Registro, filho: Registro): void {
  filho.pai = pai;
  const ord = ordemRegistro[filho.reg] ?? Number.MAX_SAFE_INTEGER;
  let pos = pai.filhos.length;
  for (let i = 0; i < pai.filhos.length; i++) {
    const o = ordemRegistro[pai.filhos[i].reg] ?? Number.MAX_SAFE_INTEGER;
    if (o > ord) {
      pos = i;
      break;
    }
  }
  pai.filhos.splice(pos, 0, filho);
}

/** Remove o registro (e toda a sua subárvore) do pai. */
export function removerRegistro(r: Registro): void {
  if (!r.pai) return;
  const i = r.pai.filhos.indexOf(r);
  if (i >= 0) r.pai.filhos.splice(i, 1);
  r.pai = null;
}

/** Percorre a árvore em ordem de arquivo. */
export function* percorrer(r: Registro): Generator<Registro> {
  yield r;
  for (const f of r.filhos) yield* percorrer(f);
}

/** Todos os registros de um tipo, em ordem de arquivo. */
export function listar(e: Escrituracao | Registro, reg: string): Registro[] {
  const raiz = 'raiz' in e ? e.raiz : e;
  const out: Registro[] = [];
  const alvoNivel = leiaute.registros[reg]?.nivel ?? 99;
  const visita = (r: Registro, ehRaiz: boolean) => {
    if (r.reg === reg) out.push(r);
    // Não desce abaixo do nível em que o registro procurado pode estar. A raiz é
    // exceção: registros de nível 0 e 1 (9999, 0990, C990...) são filhos dela na
    // árvore, então podar na raiz esconderia justamente esses.
    if (!ehRaiz && (leiaute.registros[r.reg]?.nivel ?? 0) >= alvoNivel) return;
    for (const f of r.filhos) visita(f, false);
  };
  visita(raiz, true);
  return out;
}

/** Filhos diretos de um tipo. */
export function filhosDe(r: Registro, reg: string): Registro[] {
  return r.filhos.filter((f) => f.reg === reg);
}

/** Primeiro ancestral do tipo informado (ex.: o C100 de um C170, o C010 de um C100). */
export function ancestral(r: Registro, reg: string): Registro | null {
  let p = r.pai;
  while (p && p.reg !== reg) p = p.pai;
  return p;
}
