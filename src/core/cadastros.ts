/**
 * Cadastros do bloco 0 (0150 participantes, 0190 unidades, 0200 itens, 0400 natureza
 * da operação, 0500 plano de contas): índices para leitura O(1) e sincronização com o
 * uso nos documentos.
 *
 * Os cadastros 0150/0190/0200/0400 ficam sob o 0140 do estabelecimento; o 0500 é do
 * arquivo inteiro. Um documento do C010 de CNPJ X usa os cadastros do 0140 de CNPJ X.
 */
import { estadoDe, gravarCache, lerCache } from './estado';
import type { ItemImport, ParticipanteImport } from './importacao.tipos';
import { mapaEstab, novoUsoTipo, usoCadastros, type TipoCadastro, type UsoCadastros } from './leituras';
import { idx, novoRegistro, type Aviso, type Escrituracao, type Registro } from './modelo';
import { inserir, remover } from './mutacao';
import { soDigitos } from './util';

export interface CadastrosEstab {
  /** Registro 0140 (null se o arquivo não tiver nenhum). */
  r0140: Registro | null;
  cnpj: string;
  /** COD_PART → 0150 */
  part: Map<string, Registro>;
  /** CNPJ ou CPF → 0150 */
  partDoc: Map<string, Registro>;
  /** COD_ITEM → 0200 */
  item: Map<string, Registro>;
  /** UNID → 0190 */
  unid: Map<string, Registro>;
  /** COD_NAT → 0400 */
  nat: Map<string, Registro>;
}

export interface IndicesCadastro {
  /** CNPJ do 0140 → cadastros do estabelecimento. */
  estabs: Map<string, CadastrosEstab>;
  /** Primeiro estabelecimento (usado quando o CNPJ do documento não tem 0140 próprio). */
  padrao: CadastrosEstab;
  /** COD_CTA → 0500 */
  contas: Map<string, Registro>;
}

const I = {
  cnpj0140: idx('0140', 'CNPJ'),
  codPart: idx('0150', 'COD_PART'),
  cnpj0150: idx('0150', 'CNPJ'),
  cpf0150: idx('0150', 'CPF'),
  codItem: idx('0200', 'COD_ITEM'),
  unidInv: idx('0200', 'UNID_INV'),
  unid: idx('0190', 'UNID'),
  codNat: idx('0400', 'COD_NAT'),
  codCta: idx('0500', 'COD_CTA'),
};

const TIPO_DO_REG: Record<string, TipoCadastro> = { '0150': 'part', '0200': 'item', '0190': 'unid', '0400': 'nat' };
const CAMPO_CODIGO: Record<string, number> = { '0150': I.codPart, '0200': I.codItem, '0190': I.unid, '0400': I.codNat };

function vazioEstab(r0140: Registro | null, cnpj: string): CadastrosEstab {
  return { r0140, cnpj, part: new Map(), partDoc: new Map(), item: new Map(), unid: new Map(), nat: new Map() };
}

function registros0140(e: Escrituracao): Registro[] {
  const out: Registro[] = [];
  for (const b of e.raiz.filhos) if (b.reg === '0001') for (const f of b.filhos) if (f.reg === '0140') out.push(f);
  return out;
}

/** Índices de cadastro da escrituração (cache refeito quando a estrutura muda). */
export function indices(e: Escrituracao): IndicesCadastro {
  const c = lerCache<IndicesCadastro>(e, 'indices');
  if (c) return c;
  const estabs = new Map<string, CadastrosEstab>();
  let padrao: CadastrosEstab | null = null;
  for (const r0140 of registros0140(e)) {
    const cnpj = r0140.campos[I.cnpj0140] ?? '';
    const ce = vazioEstab(r0140, cnpj);
    for (const f of r0140.filhos) {
      const v = f.campos;
      switch (f.reg) {
        case '0150': {
          ce.part.set(v[I.codPart], f);
          const doc = v[I.cnpj0150] || v[I.cpf0150];
          if (doc && !ce.partDoc.has(doc)) ce.partDoc.set(doc, f);
          break;
        }
        case '0200':
          ce.item.set(v[I.codItem], f);
          break;
        case '0190':
          ce.unid.set(v[I.unid], f);
          break;
        case '0400':
          ce.nat.set(v[I.codNat], f);
          break;
      }
    }
    if (!estabs.has(cnpj)) estabs.set(cnpj, ce);
    padrao ??= ce;
  }
  const contas = new Map<string, Registro>();
  for (const b of e.raiz.filhos) if (b.reg === '0001') for (const f of b.filhos) if (f.reg === '0500') contas.set(f.campos[I.codCta], f);
  return gravarCache(e, 'indices', { estabs, padrao: padrao ?? vazioEstab(null, ''), contas });
}

