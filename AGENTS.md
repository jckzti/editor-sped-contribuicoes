# Editor SPED Contribuições: instruções do projeto

Este arquivo é a fonte única das regras do projeto, para qualquer pessoa ou ferramenta de IA
(Codex/ChatGPT, Claude, Copilot...). Leia inteiro antes de alterar. O `CLAUDE.md` só aponta para cá:
não duplique regra nos dois.

Editor web estático (Vite + React + TypeScript, sem servidor) dos arquivos da EFD-Contribuições
(PIS/COFINS). Quem usa são contadores, não programadores: tela, manual, mensagens e comentários
em português do Brasil, sem jargão de programação na tela. O PVA continua validando e transmitindo;
não prometa na tela o que só o PVA faz.

## Antes de todo commit (obrigatório)

Push na `main` **publica o site** para os usuários. Antes de commitar, rode e confira que passaram:

```bash
npm ci               # só na primeira vez na máquina ou quando o package-lock.json mudar
npm run typecheck
npm test
npm run build
```

- Teste falhou: leia a mensagem (ela diz o que fazer) e corrija a causa. Não apague, pule nem afrouxe teste.
- Não conseguiu rodar os comandos no seu ambiente: diga isso claramente a quem pediu, não faça push
  na `main` e entregue a alteração para alguém rodar antes.
- A publicação roda os testes e é barrada se algum falhar. Ela não tem o arquivo real de cliente,
  então a prova byte a byte do motor só roda em máquina que o tenha: mudança em `src/core` exige isso.
- Trocar um **texto** da tela também conta como mudança de rótulo. Procure o texto antigo no projeto
  inteiro (`git grep`), inclusive versões curtas do mesmo rótulo, e troque em todos os lugares.

## Regra: tour e manual mudam junto com o sistema

Toda mudança de **tela, rótulo, fluxo, opção ou comportamento fiscal** atualiza, **na mesma
alteração**:

1. **Tour** (`src/ui/ajuda/passosTour.ts`): os passos que citam o que mudou. Se o roteiro mudou,
   suba `VERSAO_TOUR` e escreva `NOVIDADES[<versão nova>]` (resumo + ids dos passos): é o que
   aparece no convite "O sistema mudou: ver o que há de novo".
2. **Manual** (`src/ui/ajuda/conteudoManual.ts`): a seção que fala disso, e suba `VERSAO_MANUAL`.
   Aviso novo vai na tabela da seção `avisos` e em `COBERTURA.avisos`; opção, modo de base, tipo de
   linha ou aba nova vai em `COBERTURA`. Escreva só o que você conferiu no código.
3. **Âncoras**: elemento citado pelo tour tem `data-tour="..."`. Não remova nem mova sem ajustar o passo.
4. **README.md** e **`skill/sped-importar-documentos/SKILL.md`**, se mudou o que eles dizem
   (como usar, limites, formato do pacote de importação).
5. Depois de revisar, regrave o carimbo:
   `ATUALIZAR_CARIMBO=1 npx vitest run src/ui/ajuda/documentacao.test.ts`

`npm test` falha quando a documentação fica para trás: âncora do tour que sumiu; aba, tipo de linha,
modo de base, opção de lista, chave de `ConfigApuracao` ou código de aviso sem explicação no manual;
rótulo do manual diferente da tela; roteiro mudado sem subir `VERSAO_TOUR`; superfície da tela mudada
sem revisão. **Não regrave o carimbo para calar o teste sem revisar o texto.** Os códigos de aviso
são lidos de `src/core` nos formatos `codigo: 'X'`, `erro('X', ...)` e `aviso('nivel', 'X', ...)`:
use um deles.

Se **qualquer** texto de `passosTour.ts` mudou (mesmo uma palavra), o item 1 exige subir `VERSAO_TOUR`.

Checklist curto: passo do tour? seção do manual? `data-tour`? versões? README/SKILL? carimbo? `npm test`?

### Mapa: onde mexeu → o que revisar

