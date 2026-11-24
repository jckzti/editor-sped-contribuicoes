import { expect, it } from 'vitest';
import { inserirFilho, novoRegistro, type Escrituracao, type Registro } from '../core/modelo';
import { creditosPorNatureza } from './creditosNatureza';

function registro(codigo: string, campos: Record<string, string>, ...filhos: Registro[]) {
  const r = novoRegistro(codigo, campos);
  filhos.forEach((f) => inserirFilho(r, f));
  return r;
}

function escrituracao(...creditos: Registro[]): Escrituracao {
  return { raiz: registro('0000', {}, registro('M001', {}, ...creditos)) } as Escrituracao;
}

it('distribui o crédito oficial pelas bases em centavos e mantém o ajuste de natureza ambígua separado', () => {
  const e = escrituracao(registro('M100', { VL_CRED: '10,01', VL_AJUS_REDUC: '2' },
    registro('M105', { NAT_BC_CRED: '01', CST_PIS: '50', VL_BC_PIS: '100', VL_BC_PIS_TOT: '200' }),
    registro('M105', { NAT_BC_CRED: '02', CST_PIS: '50', VL_BC_PIS: '100' }),
    registro('M110', { IND_AJ: '0', VL_AJ: '2' })));
  const linhas = creditosPorNatureza(e, 'pis');
  expect(linhas.map(({ codigo, base, credito, ajuste }) => ({ codigo, base, credito, ajuste }))).toEqual([
    { codigo: '01', base: 10000, credito: 501, ajuste: 0 },
    { codigo: '02', base: 10000, credito: 500, ajuste: 0 },
    { codigo: '', base: null, credito: 0, ajuste: -200 },
  ]);
  expect(creditosPorNatureza(e, 'cofins')).toEqual([]);
});

it('atribui o ajuste à natureza, separa o CST ambíguo e reconcilia ajustes sem detalhe', () => {
  const e = escrituracao(registro('M500', { VL_CRED: '30', VL_AJUS_ACRES: '6', VL_AJUS_REDUC: '1' },
    registro('M505', { NAT_BC_CRED: '01', CST_COFINS: '50', VL_BC_COFINS: '100' }),
    registro('M505', { NAT_BC_CRED: '01', CST_COFINS: '51', VL_BC_COFINS: '200' }),
    registro('M510', { IND_AJ: '1', VL_AJ: '4' }),
    registro('M510', { IND_AJ: '0', VL_AJ: '1' })));
  const [natureza, semVinculo] = creditosPorNatureza(e, 'cofins');
  expect(natureza).toMatchObject({ codigo: '01', credito: 3000, ajuste: 300 });
  expect(natureza.csts).toEqual([
    { cst: '50', base: 10000, credito: 1000, ajuste: 0 },
    { cst: '51', base: 20000, credito: 2000, ajuste: 0 },
    { cst: '', base: null, credito: 0, ajuste: 300 },
  ]);
  expect(semVinculo).toMatchObject({ codigo: '', ajuste: 200 });
});