/** Cadastros do estabelecimento de CNPJ `cnpj` (ou do primeiro, se não houver 0140 com esse CNPJ). */
export function cadastrosDe(e: Escrituracao, cnpj: string): CadastrosEstab {
  const ix = indices(e);
  return ix.estabs.get(cnpj) ?? ix.padrao;
}

/** Uso efetivo para um 0140: o do próprio CNPJ + o de CNPJs sem 0140 + o global. */
function usoParaEstab(uso: UsoCadastros, cnpj: string, cnpjs0140: Set<string>): Record<TipoCadastro, Set<string>> {
  const out = novoUsoTipo();
  const junta = (m: Record<TipoCadastro, Set<string>>) => {
    for (const t of Object.keys(out) as TipoCadastro[]) for (const v of m[t]) out[t].add(v);
  };
  junta(uso.global);
  for (const [k, m] of uso.porEstab) if (k === cnpj || !cnpjs0140.has(k)) junta(m);
  return out;
}

function chaveRemovido(reg: string, cnpj: string, cod: string): string {
  return `${reg}|${cnpj}|${cod}`;
}

/**
 * Garante a coerência dos cadastros com os documentos:
 * - remove o registro de estabelecimento do bloco (C010/D010/F010...) que ficou sem
 *   nenhum filho (ver `sincronizarEstabelecimentos`);
 * - remove 0150/0200/0400/0190/0500 que eram usados no arquivo original e deixaram de ser,
 *   e os criados pelo editor que ficaram sem uso (cadastros que já eram órfãos no
 *   original nunca são removidos);
 * - recoloca, na posição original, um cadastro removido antes que voltou a ser usado;
 * - avisa sobre código usado sem cadastro (não inventa dados de cadastro).
 * Altera a árvore pelas primitivas (desfazível quando chamado dentro de uma operação).
 */
