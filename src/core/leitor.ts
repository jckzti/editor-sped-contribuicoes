/**
 * Leitura de um arquivo EFD-Contribuições (.txt) para a árvore de registros.
 *
 * - Codificação ISO-8859-1 (Latin-1), decodificada byte a byte para garantir
 *   ida e volta exata.
 * - Tudo o que vem depois da linha |9999| é assinatura digital do arquivo
 *   transmitido; é descartado (o PVA não importa arquivo assinado).
 * - A hierarquia vem do leiaute (campo `pai` de cada registro).
 */
import { leiaute, type Aviso, type Escrituracao, type Registro } from './modelo';

let sequencia = 0;

function decodificarLatin1(bytes: Uint8Array, fim: number): string {
  let s = '';
  const passo = 0x8000;
  for (let i = 0; i < fim; i += passo) {
    s += String.fromCharCode.apply(null, bytes.subarray(i, Math.min(fim, i + passo)) as unknown as number[]);
  }
  return s;
}

/** Posição (em bytes) logo após a linha |9999|...; -1 se não houver. */
function fimDoConteudo(bytes: Uint8Array): number {
  // procura "|9999|" no início de uma linha
  const alvo = [0x7c, 0x39, 0x39, 0x39, 0x39, 0x7c];
  for (let i = bytes.length - alvo.length; i >= 0; i--) {
    if (i > 0 && bytes[i - 1] !== 0x0a) continue;
    let ok = true;
    for (let j = 0; j < alvo.length; j++) {
      if (bytes[i + j] !== alvo[j]) {
        ok = false;
        break;
      }
    }
    if (!ok) continue;
    let k = i;
    while (k < bytes.length && bytes[k] !== 0x0a) k++;
    return Math.min(bytes.length, k + 1);
  }
  return -1;
}

export function lerSped(bytes: Uint8Array, nomeArquivo: string): Escrituracao {
  const avisos: Aviso[] = [];
  let fim = fimDoConteudo(bytes);
  let assinaturaRemovida = false;
  if (fim < 0) {
    fim = bytes.length;
    avisos.push({ nivel: 'erro', codigo: 'SEM_9999', mensagem: 'Arquivo sem registro 9999 (encerramento). Pode estar truncado.' });
  } else if (fim < bytes.length) {
    // sobra depois do 9999: assinatura digital (ou lixo). Só conta se não for apenas espaço em branco.
    for (let i = fim; i < bytes.length; i++) {
      if (bytes[i] > 0x20) {
        assinaturaRemovida = true;
        break;
      }
    }
  }
  const texto = decodificarLatin1(bytes, fim);
  const quebraLinha: '\r\n' | '\n' = texto.includes('\r\n') ? '\r\n' : '\n';
  const linhas = texto.split('\n');

  let raiz: Registro | null = null;
  const pilha: Registro[] = [];
  for (let n = 0; n < linhas.length; n++) {
    let linha = linhas[n];
    if (linha.endsWith('\r')) linha = linha.slice(0, -1);
    if (!linha) continue;
    if (linha[0] !== '|' || linha[linha.length - 1] !== '|') {
      avisos.push({ nivel: 'erro', codigo: 'LINHA_INVALIDA', mensagem: `Linha ${n + 1} não começa e termina com "|".`, linha: n + 1 });
      continue;
    }
    const campos = linha.slice(1, -1).split('|');
    const reg = campos[0];
    const r: Registro = { reg, campos, filhos: [], pai: null };
    const def = leiaute.registros[reg];
    if (!raiz) {
      if (reg !== '0000') throw new Error('O arquivo não começa com o registro 0000. Não parece ser uma EFD-Contribuições.');
      raiz = r;
      pilha.push(r);
      continue;
    }
    if (!def) {
      avisos.push({ nivel: 'alerta', codigo: 'REG_DESCONHECIDO', mensagem: `Registro ${reg} (linha ${n + 1}) não está no leiaute conhecido; será mantido como veio.`, linha: n + 1 });
      // mantém como folha, irmão do último registro lido
      const topo = pilha[pilha.length - 1];
      const pai = topo.pai ?? topo;
      r.pai = pai;
      pai.filhos.push(r);
      continue;
    }
    if (def.campos.length !== campos.length) {
      avisos.push({
        nivel: 'alerta',
        codigo: 'QTD_CAMPOS',
        mensagem: `Registro ${reg} (linha ${n + 1}) tem ${campos.length} campos; o leiaute prevê ${def.campos.length}.`,
        linha: n + 1,
      });
    }
    const paiReg = def.pai ?? '0000';
    while (pilha.length > 1 && pilha[pilha.length - 1].reg !== paiReg) pilha.pop();
    const pai = pilha[pilha.length - 1];
    if (pai.reg !== paiReg) {
      avisos.push({ nivel: 'alerta', codigo: 'HIERARQUIA', mensagem: `Registro ${reg} (linha ${n + 1}) apareceu sem o registro pai ${paiReg}.`, linha: n + 1 });
    }
    r.pai = pai;
    pai.filhos.push(r);
    pilha.push(r);
  }
  if (!raiz) throw new Error('Arquivo vazio.');
  if (assinaturaRemovida) {
    avisos.push({ nivel: 'info', codigo: 'ASSINATURA', mensagem: 'O arquivo estava assinado (já transmitido). A assinatura foi descartada; o PVA assina de novo na transmissão.' });
  }

  // 0000: REG|COD_VER|TIPO_ESCRIT|IND_SIT_ESP|NUM_REC_ANTERIOR|DT_INI|DT_FIN|NOME|CNPJ|...
  const c = raiz.campos;
  const dtIni = c[5] ?? '';
  const dtFim = c[6] ?? '';
  const cnpj = c[8] ?? '';
  return {
    id: `${cnpj}-${dtIni.slice(4)}${dtIni.slice(2, 4)}-${++sequencia}`,
    nomeArquivo,
    raiz,
    cnpj,
    nome: c[7] ?? '',
    dtIni,
    dtFim,
    periodo: dtIni.slice(4) + dtIni.slice(2, 4),
    assinaturaRemovida,
    quebraLinha,
    avisos,
    alterada: false,
  };
}
