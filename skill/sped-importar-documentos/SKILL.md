---
name: sped-importar-documentos
description: Converte documentos que o cliente mandou (planilhas Excel/CSV com colunas em qualquer ordem, XML de NF-e e CT-e, NFS-e de serviço em XML ou PDF, PDF de notas, faturas de energia/água/gás, relatórios de ERP, relatórios de ativo imobilizado e depreciação, lançamentos de aluguel ou receita sem nota) em um "pacote de importação" JSON válido para o botão "Importar documentos" do editor SPED EFD-Contribuições (PIS/COFINS). Use quando a pessoa pedir para importar, converter, subir ou lançar notas, itens, fretes, contas de energia, notas de serviço (NFS-e), bens do imobilizado (depreciação ou aquisição) ou operações F100 no editor, ou para preparar créditos de PIS/COFINS a partir de arquivos de cliente.
---

# Importar documentos para o editor SPED Contribuições

Seu trabalho: ler o que o cliente mandou, entender o que é cada coisa e gerar **um arquivo JSON** no formato do editor, conferido por um validador. A pessoa então importa esse JSON no editor.

Arquivos desta skill (todos na pasta da skill):

- `referencia/formato.md`: campos, tipos de documento, tabelas de CST e de base de crédito. **Leia antes de montar o pacote.**
- `scripts/validar_pacote.py`: validador. Obrigatório antes de entregar.
- `scripts/auxiliares.py`: conversores prontos (número brasileiro, data, CNPJ, chave).
- `exemplos/pacote-exemplo.json`: pacote pequeno e válido com os 7 tipos de documento (inclusive nota de serviço e imobilizado F120/F130).

## Regras que valem o tempo todo

1. **Nunca invente CST, alíquota, base ou valor.** Se a fonte não traz, pergunte à pessoa ou deixe o documento de fora e relate. Não "complete" com 1,65% e 7,6% por achar que é o normal. O editor também **não supõe alíquota em nenhum tipo** (nota, itens, frete, energia, F100, serviço, imobilizado): CST de crédito (50 a 66) ou de receita tributada (01/02) sem alíquota entra zerado, fica pendente e a validação do editor acusa erro. O validador alerta esses casos; trate cada alerta de "sem alíquota" como pergunta pendente, não como detalhe.
2. **Na dúvida, pergunte.** Mas junte todas as perguntas em uma única mensagem e só pergunte o que muda o resultado.
3. **Privacidade.** Os dados são de clientes. Tudo fica nesta máquina: não envie arquivos nem trechos a sites, APIs, serviços de OCR ou conversores online. Não copie dados reais para dentro desta pasta da skill nem para o repositório do editor; grave o pacote e os scripts de conversão ao lado dos arquivos do cliente (ou onde a pessoa indicar).
4. **Nada fica de fora em silêncio.** Todo documento ou linha descartada vai para o relatório final com o motivo.

## Passo 1. Inventariar e classificar

Liste os arquivos recebidos (pasta ou caminhos informados) e, para cada um, abra e olhe o conteúdo antes de decidir. Classifique cada arquivo (ou cada aba/bloco de uma planilha):

| O que é | Tipo no pacote |
|---|---|
| Nota de mercadoria completa, com seus itens (XML de NF-e, planilha com cabeçalho + itens) | `nota` |
| Itens soltos que pertencem a uma nota que **já está** na escrituração | `itens` |
| Conhecimento de transporte (CT-e, frete) | `frete` |
| Conta de energia elétrica, água ou gás | `energia` |
| Aluguel, leasing, receita financeira, qualquer operação sem nota fiscal | `f100` |
| Nota fiscal de serviço (NFS-e municipal, padrão nacional, PDF de prefeitura), do serviço que a empresa **contratou** (crédito) ou **prestou** (receita) | `servico` |
| Relatório de ativo imobilizado: encargo de depreciação/amortização do mês (F120) ou valor de aquisição do bem (F130) | `imobilizado` |

Depreciação de bem do ativo **não** é mais `f100`: use `imobilizado`.

Se algum arquivo não se encaixa em nenhuma linha (contrato, extrato, imagem sem texto), diga que ficou de fora e por quê.

Antes de ler tudo, mostre à pessoa um resumo curto do inventário ("3 planilhas de notas, 120 XMLs de NF-e, 2 PDFs de energia") junto com as perguntas do passo 2.