export function sincronizarCadastros(e: Escrituracao): Aviso[] {
  const st = estadoDe(e);
  const avisos: Aviso[] = [];
  sincronizarEstabelecimentos(e);
  const uso = usoCadastros(e, false);
  const orig = st.usoOriginal;
  const lista0140 = registros0140(e);
  const cnpjs0140 = new Set(lista0140.map((r) => r.campos[I.cnpj0140] ?? ''));

  for (const r0140 of lista0140) {
    const cnpj = r0140.campos[I.cnpj0140] ?? '';
    const usado = usoParaEstab(uso, cnpj, cnpjs0140);
    const origEstab = usoParaEstab(orig, cnpj, cnpjs0140);
    // 1) 0150, 0200, 0400: remove órfãos que nós criamos
    for (const f of [...r0140.filhos]) {
      const tipo = TIPO_DO_REG[f.reg];
      if (!tipo || tipo === 'unid') continue;
      const cod = f.campos[CAMPO_CODIGO[f.reg]];
      if (!usado[tipo].has(cod) && (origEstab[tipo].has(cod) || f.estado === 'novo')) {
        st.removidosCadastro.set(chaveRemovido(f.reg, cnpj, cod), { registro: f, pai: r0140 });
        remover(e, f);
      }
    }
    // 2) unidades: usadas pelos documentos e pelos 0200 que ficaram
    for (const f of r0140.filhos) if (f.reg === '0200' && f.campos[I.unidInv]) usado.unid.add(f.campos[I.unidInv]);
    for (const f of [...r0140.filhos]) {
      if (f.reg !== '0190') continue;
      const cod = f.campos[I.unid];
      if (!usado.unid.has(cod) && (origEstab.unid.has(cod) || f.estado === 'novo')) {
        st.removidosCadastro.set(chaveRemovido('0190', cnpj, cod), { registro: f, pai: r0140 });
        remover(e, f);
      }
    }
    // 3) códigos usados sem cadastro: recoloca o removido, senão avisa
    const presentes: Record<TipoCadastro, Set<string>> = novoUsoTipo();
    for (const f of r0140.filhos) {
      const tipo = TIPO_DO_REG[f.reg];
      if (tipo) presentes[tipo].add(f.campos[CAMPO_CODIGO[f.reg]]);
    }
    const docsDoEstab = usoParaEstab(uso, cnpj, cnpjs0140);
    for (const f of r0140.filhos) if (f.reg === '0200' && f.campos[I.unidInv]) docsDoEstab.unid.add(f.campos[I.unidInv]);
    for (const [reg, tipo, nome] of [
      ['0150', 'part', 'participante (0150)'],
      ['0200', 'item', 'item (0200)'],
      ['0190', 'unid', 'unidade (0190)'],
      ['0400', 'nat', 'natureza da operação (0400)'],
    ] as const) {
      for (const cod of docsDoEstab[tipo]) {
        if (presentes[tipo].has(cod)) continue;
        const rem = st.removidosCadastro.get(chaveRemovido(reg, cnpj, cod));
        if (rem && !rem.registro.pai) {
          inserir(e, rem.pai, rem.registro);
          presentes[tipo].add(cod);
          continue;
        }
        // só avisa do que não era usado no original (se já faltava no original, não é problema nosso)
        if (!origEstab[tipo].has(cod)) {
          avisos.push({ nivel: 'erro', codigo: 'CADASTRO_AUSENTE', mensagem: `Código ${cod} usado nos documentos sem cadastro de ${nome} no estabelecimento ${cnpj}.` });
        }
      }
    }
  }

  // 4) plano de contas (0500), do arquivo inteiro
  const contasPresentes = new Set<string>();
  let pai0001: Registro | null = null;
  for (const b of e.raiz.filhos) {
    if (b.reg !== '0001') continue;
    pai0001 = b;
    for (const f of [...b.filhos]) {
      if (f.reg !== '0500') continue;
      const cod = f.campos[I.codCta];
      if (!uso.contas.has(cod) && (orig.contas.has(cod) || f.estado === 'novo')) {
        st.removidosCadastro.set(chaveRemovido('0500', '', cod), { registro: f, pai: b });
        remover(e, f);
      } else contasPresentes.add(cod);
    }
  }
  if (pai0001) {
    const arquivoTemPlano = contasPresentes.size > 0 || [...st.removidosCadastro.keys()].some((k) => k.startsWith('0500|'));
    for (const cod of uso.contas) {
      if (contasPresentes.has(cod)) continue;
      const rem = st.removidosCadastro.get(chaveRemovido('0500', '', cod));
      if (rem && !rem.registro.pai) {
        inserir(e, rem.pai, rem.registro);
        contasPresentes.add(cod);
        continue;
      }
      // conta nova sem 0500 (o pacote de importação não traz dados do plano de contas).
      // Se a conta já era usada sem 0500 no original, não é problema nosso.
      if (arquivoTemPlano && !orig.contas.has(cod)) {
        avisos.push({ nivel: 'alerta', codigo: 'CONTA_SEM_0500', mensagem: `Conta contábil ${cod} usada nos documentos não existe no plano de contas (0500). Cadastre-a no PVA.` });
      }
    }
  }
  return avisos;
}

/**
 * Remove do bloco os registros de estabelecimento (C010, D010, F010, A010, I010, P010)
 * que ficaram SEM nenhum registro filho: o guia manda informar os registros de nível
 * inferior para cada estabelecimento do C010, e o PVA recusa um estabelecimento vazio.
 *
 * Não remove o estabelecimento que já estava vazio no arquivo original (mesmo critério
 * dos cadastros órfãos). O IND_MOV do registro de abertura do bloco (x001) é ajustado
 * depois, por `recontar`, que roda no fim de toda operação e em `recalcular`.
 *
 * Devolve os registros removidos (vazio quando não havia nada a fazer).
 */
export function sincronizarEstabelecimentos(e: Escrituracao): Registro[] {
  const st = estadoDe(e);
  const removidos: Registro[] = [];
  for (const bloco of e.raiz.filhos) {
    if (!/^.001$/.test(bloco.reg) || bloco.reg === '0001' || bloco.reg === '9001') continue;
    for (const f of [...bloco.filhos]) {
      if (!/^.010$/.test(f.reg) || f.filhos.length > 0) continue;
      if (st.estabsVaziosOriginal.has(f)) continue;
      remover(e, f);
      removidos.push(f);
    }
  }
  return removidos;
}