| Arquivos | Passos do tour | Seções do manual |
|---|---|---|
| `ui/Carregar.tsx`, `ui/useSessao.ts`, `core/leitor.ts`, `core/sessao.ts` | `carregar` | `carregar`, `privacidade`, `limites`, `avisos` |
| `ui/App.tsx` (barra, abas, baixar), `ui/baixar.ts` | `carregar`, `salvar-regra`, `cadastros`, `baixar`, `manual` | `o-que-e`, `baixar-pva`, `desfazer`, `sobre-ajuda` |
| `ui/TelaDocumentos.tsx`, `ui/Grade.tsx`, `ui/ConstrutorFiltros.tsx`, `ui/filtros.ts`, `ui/celulas.ts`, `ui/formato.ts`, `core/linhas.ts` | `tipo-linha`, `filtrar`, `selecionar-tudo`, `salvar-regra` | `grades` |
| `ui/PainelLote.tsx`, `ui/FormulariosAcao.tsx`, `ui/Previa.tsx`, `ui/acoes.ts`, `core/edicao.ts` | `alterar-tributacao`, `previa` | `edicao-lote`, `avisos` |
| `ui/TelaRegras.tsx`, `core/regras.ts` | `salvar-regra` | `regras` |
| Serviços e imobilizado (`core/linhas.ts`, `core/imobilizado.ts`, `ui/formato.ts` `ROTULO_TIPO`) | `tipo-linha` | `servicos`, `imobilizado`, `grades` |
| Cadastros (aba Cadastros, `core/cadastros.ts`) | `cadastros` | `cadastros` |
| `ui/ImportarDocumentos.tsx`, `core/importar.ts`, `core/xmlNfe.ts`, `core/importacao.tipos.ts` | — | `importar` (+ README, SKILL.md) |
| `ui/CriteriosApuracao.tsx`, `ui/criterios.ts`, `core/apuracao/criterios.ts` (catálogo `CRITERIOS`) | `criterios` | `apuracao-criterios`, `apuracao-saldo`, `apuracao-0111` (+ `ORIENTACAO_CRITERIOS`) |
| `ui/TelaApuracaoAba.tsx`, `ui/TelaApuracao.tsx`, `ui/apuracaoUi.ts`, `core/recalcular.ts`, `core/apuracao/**` | `recalcular`, `antes-depois` | `apuracao*`, `avisos` |
| `ui/TelaConferencia.tsx`, `core/validar.ts`, `core/edicao.ts` (diferenças, reverter) | `conferencia` | `conferencia`, `avisos` |
| `core/operacao.ts` (histórico) | — | `desfazer`, `limites` |
| `ui/preferencias.ts`, `ui/ajuda/memoriaTour.ts` (o que vai para o `localStorage`) | — | `privacidade` |

## O que mais saber

- **Dados de cliente nunca saem da máquina nem entram no projeto.** Os `.txt` reais ficam na raiz
  ou em `amostras/`, fora do versionamento (`.gitignore`); os testes que dependem deles são pulados
  quando não existem (`core/amostra.ts`). Não copie trechos reais para testes, fixtures, skill,
  notas ou mensagens. O `localStorage` guarda só preferências, regras salvas e a versão vista do tour.
- **Prova real do motor (não pode regredir):** arquivo não editado sai byte a byte igual
  (`core/leitor.test.ts`, `core/apuracao/apuracao.test.ts`), e desfazer volta byte a byte
  (`core/motor.test.ts`). Toda mudança em `src/core` roda esses testes.
- **O motor recusa em vez de errar:** perfil que ele não sabe apurar mantém o bloco M como veio, com
  aviso de nível erro (`core/apuracao/perfil.ts`). Não troque recusa por palpite.
- **Comandos:** `npm run dev` (http://localhost:5173), `npm test`, `npm run typecheck`, `npm run build`.
  A ajuda tem uma página de teste só em desenvolvimento: `/src/ui/ajuda/demo.html`.