## Passo 2. Perguntar o que não dá para deduzir

Pergunte só o que faltar e mudar o resultado:

- **CNPJ do estabelecimento** que recebe os documentos, se não aparecer nos arquivos (em XML, o CNPJ da empresa é o que se repete em várias notas).
- **Entrada ou saída**, quando a fonte não diz (planilha de "notas do mês" sem coluna de operação). Em XML isso se deduz (passo 3).
- **PIS/COFINS**: quando a fonte não traz CST e alíquota (CT-e, fatura de energia, planilha sem essas colunas), pergunte qual CST e quais alíquotas aplicar, e se vale para tudo ou só para parte. Sem resposta, esses documentos ficam de fora.
- **Base do crédito** (`natBcCred`) e **natureza do frete** (`natFrete`) de fretes, energia e F100: proponha o código que parece certo pelo tipo de gasto, mostrando a tabela de `referencia/formato.md`, e peça confirmação.
- **Base de cálculo do crédito** da energia (com ou sem ICMS): pergunte qual regra o time usa.
- **Planilha sem itens** (só total por nota): o pacote exige ao menos um item por nota, com código, descrição, unidade, quantidade e CFOP. Não crie item "genérico" sem a pessoa autorizar e dizer quais valores usar.
- **Alíquotas de PIS e COFINS dos créditos** de frete e energia: sempre pergunte (o editor não assume padrão; sem alíquota o crédito fica zerado).
- **Nota de serviço** (`servico`):
  - **Contratada ou prestada?** Compare o CNPJ da empresa com prestador e tomador da nota (veja o passo 3). Se a empresa não aparece em nenhum dos dois, deixe de fora e relate.
  - **CST e alíquotas de PIS e COFINS**: a NFS-e quase nunca traz CST. Pergunte qual CST e quais alíquotas aplicar, e se vale para todas as notas ou só para parte. Alíquotas com no máximo 2 casas. Em serviço **prestado** não há `natBcCred` nem `indOrigCred` (o editor recusa).
  - **Natureza da base do crédito** (`natBcCred`), obrigatória quando o CST é de crédito (50 a 66): proponha pelo tipo de serviço (em geral `"03"`, serviço usado como insumo), mostrando a tabela de `referencia/formato.md`, e peça confirmação.
  - **Retenção de PIS/COFINS**: se a nota mostra valores retidos, confirme que são só informativos (`pisRetido`, `cofinsRetido`, aceitos no contratado e no prestado) e não mudam o crédito.
  - **Mês da escrituração**, quando a data de execução do serviço cai em mês diferente da emissão e a pessoa quer outro mês (`periodo`).
- **Bem do imobilizado** (`imobilizado`), o que o relatório de ativo fixo raramente diz:
  - **Depreciação ou aquisição?** O crédito do bem entra pelo **encargo de depreciação do mês** (F120) ou pelo **valor de aquisição** (F130, aproveitado em parcelas)? Para o mesmo bem, não lance os dois ao mesmo tempo sem a pessoa confirmar.
  - **Número de parcelas** do F130: integral, 12, 24, 48 ou 6 meses, ou outra periodicidade (nesse caso, a base do mês). A data de aquisição e a vida útil do relatório não bastam para decidir.
  - **Parcela do valor que não gera crédito** (`parcelaSemCredito`): se o relatório não separa, pergunte; não suponha zero.
  - **Tipo do bem** (`identificacaoBem`: máquina, equipamento, veículo, edificação...) e **utilização** (`utilizacao`: produção, serviços, locação ou outros). Utilização "9" não dá direito a crédito.
  - **CST e alíquotas** (alíquota com até 4 casas; **não mande `pis.base`/`cofins.base`**: o editor ignora e calcula pela regra do guia), **amortização ou depreciação** (`natBcCred` 11 ou 09 no F120) e **mês** do crédito (`periodo`, obrigatório).
- Mês de escrituração diferente da data do documento (`periodo`), se a pessoa mencionar.

## Passo 3. Ler cada tipo de fonte

### Planilhas (Excel, CSV)

