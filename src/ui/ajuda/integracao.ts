/**
 * Âncoras do tour que ainda não estão nas telas.
 *
 * Nesta etapa os componentes de `src/ui/` não puderam ser editados; cada âncora abaixo
 * diz em qual arquivo e em qual elemento o `data-tour` deve entrar (o passo a passo
 * está em INTEGRACAO.md). `documentacao.test.ts`:
 * - aceita uma âncora do tour que não está no código SÓ se ela estiver nesta lista;
 * - falha se uma âncora daqui já estiver no código (tire-a da lista);
 * - falha se esta lista não estiver vazia depois que o App ganhar a aba Manual.
 *
 * `seletorDemo` é usado só pela página de demonstração (`demo.html`), que simula a
 * integração pondo o atributo pelo DOM. Depois da integração, a lista fica vazia.
 */
export interface AncoraPendente {
  ancora: string;
  arquivo: string;
  elemento: string;
  /** CSS para a demonstração achar o elemento enquanto o atributo não está no código. */
  seletorDemo: string;
}

export const ANCORAS_PENDENTES: AncoraPendente[] = [];
