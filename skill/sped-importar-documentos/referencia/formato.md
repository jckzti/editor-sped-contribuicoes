# Formato do pacote de importação (`sped-contrib-import`, versão 1)

Este documento descreve, campo a campo, o único arquivo que o botão **Importar documentos** do editor aceita. A fonte da verdade é `src/core/importacao.tipos.ts`; o JSON Schema equivalente está em `public/sped-import.schema.json`. Se este texto divergir do arquivo de tipos, vale o arquivo de tipos.

## Regras gerais

| Assunto | Regra |
|---|---|
| Arquivo | JSON em UTF-8. |
| Datas | Sempre `"AAAA-MM-DD"` (ex.: `"2025-03-05"`). Nunca `05/03/2025`. |
| Período | `"AAAA-MM"` (ex.: `"2025-03"`). |
| Valores em dinheiro | Número (`1234.56`) ou texto (`"1234.56"` ou `"1234,56"`). Duas casas decimais. Sem ponto de milhar (`"1.234,56"` é recusado). |
| Alíquotas | Em percentual: PIS 1,65% é `1.65`; COFINS 7,6% é `7.6`. Nunca `0.0165`. |
| CNPJ / CPF | Só dígitos: 14 (CNPJ) ou 11 (CPF). |
| Chave de acesso | 44 dígitos, sem espaços. |
| NCM | 8 dígitos. CFOP: 4 dígitos. CST de PIS/COFINS: 2 dígitos. |
| Textos | Códigos como `numero`, `serie`, `codigo`, `cst` vão **entre aspas**, mesmo que pareçam número. |
| Campo opcional | Se não tem o dado, **omita o campo**. Não envie `null` nem texto vazio. |
| Campo desconhecido | É ignorado (o validador avisa, pois costuma ser erro de digitação). |
| Tamanho | Até cerca de 20 mil itens por pacote; acima disso, divida em mais de um arquivo. |

## Raiz do pacote

| Campo | Obrig. | Descrição |
|---|---|---|
| `formato` | sim | Sempre `"sped-contrib-import"`. |
| `versao` | sim | Sempre o número `1` (sem aspas). |
| `cnpj` | sim | CNPJ do estabelecimento da escrituração que recebe os documentos. |
| `origem` | não | Texto livre: de onde vieram os dados (nome da planilha, pasta de XMLs). |
| `documentos` | sim | Lista de documentos. Cada um tem `tipo`: `nota`, `itens`, `frete`, `energia`, `f100`, `servico` ou `imobilizado`. |

## Campos comuns a todo documento

| Campo | Obrig. | Descrição |
|---|---|---|
| `tipo` | sim | `"nota"`, `"itens"`, `"frete"`, `"energia"`, `"f100"`, `"servico"` ou `"imobilizado"`. |
| `periodo` | não | Mês da escrituração que recebe o documento (`"2025-03"`). Se omitido, o editor usa a data de entrada/saída e, na falta, a data do documento (no `servico`: a data de execução e, na falta, a de emissão; no `imobilizado` ele é **obrigatório**). |
| `referencia` | não | Texto livre para rastrear a origem (ex.: `"notas.xlsx, linha 12"`). **Sempre preencha**: aparece nas mensagens de erro e no relatório do editor. |

## Participante (`participante`)

| Campo | Obrig. | Descrição |
|---|---|---|
| `nome` | sim | Razão social ou nome. |
| `cnpjCpf` | não* | CNPJ (14) ou CPF (11), só dígitos. *Só pode faltar para exterior (informe `codPais`). |
| `ie` | não | Inscrição estadual. |
| `codMunicipio` | não | Código IBGE do município, 7 dígitos. |
| `codPais` | não | Código do país (BACEN), 4 dígitos. Padrão `"1058"` (Brasil). |
| `endereco`, `numero`, `complemento`, `bairro`, `suframa` | não | Texto. |

## Tributo PIS/COFINS (`pis`, `cofins`)

| Campo | Obrig. | Descrição |
|---|---|---|
| `cst` | sim | CST com 2 dígitos (tabela abaixo). |
| `base` | não | Base de cálculo. Se faltar e houver alíquota: valor do item menos desconto. |
| `aliquota` | não | Percentual (`1.65`). |
| `valor` | não | Valor do tributo. Se faltar: base × alíquota. |

Quando `base`, `aliquota` e `valor` vêm juntos, o validador exige `valor ≈ base × alíquota ÷ 100` (tolerância de 1 centavo).

