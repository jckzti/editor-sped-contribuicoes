/**
 * Conteúdo do Manual (aba Manual). Só dados: o componente `TelaManual` só desenha.
 *
 * Marcação dentro dos textos (ver `TextoRico.tsx`): **negrito**, `código` e
 * [texto](#id-da-secao) para ligar a outra seção.
 *
 * REGRA DO PROJETO (AGENTS.md): toda mudança de tela, rótulo, fluxo, opção ou
 * comportamento fiscal atualiza, na mesma alteração, a seção que fala dela aqui,
 * sobe `VERSAO_MANUAL` e, se o roteiro do tour mudou, `VERSAO_TOUR` em `passosTour.ts`.
 * Os testes de `documentacao.test.ts` falham quando isso fica para trás.
 *
 * Cada afirmação daqui foi conferida no código. Seção com `conferirAoIntegrar`
 * descreve comportamento que estava mudando no motor quando foi escrita: confira no
 * código e apague o campo.
 */
import type { ConfigApuracao } from '../../core/apuracao/contrato';
import type { TipoLinhaTodos } from '../../core/linhas';
import { ROTULO_TIPO } from '../formato';
import type { Acao } from '../../core/regras';
import type { ModoBaseForm } from '../acoes';
import { CRITERIOS, type IdCriterio } from '../../core/apuracao';

/** Sobe a cada revisão do manual (o carimbo de `carimbo.ts` guarda a última revisada). */
export const VERSAO_MANUAL = 10;

export type Bloco =
  | { tipo: 'p'; texto: string }
  | { tipo: 'subtitulo'; texto: string }
  | { tipo: 'lista'; itens: string[] }
  | { tipo: 'passos'; itens: string[] }
  | { tipo: 'alerta'; texto: string; nivel?: 'alerta' | 'info' }
  | { tipo: 'tabela'; cabecalho: string[]; linhas: string[][] };

export type IdGrupo = 'comeco' | 'documentos' | 'regras' | 'apuracao' | 'entregar' | 'referencia';

export const GRUPOS: { id: IdGrupo; titulo: string }[] = [
  { id: 'comeco', titulo: 'Começo' },
  { id: 'documentos', titulo: 'Documentos e edição' },
  { id: 'regras', titulo: 'Regras e importação' },
  { id: 'apuracao', titulo: 'Apuração' },
  { id: 'entregar', titulo: 'Conferir e entregar' },
  { id: 'referencia', titulo: 'Referência' },
];

export interface Secao {
  /** Âncora da seção (vira `#manual-<id>`). Não mude: o tour e outras seções ligam para cá. */
  id: string;
  titulo: string;
  grupo: IdGrupo;
  /** Uma linha: aparece no índice ao passar o mouse e conta na busca. */
  resumo: string;
  blocos: Bloco[];
  /** Comportamento que estava mudando no motor quando a seção foi escrita: o que conferir. */
  conferirAoIntegrar?: string;
}

const p = (texto: string): Bloco => ({ tipo: 'p', texto });
const sub = (texto: string): Bloco => ({ tipo: 'subtitulo', texto });
const lista = (...itens: string[]): Bloco => ({ tipo: 'lista', itens });
const passos = (...itens: string[]): Bloco => ({ tipo: 'passos', itens });
const alerta = (texto: string, nivel: 'alerta' | 'info' = 'alerta'): Bloco => ({ tipo: 'alerta', texto, nivel });
const tabela = (cabecalho: string[], ...linhas: string[][]): Bloco => ({ tipo: 'tabela', cabecalho, linhas });

/**
 * Critérios da apuração: o que muda no arquivo e quando cada resposta costuma ser usada
 * (descrição de situações, não recomendação). Chaves = `CRITERIOS` de `src/core/apuracao/criterios.ts`;
 * o teste exige uma entrada para cada critério e para cada valor de resposta.
 */
export const ORIENTACAO_CRITERIOS: Record<IdCriterio, { registros: string; quando: Record<string, string> }> = {
  saldoCredor: {
    registros:
      'registros 1100 (PIS) e 1500 (COFINS) de cada mês e, nos meses seguintes carregados, o crédito de períodos anteriores descontado no M200/M600 e o valor a recolher (M205/M605).',
    quando: {
      encadear: 'Os meses carregados formam uma sequência e a sobra de um mês deve reduzir o que se paga nos seguintes, como no PVA mês a mês.',
      'somente-mes':
        'Cada mês deve ficar isolado: por exemplo, meses seguintes já transmitidos que não serão retificados, ou saldo de crédito controlado fora deste trabalho.',
    },
  },
  ordemUsoCredito: {
    registros: 'M100/M500 (crédito descontado e saldo do mês), 1100/1500 (utilização e saldo de cada período) e M200/M600.',
    quando: {
      'anteriores-primeiro': 'A preocupação é não deixar crédito antigo passar do prazo de cinco anos.',
      'mes-primeiro': 'O arquivo original já fazia assim e a ideia é mudar só o que as edições exigem, ou o saldo antigo está reservado para outro uso.',
      'tributados-primeiro': 'A empresa pretende pedir ressarcimento ou compensar os créditos ligados a receita não tributada ou exportação.',
    },
  },
  receitaBruta0111: {
    registros: 'registro 0111 (receita bruta por tipo) e, por consequência, a divisão dos créditos comuns entre os tipos 1xx, 2xx e 3xx nos M100/M105 e M500/M505.',
    quando: {
      manter: 'O 0111 veio da contabilidade e não deve mudar por reclassificação de documentos, ou as edições não mexeram em receita.',
      'ajustar-pelo-delta': 'As edições reclassificaram receitas (por exemplo, saída tributada que passou a não tributada) e o rateio deve refletir a receita corrigida.',
    },
  },
  preservarRetencaoCredito: {
    registros: 'M100/M500 (saldo do crédito e crédito descontado), M200/M600, valor a recolher (M205/M605) e o saldo levado ao 1100/1500.',
    quando: {
      true: 'O crédito foi guardado de propósito para um pedido de ressarcimento ou compensação (PER/DCOMP) feito ou a fazer.',
      false: 'O crédito guardado no original não tinha esse destino e pode reduzir a contribuição do mês.',
    },
  },
};

/** Aviso padrão das partes feitas só pelo Guia Prático. */
const GUIA =
  'Esta parte do cálculo foi feita conforme o Guia Prático e **ainda não foi conferida contra um arquivo real que a contenha**; o próprio sistema mostra esse aviso na aba Apuração ("Apurado por regra do guia, ainda não conferido contra arquivo real"). Confira o resultado com atenção.';