- `.xlsx`: tente `python3 -c "import openpyxl"`. Se não houver, **não instale globalmente**: crie um ambiente virtual numa pasta temporária (`python3 -m venv`) e instale lá, ou peça para a pessoa salvar como CSV. `.xls` antigo: peça para salvar como `.xlsx` ou CSV.
- CSV: teste as codificações `utf-8-sig` e `cp1252`, e o separador (`;` é o mais comum no Brasil).
- Olhe as primeiras 15 linhas: o cabeçalho pode não estar na linha 1; pode haver título, linhas em branco, linhas de total no fim, abas ocultas. Ignore linhas de total/subtotal.
- Se há uma linha por item, com número da nota repetido, **agrupe** por nota (chave, ou número + série + CNPJ do participante) e monte um documento `nota` por grupo.
- Cuidado com o Excel: CNPJ e NCM viram número e perdem zero à esquerda (use `so_digitos(..., zeros_a_esquerda=True)`); chaves viram notação científica (se vier `3.5E+43`, a chave está perdida: peça o XML ou a planilha em texto); datas podem vir como número de série.

**Dicionário de sinônimos** (compare ignorando maiúsculas, acentos e pontuação; confirme o mapeamento com a pessoa quando houver mais de um candidato):

| Campo do pacote | Nomes comuns na planilha |
|---|---|
| `numero` | Nº NF, Número, Nota, NF, Nr Nota, Num Doc, Documento |
| `serie` | Série, Serie, Ser. |
| `chave` | Chave, Chave NFe, Chave de Acesso, Chave Acesso |
| `dataDocumento` | Emissão, Data Emissão, Dt Emissão, Data NF, Data |
| `dataEntradaSaida` | Entrada, Data Entrada, Dt Entrada, Data Saída, Dt Saída, Data Lançamento |
| `participante.cnpjCpf` | CNPJ, CNPJ Fornecedor, CNPJ/CPF, CPF/CNPJ, CNPJ Cliente, Documento Fornecedor |
| `participante.nome` | Fornecedor, Razão Social, Nome, Cliente, Emitente, Destinatário |
| `participante.ie` | IE, Insc. Estadual, Inscrição Estadual |
| `item.codigo` | Código, Cód. Produto, Cod Item, SKU, Referência |
| `item.descricao` | Descrição, Produto, Descrição do Produto, Mercadoria |
| `item.ncm` | NCM, NCM/SH, Classificação Fiscal |
| `item.unidade` | Un, UN, Unid, UM, Unidade |
| `item.quantidade` | Qtd, Qtde, Quantidade |
| `item.valorItem` | Vlr Total, Valor Total Item, Valor Produto, Vl. Produto, Total Item |
| `item.valorDesconto` | Desconto, Vlr Desc, Vl Desconto |
| `item.cfop` | CFOP |
| `icms.cst` | CST ICMS, CST, Situação Tributária, CSOSN |
| `icms.base` / `aliquota` / `valor` | BC ICMS, Base ICMS; Alíq ICMS, % ICMS; Vlr ICMS, ICMS |
| `ipi.valor` | Vlr IPI, IPI |
| `pis.cst` | CST PIS, CST PIS/COFINS |
| `pis.base` / `aliquota` / `valor` | BC PIS, Base PIS; Alíq PIS, % PIS; Vlr PIS, PIS |
| `cofins.cst` / `base` / `aliquota` / `valor` | CST COFINS; BC COFINS; Alíq COFINS, % COFINS; Vlr COFINS, COFINS |
| `totais.documento` | Valor NF, Total NF, Valor Total da Nota |
| `totais.frete` / `seguro` / `outrasDespesas` | Frete, Vlr Frete; Seguro; Outras Despesas, Desp. Acessórias |
| `operacao` | Tipo, Operação, E/S, Entrada/Saída |
| `contaContabil` | Conta, Conta Contábil |
| `centroCusto` | CC, Centro de Custo |

**Nota de serviço (planilha de NFS-e / relatório de serviços tomados ou prestados):**

