/**
 * API pública do motor do editor EFD-Contribuições (para a interface).
 *
 * Fluxo: `criarSessao` → `adicionarArquivo` (cada .txt) → grades com `linhasDeTodas`,
 * `colunas`, `valor`, `filtrar`, `ordenar`, `somar` → edição com `editarCampos`,
 * `aplicarTributacao`, `excluirLinhas`, `incluirItem`, regras (`previsualizarRegra`,
 * `aplicarRegra`), importação (`importarPacote`, `xmlNfeParaNota`) → `desfazer`/`refazer` →
 * `validar` → `recalcular` → `gerarArquivo`.
 *
 * Toda alteração é uma operação desfazível e já mantém totais dos documentos,
 * cadastros (0150/0190/0200/0400/0500) e contadores coerentes. O bloco M (apuração)
 * só é refeito em `recalcular`.
 */
export * from './modelo';
export { lerSped } from './leitor';
export { escreverSped, escreverTexto, nomeArquivoSaida, type ResultadoEscrita } from './escritor';
export { centavos, fmtCentavos, mulAliq, ratear, mesmoValor } from './dec';
export * from './apuracao';
export type * from './importacao.tipos';

export * from './util';
export { estadoDe, invalidar, ordinalOriginal, type EstadoEdicao } from './estado';
export { pontoDeSalvamento, voltarAte, transacaoAtual } from './mutacao';
export * from './operacao';
export * from './totais';
export * from './cadastros';
export * from './contadores';
export * from './linhas';
export * from './edicao';
export { cstCredito, cstReceita, camposTributo } from './construir';
export * from './importar';
export * from './xmlNfe';
export * from './csv';
export * from './regras';
export * from './validar';
export * from './recalcular';
export * from './sessao';