export const SECOES: Secao[] = [
  // ------------------------------------------------------------------ começo
  {
    id: 'o-que-e',
    titulo: 'O que o sistema é (e o que não é)',
    grupo: 'comeco',
    resumo: 'Edição em lote de vários meses da EFD-Contribuições; o PVA continua validando e transmitindo.',
    blocos: [
      p(
        'O Editor SPED Contribuições faz, em lote e em vários meses de uma vez, a edição que no PVA é feita documento a documento e mês a mês: alterar a tributação de PIS/COFINS, definir campos, excluir e incluir documentos, e recalcular a apuração (bloco M e saldos de crédito do bloco 1).',
      ),
      alerta(
        '**O PVA continua sendo o programa oficial.** O editor gera os arquivos .txt corrigidos; você importa no PVA para validar, assinar e transmitir. As conferências do editor pegam erros comuns, mas a palavra final sobre o arquivo é sempre do PVA.',
        'info',
      ),
      sub('O que ele não faz'),
      lista(
        'Não transmite, não assina e não consulta a Receita.',
        'Não escritura do zero: parte sempre de um arquivo da EFD-Contribuições já gerado.',
        'Não guarda os arquivos em lugar nenhum (ver [Privacidade](#privacidade)).',
        'Não substitui a revisão do contador: ele mostra o antes e o depois para você decidir.',
      ),
      sub('O caminho de sempre'),
      passos(
        'Carregar os arquivos do período ([Carregar arquivos](#carregar)).',
        'Escolher o tipo de linha, filtrar e selecionar ([As grades](#grades)).',
        'Alterar em lote, sempre olhando a prévia ([Edição em lote](#edicao-lote)).',
        'Salvar como regra para repetir em outros meses ou clientes ([Regras](#regras)).',
        'Recalcular a apuração e ler o antes e o depois ([Apuração](#apuracao)).',
        'Conferir ([Conferência](#conferencia)) e baixar para o PVA ([Baixar e levar ao PVA](#baixar-pva)).',
      ),
      p('O botão **Tour guiado** mostra esse caminho na própria tela (ver [Tour guiado e este manual](#sobre-ajuda)).'),
    ],
  },
  {
    id: 'privacidade',
    titulo: 'Privacidade: o que fica e o que some',
    grupo: 'comeco',
    resumo: 'Nada sai do navegador; fechar a aba apaga os arquivos. Só preferências, regras e a marca do tour ficam guardadas.',
    blocos: [
      p(
        'Os arquivos são lidos pelo próprio navegador. Não existe servidor, upload nem banco de dados: nenhum dado do arquivo sai do computador.',
      ),
      alerta('**Fechar ou recarregar a aba apaga tudo o que foi carregado e editado.** Baixe os arquivos antes de fechar.'),
      sub('O que fica guardado neste navegador'),
      lista(
        'Preferências de tela: a última aba aberta, o tipo de linha escolhido e as colunas visíveis de cada tipo de linha.',
        'As regras salvas (nome, filtro e ação). Se o filtro de uma regra tiver um número de nota ou um CNPJ digitado por você, ele fica guardado na regra.',
        'Os critérios da apuração de uma empresa (CNPJ e escolhas), só quando você marca "Lembrar estas escolhas para esta empresa" (ver [Critérios da apuração](#apuracao-criterios)).',
        'A marca do tour guiado: só o número da versão do tour que você já viu.',
      ),
      p(
        'Nada mais. A natureza da receita atribuída na aba Apuração vale só enquanto a aba estiver aberta (ver [Natureza da receita](#apuracao-natureza)). Quem usar o mesmo navegador, no mesmo computador, vê as mesmas regras salvas.',
      ),
    ],
  },
  {
    id: 'carregar',
    titulo: 'Carregar arquivos',
    grupo: 'comeco',
    resumo: 'Arraste os .txt (um por mês); arquivo assinado é aceito; ~9,5 MB de memória por mês, recomendado um ano por vez.',
    blocos: [
      passos(
        'Na tela inicial, arraste os arquivos .txt da escrituração (um por mês; pode ser vários de uma vez) ou clique em **Escolher arquivos**.',
        'Espere a leitura ("Lendo 3 de 12: ..."). A barra de cima passa a mostrar quantos meses, o intervalo e a empresa (ou "N empresas").',
        'Para somar mais meses depois, use **Acrescentar arquivos** na barra de cima.',
      ),
      sub('O que é aceito e o que é recusado'),
      lista(
        'Na tela inicial só entram arquivos terminados em .txt; os outros são ignorados.',
        'Arquivo que não é EFD-Contribuições (por exemplo, uma EFD ICMS/IPI) é recusado e aparece em "Arquivos que não puderam ser lidos", com o motivo.',
        'O mesmo CNPJ e período não entra duas vezes: o segundo arquivo é recusado.',
        '**Arquivo assinado** (já transmitido) é aceito: a assinatura digital é descartada e o PVA assina de novo na transmissão.',
        'Versão de leiaute diferente da 006 entra com alerta: confira o resultado no PVA.',
        'Escrituração retificadora, regime cumulativo ou misto e rateio proporcional aparecem como avisos do arquivo na [Conferência](#conferencia), em "Perfil do arquivo".',
      ),
      sub('Quantos meses de uma vez'),
      p(
        'Cada mês ocupa cerca de **9,5 MB de memória**. Doze meses usam uns 115 MB, sem problema. Acima de 24 meses o editor mostra um aviso: o navegador fica lento para filtrar, selecionar e recalcular. **O recomendado é trabalhar um ano por vez.**',
      ),
      p(
        'Dá para carregar meses de mais de uma empresa: as grades e as regras valem para todos os meses carregados, e o saldo credor é encadeado separadamente por CNPJ.',
      ),
    ],
  },

  // ------------------------------------------------------------------ documentos
  {
    id: 'grades',
    titulo: 'As grades da aba Documentos',
    grupo: 'documentos',
    resumo: 'Tipos de linha, colunas, filtros e operadores, busca, seleção em massa, totais, edição na célula e destaques.',
    blocos: [
      p(
        'A aba **Documentos** mostra numa grade só as linhas de **todos os meses carregados**. A coluna Período diz de que mês é cada linha.',
      ),
      sub('Tipos de linha'),
      p('Os botões no alto escolhem o que a grade mostra; o número entre parênteses é a quantidade de linhas.'),
      tabela(
        ['Botão', 'Cada linha é', 'Registros'],
        ['Itens de nota', 'um item de nota fiscal', 'C170 (com a nota C100)'],
        ['Notas', 'uma nota inteira; alterar a tributação de uma nota vale para todos os itens dela', 'C100'],
        ['Fretes (CT-e)', 'um par PIS/COFINS de um conhecimento de transporte', 'D100 com D101/D105'],
        ['Energia, água e gás', 'um par PIS/COFINS de uma conta de energia, água ou gás', 'C500 com C501/C505'],
        ['Outras operações (F100)', 'uma operação sem nota (aluguel, receita financeira etc.)', 'F100'],
        ['Serviços (NFS-e)', 'um item de nota de serviço (ver [Notas de serviço](#servicos))', 'A170 (com a nota A100)'],
        ['Imobilizado: depreciação (F120)', 'um bem com crédito sobre depreciação ou amortização (ver [Imobilizado](#imobilizado))', 'F120'],
        ['Imobilizado: aquisição (F130)', 'um bem com crédito sobre o valor de aquisição', 'F130'],
      ),
      p('Participantes e produtos ficam na aba **Cadastros** (ver [Cadastros](#cadastros)).'),
      p('Trocar o tipo de linha limpa os filtros, a busca e a ordenação.'),
      sub('Colunas e ordenação'),
      lista(
        'O botão **Colunas (x de y)** escolhe as colunas visíveis; "voltar ao padrão" restaura as de fábrica. A escolha fica guardada para cada tipo de linha.',
        'Clique no cabeçalho para ordenar: crescente, decrescente e de volta sem ordem.',
        'Arraste a borda direita do cabeçalho para alargar a coluna. Passe o mouse no cabeçalho para ver a descrição do campo.',
      ),
      sub('Filtros e busca'),
      p(
        '**+ Filtro** acrescenta uma condição: coluna, operador e valor. As colunas vêm agrupadas (Mês / estabelecimento, Documento, Participante, Linha, PIS / COFINS, Produto). **Todos os filtros valem ao mesmo tempo**: a linha precisa atender a todos.',
      ),
      tabela(
        ['Operador', 'Como usar'],
        ['igual a / diferente de', 'Em colunas de código (CST, base do crédito, situação) aparece a lista de códigos com a descrição.'],
        ['contém / começa com', 'Só para texto e código; números e datas não têm estes.'],
        ['está na lista', 'Vários valores separados por vírgula: 50, 51, 53.'],
        ['entre', 'Dois limites (inclusive). Datas em DD/MM/AAAA.'],
        ['maior que / menor que', 'Números aceitam 1.234,56.'],
        ['está vazio / não está vazio', 'Não pede valor.'],
      ),
      lista(
        'A **busca livre** ("Buscar em qualquer texto ou código…") procura o texto nas colunas de texto e de código, junto com os filtros.',
        'Ao lado aparece a contagem ("1.234 de 6.921 linhas") e o atalho "limpar filtros".',
        'Filtros e busca continuam lá quando você troca de aba e volta.',
      ),
      sub('Seleção em massa'),
      lista(
        'Clique na **caixa** da linha, ou em qualquer outro ponto dela: marca a linha e soma às que já estavam marcadas. Clicar de novo numa linha marcada tira a marca. Não precisa de tecla nenhuma.',
        'Com o teclado: ande até a caixa da linha (Tab) e aperte a barra de espaço.',
        'Duplo clique numa célula editável abre a edição da célula e não muda a seleção.',
        'Shift + clique (na caixa ou na linha): marca todas as linhas desde a última linha clicada até esta.',
        '**Caixa no cabeçalho**: seleciona tudo o que está filtrado, em todos os meses. É o jeito certo de preparar algo para virar regra (ver [Regras](#regras)).',
        'Com "selecionar tudo", desmarcar uma linha tira só aquela linha; o resto continua marcado, mesmo com centenas de milhares de linhas.',
        'Mudar o filtro, a busca, a ordenação ou o tipo de linha limpa a seleção (as posições deixam de valer), e aplicar uma alteração em lote também. Editar uma célula não limpa.',
      ),
      sub('Totais'),
      p(
        'A linha fixa no rodapé soma as colunas de valor das linhas filtradas; a primeira coluna mostra a quantidade de linhas. Com linhas selecionadas, o painel de baixo mostra a base e o valor de PIS e COFINS da seleção (acima de 100 mil linhas selecionadas esses totais não são somados, para não travar a tela).',
      ),
      sub('Editar na célula'),
      lista(
        'Duplo clique numa célula editável abre a edição. **Enter** confirma, **Esc** cancela.',
        'Valor inválido (CST que não existe, número malformado) é recusado com a mensagem em cima da grade; corrija e tecle Enter.',
        'Colunas que vêm do cadastro ou da nota (participante, descrição do produto) não se editam nesta grade.',
        'Cada edição entra no [Desfazer](#desfazer).',
      ),
      sub('O que foi alterado fica marcado'),
      tabela(
        ['Destaque', 'Quer dizer'],
        ['Célula amarela', 'Campo alterado. Passe o mouse: aparece o valor original do arquivo.'],
        ['Célula verde', 'Registro incluído, que não existia no arquivo original.'],
        ['Linha com fundo marcado', 'A linha tem registro editado ou incluído.'],
      ),
      p('Passar o mouse numa célula de código também mostra a descrição do código (por exemplo, o que é o CST 50).'),
    ],
  },
  {
    id: 'edicao-lote',
    titulo: 'Edição em lote',
    grupo: 'documentos',
    resumo: 'Alterar tributação (modos de base), definir campo, excluir e exportar CSV, sempre com prévia antes de aplicar.',
    blocos: [
      p(
        'Com linhas selecionadas aparece, embaixo da grade, o painel com a quantidade, os totais e os botões **Alterar tributação**, **Definir campo**, **Excluir**, **Exportar seleção para CSV** e "limpar seleção". A ação vale para as linhas selecionadas de todos os meses.',
      ),
      sub('Sempre com prévia'),
      passos(
        'Preencha o formulário.',
        'Clique em **Ver prévia**: linhas afetadas, variação de PIS e de COFINS (e da base), o efeito mês a mês e uma amostra das primeiras linhas, antes e depois. Nada foi alterado ainda. Se o editor tiver algo a avisar sobre a ação, o quadro **Atenção antes de aplicar** aparece antes desses números: leia antes de aplicar.',
        'Só então aparece o botão **Aplicar**. Se você mudar o formulário, o Aplicar some até você atualizar a prévia.',
      ),
      sub('Alterar tributação'),
      p('Campo vazio ("não alterar") fica como está. PIS e COFINS são tratados juntos.'),
      tabela(
        ['Campo', 'O que faz'],
        ['CST PIS / CST COFINS', 'Novo CST, da tabela de CST de PIS/COFINS.'],
        ['Alíquota PIS / COFINS (%)', 'Percentual, por exemplo 1,65 e 7,6 (até 4 casas).'],
        ['Base de cálculo', 'Como calcular a nova base (tabela abaixo).'],
        ['Natureza da base do crédito', 'Em fretes, energia, F100, serviços e imobilizado. No item de nota (C170) a base do crédito vem do CFOP, na apuração.'],
        ['Origem do crédito', 'Só em serviços e imobilizado: **0 — operação no mercado interno** ou **1 — operação de importação**.'],
        ['Conta contábil', 'Novo código de conta.'],
        ['Valor de PIS/COFINS', 'Recalcular quando base ou alíquota mudarem (padrão), recalcular sempre (base × alíquota) ou não recalcular.'],
        ['Zerar base, alíquota e valor…', 'Quando o CST escolhido não gera crédito nem débito, zera base, alíquota e valor.'],
      ),
      sub('Modos de base'),
      tabela(
        ['Opção', 'Base de cálculo nova'],
        ['Não alterar a base', 'Fica como está.'],
        ['Valor do item', 'Valor do item (no F100, o valor da operação).'],
        ['Valor do item menos o desconto', 'Item menos o desconto do item. No frete, o desconto do conhecimento, proporcional ao par; energia não tem desconto.'],
        [
          'Valor do item menos desconto e ICMS',
          'Item menos o desconto e menos o ICMS, com o ICMS excluído uma vez só (ver o alerta abaixo). No frete e na energia, o ICMS do documento, proporcional ao par.',
        ],
        ['Zero', 'Base zero.'],
        ['Valor fixo (digitar)', 'O valor que você digitar, igual para todas as linhas.'],
      ),
      alerta(
        '**Cuidado: em alguns ERPs o desconto do item já é o ICMS.** Nesses arquivos o campo de desconto (VL_DESC) vem com o próprio valor do ICMS. Com "menos desconto e ICMS", o editor percebe isso (desconto igual ao ICMS na maioria dos itens) e usa item menos ICMS, para não tirar o ICMS duas vezes; nos itens desse arquivo em que o desconto é diferente do ICMS, tira os dois e avisa para você conferir. Itens cuja base atual já exclui o ICMS não mudam (também com aviso). Leia os avisos da prévia e, na dúvida, acrescente a coluna de ICMS do item pelo botão Colunas e compare com a de Desconto.',
      ),
      sub('Diagnóstico da base antes de tirar o ICMS'),
      p(
        'Ao escolher "Valor do item menos desconto e ICMS" em itens de nota ou notas, aparece no formulário, antes mesmo da prévia, o quadro **Diagnóstico da base antes de tirar o ICMS**, com o total de itens selecionados e quantos têm ICMS:',
      ),
      lista(
        'em quantos itens a base de PIS/COFINS atual **já exclui o ICMS** (a ação não muda esses itens);',
        'em quantos o desconto do item (VL_DESC) é igual ao ICMS, isto é, o ERP grava o ICMS no desconto, e em quantos meses esse padrão foi reconhecido;',
        'em quantos o desconto é **diferente** do ICMS (nesses a ação tira o desconto **e** o ICMS: confira se esse desconto não é, no todo ou em parte, ICMS);',
        'quantos itens teriam a base alterada e a variação total da base.',
      ),
      p('O quadro fica em destaque quando há itens com base que já exclui o ICMS ou com desconto diferente do ICMS. Ele não altera nada: só informa antes da prévia.'),
      p(
        'Outros avisos da prévia: CST de crédito (50 a 66) ou de receita tributada (01/02) definido sem escolher a base, em linhas com base zero, deixa essas linhas sem crédito ou sem débito (escolha também a base, por exemplo Valor do item); natureza da base do crédito preenchida para itens de nota é ignorada (no C170 ela vem do CFOP); linha com valor que não é número é pulada, com aviso.',
      ),
      sub('Definir campo'),
      p('Escolha um campo editável do tipo de linha e o novo valor (campos de código mostram a lista). Vale igual para todas as linhas selecionadas.'),
      sub('Excluir'),
      lista(
        'Itens de nota: a opção "Excluir também as notas que ficarem sem nenhum item" vem marcada, porque nota sem item é recusada pelo PVA. Desmarque só se você vai incluir itens depois.',
        'Fretes e energia: documento com um só par de PIS/COFINS sai inteiro; com vários pares, sai só o par selecionado.',
        'Notas: a nota sai com todos os itens.',
        'Dá para desfazer, e a [Conferência](#conferencia) tem "restaurar" para cada registro excluído.',
      ),
      sub('Exportar seleção para CSV'),
      p('Baixa as linhas selecionadas, com as colunas visíveis, num CSV para conferir em planilha. Não altera nada.'),
      sub('Depois de aplicar'),
      lista(
        'Aparece "Aplicado em N linha(s)" com o resumo; se houve avisos, eles ficam no quadro **Avisos da alteração aplicada**.',
        'O botão **Salvar como regra** aparece quando a seleção era exatamente o que o filtro mostrava (caixa do cabeçalho, sem desmarcar nada). Com linhas escolhidas à mão, filtre e selecione tudo antes.',
        'A barra de cima passa a mostrar "apuração desatualizada" até você [recalcular](#apuracao).',
      ),
    ],
  },

  {
    id: 'servicos',
    titulo: 'Notas de serviço (A100/A170)',
    grupo: 'documentos',
    resumo: 'Tipo de linha "Serviços (NFS-e)" na aba Documentos: tributação, definir campo, excluir, regras; totais da nota acompanham os itens.',
    blocos: [
      p(
        'O registro A100 é o documento fiscal de serviço (prestado ou contratado), emitido conforme as regras do município, eletrônico ou em papel; cada A100 tem pelo menos um A170 com os itens. Na aba Documentos, no tipo de linha **Serviços (NFS-e)**, cada linha é um item (A170), com os campos da nota, do participante e do produto (0200) ao lado.',
      ),
      sub('O que dá para editar'),
      lista(
        '**Alterar tributação**: PIS e COFINS juntos, inclusive a natureza da base do crédito e a **Origem do crédito** (0 — mercado interno; 1 — importação). Os modos de base usam o desconto do item; serviço não tem ICMS.',
        '**Definir campo**, **Excluir**, prévia, regras em lote e desfazer, como nas outras grades. Excluindo todos os itens de uma nota, a nota sai junto (o Guia exige ao menos um item).',
        'Os totais de PIS e COFINS da nota (bases e valores do A100) acompanham a soma dos itens, mantendo a diferença que já existia no original. Se você editar um desses totais, vale o valor digitado. Valor do documento, desconto, retenções e ISS são dados de entrada e não são recalculados.',
      ),
      sub('O que a Conferência verifica'),
      lista(
        'Serviço prestado não pode ter CST de crédito, e serviço contratado não pode ter CST de receita.',
        'CST de crédito exige a natureza da base do crédito (aviso NAT_BC_CRED_AUSENTE).',
        'Datas: basta a data de emissão ou a de execução do serviço estar no período.',
      ),
      sub('Como entram na apuração'),
      lista(
        'Item de serviço contratado com CST de crédito vira crédito, com a natureza da base do crédito do próprio item; com indicador de origem 1, é crédito de importação.',
        'Item de serviço prestado com CST de receita vira receita (valor do item) na apuração das contribuições.',
        'No ajuste do 0111 (ver [Registro 0111](#apuracao-0111)), o serviço prestado conta como receita do **mercado interno**, inclusive o prestado ao exterior: o A170 não tem CFOP, então o editor não distingue exportação de serviço. Ajuste à mão se for o caso.',
        'Documentos cancelados são ignorados.',
      ),
      sub('O que ainda não dá'),
      lista(
        'Incluir item numa nota de serviço que já está no arquivo (nota nova entra pela [importação](#importar)).',
        'Editar os registros A110, A111 e A120: são preservados como vieram.',
        'Alíquota com mais de 2 casas: o leiaute do A170 tem 2 casas, o que basta para 1,65 e 7,6, mas não para alíquotas como 0,5775.',
      ),
      alerta(GUIA),
    ],
  },
  {
    id: 'imobilizado',
    titulo: 'Bens do ativo imobilizado (F120/F130)',
    grupo: 'documentos',
    resumo: 'Dois tipos de linha (depreciação e aquisição): o que é dado de entrada e o que o sistema recalcula pela regra do Guia.',
    blocos: [
      tabela(
        ['Tipo de linha', 'Registro', 'O que é', 'Base do crédito'],
        [
          'Imobilizado: depreciação (F120)',
          'F120',
          'Crédito sobre os encargos de depreciação de bens do imobilizado usados na produção ou na prestação de serviços, ou de amortização de edificações e benfeitorias.',
          'Natureza da base 09 (depreciação) ou 11 (amortização).',
        ],
        [
          'Imobilizado: aquisição (F130)',
          'F130',
          'Crédito sobre o valor de aquisição dos bens que a legislação permite creditar dessa forma, em parcelas.',
          'Natureza da base 10.',
        ],
      ),
      p('Ficam no seletor da aba Documentos, depois de Outras operações (F100). São tipos de linha separados porque os campos e as regras são diferentes. Pelo Guia, o mesmo bem não pode estar nos dois.'),
      sub('O que você informa e o que o sistema calcula'),
      tabela(
        ['Registro', 'Dados de entrada (você edita)', 'Calculado pelo sistema'],
        [
          'F120',
          'Encargo de depreciação ou amortização do mês; parcela sem direito a crédito; CST; alíquotas; natureza da base (09 ou 11); origem do crédito.',
          'Base de PIS e de COFINS = encargo − parcela sem crédito. Valor = base × alíquota.',
        ],
        [
          'F130',
          'Valor de aquisição; parcela sem direito a crédito; número de parcelas (IND_NR_PARC); mês e ano de aquisição; CST; alíquotas; natureza da base (10); origem do crédito.',
          'Base total = aquisição − parcela sem crédito. Base do mês = base total ÷ meses do IND_NR_PARC (1 = integral; 2 = 12 meses; 3 = 24; 4 = 48; 5 = 6), arredondada. Valor = base do mês × alíquota.',
        ],
      ),
      lista(
        'Na tela, um quadro azul acima da grade resume essa regra. As colunas calculadas têm o cabeçalho em itálico, começando por **ƒ** (por exemplo, "ƒ Base PIS"), e a dica "Calculado pelo sistema: …". O mês e ano da aquisição aparecem como MM/AAAA.',
        'Editar um dado de entrada recalcula na hora o que depende dele; dá para desfazer.',
        'Com IND_NR_PARC 9 ("outra periodicidade"), o Guia não diz quantos meses são: a **base do mês é digitada** por você, e o editor avisa.',
        'Em **Alterar tributação**, qualquer modo "Valor do item…" calcula a base pela regra acima. Natureza da base fora da tabela do registro (F120 só 09 ou 11; F130 só 10) não é gravada, e a ação avisa.',
        'Excluir tira o registro direto. F129 e F139 são preservados como vieram.',
      ),
      sub('O que a Conferência verifica'),
      lista(
        'Base fora da regra do Guia em registro editado (aviso IMOBILIZADO_BASE, alerta): por exemplo, base digitada que não bate com encargo ou aquisição menos a parcela sem crédito.',
        'CST de crédito sem natureza da base do crédito (NAT_BC_CRED_AUSENTE, erro) e CST de receita em bem do imobilizado (erro).',
        'Valor diferente de base × alíquota e CST de crédito com base zero, como nos outros registros.',
      ),
      sub('Como entram na apuração'),
      lista(
        'Registro F120 ou F130 com CST de crédito vira crédito, com a natureza da base do próprio registro; com indicador de origem 1, é crédito de importação.',
        'Crédito sem natureza da base do crédito impede o recálculo do mês (ver [recusa](#apuracao-recusa)).',
      ),
      alerta(GUIA),
    ],
  },
  {
    id: 'cadastros',
    titulo: 'Cadastros de participantes (0150) e produtos (0200)',
    grupo: 'documentos',
    resumo: 'Aba Cadastros, com "Participantes (0150)" e "Produtos e serviços (0200)": campos editáveis, código fixo, cadastro em uso não sai.',
    blocos: [
      p(
        'O 0150 traz os participantes (fornecedores e clientes) e o 0200 os produtos e serviços usados nos documentos, sob o 0140 de cada estabelecimento. Na aba **Cadastros**, os tipos de linha **Participantes (0150)** e **Produtos e serviços (0200)** mostram esses cadastros de todos os meses, com filtro, ordenação e CSV; no produto, uma coluna diz quantos registros 0205, 0206 e 0208 ele tem.',
      ),
      sub('O que dá para editar'),
      lista(
        'A grade é a mesma das outras abas (filtro, busca, colunas, duplo clique para editar, rodapé com a contagem). Os campos do cadastro são editados com a validação do leiaute; CNPJ ou CPF com dígito verificador inválido é recusado na faixa "Valor recusado: …".',
        '**O código (Cód. participante / Cód. item) não abre para edição nesta versão**: ele é usado nos documentos.',
        'Mudar a unidade de inventário do produto cria o cadastro da unidade (0190), se faltar.',
        '**Cadastro em uso não pode ser excluído**: a prévia mostra, em "Atenção antes de aplicar", que ele está em uso nos documentos e não será excluído (numa regra em lote, vira aviso). Cadastro que deixa de ser usado sai sozinho no recálculo.',
        'Com linhas selecionadas, o painel oferece só **Definir campo**, **Excluir**, **Exportar seleção para CSV** e "limpar seleção": cadastro não tem "Alterar tributação" nem totais de PIS/COFINS, e a prévia mostra só as linhas afetadas e a amostra antes/depois. A aba não tem "Importar documentos".',
        'A edição campo a campo aparece em "O que mudou" na [Conferência](#conferencia); inclusões e exclusões de cadastro são automáticas.',
      ),
      p(
        'Fora isso, a cada alteração nos documentos o editor continua acertando sozinho os cadastros (0150, 0190, 0200, 0400 e 0500), para que todo código usado tenha cadastro.',
      ),
      sub('O que ainda não dá'),
      lista(
        'Criar um cadastro novo pela grade: hoje ele nasce pela [importação](#importar) de documentos.',
        'Trocar o código de um cadastro.',
        'Editar os registros ligados ao produto (0205, 0206 e 0208): são preservados como vieram.',
      ),
    ],
  },

  // ------------------------------------------------------------------ regras
  {
    id: 'regras',
    titulo: 'Regras',
    grupo: 'regras',
    resumo: 'Filtro + ação com nome, aplicados em todos os meses; prévia por mês; exportar e importar em JSON.',
    blocos: [
      p(
        'Uma regra é um nome, um tipo de linha, um filtro (com a busca, se houver) e uma ou mais ações. Ela vale para **todos os meses carregados de uma vez**: é o que o PVA não faz. A regra guarda o **filtro**, não as linhas: aplicada em outro mês ou em outro cliente, pega as linhas que atendem ao filtro lá.',
      ),
      sub('Criar'),
      lista(
        'Pela aba Documentos: aplique a ação com a seleção inteira do filtro e clique em **Salvar como regra**. A aba Regras abre com o filtro e a ação preenchidos; dê um nome e clique em **Salvar regra**.',
        'Pela aba Regras: **Nova regra**. No editor: nome, tipo de linha (os 10 tipos, inclusive serviços, imobilizado e cadastros; trocar limpa filtro e ações; para participante e produto a regra começa com Definir campo, sem Alterar tributação), observação, "Em quais linhas" (o mesmo construtor de filtros da grade) e "O que fazer" (+ Alterar tributação, + Definir campo, + Excluir).',
        'O botão **Prévia** do editor mostra o efeito antes de salvar.',
      ),
      sub('Prévia e aplicação'),
      lista(
        '**Prévia e aplicar**, na linha da regra: mostra o efeito por mês e a amostra antes/depois. O botão **Aplicar em todos os meses** fica na prévia.',
        '**Aplicar todas as ativas (N)**: aplica direto, sem prévia, todas as regras marcadas como ativas, na ordem da lista, e mostra o resultado de cada uma. Use quando você já conhece as regras.',
        'Cada aplicação entra no [Desfazer](#desfazer).',
      ),
      sub('Organizar'),
      lista('Ativa: liga ou desliga a regra no "Aplicar todas as ativas".', 'Editar, Duplicar (cria uma cópia) e Excluir.'),
      sub('Exportar e importar'),
      lista(
        '**Exportar regras** baixa `regras-sped-contribuicoes.json`, para levar a outro computador, a um colega ou a outro cliente.',
        '**Importar regras** lê esse JSON. Uma regra que já está na lista entra como cópia, com "(importada)" no nome.',
        'As regras ficam guardadas neste navegador (ver [Privacidade](#privacidade)).',
      ),
    ],
  },
  {
    id: 'importar',
    titulo: 'Importar documentos',
    grupo: 'regras',
    resumo: 'Pacote JSON ou XML de NF-e; XML de entrada entra com tributação pendente (CST 98); a skill converte planilha, XML e PDF.',
    conferirAoIntegrar: 'A skill (SKILL.md, formato.md, validar_pacote.py) ainda não gera os tipos serviço e imobilizado do pacote; quando gerar, tire a frase "A skill ainda não gera..." e confira o trecho.',
    blocos: [
      p(
        'Para incluir documentos que não estão no arquivo, use **Importar documentos** na aba Documentos. Aceita o **pacote de importação em JSON** (arrastado, ou colado e conferido com "Conferir o JSON colado") ou **arquivos .xml de NF-e** (vários de uma vez).',
      ),
      sub('Nada entra sem conferência'),
      lista(
        'Cada documento é conferido; os erros aparecem documento a documento ("nº 3: ...").',
        'Antes de importar, o editor ensaia a importação e diz quantos documentos vão entrar e por que os outros ficariam de fora: CNPJ de outra empresa, mês não carregado, documento que já existe (mesma chave, ou mesmo modelo, série, número e participante).',
        'Cada documento vai para o mês da sua data, na escrituração do mesmo CNPJ.',
        'O botão Importar só fica ativo quando não há erro. Depois, aparece o resultado por mês, os ignorados e os avisos (os que valem para o pacote inteiro aparecem como "geral"). Itens ou créditos com tributação pendente são contados: veja os avisos e defina por regra.',
      ),
      sub('XML de NF-e'),
      lista(
        'É preciso ter pelo menos um mês carregado (para saber o CNPJ da empresa). Com mais de uma empresa carregada, escolha o CNPJ.',
        'XML em que a empresa não é emitente nem destinatária é recusado.',
        '**Nota de entrada emitida por terceiros:** o PIS/COFINS do XML é o do fornecedor, não o seu crédito. Os itens entram com **CST 98, base e alíquota zeradas**. Crie uma [regra](#regras) para definir CST de crédito, alíquotas e base desses itens.',
        '**CFOP de entrada:** o editor só converte o CFOP do fornecedor quando o par é inequívoco (industrialização por encomenda, combustíveis, remessas e retornos). Em vendas em que a entrada depende do uso (insumo ou revenda, como 5101 a 5106 e 5401 a 5405) e em CFOP sem par conhecido, o item entra com **1949/2949 provisório** (não gera crédito) e uma pendência explica as opções, por exemplo 1101 (insumo) ou 1102 (revenda). Para evitar isso, escolha antes, em "Compras em XML de NF-e: finalidade", **insumo (industrialização ou prestação de serviço)** ou **revenda (comercialização)**: vale para os XML escolhidos em seguida. Sem escolher, defina o CFOP certo depois, por regra.',
        '**Data de entrada:** a do XML é a data de emissão; o editor usa essa data e avisa. Confira a data em que a mercadoria entrou, porque é ela que define o mês da escrituração.',
      ),
      sub('Nota de serviço e bem do imobilizado'),
      p('O pacote de importação aceita também estes dois tipos (na grade, ver [Notas de serviço](#servicos) e [Imobilizado](#imobilizado)):'),
      lista(
        '**Nota de serviço**: cria a nota (A100) com os itens (A170), o participante e o item de serviço (0200, tipo 09, com o código da lista de serviços da LC 116). Participante é obrigatório no serviço contratado; o CST tem de combinar com a operação; CST de crédito exige a natureza da base do crédito, que (assim como a origem do crédito) só vale no serviço contratado; alíquotas com até 2 casas. O mês vem do período informado; sem ele, da data de execução; sem ela, da emissão. Nota repetida é recusada. Serviço importado do exterior gera aviso: o Guia exige o registro A120, que a importação não cria.',
        '**Bem do imobilizado**: cria um F120 (crédito sobre depreciação) ou um F130 (crédito sobre aquisição). O período é obrigatório, porque o bem não tem data de documento. As bases seguem a regra do Guia. Bem idêntico no mesmo mês é recusado.',
        '**Sem alíquota, nada é suposto:** documento, item ou crédito importado com CST de crédito (50 a 66) ou de receita tributada (01/02) e sem alíquota entra com alíquota e valor zerados, fica pendente de tributação e o resultado da importação diz quantas linhas vieram assim. Defina a alíquota por [regra](#regras); enquanto isso, a Conferência acusa CST_ALIQUOTA_ZERO.',
      ),
      sub('Planilha, PDF e outros formatos: a skill'),
      p(
        'A skill ainda não gera notas de serviço nem bens do imobilizado. Para converter o que o cliente mandou (planilhas em qualquer layout, XML de NF-e e CT-e, PDF de notas, faturas de energia, lançamentos sem nota) no pacote JSON, use a skill **sped-importar-documentos** no Claude Code, na máquina de quem faz o trabalho. Ela lê os arquivos, pergunta o que não dá para deduzir (CST, alíquotas, base do crédito), nunca inventa tributação, valida o pacote e relata o que ficou de fora. Os arquivos do cliente não saem da máquina.',
      ),
    ],
  },

  // ------------------------------------------------------------------ apuração
  {
    id: 'apuracao',
    titulo: 'Apuração: o que o sistema recalcula',
    grupo: 'apuracao',
    resumo: 'Recalcular apuração refaz o bloco M e o bloco 1; quadro do antes e depois por mês, PIS e COFINS.',
    blocos: [
      p(
        'Na aba **Apuração**, o botão **Recalcular apuração** refaz o bloco M com as edições. Antes do primeiro recálculo de cada empresa, o editor pede os [critérios da apuração](#apuracao-criterios). O bloco M **só muda quando você recalcula**; o botão de baixar recalcula sozinho antes de gerar, se precisar. Enquanto houver edição sem recálculo, a barra de cima mostra **apuração desatualizada** (clique nela para vir a esta aba).',
      ),
      sub('O que é refeito'),
      lista(
        'Créditos: M100/M105 (PIS) e M500/M505 (COFINS), a partir dos documentos: itens de nota (C170), energia (C501/C505), fretes (D101/D105 e D501/D505), F100, F120, F130 e A170.',
        'Ajustes de estorno ligados a notas: M110/M115 e M510/M515 (ver [Estornos automáticos](#apuracao-estornos)).',
        'Contribuições M210/M610, totais M200/M600 e valor a recolher M205/M605. O cálculo inclui as vendas por NFC-e (C175) e os serviços de transporte do resumo diário (D200, com D201 para PIS e D205 para Cofins), usando as bases e alíquotas percentuais escrituradas. No regime misto com CST 01, o editor identifica a contribuição cumulativa pelas alíquotas básicas de 0,65% e 3% e usa os créditos somente na parcela não cumulativa.',
        'Receitas não tributadas M400/M410 e M800/M810 (ver [Natureza da receita](#apuracao-natureza)).',
        'Saldos de crédito 1100/1500 (ver [Saldo credor](#apuracao-saldo)) e a receita bruta do 0111 (ver [Registro 0111](#apuracao-0111)).',
        'Junto, sempre: totais dos documentos, cadastros (0150, 0190, 0200, 0400, 0500) e contadores (x990 e 9900).',
      ),
      p(
        'A base do crédito de cada item de nota vem do **CFOP**, pela tabela oficial de CFOP que geram crédito. Item com CST de crédito num CFOP fora da tabela impede o recálculo do mês (ver [Quando o recálculo é recusado](#apuracao-recusa)).',
      ),
      sub('Ler o antes e o depois'),
      lista(
        'Escolha **PIS/Pasep** ou **COFINS** no alto.',
        'Os cartões mostram o total dos meses: Crédito disponível, Contribuição apurada, **A recolher** e, quando houver, Saldo credor, com a diferença para o arquivo original.',
        'A tabela mostra cada mês com as colunas Variação: **verde é bom para a empresa** (mais crédito, menos contribuição ou menos a recolher), vermelho é o contrário. "detalhar" abre os créditos e as contribuições por tipo.',
        '"Antes" é sempre o arquivo como veio, não o último recálculo.',
      ),
      p(
        'Com notas de serviço (A170) ou bens do imobilizado (F120/F130) carregados, a aba mostra o quadro **Parte da apuração ainda não foi conferida contra arquivo real.**, com a contagem por registro e a orientação de conferir no PVA os créditos (M100/M105 e M500/M505) e, no serviço prestado, a receita (M210/M610).',
      ),
      p(
        'Abaixo do botão aparecem os avisos do recálculo, agrupados por tipo e com os meses em que ocorreram (ver [Avisos](#avisos)). Partes apuradas só pela regra do Guia, ainda sem conferência contra arquivo real, vêm marcadas num aviso de informação.',
      ),
    ],
  },
  {
    id: 'apuracao-preserva',
    titulo: 'O que a apuração mantém como veio',
    grupo: 'apuracao',
    resumo: 'Ajustes manuais, retenções e deduções do M200/M600, saldos de período futuro e registros desconhecidos ficam como estão.',
    blocos: [
      lista(
        '**Ajustes manuais** de crédito (M110/M510 que não são estorno de nota) são mantidos. Um crédito que ficou sem base no mês, mas tem ajuste manual, continua existindo.',
        '**Retenções na fonte e outras deduções** informadas no M200/M600 são dados de entrada: ficam como estão e são descontadas antes dos créditos. Se forem maiores que a contribuição do mês, o editor avisa.',
        'Contribuição que ficou sem receita no mês, mas tem ajustes ou diferimentos, é mantida.',
        'Registro 1100/1500 de período posterior ao da escrituração fica como está.',
        'Registro que não está no leiaute conhecido é mantido como veio.',
      ),
      alerta(
        'Um mês que você não editou e não recalculou sai **byte a byte igual** ao arquivo que entrou (só sem a assinatura digital). Depois de recalcular, um mês sem edição ainda pode mudar no bloco M e no bloco 1, por causa do saldo credor que vem dos meses anteriores ou das opções da apuração; a [Conferência](#conferencia) mostra essas mudanças.',
        'info',
      ),
    ],
  },
  {
    id: 'apuracao-estornos',
    titulo: 'Estornos automáticos',
    grupo: 'apuracao',
    resumo: 'Estornos de crédito ligados a notas de saída são aprendidos do arquivo original e refeitos no recálculo.',
    blocos: [
      p(
        'Ao abrir o arquivo, o editor reconhece os ajustes de redução de crédito (M110/M510) ligados a notas de saída com itens CST 49 e tributo destacado, como baixa por perda (CFOP 5927) ou devolução de compra (CFOP 5201): o ajuste cujo número de documento é de uma nota do arquivo e cujo valor bate com o tributo desses itens.',
      ),
      lista(
        'Esses ajustes passam a acompanhar a nota: se você editar a nota, o estorno é refeito no recálculo. Os demais ajustes ficam como estão.',
        'O editor aprende, por CFOP, como o arquivo distribui o estorno entre os tipos de crédito e usa essa regra no recálculo. A regra aprendida vale só para a empresa (CNPJ) de onde veio.',
        'Se há mais de uma nota com o mesmo número e data, o editor não liga o ajuste a nenhuma delas: o ajuste fica como está e avisa.',
        'Notas que pela regra teriam estorno, mas não têm ajuste no original, **continuam sem ajuste**: o editor não inventa dado e só avisa ("Notas que talvez devessem ter estorno de crédito"). Se o estorno deveria existir, inclua o ajuste no PVA ou confira com quem fez a escrituração.',
        'Estorno que iria para um tipo de crédito que não existe no mês não é gerado, com aviso.',
      ),
    ],
  },
  {
    id: 'apuracao-natureza',
    titulo: 'Natureza da receita e pendências',
    grupo: 'apuracao',
    resumo: 'Receita não tributada precisa de natureza (M410/M810); o que o editor não sabe vira pendência para você informar.',
    blocos: [
      p(
        'Receitas não tributadas (CST 04 a 09) vão para o M400/M410 (PIS) e M800/M810 (COFINS), com a natureza da receita da tabela 4.3.10/4.3.11 do Guia Prático. O editor aprende a natureza de cada receita com o arquivo original.',
      ),
      p(
        'Quando aparece receita que ele não sabe classificar (por exemplo, depois de mudar o CST de itens de saída), ela entra numa natureza provisória e aparece no quadro **Natureza da receita pendente** da aba Apuração, com mês, CST, receita e valor.',
      ),
      passos(
        'Digite o código da natureza da receita na linha da pendência.',
        'Clique em **Atribuir**: o código vale para PIS e COFINS e para todos os meses carregados do mesmo CNPJ, e a apuração é recalculada.',
      ),
      p('Quando a divisão por natureza do original pode ser explicada de mais de um jeito, o editor não adivinha: mantém a divisão original enquanto a receita desses CST não mudar e avisa; se mudar, a diferença vira pendência.'),
      alerta('A natureza atribuída à mão vale só enquanto a aba estiver aberta. Ao carregar de novo, atribua de novo.', 'info'),
    ],
  },
  {
    id: 'apuracao-criterios',
    titulo: 'Critérios da apuração',
    grupo: 'apuracao',
    resumo: 'Saldo credor, ordem de uso dos créditos, 0111 e crédito guardado: escolhas obrigatórias por empresa, sem padrão, antes de recalcular ou baixar.',
    conferirAoIntegrar:
      'Textos das perguntas e consequências vêm de CRITERIOS (src/core/apuracao/criterios.ts). A coluna "Quando costuma fazer sentido" (ORIENTACAO_CRITERIOS) foi escrita aqui e precisa de revisão fiscal antes de ir para os contadores.',
    blocos: [
      p(
        'Algumas escolhas da apuração dependem do caso, e **o editor não tem padrão para nenhuma delas**: o que fazer com o saldo credor, a ordem de uso dos créditos, o registro 0111 e o crédito que o arquivo original guardava. Quem faz o trabalho responde na rotina **Critérios da apuração**, por empresa (CNPJ), sem nada pré-marcado. Para cada opção a tela mostra a consequência fiscal e, à parte, **o que o arquivo original indica (informação, não é aplicado)**. O editor não recomenda nenhuma opção.',
      ),
      sub('Quando a rotina aparece'),
      lista(
        'Enquanto faltar escolha, **Recalcular apuração** e **Recalcular e baixar** abrem a rotina no lugar de recalcular. Mês não alterado baixa como veio, sem precisar dos critérios.',
        'A barra de cima mostra o selo **critérios da apuração pendentes** (clique para abrir a rotina). Na aba Apuração aparece o quadro "Critérios da apuração pendentes" com o botão **Responder os critérios**; depois de respondidos, o resumo "Critérios da apuração" com o botão **alterar**.',
        'Critério que não se aplica à empresa aparece como "não se aplica", com o motivo: o do 0111 quando nenhum mês tem o registro 0111; o do crédito guardado quando o arquivo original não guardou crédito havendo contribuição a recolher.',
        '**Confirmar critérios** só fica ativo com todas as perguntas que se aplicam respondidas; só ele grava as escolhas.',
        'Com várias empresas carregadas, as escolhas são por CNPJ; a caixa **Usar as mesmas escolhas para todas as N empresas carregadas** repete as mesmas respostas.',
      ),
      sub('As perguntas, as respostas e o que muda no arquivo'),
      p('As consequências abaixo são as da própria tela. A coluna da direita descreve situações em que cada resposta costuma ser usada; a decisão é de quem faz o trabalho.'),
      ...CRITERIOS.flatMap((c) => [
        p(`**${c.pergunta}** ${c.explicacao}`),
        tabela(
          ['Resposta', 'O que acontece', 'Quando costuma fazer sentido'],
          ...c.opcoes.map((o) => [
            o.rotulo,
            o.consequencia,
            ORIENTACAO_CRITERIOS[c.id].quando[String(o.valor)] ?? '',
          ]),
        ),
        p(`**O que muda no arquivo:** ${ORIENTACAO_CRITERIOS[c.id].registros}`),
      ]),
      sub('Onde as escolhas aparecem e como reaproveitar'),
      lista(
        'Na aba Apuração (resumo com "alterar") e na Conferência ("Critérios da apuração usados neste trabalho").',
        'O .zip baixado leva `criterios-usados.txt` com as escolhas, a data e os meses; ao baixar um mês só, o aviso do download oferece "baixar também os critérios usados (.txt)".',
        '**Exportar escolhas** salva um JSON; **Importar escolhas** preenche a tela com ele, e nada vale até você conferir e clicar em Confirmar critérios. Se o arquivo for de uma empresa só e ela for outra, as escolhas servem de ponto de partida para todas, com aviso.',
        '**Lembrar estas escolhas para esta empresa** (opcional) guarda as respostas neste navegador; da próxima vez elas aparecem preenchidas para confirmar, nunca valem sozinhas.',
      ),
    ],
  },
  {
    id: 'apuracao-0111',
    titulo: 'Registro 0111 (receita bruta do rateio)',
    grupo: 'apuracao',
    resumo: 'Na empresa com rateio proporcional, você escolhe manter o 0111 ou ajustá-lo pela variação da receita editada.',
    blocos: [
      p(
        'Na empresa que apropria créditos comuns por **rateio proporcional**, o 0111 traz a receita bruta do mês (tributada no mercado interno, não tributada, exportação e cumulativa). Os créditos comuns (CST 53 a 56 e 63 a 66) são divididos entre os tipos 1xx, 2xx e 3xx na proporção dessas receitas.',
      ),
      p(
        'Se você muda a tributação de saídas, a receita de cada tipo muda. O que fazer com o 0111 é um dos [critérios da apuração](#apuracao-criterios): manter o 0111 como está no arquivo, ou ajustá-lo pela variação da receita editada.',
      ),
      lista(
        'Ajustando, o editor soma ou subtrai, tipo por tipo, a variação causada pelas edições e avisa ("Receita bruta do 0111 ajustada") com os valores de antes e depois.',
        'Mantendo, se a receita dos documentos mudou, o editor avisa que o rateio está usando a proporção antiga (o 0111 pode ser editado no PVA).',
      ),
    ],
  },
  {
    id: 'apuracao-saldo',
    titulo: 'Saldo credor, ordem de uso e crédito guardado',
    grupo: 'apuracao',
    resumo: 'Levar o saldo credor adiante ou não, que crédito usar primeiro e o crédito que o original guardava: critérios da apuração.',
    blocos: [
      p(
        'Quando o crédito do mês é maior que a contribuição, sobra **saldo credor**, controlado nos registros 1100 (PIS) e 1500 (COFINS). Três [critérios da apuração](#apuracao-criterios) tratam disso:',
      ),
      lista(
        '**Saldo credor**: levar para os meses seguintes (descontar nos meses seguintes carregados do mesmo CNPJ) ou registrar só no próprio mês.',
        '**Ordem de uso do crédito**: primeiro os créditos de meses anteriores, primeiro os do próprio mês, ou primeiro os do grupo 100 (receita tributada) de todos os meses, preservando os dos grupos 200/300 (ressarcíveis ou compensáveis). O que o arquivo original fez aparece como informação.',
        '**Crédito guardado no original**: quando o original deixou crédito sem descontar havendo contribuição a recolher (reserva para ressarcimento ou compensação), manter a mesma proporção guardada ou descontar o máximo possível. O aviso "Crédito que o arquivo original guardava passou a ser descontado" leva de volta a esse critério.',
      ),
      alerta(
        'O controle do saldo de créditos entre meses (1100/1500) foi feito conforme o Guia Prático e **ainda não foi conferido contra um arquivo real que o contenha**; o próprio sistema mostra esse aviso na aba Apuração ("Apurado por regra do guia, ainda não conferido contra arquivo real"). Confira o saldo levado de um mês para o outro com atenção.',
      ),
      sub('Avisos do saldo'),
      lista(
        'Com meses faltando no meio (por exemplo, janeiro e março sem fevereiro), o saldo é levado mesmo assim e o editor avisa: carregue o mês que falta.',
        'O mesmo período carregado duas vezes para o mesmo CNPJ também gera aviso.',
        'Registrando só no próprio mês, o saldo trazido de meses anteriores (1100/1500) fica como veio. Se ele não bater com o que o mês anterior carregado deixou depois de recalculado, o mês é recalculado mesmo assim, mas sai um **erro** com os valores (o mês estaria usando crédito que não existe, ou deixando de usar crédito que existe) e a orientação de levar o saldo para os meses seguintes e recalcular.',
      ),
    ],
  },
  {
    id: 'apuracao-recusa',
    titulo: 'Quando o recálculo é recusado',
    grupo: 'apuracao',
    resumo: 'Perfis que o motor não sabe apurar ficam com o bloco M como veio; o mês aparece como "não recalculado".',
    blocos: [
      p(
        'O editor prefere **não recalcular** a gerar uma apuração errada. Quando o mês tem algo que o motor não sabe apurar, o bloco M desse mês fica exatamente como veio no arquivo, a tabela marca o mês como **não recalculado** e um quadro vermelho diz o motivo. Ao baixar, o aviso do download repete quais meses saíram assim. **Para esses meses, ajuste a apuração no PVA depois de importar o arquivo.**',
      ),
      sub('Motivos'),
      lista(
        'Falta escolher algum [critério da apuração](#apuracao-criterios) da empresa.',
        'Regime exclusivamente cumulativo. No regime misto, o recálculo também é recusado quando as receitas tributadas usam alíquotas diferenciadas ou quando o M105/M505 indica base de crédito compartilhada com o regime cumulativo.',
        'Rateio proporcional sem o registro 0111, ou arquivo sem o 0110.',
        'Apropriação direta com créditos comuns a mais de um tipo de receita (CST 53 a 56 e 63 a 66).',
        'Registros que o motor não apura: outras vendas e aquisições consolidadas (C180, C190, C380, C395, C400, C490, C600, C800, C860), outros resumos de transporte e comunicação (D300, D350, D600), estoque de abertura, atividade imobiliária, regime de caixa ou competência do lucro presumido, créditos de sucessão (F150, F200, F500, F510, F550, F560, F800), bloco I, cooperativas (M211/M611), contribuição diferida (M300/M700), PIS sobre folha (M350) e controle de retenções (1300/1700). O recálculo também é recusado se a mesma NFC-e tiver C170 e C175 ou se o D200 precisar de detalhes e não tiver D201 nem D205.',
        'Item com CST de crédito num CFOP que não está na tabela de base do crédito; crédito de frete, energia, serviço, imobilizado ou F100 sem a natureza da base do crédito.',
        'Operações por quantidade (alíquota em reais), CST 03, ou CST 05 com alíquota.',
        'Registros do bloco M com a mesma chave que o motor não sabe separar (por exemplo, receita não tributada do mesmo CST em contas contábeis diferentes). Chave repetida que dá para juntar é consolidada, com aviso.',
        'Tipo de crédito ou de contribuição que o motor não gera a partir dos documentos, ou crédito oriundo de sucessão.',
        'Crédito comum (CST 53 a 56 e 63 a 66) sem receita no 0111 nos tipos a que ele se vincula: o Guia não diz como apropriar e o editor não escolhe sozinho.',
        'Crédito presumido cujo tipo (agroindústria x06 ou outras hipóteses x07) não dá para saber pelo original.',
      ),
    ],
  },

  // ------------------------------------------------------------------ entregar
  {
    id: 'desfazer',
    titulo: 'Desfazer e refazer',
    grupo: 'entregar',
    resumo: 'Toda edição, regra e importação se desfaz; o histórico guarda até 200 ações (ou ~150 MB).',
    blocos: [
      lista(
        '**↶ Desfazer** e **↷ Refazer** ficam na barra de cima. Passe o mouse para ver o que vai ser desfeito.',
        'Entram no histórico: edição na célula, ação em lote, aplicação de regra, importação de documentos e reverter/restaurar da Conferência.',
        'O recálculo da apuração **não** entra no histórico: desfazer uma edição deixa a apuração desatualizada até recalcular de novo.',
        'Fazer uma edição nova depois de desfazer apaga o que havia para refazer.',
        'O histórico guarda até **200 ações** ou cerca de **150 MB**; passando disso, as mais antigas são descartadas e a frase ao lado dos botões avisa ("o histórico mais antigo foi descartado...").',
      ),
    ],
  },
  {
    id: 'conferencia',
    titulo: 'Conferência',
    grupo: 'entregar',
    resumo: 'Verificações do editor por mês, lista do que mudou com reverter/restaurar, e download.',
    blocos: [
      alerta(
        '**A validação que vale é a do PVA.** A Conferência pega o que o PVA costuma recusar e o que normalmente é engano de edição, mas não substitui o programa da Receita.',
        'info',
      ),
      sub('Verificações do editor'),
      lista(
        'Com até 12 meses carregados a verificação roda sozinha; acima disso, clique em **Verificar os N meses**.',
        'Cada mês tem um cartão: clique em "detalhar". As ocorrências vêm agrupadas em Erros, Alertas e Informações, e por tipo de problema (até 50 exemplos por tipo).',
        'Em todos os registros: participante, item, unidade, natureza da operação e conta sem cadastro; número fora do formato do SPED; CST de crédito em nota de saída e CST de receita em nota de entrada; CST de crédito (50 a 66) ou de receita tributada (01/02) com base zero em operação com valor, ou com base preenchida e alíquota zero; CFOP que não combina com entrada/saída; CFOP de crédito sem base de crédito configurada.',
        'Só nos registros incluídos ou editados (o que veio do arquivo já passou pelo PVA): campo obrigatório vazio; valor de PIS/COFINS diferente de base × alíquota; chave de documento eletrônico inválida; e as datas, como o Guia exige: a data do documento ou a de entrada/saída precisa estar no período (nenhuma das duas é erro; só a de entrada depois do fim do período é alerta), nota de entrada sem data de entrada é erro e data de entrada antes da emissão é erro.',
        'Os [critérios da apuração](#apuracao-criterios) usados aparecem no alto, em "Critérios da apuração usados neste trabalho".',
        '"Perfil do arquivo" lista os avisos da leitura (versão de leiaute, retificadora, regime, assinatura descartada).',
      ),
      sub('O que mudou'),
      lista(
        'A lista "O que mudou neste mês" mostra cada registro editado (campo, valor antes → depois), incluído ou excluído; inclusões e exclusões vêm primeiro. Até 300 por mês.',
        '**reverter** volta os campos ao valor do arquivo (ou tira o registro incluído); **restaurar** recoloca um excluído no lugar original. Se o registro de cima também foi excluído, restaure primeiro o de cima ou use Desfazer.',
        'A caixa "Mostrar também as mudanças automáticas" inclui o que o editor acertou sozinho: totais, cadastros, contadores e bloco M.',
      ),
      sub('Baixar daqui'),
      p('O botão do alto baixa todos os meses; "Baixar este mês", em cada cartão, baixa só aquele (ver [Baixar e levar ao PVA](#baixar-pva)).'),
    ],
  },
  {
    id: 'baixar-pva',
    titulo: 'Baixar e levar ao PVA',
    grupo: 'entregar',
    resumo: 'Baixar arquivos recalcula se preciso e gera .txt (um mês) ou .zip; depois importar, validar e transmitir no PVA.',
    blocos: [
      passos(
        'Clique em **Baixar arquivos** (canto superior direito). Se houve edição depois do último recálculo, o botão se chama **Recalcular e baixar**: ele recalcula a apuração antes de gerar. Se o recálculo falhar, nada é baixado e a mensagem diz por quê.',
        'Um mês sai como `EFD_CONTRIB_<CNPJ>_<período>_ajustado.txt`; dois ou mais saem juntos num .zip.',
        'Leia o aviso do topo: quantos arquivos, se a apuração foi recalculada, se algum mês saiu com o bloco M sem recalcular e se algum caractere fora do padrão do arquivo (ISO-8859-1) virou "?" (confira descrições e nomes com acento ou símbolo estranho).',
        'No PVA da EFD-Contribuições, importe cada arquivo.',
        'Valide no PVA e corrija o que ele apontar (no PVA ou no editor, baixando de novo).',
        'Para os meses marcados como não recalculados, ajuste a apuração no PVA.',
        'Assine e transmita pelo PVA, como sempre.',
      ),
      alerta('Baixe antes de fechar a aba: fechar apaga tudo o que foi editado.'),
    ],
  },

  // ------------------------------------------------------------------ referência
  {
    id: 'avisos',
    titulo: 'Avisos: o que cada um quer dizer',
    grupo: 'referencia',
    resumo: 'Glossário dos códigos de aviso da leitura, da edição, da apuração e da conferência.',
    blocos: [
      p('Os avisos trazem um código entre parênteses. Procure o código aqui (ou use a busca do manual).'),
      sub('Leitura do arquivo'),
      tabela(
        ['Código', 'O que quer dizer'],
        ['ASSINATURA', 'O arquivo estava assinado (já transmitido); a assinatura foi descartada e o PVA assina de novo.'],
        ['VERSAO_LEIAUTE', 'Versão de leiaute diferente da 006, que é a que o editor segue. Confira no PVA.'],
        ['RETIFICADORA', 'Escrituração retificadora.'],
        ['SEM_0110', 'Arquivo sem o registro 0110 (regime de apuração).'],
        ['REGIME_CUMULATIVO', 'Regime cumulativo: não há créditos; regras de crédito não se aplicam.'],
        ['REGIME_MISTO', 'Regimes não cumulativo e cumulativo no mesmo arquivo.'],
        ['RATEIO_PROPORCIONAL', 'Créditos apropriados por rateio proporcional da receita bruta (0111).'],
        ['ALIQ_UNIDADE', 'Apuração por alíquotas por unidade de medida.'],
        ['SEM_9999', 'Arquivo sem o registro de encerramento 9999: pode estar cortado.'],
        ['LINHA_INVALIDA', 'Linha que não começa e termina com "|".'],
        ['REG_DESCONHECIDO', 'Registro fora do leiaute conhecido; mantido como veio.'],
        ['QTD_CAMPOS', 'Registro com quantidade de campos diferente do leiaute.'],
        ['HIERARQUIA', 'Registro que apareceu sem o registro pai.'],
        ['APURACAO_ORIGINAL', 'Não foi possível guardar a apuração original do arquivo; o "antes" da aba Apuração pode faltar.'],
      ),
      sub('Edição e cadastros'),
      tabela(
        ['Código', 'O que quer dizer'],
        ['CADASTRO_AUSENTE', 'Código usado nos documentos sem cadastro no estabelecimento.'],
        ['CONTA_SEM_0500', 'Conta contábil usada nos documentos que não está no plano de contas (0500). Cadastre no PVA.'],
      ),
      sub('Apuração'),
      tabela(
        ['Código', 'O que quer dizer'],
        ['CRITERIOS_PENDENTES', 'Falta escolher critério da apuração da empresa: o bloco M ficou como estava. Ver [Critérios da apuração](#apuracao-criterios).'],
        ['APURACAO_REGISTRO_NAO_SUPORTADO', 'O arquivo tem registro que o motor não apura; bloco M mantido como veio. Ver [recusa](#apuracao-recusa).'],
        ['APURACAO_REGIME_NAO_SUPORTADO', 'Regime cumulativo ou misto; bloco M mantido.'],
        ['APURACAO_SEM_0110', 'Sem 0110; bloco M mantido.'],
        ['APURACAO_SEM_0111', 'Rateio proporcional sem 0111; bloco M mantido.'],
        ['APURACAO_CFOP_SEM_NAT_BC', 'Item com CST de crédito em CFOP fora da tabela de base do crédito; bloco M mantido.'],
        ['APURACAO_SEM_NAT_BC', 'Crédito de frete, energia ou F100 sem natureza da base do crédito; bloco M mantido.'],
        ['APURACAO_QUANTIDADE', 'Operação por quantidade (alíquota em reais); bloco M mantido.'],
        ['APURACAO_CST_03', 'Operação com CST 03; bloco M mantido.'],
        ['APURACAO_CST_05', 'Operação com CST 05 com alíquota; bloco M mantido.'],
        ['APURACAO_APROPRIACAO_DIRETA', 'Apropriação direta com créditos comuns; bloco M mantido.'],
        ['APURACAO_CREDITO_SUCESSAO', 'Crédito oriundo de sucessão; bloco M mantido.'],
        ['APURACAO_TIPO_CREDITO', 'Tipo de crédito que o motor não gera a partir dos documentos; bloco M mantido.'],
        ['APURACAO_COD_CONT', 'Tipo de contribuição que o motor não gera a partir dos documentos; bloco M mantido.'],
        ['APURACAO_MISTO_ALIQUOTA', 'Regime misto com receita tributada que o editor não consegue enquadrar com segurança pelas alíquotas básicas do CST 01.'],
        ['APURACAO_MISTO_BASE_COMPARTILHADA', 'Regime misto com base de crédito vinculada ao regime cumulativo no M105/M505. A separação dessa base precisa ser feita no PVA.'],
        ['APURACAO_CHAVE_REPETIDA', 'Recálculo recusado: o bloco M tem registros que pelo Guia são diferentes, mas que o motor não sabe separar (M410/M810 da mesma natureza com conta ou descrição diferentes; M400/M800 do mesmo CST com contas diferentes; M210/M610 que diferem só na alíquota em reais). O bloco M fica como veio: ajuste no PVA.'],
        ['APURACAO_RATEIO_SEM_RECEITA', 'Crédito comum (CST 53 a 56, 63 a 66) sem receita no 0111 nos tipos a que ele se vincula; o editor não escolhe sozinho e mantém o bloco M. Confira o 0111 ou o CST dos documentos.'],
        ['APURACAO_PRESUMIDO_AMBIGUO', 'O original tem crédito presumido da agroindústria (x06) e de outras hipóteses (x07) e não dá para saber o tipo de um crédito presumido; bloco M mantido.'],
        ['APURACAO_ERRO', 'Erro inesperado no recálculo: o bloco M pode estar inconsistente. Não baixe sem entender.'],
        ['APURACAO_INDISPONIVEL', 'O motor de apuração não estava disponível; bloco M ficou como no original.'],
        ['APURACAO_SEM_ORIGINAL', 'O aprendizado (estornos, natureza da receita) foi feito sobre o arquivo já editado, não sobre o original.'],
        ['APURACAO_NAO_CONFERIDA', 'Partes apuradas só pela regra do Guia, ainda sem conferência contra arquivo real. Confira com atenção.'],
        ['ESTORNO_AUSENTE', 'Notas que teriam estorno pela regra do arquivo, mas não têm no original; mantidas sem. Ver [estornos](#apuracao-estornos).'],
        ['ESTORNO_SEM_CREDITO', 'Estorno não gerado: não há crédito no mês para abater.'],
        ['ESTORNO_AMBIGUO', 'Ajuste de estorno que o editor não ligou a nenhuma nota, porque há mais de uma nota com o mesmo número e data; o ajuste fica como está e essas notas não recebem estorno automático.'],
        ['CREDITO_RETIDO', 'O original guardava parte do crédito; agora ele é descontado. Ver o critério do [crédito guardado](#apuracao-saldo).'],
        ['CREDITO_SO_COM_AJUSTE', 'Crédito sem base no mês, mantido por ter ajuste manual.'],
        ['CREDITO_NEGATIVO', 'Ajustes de redução maiores que o crédito do mês.'],
        ['CREDITO_ALIQ_DIFERENCIADA_NOVO', 'Crédito classificado como de alíquota diferenciada (x02), que o original não tinha. Se for aquisição de embalagens para revenda, o tipo certo é x05, que o editor não gera: confira antes de transmitir.'],
        ['CONTRIBUICAO_SO_COM_AJUSTE', 'Contribuição sem receita no mês, mantida por ter ajustes ou diferimentos.'],
        ['CST01_ALIQ_DIFERENTE', 'Operações CST 01 (alíquota básica) com alíquota diferente da básica.'],
        ['PRESUMIDO_TIPO_SUPOSTO', 'Crédito presumido (CST 60 a 66) classificado como outros créditos presumidos (x07), porque o original não ensinava o tipo. Se for presumido da agroindústria, o certo é x06.'],
        ['RETENCAO_MAIOR_QUE_CONTRIBUICAO', 'Retenções e deduções do M200/M600 maiores que a contribuição do mês.'],
        ['NATUREZA_RECEITA_PENDENTE', 'Receita não tributada sem natureza conhecida. Ver [natureza da receita](#apuracao-natureza).'],
        ['NATUREZA_RECEITA_AMBIGUA', 'A divisão por natureza da receita do original tem mais de uma explicação; o editor não aprendeu regra. Enquanto a receita desses CST não mudar, a divisão original fica; se mudar, a diferença vira pendência.'],
        ['0111_AJUSTADO', 'Receita bruta do 0111 ajustada pela variação da receita editada, com os valores de antes e depois. Ver [0111](#apuracao-0111).'],
        ['0111_DESATUALIZADO', 'Com a opção de manter o 0111, a receita dos documentos mudou e o 0111 não acompanhou: o rateio dos créditos comuns está usando a proporção antiga.'],
        ['CHAVE_REPETIDA_CONSOLIDADA', 'O bloco M do arquivo trazia registros com a mesma chave, o que o leiaute não admite (M210/M610 do mesmo tipo de contribuição e alíquota; M100/M500 do mesmo tipo de crédito e alíquota; M105/M505 repetido; M400/M800 do mesmo CST e conta; M410/M810 com a chave inteira repetida). O recálculo juntou cada grupo num registro só. Confira.'],
        ['LACUNA_DE_MESES', 'Saldo credor encadeado com meses faltando no meio.'],
        ['PERIODO_REPETIDO', 'O mesmo período do mesmo CNPJ carregado mais de uma vez.'],
        ['SALDO_CREDOR_DIVERGENTE', 'Erro (o mês é recalculado, mas o resultado está errado): registrando o saldo credor só no próprio mês, o saldo de crédito que este mês traz (1100/1500) não bate com o que sobra do mês anterior recalculado. Escolha levar o saldo para os meses seguintes e recalcule.'],
        ['SALDO_CREDOR_NAO_LEVADO', 'O mês anterior recalculado termina com saldo de um crédito que este mês não traz no 1100/1500. Mesma orientação: levar o saldo para os meses seguintes.'],
        ['SALDO_PERIODO_FUTURO', '1100/1500 de período posterior ao da escrituração; mantido.'],
        ['SALDO_TRANSF_OUTROS', 'Saldo com crédito transferido ou outras utilizações, que o saldo levado ao mês seguinte não desconta. Confira.'],
        ['M205_SEM_COD_REC', 'Valor a recolher criado sem código de receita: informe no PVA.'],
        ['M205_VARIOS', 'Valor a recolher com vários códigos de receita: confira a divisão.'],
      ),
      sub('Conferência'),
      tabela(
        ['Código', 'O que quer dizer'],
        ['REF_0150', 'Participante sem cadastro (0150).'],
        ['REF_0190', 'Unidade sem cadastro (0190).'],
        ['REF_0200', 'Item sem cadastro (0200).'],
        ['REF_0400', 'Natureza da operação sem cadastro (0400).'],
        ['REF_0500', 'Conta contábil fora do plano de contas (0500).'],
        ['OBRIGATORIO', 'Campo obrigatório vazio.'],
        ['VALOR_TRIBUTO', 'Valor de PIS/COFINS diferente de base × alíquota.'],
        ['CST_CREDITO_SAIDA', 'CST de crédito em nota de saída.'],
        ['CST_RECEITA_ENTRADA', 'CST de receita em nota de entrada.'],
        ['CFOP_OPERACAO', 'CFOP que não combina com entrada/saída da nota.'],
        ['CFOP_SEM_NAT_BC', 'Item com CST de crédito num CFOP sem base de crédito configurada (o recálculo vai recusar o mês).'],
        ['CHAVE_DV', 'Chave de documento eletrônico (NF-e, CT-e, conta de energia) inválida: dígito verificador ou tamanho.'],
        ['DATA_PERIODO', 'Nenhuma das datas (documento, entrada/saída) está no período da escrituração (erro), ou só a data de entrada/saída passa do fim do período (alerta).'],
        ['DATA_ENTRADA_OBRIGATORIA', 'Nota de entrada sem a data de entrada (DT_E_S).'],
        ['DATA_ENTRADA_ANTES_EMISSAO', 'Data de entrada/saída anterior à data de emissão.'],
        ['NAT_BC_CRED_AUSENTE', 'Item de serviço (A170) ou bem do imobilizado (F120/F130) com CST de crédito sem a natureza da base do crédito (NAT_BC_CRED). Sem ela o crédito não pode ser apurado.'],
        ['IMOBILIZADO_BASE', 'Bem do imobilizado (F120/F130) editado com base fora da regra do Guia (encargo ou aquisição menos a parcela sem crédito, e no F130 a base do mês pelas parcelas). Ver [Imobilizado](#imobilizado).'],
        ['CST_ALIQUOTA_ZERO', 'CST de crédito (50 a 66) ou de receita tributada (01/02) com base preenchida e alíquota zero: não gera crédito nem débito. Vale para itens de nota, F100, fretes, energia, serviços e imobilizado; costuma aparecer depois de importar documento sem alíquota. Defina a alíquota por regra.'],
        ['CST_CREDITO_BASE_ZERO', 'CST de crédito (50 a 66) com base de cálculo zero numa operação com valor: não gera crédito.'],
        ['CST_RECEITA_BASE_ZERO', 'CST de receita tributada (01/02) com base de cálculo zero numa operação com valor: não gera débito.'],
        ['NUMERO_INVALIDO', 'Campo numérico com texto fora do formato do SPED (vírgula decimal, sem separador de milhar).'],
        ['VERIFICACAO_FALHOU', 'A verificação do mês não pôde ser feita.'],
      ),
    ],
  },
  {
    id: 'perguntas',
    titulo: 'Perguntas frequentes',
    grupo: 'referencia',
    resumo: 'Fechar a aba, arquivo igual, mais de uma empresa, regras em outro cliente, onde ajustar o que o editor não faz.',
    blocos: [
      sub('Fechei a aba sem baixar. Perdi?'),
      p('Sim: nada é guardado fora da aba. As regras salvas continuam lá; aplique de novo nos arquivos originais.'),
      sub('Não editei nada. O arquivo baixado é igual ao original?'),
      p('Sem recalcular, sai byte a byte igual (só sem a assinatura digital). Depois de recalcular, veja [o que a apuração mantém](#apuracao-preserva).'),
      sub('Posso usar a mesma regra em outro cliente?'),
      p('Pode: exporte as regras, carregue os arquivos do outro cliente e importe. Confira a prévia: o filtro pega as linhas que atendem a ele lá.'),
      sub('O tour ou o manual diz uma coisa e a tela mostra outra'),
      p('Avise quem mantém o sistema: tour e manual têm de ser atualizados junto com a tela (ver [Tour guiado e este manual](#sobre-ajuda)).'),
      sub('O PVA recusou o arquivo'),
      p('Corrija no PVA, ou volte ao editor, corrija e baixe de novo. A [Conferência](#conferencia) costuma apontar a causa antes.'),
    ],
  },
  {
    id: 'limites',
    titulo: 'Limites conhecidos',
    grupo: 'referencia',
    resumo: 'Memória, perfis de arquivo, PVA como validador final, natureza da receita só na sessão.',
    blocos: [
      lista(
        '**Memória:** ~9,5 MB por mês; acima de 24 meses o navegador fica lento. Um ano por vez é o recomendado.',
        '**Perfil:** a apuração é recalculada para o regime não cumulativo e para o regime misto nas condições suportadas. Outros perfis carregam e podem ser editados com o bloco M original (ver [recusa](#apuracao-recusa)).',
        '**Leiaute:** o editor segue a versão 006 do leiaute (Guia Prático 1.35).',
        '**Caracteres:** o arquivo é gravado em ISO-8859-1; caractere fora disso sai como "?" e o aviso do download conta quantos.',
        '**Histórico:** até 200 ações ou ~150 MB para desfazer.',
        '**Natureza da receita** atribuída à mão e o histórico de desfazer valem só enquanto a aba estiver aberta.',
        '**O PVA é quem valida.**',
      ),
    ],
  },
  {
    id: 'sobre-ajuda',
    titulo: 'Tour guiado e este manual',
    grupo: 'referencia',
    resumo: 'Como reabrir o tour, o convite "O sistema mudou" e o compromisso de manter tour e manual em dia.',
    blocos: [
      lista(
        'O **tour guiado** abre sozinho na primeira visita. Para rever, clique em **Tour guiado** na barra de cima. Teclas: → ou Enter avança, ← volta, Esc fecha.',
        'Sem arquivo carregado, o tour explica cada passo em modo demonstrativo, sem destacar a tela.',
        'Quando o sistema muda, quem já viu o tour recebe um convite discreto, **"O sistema mudou: ver o que há de novo"**, que mostra só os passos novos.',
        'Este **Manual** fica na aba Manual: índice ao lado, busca no texto e um endereço para cada seção.',
      ),
      p('Tour e manual são atualizados junto com qualquer mudança de tela, rótulo, fluxo, opção ou comportamento fiscal. Se encontrar diferença, avise.'),
    ],
  },
];

