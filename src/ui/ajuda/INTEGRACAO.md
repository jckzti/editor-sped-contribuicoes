# Integração do tour e do Manual nas telas

Roteiro mecânico para quando a sessão da interface liberar os arquivos de `src/ui/`.
O CSS (`ajuda.css`) já é importado pelos próprios componentes: não mexa em `main.tsx`.

## 1. `src/ui/App.tsx`

Imports (junto dos outros):

```ts
import { ControleTour } from './ajuda/ControleTour';
import type { TelaTour } from './ajuda/passosTour';
import { TelaManual } from './ajuda/TelaManual';
```

Aba nova, no fim de `ABAS`:

```ts
  { id: 'manual', rotulo: 'Manual' },
```

Estado, junto dos outros `useState` do `App`:

```ts
  const [secaoManual, setSecaoManual] = useState<string | undefined>();
  const [pedidoTour, setPedidoTour] = useState(0);
```

Âncoras na barra:

- `<label className="botao-arquivo" data-tour="acrescentar-arquivos">` (Acrescentar itens)
- no `map` de `ABAS`: `<button key={a.id} data-tour={`aba-${a.id}`} role="tab" ...>` (cobre `aba-regras` e `aba-manual`)
- `<button className="primario" data-tour="baixar-arquivos" ...>` (Baixar arquivos)

Botão do tour e convite de novidades, logo antes de `<div className="abas" role="tablist">`:

```tsx
        <ControleTour
          temDados={escrituracoes.length > 0}
          aoIrPara={(t: TelaTour) => mudarPrefs({ aba: t })}
          aoAbrirManual={(secao) => {
            setSecaoManual(secao);
            mudarPrefs({ aba: 'manual' });
          }}
          pedidoAbrir={pedidoTour}
        />
```

Conteúdo: o Manual abre mesmo sem arquivo carregado. Troque o início do ternário
`{!escrituracoes.length ? (<Carregar .../>) : aba === 'documentos' ? ...}` por:

```tsx
        {aba === 'manual' ? (
          <TelaManual secaoInicial={secaoManual} aoAbrirTour={() => setPedidoTour((n) => n + 1)} />
        ) : !escrituracoes.length ? (
          <Carregar ... />   {/* como está */}
        ) : aba === 'documentos' ? (
```

## 2. Âncoras nos componentes (um atributo por linha)

| Arquivo | Elemento | Atributo |
|---|---|---|
| `Carregar.tsx` | `<div className={`carregar...`}>` (raiz) | `data-tour="carregar-arquivos"` |
| `TelaDocumentos.tsx` | `<div className="seletor">` dos tipos de linha | `data-tour="tipo-linha"` |
| `TelaDocumentos.tsx` | `<button>` "Salvar como regra" | `data-tour="salvar-como-regra"` |
| `ConstrutorFiltros.tsx` | `<div className="filtros">` (raiz) | `data-tour="filtros"` |
| `Grade.tsx` | `<div className="grade">` (raiz) | `data-tour="grade"` |
| `Grade.tsx` | `<div className="grade-celula marcador">` do **cabeçalho** (a caixa de selecionar tudo; não a das linhas) | `data-tour="selecionar-tudo"` |
| `PainelLote.tsx` | `<div className="painel-lote">` (raiz) | `data-tour="painel-lote"` |
| `Previa.tsx` | `<div className="previa">` (raiz) | `data-tour="previa"` |
| `TelaApuracaoAba.tsx` | `<div className="aviso alerta forte">` do quadro "Critérios da apuração pendentes" | `data-tour="criterios-apuracao"` |
| `CriteriosApuracao.tsx` | `<div className="resumo-criterios">` (raiz do `ResumoCriterios`; a mesma âncora, porque só um dos dois aparece) | `data-tour="criterios-apuracao"` |
| `TelaApuracaoAba.tsx` | `<button className="primario">` "Recalcular apuração" | `data-tour="recalcular-apuracao"` |
| `TelaApuracao.tsx` | `<div className="cartoes">` | `data-tour="apuracao-quadro"` |
| `TelaConferencia.tsx` | primeira `<div className="barra-secao envolve">` (Baixar / Verificar) | `data-tour="conferencia-acoes"` |

`botao-tour` já está em `ControleTour.tsx`.

## 3. Fechar a integração

1. Esvazie a lista: `export const ANCORAS_PENDENTES: AncoraPendente[] = [];` em `integracao.ts`.
   (Com a aba Manual no App, o teste exige a lista vazia; e acusa âncora que já está no código e continua listada.)
2. Confira cada item de `SECOES_A_CONFERIR` (seções com `conferirAoIntegrar` em `conteudoManual.ts`)
   contra o código final do motor e da tela; corrija o texto e apague o campo.
3. Suba `VERSAO_MANUAL` para 2 (a superfície muda: entrou a aba Manual) e regrave o carimbo:
   `ATUALIZAR_CARIMBO=1 npx vitest run src/ui/ajuda/documentacao.test.ts`.
   `VERSAO_TOUR` só sobe se o roteiro mudar.
4. `npx tsc --noEmit` e `npx vitest run` limpos.
5. No navegador: apague a chave `sped-contrib.tour` do `localStorage` e recarregue: o tour abre
   sozinho em modo demonstrativo; carregue um arquivo e rode o tour inteiro pelo botão
   **Tour guiado** (cada passo deve destacar o elemento certo, trocando de aba sozinho).
6. Opcional: apague `demo.html` e `Demonstracao.tsx` (servem só para testar antes da integração).