| Campo do pacote | Nomes comuns |
|---|---|
| `operacao` (`contratado`/`prestado`) | Serviços Tomados / Serviços Prestados (nome da aba ou do relatório), Tomado, Prestado, Natureza |
| `numero` | Nº NFS-e, Número da Nota, Nº RPS, Número NFSe |
| `chave` | Código de Verificação, Cód. Verificação, Chave NFS-e, Autenticidade |
| `dataDocumento` | Data de Emissão, Emissão, Competência da nota (cuidado: competência não é emissão) |
| `dataExecucao` | Data da Prestação, Data do Serviço, Data de Execução, Competência |
| `participante` | Prestador / Razão Social do Prestador (contratado); Tomador / Razão Social do Tomador (prestado); CNPJ/CPF do Prestador ou do Tomador |
| `item.codigoServico` | Item da Lista de Serviço, Cód. Serviço, Código LC 116, Item LC 116, Subitem |
| `item.descricao` | Discriminação, Discriminação dos Serviços, Descrição do Serviço |
| `item.valorItem` | Valor dos Serviços, Valor do Serviço, Valor Bruto, Total do Serviço |
| `item.valorDesconto` | Deduções, Desconto Incondicionado, Desconto, Valor Deduzido |
| `valorIss` | ISS, ISSQN, Valor do ISS |
| `pisRetido` / `cofinsRetido` | PIS Retido, Retenção PIS; COFINS Retida, Retenção COFINS |
| `valorDocumento` | Valor Líquido, Valor Total da Nota |

**Imobilizado (relatório de ativo fixo / depreciação):**

| Campo do pacote | Nomes comuns |
|---|---|
| `descricao` | Descrição do Bem, Bem, Ativo, Patrimônio, Nome do Ativo |
| `identificacaoBem` | Classe, Grupo, Tipo do Bem, Conta do Ativo (Máquinas, Veículos, Edificações, Instalações) |
| `mesAquisicao` | Data de Aquisição, Data de Compra, Data de Incorporação, Data de Início de Uso |
| `valorAquisicao` | Valor de Aquisição, Custo, Valor Original, Valor de Compra |
| `valorEncargo` | Depreciação do Mês, Encargo do Mês, Quota de Depreciação, Depreciação Mensal, Amortização do Mês |
| `parcelaSemCredito` | Valor sem Crédito, Não Gera Crédito, Parcela Excluída (raro: em geral é preciso perguntar) |
| `contaContabil` / `centroCusto` | Conta, Conta Contábil; CC, Centro de Custo |
| (informativo, não vai no pacote) | Taxa de Depreciação (% ao ano), Vida Útil, Depreciação Acumulada, Valor Residual / Líquido |

Taxa, vida útil e depreciação acumulada ajudam a **conferir** o encargo do mês (valor × taxa ÷ 12), mas o pacote leva só o encargo do mês. Se o relatório traz só a taxa e o valor de aquisição, calcule o encargo, **mostre à pessoa** e peça confirmação antes de usar.

Se uma coluna importante não tem candidato claro, pergunte; não adivinhe.

### Formatos de dado

| Dado | Como converter |
|---|---|
| Número brasileiro `1.234,56` | `numero_br()` do `auxiliares.py` → `1234.56`. Um ponto único com 3 casas (`1.234`) é ambíguo: pergunte ou confira com a soma da nota. |
| Datas `05/03/2025` | `data_iso()` → `2025-03-05`. Atenção a `03/05` (mês/dia americano) quando a planilha vem de sistema em inglês: confira com o período dos documentos. |
| CNPJ `44.555.666/0001-81` | `so_digitos(x, 14)` → só dígitos. CPF: 11 dígitos. |
| Chave `3525 0344 5556 ...` | `chave_limpa()` → 44 dígitos sem espaços. |
| NCM `7318.15.00` | `so_digitos(x, 8)`. |
| Alíquota `1,65%` ou `0,0165` | Sempre em percentual: `1.65`. Se a planilha traz fração (`0.0165`), multiplique por 100 e avise. |
| Dinheiro | `dinheiro()` → texto com 2 casas (`"1234.56"`). |

### XML de NF-e (procNFe / NFe)

Os XMLs têm namespace `http://www.portalfiscal.inf.br/nfe`; use `xml.etree.ElementTree` com o namespace. Pule XML que não seja NF-e (eventos, inutilização) e notas não autorizadas (`protNFe/infProt/cStat` diferente de 100; cancelada: relate).

