import { describe, expect, it } from 'vitest';
import { arquivosDeAmostra, lerBytes, semAssinatura } from './amostra';
import { escreverSped } from './escritor';
import { lerSped } from './leitor';
import { listar } from './modelo';

const amostras = arquivosDeAmostra();

describe.skipIf(amostras.length === 0)('leitura e gravação (ida e volta)', () => {
  for (const caminho of amostras) {
    it(`regrava idêntico ao original: ${caminho.split('/').pop()}`, () => {
      const original = lerBytes(caminho);
      const e = lerSped(original, caminho);
      const problemas = e.avisos.filter((a) => a.nivel !== 'info');
      expect(problemas.slice(0, 10)).toEqual([]);
      const { bytes, caracteresInvalidos } = escreverSped(e);
      expect(caracteresInvalidos).toBe(0);
      expect(Buffer.from(bytes).equals(Buffer.from(semAssinatura(original)))).toBe(true);
      // hierarquia: todo C170 está sob um C100
      for (const item of listar(e, 'C170')) expect(item.pai?.reg).toBe('C100');
    });
  }
});
