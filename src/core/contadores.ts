/**
 * Contadores do arquivo: x990 (linhas de cada bloco), 9900 (um por tipo de registro),
 * 9990 (linhas do bloco 9) e 9999 (linhas do arquivo), além do IND_MOV dos registros
 * de abertura x001 (0 = bloco com dados, 1 = sem dados).
 *
 * A ordem dos 9900 segue a do arquivo original: se ele estava em ordem alfabética
 * (como gera o PVA) ou na ordem do leiaute, os tipos novos entram na posição
 * correspondente; senão vão para o fim (antes do 9900 do próprio 9900, se ele for o último).
 */
import { leiaute, novoRegistro, ordemRegistro, type Escrituracao, type Registro } from './modelo';
import { alterar, inserir, remover } from './mutacao';

function blocoDe(reg: string): string {
  return leiaute.registros[reg]?.bloco ?? reg[0];
}

function gravarNumero(e: Escrituracao, r: Registro, i: number, n: number): boolean {
  const atual = r.campos[i] ?? '';
  if (atual !== '' && Number(atual) === n) return false;
  return alterar(e, r, i, String(n));
}

export interface ResultadoRecontagem {
  /** Quantidade de linhas por tipo de registro. */
  porTipo: Record<string, number>;
  totalLinhas: number;
  /** Campos alterados pela recontagem. */
  alteracoes: number;
}

/**
 * Recalcula todos os contadores. Em um arquivo não editado não muda nada.
 * Altera pelas primitivas (desfazível quando chamado dentro de uma operação).
 */
export function recontar(e: Escrituracao): ResultadoRecontagem {
  let alteracoes = 0;
  // 1) IND_MOV dos x001 (antes de contar: não muda o número de linhas)
  for (const b of e.raiz.filhos) {
    if (!/^.001$/.test(b.reg) || b.reg === '9001') continue;
    const comDados = b.filhos.length > 0;
    if (gravarNumero(e, b, 1, comDados ? 0 : 1)) alteracoes++;
  }

  // 2) contagem por tipo (sem os 9900, que serão regenerados)
  const porTipo = new Map<string, number>();
  const pilha: Registro[] = [e.raiz];
  let r9001: Registro | null = null;
  while (pilha.length) {
    const r = pilha.pop()!;
    if (r.reg === '9001') r9001 = r;
    if (r.reg !== '9900') porTipo.set(r.reg, (porTipo.get(r.reg) ?? 0) + 1);
    for (let k = r.filhos.length - 1; k >= 0; k--) pilha.push(r.filhos[k]);
  }

  // 3) 9900: um por tipo presente, contando a si mesmo
  if (r9001) alteracoes += regenerar9900(e, r9001, porTipo);
  const n9900 = r9001 ? r9001.filhos.filter((f) => f.reg === '9900').length : 0;
  porTipo.set('9900', n9900);

  // 4) linhas por bloco
  const porBloco = new Map<string, number>();
  let total = 0;
  for (const [reg, n] of porTipo) {
    const b = blocoDe(reg);
    porBloco.set(b, (porBloco.get(b) ?? 0) + n);
    total += n;
  }
  for (const b of e.raiz.filhos) {
    if (!/^.990$/.test(b.reg)) continue;
    const bloco = blocoDe(b.reg);
    if (bloco === '9') {
      if (gravarNumero(e, b, 1, porBloco.get('9') ?? 0)) alteracoes++;
    } else if (gravarNumero(e, b, 1, porBloco.get(bloco) ?? 0)) alteracoes++;
  }
  const r9999 = e.raiz.filhos.find((f) => f.reg === '9999');
  if (r9999 && gravarNumero(e, r9999, 1, total)) alteracoes++;
  return { porTipo: Object.fromEntries(porTipo), totalLinhas: total, alteracoes };
}

type Estilo = 'alfabetica' | 'leiaute' | 'livre';

function compara(estilo: Estilo, a: string, b: string): number {
  if (estilo === 'alfabetica') return a < b ? -1 : a > b ? 1 : 0;
  return (ordemRegistro[a] ?? 1e9) - (ordemRegistro[b] ?? 1e9);
}

function detectarEstilo(tipos: string[]): Estilo {
  const ordenado = (est: Estilo) => tipos.every((t, i) => i === 0 || compara(est, tipos[i - 1], t) <= 0);
  if (ordenado('alfabetica')) return 'alfabetica';
  if (ordenado('leiaute')) return 'leiaute';
  return 'livre';
}

function regenerar9900(e: Escrituracao, r9001: Registro, porTipo: Map<string, number>): number {
  let alteracoes = 0;
  const desejado = new Map(porTipo);
  // tipos presentes + o próprio 9900
  const existentes = r9001.filhos.filter((f) => f.reg === '9900');
  // remove 9900 de tipos que não existem mais (e duplicados)
  const vistos = new Set<string>();
  for (const r of existentes) {
    const t = r.campos[1];
    if (t === '9900') {
      if (vistos.has(t)) remover(e, r);
      vistos.add(t);
      continue;
    }
    if (!desejado.has(t) || vistos.has(t)) {
      remover(e, r);
      alteracoes++;
    } else vistos.add(t);
  }
  let atuais = r9001.filhos.filter((f) => f.reg === '9900');
  const tiposAtuais = atuais.map((r) => r.campos[1]).filter((t) => t !== '9900');
  const estilo = detectarEstilo(tiposAtuais);
  const selfUltimo = atuais.length > 0 && atuais[atuais.length - 1].campos[1] === '9900';
  // inclui tipos novos
  const novos = [...desejado.keys()].filter((t) => !vistos.has(t));
  if (!vistos.has('9900')) novos.push('9900');
  for (const t of novos) {
    const r = novoRegistro('9900', { REG_BLC: t, QTD_REG_BLC: '0' });
    atuais = r9001.filhos.filter((f) => f.reg === '9900');
    let pos = r9001.filhos.length;
    const ultimoIdx = atuais.length ? r9001.filhos.indexOf(atuais[atuais.length - 1]) : r9001.filhos.length - 1;
    if (t === '9900') pos = ultimoIdx + 1;
    else if (estilo === 'livre') pos = selfUltimo ? ultimoIdx : ultimoIdx + 1;
    else {
      pos = selfUltimo ? ultimoIdx : ultimoIdx + 1;
      for (const a of atuais) {
        const ta = a.campos[1];
        if (ta === '9900' && selfUltimo) continue;
        if (compara(estilo, ta, t) > 0) {
          pos = r9001.filhos.indexOf(a);
          break;
        }
      }
    }
    inserir(e, r9001, r, Math.max(0, pos));
    alteracoes++;
  }
  // quantidades
  atuais = r9001.filhos.filter((f) => f.reg === '9900');
  for (const r of atuais) {
    const t = r.campos[1];
    const n = t === '9900' ? atuais.length : desejado.get(t) ?? 0;
    if (gravarNumero(e, r, 2, n)) alteracoes++;
  }
  return alteracoes;
}