**O editor nunca supõe alíquota, em nenhum tipo de documento** (nota, itens, frete, energia, f100, servico, imobilizado). CST de crédito (50 a 66) ou de receita tributada (01 e 02) **sem alíquota** entra com valor zero, fica **pendente** e a validação do editor acusa erro. O validador alerta em todos esses casos: pergunte as alíquotas à pessoa, nunca complete por conta própria.

## Item (`itens[]` em `nota` e em `itens`)

| Campo | Obrig. | Descrição |
|---|---|---|
| `codigo` | sim | Código do produto no cadastro do cliente (vira o registro 0200). |
| `descricao` | sim | Descrição do produto. |
| `ncm` | não | 8 dígitos. |
| `unidade` | sim | `"UN"`, `"KG"`, `"CX"`... |
| `tipoItem` | não | Tabela do 0200 (abaixo). |
| `quantidade` | sim | Quantidade. |
| `valorItem` | sim | Valor total do item (quantidade × unitário), **antes** de descontos. |
| `valorDesconto` | não | Desconto do item. |
| `cfop` | sim | 4 dígitos. Começa com 1/2/3 em entrada; 5/6/7 em saída. |
| `natOperacao` | não | `{ "codigo": "001", "descricao": "Venda" }` (registro 0400). |
| `icms` | não | `{ cst, base, aliquota, valor, baseSt, aliquotaSt, valorSt }`, todos opcionais. CST do ICMS com 2 ou 3 dígitos. |
| `ipi` | não | `{ cst, base, aliquota, valor }`, todos opcionais. |
| `pis` | sim | Tributo PIS (acima). |
| `cofins` | sim | Tributo COFINS (acima). |
| `contaContabil` | não | Código da conta (registro 0500). |

## Tipo `nota` (gera C100 + C170)

Nota fiscal inteira com seus itens.

| Campo | Obrig. | Descrição |
|---|---|---|
| `operacao` | sim | `"entrada"` ou `"saida"`. |
| `emissao` | sim | `"propria"` (emitida pela empresa) ou `"terceiros"`. |
| `modelo` | não | `"55"` NF-e, `"01"` NF, `"65"` NFC-e... Padrão `"55"`. |
| `situacao` | não | Padrão `"00"` (regular). Ver tabela. |
| `serie` | não | Série. |
| `numero` | sim | Número da nota. |
| `chave` | não | 44 dígitos (com dígito verificador válido). |
| `dataDocumento` | sim | Data de emissão. |
| `dataEntradaSaida` | não | Data de entrada ou saída. |
| `participante` | sim | Fornecedor (entrada) ou cliente (saída). |
| `indPagamento` | não | `"0"` à vista, `"1"` a prazo, `"9"` sem pagamento. Padrão `"1"`. |
| `indFrete` | não | `"0"` emitente, `"1"` destinatário, `"2"` terceiros, `"3"` próprio por conta do remetente, `"4"` próprio por conta do destinatário, `"9"` sem frete. Padrão `"9"`. |
| `totais` | não | `{ documento, mercadorias, desconto, frete, seguro, outrasDespesas }`. O que faltar é somado a partir dos itens. |
| `itens` | sim | Lista de itens. |

Exemplo mínimo:

```json
{
  "tipo": "nota",
  "referencia": "notas.xlsx, linha 2",
  "operacao": "entrada",
  "emissao": "terceiros",
  "numero": "12345",
  "serie": "1",
  "chave": "35250344555666000181550010000123451123456780",
  "dataDocumento": "2025-03-05",
  "participante": { "cnpjCpf": "44555666000181", "nome": "Distribuidora Alfa Ficticia Ltda" },
  "itens": [
    {
      "codigo": "A001", "descricao": "Parafuso sextavado", "ncm": "73181500", "unidade": "CX",
      "quantidade": 100, "valorItem": 5000.00, "cfop": "1102",
      "pis": { "cst": "50", "base": 5000.00, "aliquota": 1.65, "valor": 82.50 },
      "cofins": { "cst": "50", "base": 5000.00, "aliquota": 7.6, "valor": 380.00 }
    }
  ]
}
```

## Tipo `itens` (acrescenta itens em nota que já existe na escrituração)

| Campo | Obrig. | Descrição |
|---|---|---|
| `nota` | sim | Como achar a nota: `chave` (preferível) **ou** `numero` + `serie` + `cnpjCpfParticipante`. |
| `itens` | sim | Lista de itens (mesmo formato acima). |

