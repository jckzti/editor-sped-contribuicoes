import { centavos, fmtCentavos } from './dec';
import { normalizarCampo } from './edicao';
import { get, listar, type Escrituracao, type Registro } from './modelo';
import { alterar, registrarAcao } from './mutacao';
import { executar } from './operacao';
import tabelas from './tabelas.json';

const editados = new WeakSet<Registro>();
export const TIPOS_CREDITO: Readonly<Record<string, string>> = tabelas.codCred;

const camposAnteriores = ['VL_CRED_PER_PA_ANT', 'VL_CRED_DCOMP_PA_ANT'];
const camposOutros = ['VL_CRED_DCOMP_EFD', 'VL_CRED_TRANS', 'VL_CRED_OUT'];
const cent = (r: Registro, campo: string) => centavos(get(r, campo));
const somar = (r: Registro, campos: string[]) => campos.reduce((total, campo) => total + cent(r, campo), 0);
const periodoIso = (campo: string) => campo.slice(2) + '-' + campo.slice(0, 2);
const proprio = (e: Escrituracao, periodo: string) => periodo.replace('-', '') === e.periodo;

export function saldoCredorEditado(e: Escrituracao): boolean {
  return listar(e, '1100').some((r) => editados.has(r)) || listar(e, '1500').some((r) => editados.has(r));
}

export function lerSaldoCredor(e: Escrituracao, r: Registro) {
  const periodo = periodoIso(get(r, 'PER_APU_CRED'));
  const doMes = proprio(e, periodo);
  const credito = get(r, 'VL_TOT_CRED_APU') === '' ? cent(r, 'VL_CRED_APU') + cent(r, 'VL_CRED_EXT_APU') : cent(r, 'VL_TOT_CRED_APU');
  const descontoOrigem = cent(r, 'VL_CRED_DESC_PA_ANT');
  const utilizadoAnterior = somar(r, camposAnteriores) + (doMes ? 0 : descontoOrigem);
  return {
    periodo, codigo: get(r, 'COD_CRED'), credito, utilizadoAnterior,
    saldoAnterior: credito - utilizadoAnterior,
    utilizadoMes: cent(r, 'VL_CRED_DESC_EFD') + (doMes ? descontoOrigem : 0),
    ressarcimento: cent(r, 'VL_CRED_PER_EFD'),
    outrasUtilizacoes: somar(r, camposOutros),
    saldo: cent(r, 'SLD_CRED_FIM'),
  };
}

export interface EdicaoSaldoCredor {
  periodo: string;
  codigo: string;
  credito: string;
  utilizadoAnterior: string;
  utilizadoMes: string;
  ressarcimento: string;
}

export function planejarSaldoCredor(e: Escrituracao, r: Registro, dados: EdicaoSaldoCredor) {
  if (r.reg !== '1100' && r.reg !== '1500') throw new Error('O registro de saldo não está mais na escrituração.');
  const registros = listar(e, r.reg);
  if (!registros.includes(r)) throw new Error('O registro de saldo não está mais na escrituração.');
  const { periodo, codigo } = dados;
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(periodo) || periodo.replace('-', '') > e.periodo) {
    throw new Error('Informe um período de crédito válido, até o mês da escrituração.');
  }
  if (!Object.hasOwn(TIPOS_CREDITO, codigo)) throw new Error('Escolha um código de crédito da tabela 4.3.6.');
  const periodoSped = periodo.slice(5) + periodo.slice(0, 4);
  const mesmoGrupo = (outro: Registro) => ['ORIG_CRED', 'CNPJ_SUC'].every((c) => get(outro, c) === get(r, c));
  if ((periodoSped !== get(r, 'PER_APU_CRED') || codigo !== get(r, 'COD_CRED')) && registros.some((outro) =>
    outro !== r && get(outro, 'PER_APU_CRED') === periodoSped && get(outro, 'COD_CRED') === codigo && mesmoGrupo(outro))) {
    throw new Error('Já existe um saldo com esse período, tipo e origem do crédito.');
  }
  const ler = (campo: string, entrada: string) => {
    if (!entrada.trim()) throw new Error('Preencha todos os valores, incluindo zero quando for o caso.');
    const n = normalizarCampo(r.reg, campo, entrada);
    if ('erro' in n) throw new Error(n.erro);
    const valor = centavos(n.valor);
    if (!Number.isSafeInteger(valor) || valor < 0) throw new Error('Informe um valor válido e não negativo.');
    return valor;
  };
  const credito = ler('VL_TOT_CRED_APU', dados.credito);
  const utilizadoAnterior = ler('VL_CRED_DESC_PA_ANT', dados.utilizadoAnterior);
  const utilizadoMes = ler('VL_CRED_DESC_EFD', dados.utilizadoMes);
  const ressarcimento = ler('VL_CRED_PER_EFD', dados.ressarcimento);
  const outrosAnteriores = somar(r, camposAnteriores);
  const outrasUtilizacoes = somar(r, camposOutros);
  const externo = cent(r, 'VL_CRED_EXT_APU');
  if (credito < externo) throw new Error('O total do crédito não pode ser menor que o crédito extemporâneo escriturado.');
  if (utilizadoAnterior < outrosAnteriores) throw new Error('O utilizado em meses anteriores não pode ser menor que os ressarcimentos e compensações anteriores já escriturados.');
  const doMes = proprio(e, periodo);
  if (doMes && utilizadoAnterior !== outrosAnteriores) throw new Error('Para crédito do próprio mês, informe o desconto em Utilizado no mês.');
  const saldoAnterior = credito - utilizadoAnterior;
  const saldo = saldoAnterior - utilizadoMes - ressarcimento - outrasUtilizacoes;
  if (saldoAnterior < 0 || saldo < 0) throw new Error('As utilizações ultrapassam o valor do crédito.');
  const descontoAtualEfd = doMes ? Math.min(cent(r, 'VL_CRED_DESC_EFD'), utilizadoMes) : utilizadoMes;
  const descontoAnterior = doMes ? utilizadoMes - descontoAtualEfd : utilizadoAnterior - outrosAnteriores;
  return {
    saldoAnterior, saldo,
    campos: {
      PER_APU_CRED: periodoSped, COD_CRED: codigo,
      VL_CRED_APU: fmtCentavos(credito - externo), VL_TOT_CRED_APU: fmtCentavos(credito),
      VL_CRED_DESC_PA_ANT: fmtCentavos(descontoAnterior),
      SD_CRED_DISP_EFD: fmtCentavos(credito - outrosAnteriores - descontoAnterior),
      VL_CRED_DESC_EFD: fmtCentavos(descontoAtualEfd), VL_CRED_PER_EFD: fmtCentavos(ressarcimento), SLD_CRED_FIM: fmtCentavos(saldo),
    },
  };
}

export function editarSaldoCredor(e: Escrituracao, r: Registro, dados: EdicaoSaldoCredor): boolean {
  const { campos } = planejarSaldoCredor(e, r, dados);
  const mudancas = Object.entries(campos).filter(([campo, novo]) => campo.startsWith('VL_') || campo.startsWith('SD_') || campo === 'SLD_CRED_FIM'
    ? cent(r, campo) !== centavos(novo)
    : get(r, campo) !== novo);
  if (!mudancas.length) return false;
  executar('Editar saldo credor ' + r.reg, () => {
    for (const [campo, novo] of mudancas) alterar(e, r, campo, novo);
    if (!editados.has(r)) registrarAcao(e, () => editados.add(r), () => { editados.delete(r); });
  });
  return true;
}