// ---------------------------------------------------------------------------
// Criação de cadastros (importação e inclusão de itens)
// ---------------------------------------------------------------------------

const DESCR_UNIDADE: Record<string, string> = {
  UN: 'UNIDADE', UND: 'UNIDADE', UNID: 'UNIDADE', PC: 'PECA', PCT: 'PACOTE', CX: 'CAIXA', KG: 'QUILOGRAMA', G: 'GRAMA', TON: 'TONELADA',
  T: 'TONELADA', L: 'LITRO', LT: 'LITRO', ML: 'MILILITRO', M: 'METRO', M2: 'METRO QUADRADO', M3: 'METRO CUBICO', MI: 'MILHEIRO', MIL: 'MILHEIRO',
  DZ: 'DUZIA', PAR: 'PAR', RL: 'ROLO', SC: 'SACO', FD: 'FARDO', GL: 'GALAO', KWH: 'QUILOWATT HORA', H: 'HORA', SV: 'SERVICO', CJ: 'CONJUNTO',
};

/**
 * Devolve o COD_PART do participante, reaproveitando o 0150 de mesmo CNPJ/CPF do
 * estabelecimento. Se não houver, cria um 0150 novo.
 *
 * Regra do código novo: o próprio CNPJ/CPF (só dígitos); se esse código já existir
 * para outro participante, acrescenta "-2", "-3"... Participante sem CNPJ/CPF
 * (exterior): "EX1", "EX2"... (o primeiro livre).
 */
export function garantirParticipante(e: Escrituracao, cnpjEstab: string, p: ParticipanteImport, avisos: string[]): string {
  const cad = cadastrosDe(e, cnpjEstab);
  const doc = soDigitos(p.cnpjCpf);
  if (doc) {
    const existente = cad.partDoc.get(doc);
    if (existente) return existente.campos[I.codPart];
    // removido antes por ficar órfão? recoloca
    const st = estadoDe(e);
    for (const { registro, pai } of st.removidosCadastro.values()) {
      if (registro.reg === '0150' && !registro.pai && pai === cad.r0140 && (registro.campos[I.cnpj0150] === doc || registro.campos[I.cpf0150] === doc)) {
        inserir(e, pai, registro);
        return registro.campos[I.codPart];
      }
    }
  }
  if (!cad.r0140) throw new Error('A escrituração não tem estabelecimento (0140) para cadastrar o participante.');
  let cod = doc;
  if (!cod) {
    for (let n = 1; ; n++) if (!cad.part.has((cod = `EX${n}`))) break;
  } else if (cad.part.has(cod)) {
    for (let n = 2; ; n++) if (!cad.part.has((cod = `${doc}-${n}`))) break;
  }
  const nome = (p.nome ?? '').trim();
  if (!nome) avisos.push(`Participante ${doc || '(sem CNPJ/CPF)'} sem nome: o 0150 ficará incompleto (NOME é obrigatório).`);
  if (nome.length > 100) avisos.push(`Nome do participante ${doc} tem mais de 100 caracteres e foi cortado.`);
  const codPais = p.codPais || '1058';
  if (codPais === '1058' && !p.codMunicipio) avisos.push(`Participante ${nome || doc} sem código de município (COD_MUN): o PVA exige para participante do Brasil.`);
  const r = novoRegistro('0150', {
    COD_PART: cod,
    NOME: nome.slice(0, 100),
    COD_PAIS: codPais,
    CNPJ: doc.length === 14 ? doc : '',
    CPF: doc.length === 11 ? doc : '',
    IE: soDigitos(p.ie) || (p.ie ?? '').trim(),
    COD_MUN: soDigitos(p.codMunicipio),
    SUFRAMA: p.suframa ?? '',
    END: (p.endereco ?? '').slice(0, 60),
    NUM: p.numero ?? '',
    COMPL: (p.complemento ?? '').slice(0, 60),
    BAIRRO: (p.bairro ?? '').slice(0, 60),
  });
  inserir(e, cad.r0140, r);
  return cod;
}

