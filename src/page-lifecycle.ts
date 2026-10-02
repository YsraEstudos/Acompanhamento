import { subscribeAspNetEndRequest } from './aspnet';
import { SETTINGS_KEY, SETTINGS_CHANGED_EVENT } from './state';
import { resolveQuickPageContext, type QuickSinPageContext } from './url';

const CONTEXT_MUTATION_SELECTOR = [
  '#UpdatePanel1',
  '.kl-view',
  '#DV_Resumo_sin',
  '#Label_infoSIN',
  '#hButAcompanhamentoSIN',
  '#hlkObs',
  '#txtNumero'
].join(', ');
const OWN_UI_MUTATION_SELECTOR = [
  '.km-sin-layout',
  '.km-sin-inline-toggle',
  '[data-km-unspsc-quick="1"]',
  '[data-km-unspsc-toast="1"]',
  '#km-sin-sidebar-style',
  '#km-unspsc-quick-style'
].join(', ');

function getMutationElement(node: Node): Element | null {
  if (node.nodeType === 1) return node as Element;
  return node.parentElement;
}

function isOwnedUiNode(node: Node): boolean {
  const element = getMutationElement(node);
  return Boolean(element?.matches(OWN_UI_MUTATION_SELECTOR) || element?.closest(OWN_UI_MUTATION_SELECTOR));
}

function nodeTouchesContext(node: Node): boolean {
  const element = getMutationElement(node);
  return Boolean(
    element?.matches(CONTEXT_MUTATION_SELECTOR)
    || element?.closest(CONTEXT_MUTATION_SELECTOR)
    || element?.querySelector(CONTEXT_MUTATION_SELECTOR)
  );
}

function hasRelevantContextMutation(records: MutationRecord[]): boolean {
  return records.some((record) => {
    const target = getMutationElement(record.target);
    if (target?.closest(OWN_UI_MUTATION_SELECTOR)) return false;
    if (target?.matches(CONTEXT_MUTATION_SELECTOR) || target?.closest(CONTEXT_MUTATION_SELECTOR)) return true;

    return [...record.addedNodes, ...record.removedNodes].some((node) => {
      if (isOwnedUiNode(node)) return false;
      return nodeTouchesContext(node);
    });
  });
}

export interface PageLifecycleOptions {
  hookAspNet?: boolean;
  onContextChange: (context: QuickSinPageContext) => void;
  onSettingsChange: () => void;
}

export class PageLifecycle {
  private destroyAspNet: (() => void) | null = null;
  private destroyContextEvents: (() => void) | null = null;
  private observedContextSignature: string | null = null;

  constructor(private readonly options: PageLifecycleOptions) {}

  start(): void {
    if (this.destroyContextEvents) return;
    this.destroyContextEvents = this.bindContextEvents();
    if (this.options.hookAspNet ?? true) this.destroyAspNet = subscribeAspNetEndRequest(this.handlePageLifecycleEvent);
  }

  destroy(): void {
    this.destroyAspNet?.();
    this.destroyContextEvents?.();
    this.destroyAspNet = null;
    this.destroyContextEvents = null;
  }

  private readonly handleStorageEvent = (event: Event): void => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key !== null && storageEvent.key !== SETTINGS_KEY) return;
    this.options.onSettingsChange();
  };

  private readonly handleSettingsChanged = (): void => this.options.onSettingsChange();

  private readonly handlePageLifecycleEvent = (event?: Event): void => {
    if (event?.type === 'pageshow' && !(event as PageTransitionEvent).persisted) return;
    const context = resolveQuickPageContext();
    this.observedContextSignature = this.captureContextSignature(context);
    this.options.onContextChange(context);
  };

  private captureContextSignature(context: QuickSinPageContext = resolveQuickPageContext()): string {
    return [
      window.location.href,
      context.itemId || 'sem-item',
      context.summarySinId || 'sem-sin-resumo',
      context.historyIdentity?.fingerprint || context.historyUrl || context.sinId || 'sem-historico'
    ].join('|');
  }

  private bindContextEvents(): () => void {
    let disposed = false;
    let mutationObserver: MutationObserver | null = null;
    let mutationTimer = 0;
    const observeRoot = document.body ?? document.documentElement;
    const timerHost = observeRoot.ownerDocument?.defaultView ?? window;

    const handleMutation = (): void => {
      if (disposed) return;
      mutationTimer = 0;
      const nextSignature = this.captureContextSignature();
      if (nextSignature === this.observedContextSignature) return;
      this.observedContextSignature = nextSignature;
      this.handlePageLifecycleEvent();
    };

    window.addEventListener('storage', this.handleStorageEvent);
    globalThis.addEventListener(SETTINGS_CHANGED_EVENT, this.handleSettingsChanged);
    window.addEventListener('pageshow', this.handlePageLifecycleEvent);
    window.addEventListener('popstate', this.handlePageLifecycleEvent);
    window.addEventListener('hashchange', this.handlePageLifecycleEvent);

    if (observeRoot) {
      this.observedContextSignature = this.captureContextSignature();
      mutationObserver = new MutationObserver((records) => {
        if (!hasRelevantContextMutation(records) || mutationTimer) return;
        mutationTimer = timerHost.setTimeout(handleMutation, 80);
      });

      mutationObserver.observe(observeRoot, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
        attributeFilter: ['href', 'value', 'style', 'class', 'hidden']
      });
    }

    return () => {
      disposed = true;
      if (mutationTimer) {
        timerHost.clearTimeout(mutationTimer);
      }
      mutationObserver?.disconnect();
      window.removeEventListener('storage', this.handleStorageEvent);
      globalThis.removeEventListener(SETTINGS_CHANGED_EVENT, this.handleSettingsChanged);
      window.removeEventListener('pageshow', this.handlePageLifecycleEvent);
      window.removeEventListener('popstate', this.handlePageLifecycleEvent);
      window.removeEventListener('hashchange', this.handlePageLifecycleEvent);
    };
  }

}
