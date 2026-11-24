/**
 * Leitura do código-fonte para os testes de documentação (SÓ testes: usa node:fs).
 *
 * "Superfície" = o que o usuário vê e o manual/tour descrevem: abas, tipos de linha,
 * modos de base, opções das listas, critérios da apuração, chaves da configuração da
 * apuração e códigos de aviso.
 * Mudou a superfície → o carimbo (`carimbo.ts`) deixa de bater e o teste pede revisão.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TIPOS_LINHA_TODOS } from '../../core/linhas';
import { ROTULO_TIPO } from '../formato';
import { MODOS_BASE } from '../acoes';
import { CRITERIOS } from '../../core/apuracao';
import { TITULO_AVISO, TITULO_VALIDACAO } from '../apuracaoUi';
import { PASSOS_TOUR } from './passosTour';

/** Pasta `src/`. */
export const RAIZ_SRC = resolve(fileURLToPath(import.meta.url), '../../..');

function arquivos(dir: string, filtro: (caminho: string) => boolean): string[] {
  const out: string[] = [];
  for (const nome of readdirSync(dir)) {
    const c = join(dir, nome);
    if (statSync(c).isDirectory()) out.push(...arquivos(c, filtro));
    else if (filtro(c)) out.push(c);
  }
  return out.sort();
}

const ehTeste = (c: string) => /\.test\.tsx?$/.test(c);

/**
 * Componentes da interface onde âncoras e rótulos valem: os `.tsx` de `src/ui/` (atributos JSX
 * só existem em .tsx), sem testes e sem a página de demonstração (que põe atributos
 * pelo DOM, só para simular a integração).
 */
export function fontesDaInterface(): { arquivo: string; texto: string }[] {
  return arquivos(join(RAIZ_SRC, 'ui'), (c) => c.endsWith('.tsx') && !ehTeste(c) && !c.endsWith('Demonstracao.tsx')).map((c) => ({
    arquivo: relative(RAIZ_SRC, c).split(sep).join('/'),
    texto: readFileSync(c, 'utf-8'),
  }));
}

/** Âncoras `data-tour` presentes no código: literais e prefixos de template (`aba-${...}`). */
export function ancorasNoCodigo(fontes = fontesDaInterface()): { literais: Map<string, string>; prefixos: Map<string, string> } {
  const literais = new Map<string, string>();
  const prefixos = new Map<string, string>();
  for (const { arquivo, texto } of fontes) {
    for (const m of texto.matchAll(/data-tour=(?:"([^"]+)"|\{\s*'([^']+)'\s*\}|\{\s*"([^"]+)"\s*\})/g)) literais.set(m[1] ?? m[2] ?? m[3], arquivo);
    for (const m of texto.matchAll(/data-tour=\{\s*`([^`$]*)\$\{/g)) prefixos.set(m[1], arquivo);
  }
  return { literais, prefixos };
}

export function ancoraExiste(ancora: string, achadas = ancorasNoCodigo()): boolean {
  if (achadas.literais.has(ancora)) return true;
  for (const p of achadas.prefixos.keys()) if (p && ancora.startsWith(p)) return true;
  return false;
}

/** Abas do App, lidas da constante ABAS de `App.tsx`. */
export function abasDoApp(): { id: string; rotulo: string }[] {
  const texto = readFileSync(join(RAIZ_SRC, 'ui/App.tsx'), 'utf-8');
  const bloco = /const ABAS\s*=\s*\[([\s\S]*?)\]\s*as const/.exec(texto)?.[1];
  if (!bloco) throw new Error('Não achei a constante ABAS em src/ui/App.tsx: atualize abasDoApp() em src/ui/ajuda/superficie.ts.');
  return [...bloco.matchAll(/id:\s*'([^']+)',\s*rotulo:\s*'([^']+)'/g)].map((m) => ({ id: m[1], rotulo: m[2] }));
}

/** Chaves da interface `ConfigApuracao` (lidas de `contrato.ts`). */
export function chavesConfigApuracao(): string[] {
  const texto = readFileSync(join(RAIZ_SRC, 'core/apuracao/contrato.ts'), 'utf-8');
  const corpo = /export interface ConfigApuracao\s*\{([\s\S]*?)\n\}/.exec(texto)?.[1];
  if (!corpo) throw new Error('Não achei a interface ConfigApuracao em src/core/apuracao/contrato.ts.');
  return [...corpo.matchAll(/^ {2}(\w+)\??:/gm)].map((m) => m[1]).sort();
}

/**
 * Códigos de aviso conhecidos: os do motor (`codigo: 'X'`, `erro('X', ...)`,
 * `aviso('nivel', 'X', ...)` em `src/core`, fora dos testes) e os que a interface
 * titula (`TITULO_AVISO`, `TITULO_VALIDACAO`).
 */
export function codigosDeAviso(): string[] {
  const codigos = new Set<string>([...Object.keys(TITULO_AVISO), ...Object.keys(TITULO_VALIDACAO)]);
  for (const c of arquivos(join(RAIZ_SRC, 'core'), (x) => x.endsWith('.ts') && !ehTeste(x))) {
    const t = readFileSync(c, 'utf-8');
    for (const m of t.matchAll(/codigo:\s*'([A-Z0-9_]+)'/g)) codigos.add(m[1]);
    for (const m of t.matchAll(/\berro\(\s*'([A-Z0-9_]{3,})'/g)) codigos.add(m[1]);
    for (const m of t.matchAll(/\baviso\(\s*'(?:erro|alerta|info)',\s*'([A-Z0-9_]+)'/g)) codigos.add(m[1]);
  }
  return [...codigos].sort();
}

/** Opções de listas com valor e texto fixos nas telas (`<option value="x">texto</option>`). */
export function opcoesDasTelas(fontes = fontesDaInterface()): { arquivo: string; valor: string; rotulo: string }[] {
  const out: { arquivo: string; valor: string; rotulo: string }[] = [];
  for (const { arquivo, texto } of fontes) {
    if (arquivo.startsWith('ui/ajuda/')) continue;
    for (const m of texto.matchAll(/<option value="([^"]+)">([^<{]+)<\/option>/g)) out.push({ arquivo, valor: m[1], rotulo: m[2].trim() });
  }
  return out;
}

/** A superfície inteira, em linhas ordenadas (o que vai no carimbo). */
export function superficie(): string[] {
  const linhas = [
    ...abasDoApp().map((a) => `aba:${a.id}=${a.rotulo}`),
    ...TIPOS_LINHA_TODOS.map((t) => `tipoLinha:${t}=${ROTULO_TIPO[t]}`),
    ...MODOS_BASE.map((m) => `modoBase:${m.valor}=${m.rotulo}`),
    ...chavesConfigApuracao().map((c) => `config:${c}`),
    ...CRITERIOS.flatMap((c) => c.opcoes.map((o) => `criterio:${c.id}:${String(o.valor)}=${o.rotulo}`)),
    ...opcoesDasTelas().map((o) => `opcao:${o.arquivo.replace(/^ui\//, '')}:${o.valor}=${o.rotulo}`),
    ...codigosDeAviso().map((c) => `aviso:${c}`),
  ];
  return [...new Set(linhas)].sort();
}

/** Impressão digital do roteiro do tour (FNV-1a de 32 bits sobre o JSON dos passos). */
export function digitalRoteiro(passos = PASSOS_TOUR): string {
  const s = JSON.stringify(passos);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}