| Pacote | Onde está no XML |
|---|---|
| `chave` | `protNFe/infProt/chNFe` ou o `Id` de `infNFe` sem o prefixo `NFe` |
| `modelo`, `serie`, `numero` | `ide/mod`, `ide/serie`, `ide/nNF` |
| `dataDocumento` | `ide/dhEmi` (ou `dEmi`), só a parte da data |
| `dataEntradaSaida` | `ide/dhSaiEnt` (ou `dSaiEnt`), se existir |
| participante | o outro lado da operação (regra abaixo): `emit` (`CNPJ`/`CPF`, `xNome`, `IE`, `enderEmit/cMun`) ou `dest` (`CNPJ`/`CPF`, `xNome`, `IE`, `enderDest/cMun`) |
| `indPagamento` | `pag/detPag/indPag`, se existir |
| `indFrete` | `transp/modFrete` (0 emitente, 1 destinatário, 2 terceiros, 9 sem frete) |
| `totais` | `total/ICMSTot`: `vNF`→documento, `vProd`→mercadorias, `vDesc`, `vFrete`, `vSeg`, `vOutro`→outrasDespesas |
| item | cada `det`: `prod/cProd`→codigo, `xProd`→descricao, `NCM`, `uCom`→unidade, `qCom`, `vProd`→valorItem, `vDesc`, `CFOP` |
| `icms` | `imposto/ICMS/*`: `orig`+`CST` (ou `orig`+`CSOSN`) juntos formam o `cst` de 3 dígitos; `vBC`, `pICMS`, `vICMS`; `vBCST`, `pICMSST`, `vICMSST` |
| `ipi` | `imposto/IPI/IPITrib` (ou `IPINT`): `CST`, `vBC`, `pIPI`, `vIPI` |
| `pis` | `imposto/PIS/*` (`PISAliq`, `PISQtde`, `PISNT`, `PISOutr`): `CST`, `vBC`, `pPIS`, `vPIS` |
| `cofins` | `imposto/COFINS/*`: `CST`, `vBC`, `pCOFINS`, `vCOFINS` |

Se o item não tem `PIS`/`COFINS` no XML (ou só `PISNT` sem valores), use o CST que está no XML e **não invente** alíquota. Se o XML não traz CST, aplique a regra 1.
Valores por unidade (`PISQtde`: `qBCProd`, `vAliqProd`) não cabem em `base`/`aliquota` percentuais: informe só `cst` e `valor` e relate.

**Entrada ou saída, própria ou terceiros** (compare com o CNPJ da empresa, só dígitos):

| Situação | `emissao` | `operacao` | Participante |
|---|---|---|---|
| `emit` = empresa e `ide/tpNF` = 1 | `propria` | `saida` | `dest` |
| `emit` = empresa e `ide/tpNF` = 0 | `propria` | `entrada` | `dest` |
| `dest` = empresa e `emit` ≠ empresa | `terceiros` | `entrada` | `emit` |
| `emit` = `dest` = empresa (transferência) | pergunte | | |
| nenhum dos dois é a empresa | **deixe de fora** e relate | | |

### XML de CT-e

Namespace `http://www.portalfiscal.inf.br/cte`. Pule os não autorizados (`cStat` ≠ 100).

| Pacote | Onde está |
|---|---|
| `chave`, `modelo`, `serie`, `numero`, `dataDocumento` | `protCTe/infProt/chCTe`, `ide/mod`, `ide/serie`, `ide/nCT`, `ide/dhEmi` |
| participante | `emit` (a transportadora) quando a empresa contrata o frete; `dest`/`rem` quando a empresa é a transportadora |
| `valorDocumento`, `valorServico` | `vPrest/vTPrest` e `vPrest/vRec` |
| `icms` | `imp/ICMS/*`: `vBC`→base, `vICMS`→valor |

- `operacao`: `entrada` quando a empresa **contrata** o frete (é a tomadora: `ide/toma3/toma`, ou `toma4`, aponta para o CNPJ dela), inclusive frete pago na venda. `saida` quando a empresa **presta** o transporte (`emit` = empresa).
- `emissao`: `propria` se `emit` = empresa; senão `terceiros`.
- CT-e **não traz** CST de PIS/COFINS, `natFrete`, nem `natBcCred`: pergunte (passo 2). Sem resposta, relate o CT-e como ficou de fora.

### PDF