**Use sempre `periodo`** (recomendado; o validador alerta se faltar). O editor procura a nota em todos os meses carregados, mas se houver duas notas com o mesmo número em meses diferentes e o pacote não trouxer `periodo`, ele recusa o documento por ambiguidade. Se o editor não achar a nota, também recusa o documento: por isso a `chave` é muito melhor que número + série + CNPJ. O validador não consegue conferir se a nota existe (ela está no arquivo SPED, não no pacote).

```json
{
  "tipo": "itens",
  "referencia": "itens-avulsos.xlsx, linha 5",
  "periodo": "2025-03",
  "nota": { "numero": "778", "serie": "1", "cnpjCpfParticipante": "44555666000181" },
  "itens": [
    {
      "codigo": "C200", "descricao": "Embalagem plástica", "unidade": "UN",
      "quantidade": 500, "valorItem": 320.00, "cfop": "1101",
      "pis": { "cst": "50", "aliquota": 1.65 },
      "cofins": { "cst": "50", "aliquota": 7.6 }
    }
  ]
}
```

## Crédito (`creditos[]` em `frete` e `energia`)

| Campo | Obrig. | Descrição |
|---|---|---|
| `valorItem` | sim | Valor do item/parcela que dá direito a crédito. |
| `cst` | sim | CST (o mesmo para PIS e COFINS). Normalmente 50 a 56 ou 60 a 66. |
| `natBcCred` | sim | Código da base do crédito, `"01"` a `"18"` (tabela abaixo). |
| `base` | não | Base de cálculo. Se faltar: `valorItem`. |
| `aliquotaPis` | não* | Percentual. |
| `aliquotaCofins` | não* | Percentual. |
| `contaContabil` | não | Conta contábil. |

*O editor **não assume alíquota padrão**: crédito sem alíquota entra com valor zero, fica pendente e a validação do editor acusa erro. Por isso informe sempre as duas alíquotas (o validador alerta a falta de cada uma).

## Tipo `frete` (CT-e; gera D100 + D101 + D105)

| Campo | Obrig. | Descrição |
|---|---|---|
| `operacao`, `emissao` | sim | `emissao`: como em `nota`. `operacao`: `"entrada"` quando a empresa **contrata** o frete (aquisição do serviço, inclusive o frete da própria venda); `"saida"` quando a empresa **presta** o transporte (é a transportadora). Confirmado no contrato. |
| `modelo` | não | Padrão `"57"`. |
| `situacao`, `serie`, `subserie` | não | Texto. |
| `numero` | sim | Número do conhecimento. |
| `chave` | não | 44 dígitos. |
| `dataDocumento` | sim | Data de emissão. |
| `dataEntradaSaida` | não | Data da aquisição/prestação. |
| `participante` | sim | Transportadora (ou tomador, se a emissão for própria). |
| `valorDocumento` | sim | Valor total do conhecimento. |
| `valorDesconto`, `valorServico` | não | Valores. |
| `indFrete` | não | Mesmos códigos do `indFrete` da nota. Padrão `"1"`. |
| `icms` | não | `{ base, valor, naoTributado }`. |
| `natFrete` | sim | Natureza do frete (IND_NAT_FRT, tabela abaixo). |
| `creditos` | sim | Lista de créditos (pode ser `[]`, mas gera alerta). |
| `contaContabil` | não | Conta contábil. |

```json
{
  "tipo": "frete",
  "referencia": "CT-e 5521.xml",
  "operacao": "entrada",
  "emissao": "terceiros",
  "numero": "5521",
  "serie": "1",
  "chave": "41250333444555000181570010000055211123456784",
  "dataDocumento": "2025-03-20",
  "participante": { "cnpjCpf": "33444555000181", "nome": "Transportes Gama Ficticia Ltda" },
  "valorDocumento": 800.00,
  "natFrete": "0",
  "creditos": [
    { "valorItem": 800.00, "cst": "50", "natBcCred": "07", "aliquotaPis": 1.65, "aliquotaCofins": 7.6 }
  ]
}
```

## Tipo `energia` (energia elétrica, água, gás; gera C500 + C501 + C505)

| Campo | Obrig. | Descrição |
|---|---|---|
| `modelo` | não | `"06"` energia (papel), `"55"`/`"66"` eletrônica, `"28"` gás, `"29"` água. Padrão `"06"`. |
| `situacao`, `serie`, `subserie` | não | Texto. |
| `numero` | sim | Número da conta/fatura. |
| `chave` | não | 44 dígitos (modelos eletrônicos). |
| `dataDocumento` | sim | Data de emissão. |
| `dataEntrada` | sim | Data de entrada (**obrigatória** aqui, diferente da nota). |
| `participante` | sim | A concessionária. |
| `valorDocumento` | sim | Valor total da conta. |
| `valorIcms` | não | ICMS destacado. |
| `creditos` | sim | Lista de créditos. Em geral `natBcCred: "04"` (energia elétrica). Para água e gás, pergunte ao usuário qual base se aplica. |

