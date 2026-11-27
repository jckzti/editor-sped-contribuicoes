import { expect, it } from 'vitest';
import { verificarPerfil } from './apuracao/perfil';
import { get, inserirFilho, novoRegistro, type Escrituracao } from './modelo';
import { desfazer, limparHistorico } from './operacao';
import { editarSaldoCredor, lerSaldoCredor, saldoCredorEditado } from './saldosCredores';

function fixture(tipo: '1100' | '1500', periodo: string) {
  const raiz = novoRegistro('0000');
  const bloco = novoRegistro('1001');
  const r = novoRegistro(tipo, {
    PER_APU_CRED: periodo, COD_CRED: '101', ORIG_CRED: '01',
    VL_CRED_APU: '950', VL_CRED_EXT_APU: '50', VL_TOT_CRED_APU: '1000', VL_CRED_DESC_PA_ANT: '100',
    VL_CRED_PER_EFD: '10', VL_CRED_DCOMP_EFD: '20', SLD_CRED_FIM: '870',
  });
  inserirFilho(raiz, bloco);
  inserirFilho(bloco, r);
  const e = { id: 'teste', periodo: '202610', raiz, alterada: false } as Escrituracao;
  return { e, r };
}

it('edita o 1100, atualiza os saldos e restaura a edição e o bloqueio ao desfazer', () => {
  limparHistorico();
  const { e, r } = fixture('1100', '092026');
  const antes = lerSaldoCredor(e, r);
  expect(editarSaldoCredor(e, r, {
    periodo: '2026-09', codigo: '101', credito: '1000', utilizadoAnterior: '120',
    utilizadoMes: '30', ressarcimento: '20',
  })).toBe(true);
  expect(lerSaldoCredor(e, r)).toMatchObject({ saldoAnterior: 88000, outrasUtilizacoes: 2000, saldo: 81000 });
  expect(get(r, 'VL_CRED_EXT_APU')).toBe('50');
  expect(verificarPerfil(e).map((a) => a.codigo)).toContain('APURACAO_SALDO_EDITADO');
  expect(desfazer()).not.toBeNull();
  expect(saldoCredorEditado(e)).toBe(false);
  expect(lerSaldoCredor(e, r)).toEqual(antes);
});

it('apresenta o desconto da origem como uso atual no 1500 do próprio mês', () => {
  limparHistorico();
  const { e, r } = fixture('1500', '102026');
  expect(lerSaldoCredor(e, r)).toMatchObject({ utilizadoAnterior: 0, saldoAnterior: 100000, utilizadoMes: 10000 });
  expect(() => editarSaldoCredor(e, r, {
    periodo: '2026-10', codigo: '101', credito: '1000', utilizadoAnterior: '0', utilizadoMes: '990', ressarcimento: '20',
  })).toThrow('ultrapassam');
  expect(saldoCredorEditado(e)).toBe(false);
});