- Leia o PDF e veja se saiu texto. Se sair, extraia número, datas, emitente, valores e itens, e **mostre à pessoa o que extraiu** (principalmente valores e CNPJ) antes de gerar.
- Se o PDF é imagem (escaneado/foto, sem texto selecionável) ou o texto sai embaralhado, **diga isso**: é preciso o XML ou uma planilha, ou OCR feito por uma ferramenta instalada nesta máquina que a pessoa aprove. Não chute valores e não envie o arquivo a nenhum serviço externo.
- Se há XML e PDF da mesma nota, use o XML.

### Energia, água e gás

Em geral vêm em PDF. Extraia: concessionária (CNPJ, nome), número da conta, data de emissão, data de entrada (se não houver, pergunte), valor total, ICMS destacado. Modelo: `06` conta de energia em papel, `55`/`66` eletrônica, `28` gás, `29` água. Monte `creditos` com o CST, `natBcCred` e alíquotas confirmados no passo 2. **O editor não assume alíquota padrão**: crédito de frete ou energia sem `aliquotaPis`/`aliquotaCofins` entra com valor zero. Por isso pergunte as alíquotas; nunca as omita. Se a fatura destaca PIS e COFINS, mostre à pessoa e pergunte se usa esses percentuais ou os do regime.

### Itens avulsos em nota existente (`itens`)

Cuidado: o editor **recusa o documento se não achar a nota** na escrituração, e o validador não tem como conferir isso. Por isso prefira sempre a **chave de acesso** a número + série + CNPJ. Informe também o `periodo` (se houver duas notas com o mesmo número em meses diferentes, sem `periodo` o editor recusa por ambiguidade). Avise a pessoa de que a nota precisa já estar carregada no editor.

### Nota de serviço (NFS-e)

**Reconhecer.** NFS-e não é a NF-e de mercadoria: não tem chave de 44 dígitos nem CFOP nem NCM. O XML traz tags como `InfNfse`, `CompNfse`, `Servico`, `Prestador`, `Tomador` (padrão ABRASF, usado por muitas prefeituras), ou `NFSe`/`infNFSe`/`DPS` com `emit`, `toma`, `serv` e `valores` (**padrão nacional**). Cada prefeitura muda nomes e acentos: abra o arquivo, veja a estrutura e **mostre à pessoa o mapeamento** antes de converter. Namespace e nomes variam; não suponha o da outra cidade.

**O que ler** (nomes mais comuns; confirme no arquivo):

| Pacote | Onde está na NFS-e |
|---|---|
| `numero`, `serie`, `chave` | `Numero` / `nNFSe`; série do RPS, se houver; **código de verificação** (`CodigoVerificacao`, `chNFSe` ou `Id`) |
| `dataDocumento` | `DataEmissao` / `dhEmi` (só a parte da data) |
| `dataExecucao` | `Competencia` / `dCompet` ou data da prestação, quando a nota traz. Competência é referência de mês; se a nota não traz uma data de execução clara, omita |
| participante | **Prestador** (`PrestadorServico`, `emit`: CNPJ, razão social, município) quando a empresa contratou; **Tomador** (`TomadorServico`, `toma`) quando a empresa prestou |
| `codigoServico` | `ItemListaServico` / `cTribNac`: reescreva no padrão `NN.NN` (`7.02` vira `07.02`; código nacional de 6 dígitos tem o item e o subitem nos 4 primeiros: `140100` vira `14.01`) |
| `item.descricao` | `Discriminacao` / `xDescServ` |
| `item.valorItem` | `ValorServicos` / `vServ` |
| `item.valorDesconto` | `DescontoIncondicionado` / `vDescIncond` (**não** use `ValorDeducoes` como desconto de PIS/COFINS sem perguntar: dedução do ISS é outra coisa) |
| `valorIss` | `ValorIss` / `vISSQN` |
| `pisRetido`, `cofinsRetido` | `ValorPis`, `ValorCofins` (retenções federais da nota) / `vPis`, `vCofins` do grupo de retenção |
| `valorDocumento` | `ValorLiquidoNfse` / `vLiq` |