```json
{
  "tipo": "energia",
  "referencia": "fatura-energia-mar25.pdf",
  "modelo": "06",
  "serie": "B",
  "numero": "334455",
  "dataDocumento": "2025-04-02",
  "dataEntrada": "2025-04-03",
  "participante": { "cnpjCpf": "55666777000181", "nome": "Energia Delta Ficticia SA" },
  "valorDocumento": 3200.00,
  "valorIcms": 576.00,
  "creditos": [
    { "valorItem": 3200.00, "cst": "50", "natBcCred": "04", "base": 2624.00, "aliquotaPis": 1.65, "aliquotaCofins": 7.6 }
  ]
}
```

## Tipo `f100` (operação sem documento fiscal específico; gera F100)

Aluguel, receita financeira, leasing, depreciação e semelhantes.

| Campo | Obrig. | Descrição |
|---|---|---|
| `indOper` | sim | `"0"` entrada com direito a crédito; `"1"` receita tributada; `"2"` receita não tributada. |
| `participante` | não | Quem recebe ou paga. |
| `codItem` | não | Código do item no cadastro (0200). |
| `data` | sim | Data da operação. |
| `valor` | sim | Valor da operação. |
| `pis`, `cofins` | sim | Tributos (formato acima). |
| `natBcCred` | cond. | **Obrigatório quando `indOper = "0"`.** Código `"01"` a `"18"`. |
| `indOrigCred` | não | `"0"` mercado interno, `"1"` importação. |
| `contaContabil`, `centroCusto`, `descricao` | não | Texto. |

```json
{
  "tipo": "f100",
  "referencia": "despesas.xlsx, linha 8",
  "indOper": "0",
  "data": "2025-03-10",
  "valor": 4500.00,
  "pis": { "cst": "50", "base": 4500.00, "aliquota": 1.65, "valor": 74.25 },
  "cofins": { "cst": "50", "base": 4500.00, "aliquota": 7.6, "valor": 342.00 },
  "natBcCred": "05",
  "indOrigCred": "0",
  "descricao": "Aluguel do galpao"
}
```

## Tipo `servico` (nota fiscal de serviço; gera A100 + A170)

NFS-e municipal (ou documento estrangeiro equivalente). Serve para o serviço que a empresa **contratou** (crédito de PIS/COFINS sobre serviço usado como insumo) e para o serviço que a empresa **prestou** (receita). O editor cria o A010 do estabelecimento se faltar e cria o item no cadastro (0200, tipo "09" serviços) se o código ainda não existir.

| Campo | Obrig. | Descrição |
|---|---|---|
| `operacao` | sim | `"contratado"` = serviço tomado pela empresa (IND_OPER 0); `"prestado"` = serviço que a empresa prestou (IND_OPER 1). |
| `emissao` | sim | `"propria"` (emitida pelo estabelecimento) ou `"terceiros"` (emitida pelo prestador). |
| `situacao` | não | `"00"` regular (padrão) ou `"02"` cancelada. Só esses dois valores. Nota regular **exige** `itens` (ao menos um); a cancelada dispensa (se vierem itens, são ignorados com aviso). |
| `serie`, `subserie` | não | Texto, **até 20 caracteres** (acima disso é recusado). |
| `numero` | sim | Número da nota, **até 60 caracteres**. Se não houver número, `"SN"`. |
| `chave` | não | Chave ou **código de verificação** da NFS-e (CHV_NFSE), texto de **até 60 caracteres**. **Não** é a chave de 44 dígitos da NF-e: o validador não exige 44 dígitos. |
| `dataDocumento` | sim | Data de emissão. |
| `dataExecucao` | não | Data em que o serviço foi executado/concluído (DT_EXE_SERV). Sem ela, o campo fica em branco. Sem `periodo`, a nota vai para o mês desta data; se nenhuma escrituração carregada cobrir esse mês, vai para o mês da emissão. |
| `participante` | cond. | **Obrigatório no serviço contratado** (o prestador). No prestado é o tomador e pode faltar (consumidor final). |
| `indPagamento` | não | `"0"` à vista, `"1"` a prazo (padrão), `"9"` sem pagamento. |
| `valorDocumento` | não | Total da nota. Se faltar: soma dos itens − desconto. |
| `valorDesconto` | não | Desconto total. Se faltar: soma dos descontos dos itens. |
| `pisRetido`, `cofinsRetido` | não | PIS e COFINS **retidos na fonte**. Aceitos no serviço contratado e no prestado; são só informativos: não entram na apuração (A100, campos 19 e 20; a retenção que se deduz vai no F600, que a importação não cria). |
| `valorIss` | não | Valor do ISS da nota. |
| `itens` | sim* | Lista de itens de serviço (abaixo). *Só a nota cancelada (`"02"`) dispensa. |

