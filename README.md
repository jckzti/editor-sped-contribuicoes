# Editor SPED Contribuições

Editor de arquivos da EFD-Contribuições (SPED PIS/COFINS) que roda inteiro no navegador.
Serve para fazer, em lote e em vários meses de uma vez, a edição que hoje é feita documento
a documento dentro do PVA: alterar a tributação de itens, excluir e incluir itens e notas.
O arquivo gerado vai para o PVA apenas para validar e transmitir.

**Nada sai da máquina.** Os arquivos são lidos pelo próprio navegador; não existe servidor,
não há upload, não há banco de dados. Fechar a aba apaga tudo.

## Como usar

1. Arraste os arquivos `.txt` da EFD-Contribuições (um por mês) para a tela inicial.
2. Nas grades (itens, notas, fretes, energia, outras operações), filtre, selecione e edite.
   Uma edição aplicada vale para todos os meses carregados que atendem ao filtro.
3. Confira a aba **Apuração**: ela mostra, mês a mês, o antes e o depois de crédito,
   débito e valor a recolher.
4. Baixe os arquivos corrigidos (um `.zip` com todos os meses) e importe no PVA.

### Tour guiado e Manual

Na primeira visita, um **tour guiado** mostra o caminho de ponta a ponta (carregar, filtrar,
selecionar, alterar com prévia, salvar como regra, recalcular, conferir, baixar); o botão
**Tour guiado** reabre. A aba **Manual** explica cada tela, opção e aviso, com busca.
Os dois ficam em `src/ui/ajuda/`.

**Regra do projeto:** toda mudança de tela, rótulo, fluxo, opção ou comportamento fiscal atualiza
o tour (`passosTour.ts`, subindo a versão) e o manual (`conteudoManual.ts`) na mesma alteração.
O `npm test` falha quando eles ficam para trás. Detalhes e checklist em [`AGENTS.md`](AGENTS.md).

### Incluir documentos que não estão no arquivo

O editor importa um JSON no formato "pacote de importação"
(contrato em `src/core/importacao.tipos.ts`, JSON Schema em `public/sped-import.schema.json`).
Para transformar o que o cliente mandou (planilha, XML de NF-e, PDF) nesse formato, use a skill
`skill/sped-importar-documentos` dentro do Claude Code, na máquina de quem vai fazer o trabalho.

## Pedir uma alteração no sistema

Não é preciso saber programar. Abra a pasta do projeto no Codex ou no Claude Code e escreva o que
você quer, com as suas palavras. A IA atualiza o projeto, faz a alteração, testa, envia e avisa
quando estiver no ar; as regras que ela segue estão no [`AGENTS.md`](AGENTS.md). Nunca coloque
arquivos de cliente nas mensagens nem peça para enviá-los: o repositório é público.

## Rodar localmente

```bash
npm install
npm run dev
```

## Publicar (de graça)

O build gera um site estático em `dist/`, com caminhos relativos: funciona em qualquer
hospedagem, inclusive em subpasta.

```bash
npm run build
```

Depois publique a pasta `dist/` em GitHub Pages, Cloudflare Pages, Netlify ou qualquer
servidor de arquivos. Também funciona abrindo o `index.html` a partir de um servidor local
simples (`npx serve dist`).

## Limites conhecidos

- **Memória**: cada mês ocupa cerca de 9,5 MB. Doze meses usam ~115 MB, sem problema.
  Sessenta meses chegam a ~570 MB, o que funciona em um computador com folga de memória,
  mas deixa o navegador lento. O recomendado é trabalhar um ano por vez.
- **Perfil de arquivo suportado**: escrituração do regime não cumulativo ou do regime misto
  com receitas tributadas nas alíquotas básicas do CST 01 e sem base de crédito compartilhada
  com o regime cumulativo. Inclui documentos
  informados item a item (C100/C170), vendas por NFC-e (C175), fretes (D100), serviços de transporte
  do resumo diário (D200/D201/D205), energia (C500) e outras operações (F100).
  Arquivos com outros registros que afetam a apuração e ainda não são suportados são
  carregados e podem ser editados, mas a apuração do bloco M não é recalculada: o editor
  avisa e mantém o bloco como veio.
- **O PVA é quem valida.** O editor faz conferências próprias para evitar erro óbvio, mas
  a palavra final sobre o arquivo é sempre do PVA.

## Estrutura

- `src/core/` — leitura e gravação do arquivo, modelo de registros, edição, regras em lote,
  cadastros, contadores, importação e validações.
- `src/core/apuracao/` — recálculo do bloco M (créditos, contribuições, ajustes) e do
  bloco 1 (saldo de créditos entre meses).
- `src/core/leiaute.json` — leiaute dos 203 registros, extraído do Guia Prático v1.35.
- `src/ui/` — interface.
- `skill/` — skill de conversão de documentos do cliente para o formato de importação.