**Cuidados.**
- A NFS-e **não traz CST nem a natureza da base do crédito**: pergunte (passo 2); sem resposta, a nota fica de fora. Não use as alíquotas de PIS/COFINS que a nota destaca como retenção para calcular o crédito sem perguntar: retenção e crédito são coisas diferentes.
- Nota **cancelada** (situação cancelada no XML ou carimbo no PDF): `situacao: "02"` e **sem itens** (se forem enviados, o editor ignora); relate. Nota regular precisa de ao menos um item.
- Se a nota tem **vários serviços** (várias linhas), faça um item para cada um. Se só traz um valor total, um item único com a discriminação.
- **Valor do serviço, deduções e ISS**: mostre à pessoa. Se há dedução da base, pergunte se a base de PIS/COFINS usa o valor cheio ou o líquido da dedução.
- Compare o CNPJ da empresa: prestador = empresa → `operacao: "prestado"`, `emissao: "propria"` (participante é o tomador); tomador = empresa → `operacao: "contratado"`, `emissao: "terceiros"` (participante é o prestador). Nenhum dos dois: deixe de fora e relate.
- **PDF de nota de serviço**: veja a seção PDF. Mostre à pessoa número, datas, CNPJ do prestador e do tomador, valor do serviço, ISS, retenções e código do serviço antes de gerar. Se há XML da mesma nota, use o XML.

### Relatório de imobilizado e depreciação

**Reconhecer.** Planilha ou PDF do sistema de patrimônio ("Relatório de Ativo Fixo", "Mapa de Depreciação", "Razão do Imobilizado") com uma linha por bem: descrição, data de aquisição, valor de aquisição, taxa de depreciação (% ao ano), depreciação do mês, depreciação acumulada, valor líquido. Uma linha por bem vira um documento `imobilizado`; **não** agrupe bens diferentes sem a pessoa pedir (o leiaute aceita "grupo de bens", mas só se a pessoa disser que o relatório já vem agrupado).

**Como ler.**
- **Depreciação (F120)**: use a coluna do encargo **do mês** (não a acumulada). O mês do relatório vira o `periodo`. Ignore linhas de total e bens totalmente depreciados (encargo zero) e **relate** os ignorados.
- **Aquisição (F130)**: use a data de aquisição (só mês e ano em `mesAquisicao`) e o valor de aquisição; o `periodo` é o mês em que o crédito começa, informado pela pessoa.
- Bens **sem direito a crédito** (utilização "9", uso fora da atividade, terreno, bem que não gera crédito): pergunte antes de incluir ou excluir.
- Classifique o bem em `identificacaoBem` (máquina, equipamento, veículo...) pela conta ou classe do relatório e **mostre o mapeamento** à pessoa.
- Relatórios de depreciação **contábil** e **fiscal** podem trazer valores diferentes: pergunte qual a empresa usa para o crédito.
- **Nunca** calcule o encargo a partir da taxa sem mostrar à pessoa e ter confirmação.

### Operações sem nota (F100)

Aluguéis, arrendamento, receitas financeiras e similares (depreciação de bem do ativo vai em `imobilizado`) geralmente vêm em planilha ou lista. Para cada linha: `indOper` (0 crédito, 1 receita tributada, 2 receita não tributada), data, valor, CST/alíquotas e, se for crédito, `natBcCred` (obrigatório).

## Passo 4. Regras de qualidade

- Dinheiro com 2 casas; alíquota em percentual; CNPJ/CPF, chave e NCM só dígitos; datas `AAAA-MM-DD`.
- Textos como `numero`, `serie`, `cst`, `cfop`, `codigo` sempre entre aspas.
- **Um documento por nota**, com todos os itens dela dentro. Nunca uma nota por item.
- Campo sem dado: omita (nada de `null`, `""`, `0` ou `"N/D"` de enfeite).
- Sempre preencha `referencia` (arquivo e linha, ou nome do XML) para a pessoa achar a origem de qualquer erro.
- **Conferência de totais**: para cada nota, some `valorItem` dos itens e compare com o total de mercadorias da fonte (`vProd` do XML, coluna de total da planilha). Se informar `totais.documento`, confira também: mercadorias − desconto + frete + seguro + outras (o IPI e o ICMS-ST que estão no total da nota explicam diferenças). Divergência de mais de 1 centavo: **não ajuste valores para "fechar"**; relate a nota, os dois totais e a diferença, e pergunte se entra assim ou fica de fora.
- **Nota de serviço**: some `valorItem − valorDesconto` dos itens e compare com o valor do serviço da nota (e com `valorDocumento`, se informar). O validador alerta a diferença; não ajuste para fechar.
- **Imobilizado**: confira a soma dos encargos do mês com o total de depreciação do relatório do cliente.
- Notas duplicadas (mesma chave, ou mesmo número/série/CNPJ): inclua uma só e relate.
- Valores negativos, quantidade zero, CNPJ com dígito verificador inválido: relate à pessoa antes de seguir.

