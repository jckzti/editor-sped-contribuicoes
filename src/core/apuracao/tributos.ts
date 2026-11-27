/**
 * Descrição dos dois tributos apurados no bloco M: os registros e campos do PIS/Pasep
 * e da Cofins têm a mesma lógica e só mudam de nome. O motor trabalha sempre com um
 * `Tributo` para não duplicar código.
 */

export type IdTributo = 'pis' | 'cofins';

export interface Tributo {
  id: IdTributo;
  nome: string;
  /** Sufixo dos campos de documento e do bloco M: CST_PIS, VL_BC_PIS, ALIQ_PIS... */
  sfx: 'PIS' | 'COFINS';
  M100: string;
  M105: string;
  M110: string;
  M115: string;
  M200: string;
  M205: string;
  M210: string;
  M215: string;
  M220: string;
  M230: string;
  M400: string;
  M410: string;
  /** Controle de créditos fiscais (bloco 1). */
  R1100: string;
  /** Registros filhos de documento, próprios do tributo. */
  C501: string;
  D101: string;
  D501: string;
  /** Nome do campo de crédito diferido no M100/M500 (o leiaute muda o nome). */
  campoCredDif: string;
  /** Alíquota básica não cumulativa em escala 10^4 (1,65% → 16500). */
  aliqBasica: bigint;
  /** Alíquota básica cumulativa na mesma escala. */
  aliqBasicaCum: bigint;
  /** Código de receita padrão (DCTF) da contribuição não cumulativa. */
  codRecNC: string;
}

export const PIS: Tributo = {
  id: 'pis',
  nome: 'PIS/Pasep',
  sfx: 'PIS',
  M100: 'M100',
  M105: 'M105',
  M110: 'M110',
  M115: 'M115',
  M200: 'M200',
  M205: 'M205',
  M210: 'M210',
  M215: 'M215',
  M220: 'M220',
  M230: 'M230',
  M400: 'M400',
  M410: 'M410',
  R1100: '1100',
  C501: 'C501',
  D101: 'D101',
  D501: 'D501',
  campoCredDif: 'VL_CRED_DIF',
  aliqBasica: 16500n,
  aliqBasicaCum: 6500n,
  codRecNC: '691201',
};

export const COFINS: Tributo = {
  id: 'cofins',
  nome: 'Cofins',
  sfx: 'COFINS',
  M100: 'M500',
  M105: 'M505',
  M110: 'M510',
  M115: 'M515',
  M200: 'M600',
  M205: 'M605',
  M210: 'M610',
  M215: 'M615',
  M220: 'M620',
  M230: 'M630',
  M400: 'M800',
  M410: 'M810',
  R1100: '1500',
  C501: 'C505',
  D101: 'D105',
  D501: 'D505',
  campoCredDif: 'VL_CRED_DIFER',
  aliqBasica: 76000n,
  aliqBasicaCum: 30000n,
  codRecNC: '585601',
};

export const TRIBUTOS: Tributo[] = [PIS, COFINS];