/** Seções com comportamento em mudança: conferir no código ao integrar. */
export const SECOES_A_CONFERIR = SECOES.filter((s) => s.conferirAoIntegrar).map((s) => ({ id: s.id, titulo: s.titulo, oQue: s.conferirAoIntegrar! }));

// ---------------------------------------------------------------------------
// Cobertura: o que o sistema expõe → onde o manual fala disso.
// Os `Record<...>` fazem o `tsc` falhar quando aparece um tipo de linha, ação,
// modo de base ou opção de apuração novo sem lugar no manual. `documentacao.test.ts`
// confere que a seção existe e que o termo aparece no texto dela.
// ---------------------------------------------------------------------------

export interface Mencao {
  secao: string;
  /** Texto que precisa aparecer na seção (o rótulo que o usuário vê). */
  termo: string;
}

export const COBERTURA: {
  /** Abas do App.tsx (por id), lidas do código-fonte pelo teste. */
  abas: Record<string, Mencao>;
  /**
   * Tipos de linha: o teste percorre `TIPOS_LINHA_TODOS` do motor, e o `Record` faz o tsc acusar
   * tipo novo sem seção. O termo é o rótulo que a TELA mostra (`ROTULO_TIPO` de src/ui/formato.ts), que tem de aparecer na seção.
   */
  tiposLinha: Record<TipoLinhaTodos, Mencao>;
  acoes: Record<Acao['tipo'], Mencao>;
  modosBase: Record<ModoBaseForm, Mencao>;
  configApuracao: Record<keyof ConfigApuracao, Mencao>;
  /** Os critérios da apuração e os valores de resposta, lidos de `CRITERIOS` (src/core/apuracao/criterios.ts). */
  criterios: Record<IdCriterio, { secao: string; valores: string[] }>;
  /** Todo código de aviso conhecido → seção que o explica (o código precisa aparecer no texto). */
  avisos: Record<string, string>;
} = {
  abas: {
    documentos: { secao: 'grades', termo: 'Documentos' },
    cadastros: { secao: 'cadastros', termo: 'Cadastros' },
    regras: { secao: 'regras', termo: 'Regras' },
    apuracao: { secao: 'apuracao', termo: 'Apuração' },
    conferencia: { secao: 'conferencia', termo: 'Conferência' },
    manual: { secao: 'sobre-ajuda', termo: 'Manual' },
  },
  tiposLinha: Object.fromEntries(
    (
      [
        ['item', 'grades'],
        ['nota', 'grades'],
        ['frete', 'grades'],
        ['energia', 'grades'],
        ['f100', 'grades'],
        ['servico', 'servicos'],
        ['imobDepreciacao', 'imobilizado'],
        ['imobAquisicao', 'imobilizado'],
        ['participante', 'cadastros'],
        ['produto', 'cadastros'],
      ] satisfies [TipoLinhaTodos, string][]
    ).map(([t, secao]) => [t, { secao, termo: ROTULO_TIPO[t] }]),
  ) as Record<TipoLinhaTodos, Mencao>,
  acoes: {
    tributacao: { secao: 'edicao-lote', termo: 'Alterar tributação' },
    definirCampo: { secao: 'edicao-lote', termo: 'Definir campo' },
    excluir: { secao: 'edicao-lote', termo: 'Excluir' },
  },
  modosBase: {
    manter: { secao: 'edicao-lote', termo: 'Não alterar a base' },
    'valor-item': { secao: 'edicao-lote', termo: 'Valor do item' },
    'valor-item-menos-desconto': { secao: 'edicao-lote', termo: 'Valor do item menos o desconto' },
    'valor-item-menos-desconto-menos-icms': { secao: 'edicao-lote', termo: 'Valor do item menos desconto e ICMS' },
    zero: { secao: 'edicao-lote', termo: 'Zero' },
    fixo: { secao: 'edicao-lote', termo: 'Valor fixo (digitar)' },
  },
  configApuracao: {
    saldoCredor: { secao: 'apuracao-saldo', termo: 'Saldo credor' },
    ordemUsoCredito: { secao: 'apuracao-saldo', termo: 'Ordem de uso do crédito' },
    preservarRetencaoCredito: { secao: 'apuracao-saldo', termo: 'Crédito guardado no original' },
    cfopNatBc: { secao: 'apuracao', termo: 'CFOP' },
    estornos: { secao: 'apuracao-estornos', termo: 'estorno' },
    receitaBruta0111: { secao: 'apuracao-0111', termo: 'variação da receita editada' },
    naturezasReceita: { secao: 'apuracao-natureza', termo: 'natureza da receita' },
    criteriosPorCnpj: { secao: 'apuracao-criterios', termo: 'por empresa (CNPJ)' },
  },
  // lidos do catálogo do motor: critério ou valor novo exige ORIENTACAO_CRITERIOS (o teste confere)
  criterios: Object.fromEntries(
    CRITERIOS.map((c) => [c.id, { secao: 'apuracao-criterios', valores: c.opcoes.map((o) => String(o.valor)) }]),
  ) as Record<IdCriterio, { secao: string; valores: string[] }>,
  avisos: Object.fromEntries(
    [
      'ASSINATURA', 'VERSAO_LEIAUTE', 'RETIFICADORA', 'SEM_0110', 'REGIME_CUMULATIVO', 'REGIME_MISTO', 'RATEIO_PROPORCIONAL',
      'ALIQ_UNIDADE', 'SEM_9999', 'LINHA_INVALIDA', 'REG_DESCONHECIDO', 'QTD_CAMPOS', 'HIERARQUIA', 'APURACAO_ORIGINAL',
      'CADASTRO_AUSENTE', 'CONTA_SEM_0500',
      'CRITERIOS_PENDENTES', 'APURACAO_REGISTRO_NAO_SUPORTADO', 'APURACAO_REGIME_NAO_SUPORTADO', 'APURACAO_SEM_0110', 'APURACAO_SEM_0111',
      'APURACAO_CFOP_SEM_NAT_BC', 'APURACAO_SEM_NAT_BC', 'APURACAO_QUANTIDADE', 'APURACAO_CST_03', 'APURACAO_CST_05',
      'APURACAO_APROPRIACAO_DIRETA', 'APURACAO_CREDITO_SUCESSAO', 'APURACAO_TIPO_CREDITO', 'APURACAO_COD_CONT', 'APURACAO_RATEIO_SEM_RECEITA', 'APURACAO_PRESUMIDO_AMBIGUO', 'APURACAO_CHAVE_REPETIDA', 'CHAVE_REPETIDA_CONSOLIDADA',
      'APURACAO_MISTO_ALIQUOTA', 'APURACAO_MISTO_BASE_COMPARTILHADA',
      'APURACAO_ERRO', 'APURACAO_INDISPONIVEL', 'APURACAO_SEM_ORIGINAL', 'APURACAO_NAO_CONFERIDA',
      'ESTORNO_AUSENTE', 'ESTORNO_SEM_CREDITO', 'ESTORNO_AMBIGUO', 'PRESUMIDO_TIPO_SUPOSTO', 'NATUREZA_RECEITA_AMBIGUA', '0111_DESATUALIZADO',
      'SALDO_CREDOR_DIVERGENTE', 'SALDO_CREDOR_NAO_LEVADO', 'CREDITO_RETIDO', 'CREDITO_SO_COM_AJUSTE', 'CREDITO_NEGATIVO', 'CREDITO_ALIQ_DIFERENCIADA_NOVO',
      'CONTRIBUICAO_SO_COM_AJUSTE', 'CST01_ALIQ_DIFERENTE', 'RETENCAO_MAIOR_QUE_CONTRIBUICAO',
      'NATUREZA_RECEITA_PENDENTE', '0111_AJUSTADO', 'LACUNA_DE_MESES', 'PERIODO_REPETIDO', 'SALDO_PERIODO_FUTURO',
      'SALDO_TRANSF_OUTROS', 'M205_SEM_COD_REC', 'M205_VARIOS',
      'NAT_BC_CRED_AUSENTE', 'IMOBILIZADO_BASE', 'CST_ALIQUOTA_ZERO', 'DATA_ENTRADA_OBRIGATORIA', 'DATA_ENTRADA_ANTES_EMISSAO', 'CST_CREDITO_BASE_ZERO', 'CST_RECEITA_BASE_ZERO', 'NUMERO_INVALIDO',
      'REF_0150', 'REF_0190', 'REF_0200', 'REF_0400', 'REF_0500', 'OBRIGATORIO', 'VALOR_TRIBUTO', 'CST_CREDITO_SAIDA',
      'CST_RECEITA_ENTRADA', 'CFOP_OPERACAO', 'CFOP_SEM_NAT_BC', 'CHAVE_DV', 'DATA_PERIODO', 'VERIFICACAO_FALHOU',
    ].map((c) => [c, 'avisos']),
  ),
};

/** Texto puro da seção (sem marcação), para a busca e para os testes. */
export function textoDaSecao(s: Secao): string {
  const partes: string[] = [s.titulo, s.resumo];
  for (const b of s.blocos) {
    if (b.tipo === 'p' || b.tipo === 'subtitulo' || b.tipo === 'alerta') partes.push(b.texto);
    else if (b.tipo === 'lista' || b.tipo === 'passos') partes.push(...b.itens);
    else partes.push(...b.cabecalho, ...b.linhas.flat());
  }
  return partes.join('\n').replace(/\*\*|`/g, '').replace(/\[([^\]]+)\]\(#[^)]+\)/g, '$1');
}
