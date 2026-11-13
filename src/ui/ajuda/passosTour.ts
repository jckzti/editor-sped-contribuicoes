/**
 * Roteiro do tour guiado de primeiro uso.
 *
 * REGRA DO PROJETO (CLAUDE.md): mudou tela, rótulo, fluxo ou opção que um passo cita?
 * Atualize o passo aqui, suba `VERSAO_TOUR` e escreva em `NOVIDADES` o que mudou.
 * Quem já viu o tour recebe o convite "O sistema mudou: ver o que há de novo".
 * `documentacao.test.ts` falha se o roteiro mudar sem subir a versão.
 *
 * Âncoras: cada passo aponta para elementos com `data-tour="<âncora>"`. A primeira
 * âncora que existir na tela é destacada; se nenhuma existir (aba sem dados, painel
 * fechado, modo demonstrativo), o passo aparece no centro da tela sem quebrar.
 */

/** Telas do App onde um passo acontece (o tour troca de aba antes de mostrar o passo). */
export type TelaTour = 'documentos' | 'regras' | 'apuracao' | 'conferencia' | 'manual';

export interface PassoTour {
  id: string;
  titulo: string;
  /** Texto curto (2 a 4 frases). Marcação: **negrito**. */
  texto: string;
  /** Texto usado quando não há arquivo carregado (modo demonstrativo). Ausente = `texto`. */
  textoSemDados?: string;
  /** Aba onde o passo acontece; null = qualquer tela (não troca de aba). */
  tela: TelaTour | null;
  /** Âncoras `data-tour` em ordem de preferência; vazio = passo centralizado. */
  ancoras: string[];
  /** Seção do manual para "ler mais" (id de `conteudoManual.ts`). */
  secaoManual?: string;
}

/** Versão do roteiro. Suba sempre que um passo mudar, entrar ou sair. */
export const VERSAO_TOUR = 3;