### Item de serviço (`itens[]` do `servico`; gera A170)

| Campo | Obrig. | Descrição |
|---|---|---|
| `codigo` | sim | Código do serviço no cadastro do cliente (vira o 0200), até 60 caracteres. |
| `descricao` | sim | Descrição do serviço. |
| `codigoServico` | não | Código do serviço na **lista da LC 116/2003**, no padrão `NN.NN` (ex.: `"17.01"`, `"14.01"`). Só é gravado quando o item **ainda não existe** no cadastro (0200): item já cadastrado **não é alterado**, e o editor apenas avisa se o código for diferente. O contrato não obriga; informe sempre que a nota trouxer (a NFS-e traz). |
| `unidade` | não | Unidade, **até 6 caracteres**. Opcional em serviço. |
| `descricaoComplementar` | não | Texto da nota (DESCR_COMPL do A170). |
| `valorItem` | sim | Valor total do item. |
| `valorDesconto` | não | Desconto incondicional / valor que a nota exclui da base de PIS e COFINS. |
| `natBcCred` | cond. | Base do crédito (tabela 4.3.7). **Obrigatório quando o CST de PIS ou COFINS é de crédito (50 a 66)**; só vale em serviço contratado (**no prestado é recusado**). |
| `indOrigCred` | não | `"0"` mercado interno (padrão no serviço contratado) ou `"1"` importação (o guia exige então o registro A120, que a importação não cria: o editor avisa). Só no serviço contratado; no prestado é recusado. |
| `pis`, `cofins` | sim | Tributos. Contratado: CST **50 a 66** (crédito) ou **70 a 99** (sem crédito). Prestado: CST **01 a 09**, **49** ou **99**. Sem `base` e com alíquota: valor do item − desconto. |
| `contaContabil`, `centroCusto` | não | Conta (0500) e centro de custo (COD_CCUS). |

Regras que o contrato impõe ao `servico`:

- **Participante obrigatório** quando `operacao = "contratado"`.
- **`natBcCred` obrigatório** em qualquer item com CST de crédito (50 a 66). Aceita os códigos `"01"` a `"18"` da tabela 4.3.7; o mais comum em serviço é `"03"` (serviços utilizados como insumo).
- **Alíquotas de PIS e COFINS com no máximo 2 casas decimais** (leiaute do A170): `1.65` e `7.6` valem; `1.6523` é recusado.
- **Serviço prestado não leva `natBcCred` nem `indOrigCred`** nos itens (o editor recusa).
- **Sem alíquota onde o CST exige** (50 a 66, 01 ou 02): o tributo entra zerado e pendente; o editor não supõe.
- **Mês da escrituração**: `periodo`, se informado; senão o mês da `dataExecucao`; se nenhuma escrituração carregada cobrir esse mês (ou não houver execução), o mês da `dataDocumento`. Basta **uma** das duas datas cair no período (o guia aceita); o validador só alerta quando nenhuma cai.
- Quando `base`, `aliquota` e `valor` vêm juntos, `valor ≈ base × alíquota ÷ 100` (1 centavo).

Exemplo mínimo, serviço **contratado com crédito**:

```json
{
  "tipo": "servico",
  "referencia": "NFS-e 2025-00417.xml",
  "operacao": "contratado",
  "emissao": "terceiros",
  "numero": "2025/00417",
  "dataDocumento": "2025-03-14",
  "dataExecucao": "2025-03-12",
  "participante": { "cnpjCpf": "66223344000178", "nome": "Manutencao Industrial Omega Ficticia Ltda" },
  "valorDocumento": 3200.00,
  "valorIss": 160.00,
  "itens": [
    {
      "codigo": "S014", "descricao": "Manutencao preventiva de maquinas industriais", "codigoServico": "14.01",
      "valorItem": 3200.00, "natBcCred": "03",
      "pis": { "cst": "50", "base": 3200.00, "aliquota": 1.65, "valor": 52.80 },
      "cofins": { "cst": "50", "base": 3200.00, "aliquota": 7.6, "valor": 243.20 }
    }
  ]
}
```