## Passo 5. Gerar o pacote com um script

Não digite JSON grande à mão. Escreva um script Python (biblioteca padrão; `auxiliares.py` ajuda) que lê as fontes, monta a lista de documentos e grava o JSON com `json.dump(..., ensure_ascii=False, indent=2)`. Guarde o script junto do pacote (`converter.py`), para a pessoa poder repetir.

Estrutura mínima: `{"formato": "sped-contrib-import", "versao": 1, "cnpj": "<14 dígitos>", "origem": "<nome da planilha/pasta>", "documentos": [...]}`.

O script deve juntar, numa lista, tudo o que descartar (arquivo/linha, motivo) para o relatório.

- Os meses não precisam ser separados: o editor distribui cada documento pelo mês da data. Só use `periodo` se a pessoa pedir ou se a data não representar o mês certo. Exceção: `imobilizado` não tem data, então `periodo` é sempre obrigatório. Em `servico`, o mês vem da data de execução e, se nenhuma escrituração carregada a cobrir, da emissão.
- **Acima de ~20 mil itens**, divida em vários pacotes (`pacote-1.json`, `pacote-2.json`...), sempre cortando entre documentos (nunca no meio de uma nota), cada um com o cabeçalho completo. O validador alerta quando passa disso.

## Passo 6. Validar e entregar

Rode (o caminho da skill está no cabeçalho "Base directory" quando ela é carregada):

```
python3 "<pasta da skill>/scripts/validar_pacote.py" caminho/do/pacote.json
```

- **Erros** (linhas `ERRO`): corrija na origem (no script de conversão) e rode de novo. Só entregue com `RESULTADO: APROVADO`. Se um erro não tem correção possível (dado ausente na fonte), tire o documento do pacote e relate.
- **Alertas**: leia todos. Corrija os que forem erro de conversão; os demais (por exemplo, divergência de total que a pessoa aceitou) vão no relatório.
- Se a tela de validação mostra o campo e a `Referência`, use-a para achar a linha de origem.

Entregue ao final, em linguagem simples:

1. O caminho do(s) arquivo(s) `.json` e a instrução: no editor, abrir a escrituração e usar **Importar documentos**.
2. Resumo: quantos documentos e itens por tipo e por mês, e o valor total por tipo (o validador imprime isso).
3. **O que ficou de fora e por quê** (arquivo/linha/nota, motivo), mais as divergências de total e os alertas que sobraram.
4. As suposições que a pessoa confirmou (CST, alíquotas, natBcCred, entrada/saída) para constar no relatório do cliente.

## Conferir antes de entregar

Peça à pessoa para olhar este checklist no relatório antes de importar (e, quando houver dúvida, não importe):

- [ ] **Quantidade de documentos por tipo e por mês** (inclusive notas de serviço e bens do imobilizado) bate com o que ela esperava receber do cliente?
- [ ] **Soma dos valores** por tipo bate com o total que o cliente informou (relatório do ERP, total da planilha, soma dos XMLs)?
- [ ] **Lista do que ficou de fora** (arquivo, linha ou nota, motivo): algum item é importante e precisa ser resolvido com o cliente?
- [ ] **Divergências de total** e alertas restantes: foram aceitos de propósito?
- [ ] **Suposições** (CST, alíquotas, base do crédito, entrada/saída) são as combinadas com o cliente?
- [ ] Documentos do tipo `itens`: as notas já estão carregadas no editor?
- [ ] Imobilizado: a modalidade (depreciação ou aquisição), o número de parcelas e a parcela sem crédito foram confirmados bem a bem? O mesmo bem não está nos dois (F120 e F130)?
- [ ] Serviço contratado: o prestador está identificado e o CST, as alíquotas e a base do crédito foram confirmados?

Se algo no contrato do pacote parecer insuficiente para o caso (um campo que a fonte traz e o formato não tem), não force: diga o que faltou e como contornou.