export const PASSOS_TOUR: PassoTour[] = [
  {
    id: 'boas-vindas',
    titulo: 'Bem-vindo ao Editor EFD-Contribuições',
    texto:
      'Aqui você corrige PIS/COFINS em lote, em vários meses de uma vez, e baixa os arquivos para o PVA, que continua validando e transmitindo. Nada sai deste computador. O tour leva uns 2 minutos: use → e ← ou os botões, e Esc para sair.',
    tela: null,
    ancoras: [],
    secaoManual: 'o-que-e',
  },
  {
    id: 'carregar',
    titulo: '1. Carregar os arquivos',
    texto:
      'Arraste os .txt da EFD-Contribuições, um por mês (pode ser vários de uma vez). Arquivo já transmitido, com assinatura, também serve. Para somar meses depois, use **Acrescentar arquivos**. O recomendado é um ano por vez.',
    textoSemDados:
      'Comece arrastando os .txt da EFD-Contribuições para a tela inicial, um por mês (pode ser vários de uma vez). Arquivo já transmitido, com assinatura, também serve. Enquanto isso, o tour segue em modo demonstrativo.',
    tela: null,
    ancoras: ['carregar-arquivos', 'acrescentar-arquivos'],
    secaoManual: 'carregar',
  },
  {
    id: 'tipo-linha',
    titulo: '2. Escolher o tipo de linha',
    texto:
      'A aba **Documentos** junta todos os meses numa grade só. Escolha o que olhar: itens de nota, notas, fretes, energia/água/gás, outras operações (F100), serviços (NFS-e) ou imobilizado (F120/F130). O número mostra quantas linhas há.',
    tela: 'documentos',
    ancoras: ['tipo-linha'],
    secaoManual: 'grades',
  },
  {
    id: 'filtrar',
    titulo: '3. Filtrar',
    texto:
      '**+ Filtro** monta condições como "CFOP está na lista 1101, 1102" e "CST PIS igual a 70". Todos os filtros valem juntos. A busca livre procura qualquer texto ou código.',
    tela: 'documentos',
    ancoras: ['filtros'],
    secaoManual: 'grades',
  },
  {
    id: 'selecionar-tudo',
    titulo: '4. Selecionar tudo o que está filtrado',
    texto:
      'A caixa no cabeçalho da grade seleciona todas as linhas filtradas, de todos os meses. Para escolher à mão, clique na caixa de cada linha (ou em qualquer ponto dela): cada clique soma ou tira uma linha, sem precisar de tecla. Shift + clique marca o intervalo desde a última linha clicada.',
    tela: 'documentos',
    ancoras: ['selecionar-tudo', 'grade'],
    secaoManual: 'grades',
  },
  {
    id: 'alterar-tributacao',
    titulo: '5. Alterar a tributação',
    texto:
      'Com linhas selecionadas aparece este painel: **Alterar tributação** troca CST, alíquotas, base, conta. Também dá para definir um campo, excluir ou exportar a seleção para CSV.',
    textoSemDados:
      'Com linhas selecionadas aparece um painel embaixo da grade: **Alterar tributação** troca CST, alíquotas, base e conta de todas elas de uma vez. Também dá para definir um campo, excluir ou exportar para CSV.',
    tela: 'documentos',
    ancoras: ['painel-lote', 'grade'],
    secaoManual: 'edicao-lote',
  },
  {
    id: 'previa',
    titulo: '6. Ver a prévia antes de aplicar',
    texto:
      '**Ver prévia** mostra quantas linhas mudam, a variação de PIS e COFINS mês a mês e uma amostra antes/depois. O botão Aplicar só aparece depois. Atenção à base "menos desconto e ICMS": em alguns ERPs o desconto já é o ICMS.',
    tela: 'documentos',
    ancoras: ['previa'],
    secaoManual: 'edicao-lote',
  },
  {
    id: 'salvar-regra',
    titulo: '7. Salvar como regra',
    texto:
      'Depois de aplicar, **Salvar como regra** guarda o filtro e a ação com um nome, na aba **Regras**. Lá a regra vale para todos os meses de uma vez e pode ser exportada para outro cliente.',
    tela: 'documentos',
    ancoras: ['salvar-como-regra', 'aba-regras'],
    secaoManual: 'regras',
  },
  {
    id: 'cadastros',
    titulo: 'À parte: cadastros',
    texto:
      'Participantes (0150) e produtos (0200) ficam na aba **Cadastros**, com a mesma grade: filtrar, editar campos com duplo clique, definir campo em lote e excluir o que não está em uso. O código do cadastro não muda.',
    tela: null,
    ancoras: ['aba-cadastros'],
    secaoManual: 'cadastros',
  },
  {
    id: 'criterios',
    titulo: '8. Responder os critérios da apuração',
    texto:
      'Antes de recalcular, responda os **Critérios da apuração** de cada empresa: saldo credor, ordem de uso dos créditos, 0111 e, se for o caso, o crédito guardado no original. Não há padrão: a tela mostra a consequência de cada resposta e o que o arquivo original indica, e quem decide é você.',
    tela: 'apuracao',
    ancoras: ['criterios-apuracao'],
    secaoManual: 'apuracao-criterios',
  },
  {
    id: 'recalcular',
    titulo: '9. Recalcular a apuração',
    texto:
      'O bloco M só muda quando você clica em **Recalcular apuração** (o botão de baixar recalcula antes, se precisar); até lá, a barra mostra "apuração desatualizada". Enquanto faltar critério, o botão abre a rotina dos critérios.',
    tela: 'apuracao',
    ancoras: ['recalcular-apuracao'],
    secaoManual: 'apuracao',
  },
  {
    id: 'antes-depois',
    titulo: '10. Ler o antes e o depois',
    texto:
      'Crédito, contribuição e valor a recolher, comparados com o arquivo original. Verde é bom para a empresa, vermelho é o contrário. Troque entre PIS e COFINS e use "detalhar" em cada mês.',
    tela: 'apuracao',
    ancoras: ['apuracao-quadro'],
    secaoManual: 'apuracao',
  },
  {
    id: 'conferencia',
    titulo: '11. Conferir',
    texto:
      'A aba **Conferência** verifica cada mês (cadastros, CST × operação, base × alíquota, datas) e lista tudo o que mudou, com reverter e restaurar. A validação que vale continua sendo a do PVA.',
    tela: 'conferencia',
    ancoras: ['conferencia-acoes'],
    secaoManual: 'conferencia',
  },
  {
    id: 'baixar',
    titulo: '12. Baixar e levar ao PVA',
    texto:
      '**Baixar arquivos** gera um .txt por mês (vários vão num .zip) e recalcula antes, se precisar. No PVA: importar, validar, ajustar os meses não recalculados, assinar e transmitir. Baixe antes de fechar a aba.',
    tela: null,
    ancoras: ['baixar-arquivos'],
    secaoManual: 'baixar-pva',
  },
  {
    id: 'manual',
    titulo: 'Manual e este tour',
    texto:
      'A aba **Manual** explica cada tela, opção e aviso, com busca. Para rever este tour, use o botão **Tour guiado** na barra de cima.',
    tela: null,
    ancoras: ['aba-manual', 'botao-tour'],
    secaoManual: 'sobre-ajuda',
  },
];

/**
 * O que mudou em cada versão do roteiro (a partir da 2): o convite "O sistema mudou"
 * mostra só estes passos. Obrigatório para toda versão > 1 (o teste confere).
 */
export const NOVIDADES: Record<number, { resumo: string; passos: string[] }> = {
  2: {
    resumo: 'A aba Documentos ganhou serviços (NFS-e) e bens do imobilizado (F120/F130), e há uma aba nova, Cadastros, para participantes e produtos.',
    passos: ['tipo-linha', 'cadastros'],
  },
  3: {
    resumo: 'Na grade, cada clique numa linha (na caixa ou em qualquer ponto dela) soma ou tira a linha da seleção, sem Ctrl/Cmd. Shift + clique marca um intervalo.',
    passos: ['selecionar-tudo'],
  },
};