Serviço **prestado** (receita): troque `operacao` por `"prestado"` e `emissao` por `"propria"`, use CST 01 (ou o que couber), **não informe `natBcCred` nem `indOrigCred`** (o editor recusa), e o `participante` passa a ser o tomador. Se o tomador reteve PIS/COFINS, informe `pisRetido` e `cofinsRetido`.

## Tipo `imobilizado` (bem do ativo com crédito; gera F120 ou F130)

Crédito sobre bem do ativo imobilizado. **Não tem data de documento**: o `periodo` (`"AAAA-MM"`) é **obrigatório** e é o mês em que o crédito entra. Há duas modalidades:

- `"depreciacao"` gera o **F120**: crédito sobre o **encargo de depreciação ou amortização do mês**.
- `"aquisicao"` gera o **F130**: crédito sobre o **valor de aquisição** do bem, aproveitado em parcelas mensais.

| Campo | Obrig. | Descrição |
|---|---|---|
| `periodo` | sim | Mês da escrituração (`"2025-03"`). |
| `modalidade` | sim | `"depreciacao"` (F120) ou `"aquisicao"` (F130). |
| `natBcCred` | não | **F120 (`depreciacao`)**: `"09"` depreciação (padrão) ou `"11"` amortização. **F130 (`aquisicao`)**: só `"10"` (pode omitir). Qualquer outro código na modalidade é recusado. |
| `identificacaoBem` | sim | Tipo do bem (tabela abaixo): `"01"` a `"06"` ou `"99"`. |
| `indOrigCred` | não | `"0"` mercado interno (padrão) ou `"1"` importação. |
| `utilizacao` | sim | Para que o bem é usado: `"1"` produção de bens para venda, `"2"` prestação de serviços, `"3"` locação a terceiros, `"9"` outros (**sem direito a crédito**). |
| `valorEncargo` | **obrig. na depreciação** | Encargo de depreciação/amortização **do mês** (VL_OPER_DEP). |
| `mesAquisicao` | não | F130: mês/ano da aquisição (`"2025-03"`). Deixe de fora em grupo de bens com datas diversas. |
| `valorAquisicao` | **obrig. na aquisição** | Valor de aquisição (VL_OPER_AQUIS). |
| `parcelaSemCredito` | não | Parte do valor que **não** dá crédito e sai da base (padrão 0). |
| `parcelas` | **obrig. na aquisição** | Número de parcelas do crédito (IND_NR_PARC, tabela abaixo). |
| `baseMes` | cond. | **Obrigatório quando `parcelas = "9"`**: a base de cálculo do mês (o leiaute não traz o número de meses). |
| `pis`, `cofins` | sim | CST de crédito (50 a 66) ou sem crédito (70 a 99) e **alíquota com até 4 casas**. **Não mande `base`**: a base informada não é usada (vale a regra do guia abaixo) e o `valor` também é recalculado (base × alíquota). Sem alíquota onde o CST exige, entra zerado e pendente. |
| `contaContabil`, `centroCusto`, `descricao` | não | `descricao` é a descrição do bem ou do grupo de bens (DESC_BEM_IMOB). |

Como o editor calcula a base (regra do guia; ele **ignora** a `base` informada e avisa se ela for diferente; o validador também alerta):

- **F120**: base = `valorEncargo` − `parcelaSemCredito`.
- **F130**: base total = `valorAquisicao` − `parcelaSemCredito`; base do mês = base total ÷ número de meses da tabela de `parcelas` (ou o `baseMes`, se `parcelas = "9"`).

Exemplo mínimo, **depreciação (F120)**:

```json
{
  "tipo": "imobilizado",
  "referencia": "ativo-fixo.xlsx, linha 4",
  "periodo": "2025-03",
  "modalidade": "depreciacao",
  "natBcCred": "09",
  "identificacaoBem": "04",
  "utilizacao": "1",
  "valorEncargo": 1500.00,
  "parcelaSemCredito": 100.00,
  "pis": { "cst": "50", "aliquota": 1.65, "valor": 23.10 },
  "cofins": { "cst": "50", "aliquota": 7.6, "valor": 106.40 },
  "descricao": "Prensa hidraulica - encargo de depreciacao do mes"
}
```

Exemplo mínimo, **aquisição (F130)**, crédito em 24 meses (`parcelas = "3"`): base do mês = 60.000,00 ÷ 24 = 2.500,00.