/** Garante a unidade (0190). Descrição: tabela comum de siglas, senão a própria sigla. */
export function garantirUnidade(e: Escrituracao, cnpjEstab: string, unid: string): void {
  const u = unid.trim();
  if (!u) return;
  const cad = cadastrosDe(e, cnpjEstab);
  if (cad.unid.has(u) || !cad.r0140) return;
  const rem = estadoDe(e).removidosCadastro.get(chaveRemovido('0190', cad.cnpj, u));
  if (rem && !rem.registro.pai) {
    inserir(e, rem.pai, rem.registro);
    return;
  }
  inserir(e, cad.r0140, novoRegistro('0190', { UNID: u, DESCR: DESCR_UNIDADE[u.toUpperCase()] ?? u }));
}

/** Garante o item (0200) e sua unidade. Item já cadastrado não é alterado. */
export function garantirItem(
  e: Escrituracao,
  cnpjEstab: string,
  it: Pick<ItemImport, 'codigo' | 'descricao' | 'ncm' | 'unidade' | 'tipoItem'> & { codLst?: string },
  avisos: string[],
): void {
  const cad = cadastrosDe(e, cnpjEstab);
  const cod = it.codigo.trim();
  if (cad.item.has(cod) || !cad.r0140) return;
  const rem = estadoDe(e).removidosCadastro.get(chaveRemovido('0200', cad.cnpj, cod));
  if (rem && !rem.registro.pai) {
    inserir(e, rem.pai, rem.registro);
    const u = rem.registro.campos[I.unidInv];
    if (u) garantirUnidade(e, cnpjEstab, u);
    return;
  }
  garantirUnidade(e, cnpjEstab, it.unidade);
  let tipo = it.tipoItem ?? '';
  if (!/^(0\d|10|99)$/.test(tipo)) {
    avisos.push(`Item ${cod}: tipo do item (TIPO_ITEM) não informado; usado "99" (outras). Ajuste se necessário.`);
    tipo = '99';
  }
  const ncm = soDigitos(it.ncm);
  if (!(it.descricao ?? '').trim()) avisos.push(`Item ${cod} sem descrição: o 0200 ficará incompleto (DESCR_ITEM é obrigatória).`);
  inserir(
    e,
    cad.r0140,
    novoRegistro('0200', {
      COD_ITEM: cod,
      DESCR_ITEM: (it.descricao ?? '').trim(),
      UNID_INV: it.unidade.trim(),
      TIPO_ITEM: tipo,
      COD_NCM: ncm.length === 8 ? ncm : '',
      COD_GEN: ncm.length >= 2 && !['09', '10'].includes(tipo) ? ncm.slice(0, 2) : '',
      COD_LST: (it.codLst ?? '').trim(),
    }),
  );
}

/**
 * Garante a natureza da operação (0400). Sem descrição não cria (DESCR_NAT é
 * obrigatória): devolve "" e avisa, e o COD_NAT do item fica em branco (é opcional).
 */
export function garantirNatureza(e: Escrituracao, cnpjEstab: string, nat: { codigo: string; descricao?: string } | undefined, avisos: string[]): string {
  if (!nat?.codigo) return '';
  const cad = cadastrosDe(e, cnpjEstab);
  const cod = nat.codigo.trim();
  if (cad.nat.has(cod)) return cod;
  const rem = estadoDe(e).removidosCadastro.get(chaveRemovido('0400', cad.cnpj, cod));
  if (rem && !rem.registro.pai) {
    inserir(e, rem.pai, rem.registro);
    return cod;
  }
  if (!nat.descricao?.trim() || !cad.r0140) {
    avisos.push(`Natureza da operação ${cod} não existe no 0400 e veio sem descrição: COD_NAT ficou em branco.`);
    return '';
  }
  inserir(e, cad.r0140, novoRegistro('0400', { COD_NAT: cod, DESCR_NAT: nat.descricao.trim() }));
  return cod;
}

/** A conta existe no plano de contas (0500)? (Também aceita uma que tenha sido removida por órfã e será recolocada.) */
export function contaExiste(e: Escrituracao, cod: string): boolean {
  if (indices(e).contas.has(cod)) return true;
  const rem = estadoDe(e).removidosCadastro.get(chaveRemovido('0500', '', cod));
  return !!rem;
}

/** Usado pelos testes e pela tela de conferência: códigos usados agora. */
export function usoAtual(e: Escrituracao): UsoCadastros {
  return usoCadastros(e, true);
}

export { mapaEstab };