```json
{
  "tipo": "imobilizado",
  "referencia": "ativo-fixo.xlsx, linha 9",
  "periodo": "2025-03",
  "modalidade": "aquisicao",
  "identificacaoBem": "05",
  "utilizacao": "2",
  "mesAquisicao": "2025-03",
  "valorAquisicao": 60000.00,
  "parcelas": "3",
  "pis": { "cst": "50", "aliquota": 1.65, "valor": 41.25 },
  "cofins": { "cst": "50", "aliquota": 7.6, "valor": 190.00 },
  "descricao": "Servidor de producao - credito em 24 parcelas"
}
```

Regras que o contrato impõe ao `imobilizado` (são dois formatos, conforme a `modalidade`): `periodo` obrigatório nas duas; `identificacaoBem` e `utilizacao` obrigatórios; depreciação exige `valorEncargo` e aceita `natBcCred` 09 ou 11; aquisição exige `valorAquisicao` e `parcelas`, aceita só o 10, e `parcelas = "9"` exige `baseMes`; `parcelaSemCredito` não pode passar do valor-base (a base ficaria negativa).

---

## Tabelas de códigos

### CST de PIS/COFINS

| CST | Descrição curta |
|---|---|
| 01 | Tributável, alíquota básica |
| 02 | Tributável, alíquota diferenciada |
| 03 | Tributável, alíquota por unidade de medida |
| 04 | Tributável monofásica, revenda a alíquota zero |
| 05 | Tributável por substituição tributária |
| 06 | Tributável a alíquota zero |
| 07 | Isenta da contribuição |
| 08 | Sem incidência da contribuição |
| 09 | Com suspensão da contribuição |
| 49 | Outras operações de saída |
| 50 | Entrada com crédito, vinculada a receita tributada no mercado interno |
| 51 | Entrada com crédito, vinculada a receita não tributada no mercado interno |
| 52 | Entrada com crédito, vinculada a receita de exportação |
| 53 | Entrada com crédito, receitas tributadas e não tributadas no mercado interno |
| 54 | Entrada com crédito, receitas tributadas no mercado interno e de exportação |
| 55 | Entrada com crédito, receitas não tributadas no mercado interno e de exportação |
| 56 | Entrada com crédito, receitas tributadas, não tributadas e de exportação |
| 60 | Crédito presumido, receita tributada no mercado interno |
| 61 | Crédito presumido, receita não tributada no mercado interno |
| 62 | Crédito presumido, receita de exportação |
| 63 | Crédito presumido, receitas tributadas e não tributadas no mercado interno |
| 64 | Crédito presumido, receitas tributadas no mercado interno e de exportação |
| 65 | Crédito presumido, receitas não tributadas no mercado interno e de exportação |
| 66 | Crédito presumido, receitas tributadas, não tributadas e de exportação |
| 67 | Crédito presumido, outras operações |
| 70 | Aquisição sem direito a crédito |
| 71 | Aquisição com isenção |
| 72 | Aquisição com suspensão |
| 73 | Aquisição a alíquota zero |
| 74 | Aquisição sem incidência da contribuição |
| 75 | Aquisição por substituição tributária |
| 98 | Outras operações de entrada |
| 99 | Outras operações |

Regra prática: **saída** usa 01 a 09, 49 ou 99. **Entrada** usa 50 a 56 (crédito), 60 a 67 (crédito presumido), 70 a 75 (sem crédito), 98 ou 99.

### Base do crédito (`natBcCred`, tabela 4.3.7)

| Código | Descrição curta |
|---|---|
| 01 | Aquisição de bens para revenda |
| 02 | Aquisição de bens utilizados como insumo |
| 03 | Aquisição de serviços utilizados como insumo |
| 04 | Energia elétrica e térmica (inclusive vapor) |
| 05 | Aluguéis de prédios |
| 06 | Aluguéis de máquinas e equipamentos |
| 07 | Armazenagem de mercadoria e frete na operação de venda |
| 08 | Contraprestações de arrendamento mercantil |
| 09 | Máquinas, equipamentos e outros bens do ativo: encargos de depreciação |
| 10 | Máquinas, equipamentos e outros bens do ativo: aquisição (crédito em 12 meses etc.) |
| 11 | Amortização de edificações e benfeitorias em imóveis |
| 12 | Devolução de vendas sujeitas à incidência não cumulativa |
| 13 | Outras operações com direito a crédito |
| 14 | Atividade de transporte de cargas: subcontratação |
| 15 | Atividade imobiliária: custo incorrido de unidade imobiliária |
| 16 | Atividade imobiliária: custo orçado de unidade não concluída |
| 17 | Prestação de serviços de limpeza, conservação e manutenção: vale-transporte, refeição/alimentação, fardamento |
| 18 | Estoque de abertura de bens |

### Tipo do item (`tipoItem`, registro 0200)

| Código | Descrição |
|---|---|
| 00 | Mercadoria para revenda |
| 01 | Matéria-prima |
| 02 | Embalagem |
| 03 | Produto em processo |
| 04 | Produto acabado |
| 05 | Subproduto |
| 06 | Produto intermediário |
| 07 | Material de uso e consumo |
| 08 | Ativo imobilizado |
| 09 | Serviços |
| 10 | Outros insumos |
| 99 | Outras |

### Natureza do frete (`natFrete`, IND_NAT_FRT)

| Código | Descrição |
|---|---|
| 0 | Venda de mercadoria, frete por conta (ônus) do vendedor |
| 1 | Venda de mercadoria, frete por conta (ônus) do adquirente |
| 2 | Compra de bens para revenda ou insumo, com crédito |
| 3 | Compra de bens, sem crédito |
| 4 | Transferência de produtos acabados entre estabelecimentos |
| 5 | Transferência de produtos em elaboração entre estabelecimentos |
| 9 | Outras |

### Situação do documento (`situacao`)

| Código | Descrição |
|---|---|
| 00 | Regular (padrão) |
| 01 | Regular, escriturado fora do prazo (extemporâneo) |
| 02 | Cancelado |
| 03 | Cancelado, extemporâneo |
| 04 | NF-e/CT-e denegado |
| 05 | Numeração inutilizada |
| 06 | Complementar |
| 07 | Complementar extemporâneo |
| 08 | Regime especial ou norma específica |

### Tipo de frete (`indFrete`)

`"0"` por conta do emitente, `"1"` por conta do destinatário, `"2"` por conta de terceiros, `"3"` transporte próprio por conta do remetente, `"4"` transporte próprio por conta do destinatário, `"9"` sem frete.

### Base do crédito aceita em cada tipo (`natBcCred`)

| Onde | Códigos aceitos |
|---|---|
| `nota`, `itens` | Não têm `natBcCred` (o crédito vem do CST). |
| `frete`, `energia` (cada crédito) | `"01"` a `"18"`, obrigatório. |
| `f100` | `"01"` a `"18"`, obrigatório quando `indOper = "0"`. |
| `servico` (cada item) | `"01"` a `"18"`, obrigatório com CST 50 a 66; só em serviço contratado. Normal: `"03"`. |
| `imobilizado` F120 (`depreciacao`) | **Só `"09"`** (depreciação, padrão) **ou `"11"`** (amortização). |
| `imobilizado` F130 (`aquisicao`) | **Só `"10"`** (pode omitir). |

### Número de parcelas do crédito do F130 (`parcelas`, IND_NR_PARC)

| Código | Significado | Base do mês |
|---|---|---|
| `"1"` | Integral: todo o crédito no mês da aquisição | base total |
| `"2"` | 12 meses | base total ÷ 12 |
| `"3"` | 24 meses | base total ÷ 24 |
| `"4"` | 48 meses | base total ÷ 48 |
| `"5"` | 6 meses (embalagens de bebidas frias) | base total ÷ 6 |
| `"9"` | Outra periodicidade | você informa em `baseMes` |

### Origem do crédito (`indOrigCred`)

`"0"` mercado interno (padrão); `"1"` importação.

### Identificação do bem (`identificacaoBem`, IDENT_BEM_IMOB)

| Código | Descrição |
|---|---|
| 01 | Edificações e benfeitorias em imóveis próprios |
| 02 | Edificações e benfeitorias em imóveis de terceiros |
| 03 | Instalações |
| 04 | Máquinas |
| 05 | Equipamentos |
| 06 | Veículos |
| 99 | Outros |

### Utilização do bem (`utilizacao`, IND_UTIL_BEM_IMOB)

`"1"` produção de bens destinados à venda; `"2"` prestação de serviços; `"3"` locação a terceiros; `"9"` outros (sem direito a crédito).

### Código do serviço (`codigoServico`, lista da LC 116/2003)

Formato `NN.NN`, com o item de 01 a 40 e o subitem de duas casas. Exemplos: `14.01` lubrificação, limpeza, manutenção e conservação de máquinas e equipamentos; `17.01` assessoria ou consultoria; `07.02` execução de obra; `17.06` propaganda e publicidade. A NFS-e costuma trazer o código (às vezes sem o zero à esquerda, `7.02`; escreva `07.02`).
