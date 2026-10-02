import { HistoryRepository, type SinHistoryResult } from './history-repository';
import { PageLifecycle } from './page-lifecycle';
import { extractHistoryIdentityFromUrl } from './history-identity';
import type { TimelineEvent } from './parse';
import {
  getInlinePanelToggleLabel,
  loadSettings,
  saveSettings,
  type SinPanelSettings,
  type TimelineMode
} from './state';
import {
  ensureShell,
  injectStyles,
  renderEmpty,
  appendTimeline,
  renderIframeFallback,
  renderIframeFallbackPrompt,
  renderTimeline,
  setShellMeta,
  setShellState,
  type ShellRefs
} from './ui';
import {
  resolvePageContext,
  resolveQuickPageContext,
  type QuickSinPageContext,
  type SinPageContext
} from './url';

export type { SinHistoryResult } from './history-repository';

export type RefreshMode = 'manual' | 'semi-auto' | 'auto';

interface AppOptions {
  refreshMode?: RefreshMode;
  hookAspNet?: boolean;
}

interface ParsedTimelineState {
  allTimeline: TimelineEvent[];
  yellowTimeline: TimelineEvent[];
  historyUrl: string;
  result: Extract<SinHistoryResult, { mode: 'parsed' }>;
}

const RENDER_BATCH_SIZE = 30;

function isAbortError(error: unknown): boolean {
  return (error instanceof Error || error instanceof DOMException) && error.name === 'AbortError';
}

function getSafeHistoryUrl(rawUrl: string | null | undefined): string | null {
  return extractHistoryIdentityFromUrl(rawUrl)?.absoluteUrl || null;
}

export class SinSidebarApp {
  private readonly history = new HistoryRepository();
  private readonly lifecycle: PageLifecycle;
  private settings: SinPanelSettings = loadSettings();
  private loadSerial = 0;
  private currentShell: ShellRefs | null = null;
  private currentViewRoot: HTMLElement | null = null;
  private currentContext: SinPageContext | null = null;
  private latestParsed: ParsedTimelineState | null = null;
  private latestResult: SinHistoryResult | null = null;
  private renderedCount = 0;
  private inlinePanelOverride: boolean | null = null;
  private panelOpen = this.settings.alwaysOpen;
  private currentContextKey: string | null = null;
  private toggleHost: HTMLSpanElement | null = null;
  private toggleButton: HTMLButtonElement | null = null;
  private toggleParent: HTMLElement | null = null;

  private readonly handleToggleClick = (): void => {
    const nextOpen = !this.panelOpen;
    this.inlinePanelOverride = nextOpen === this.settings.alwaysOpen ? null : nextOpen;
    this.panelOpen = nextOpen;
    this.syncInlineToggle(resolveQuickPageContext());

    if (!nextOpen) {
      this.closePanel();
      return;
    }

    void this.hydrate(true);
  };

  private readonly handleModeToggleClick = (): void => {
    this.settings = {
      ...this.settings,
      timelineMode: this.settings.timelineMode === 'all' ? 'yellow-only' : 'all'
    };
    saveSettings(this.settings);

    if (!this.currentShell) return;
    this.syncModeButton(this.currentShell);
    this.renderedCount = 0;
    this.renderStoredTimeline(this.currentShell);
  };

  private readonly handleInlineRender = (): void => {
    const context = this.currentContext ?? resolvePageContext();
    const shell = this.currentShell;
    const safeHistoryUrl = getSafeHistoryUrl(context.historyUrl);
    if (shell && safeHistoryUrl) {
      this.history.abort();
      setShellState(shell, 'Exibindo visualizacao segura do historico...', 'default');
      renderIframeFallback(
        shell,
        safeHistoryUrl,
        undefined,
        this.latestResult?.inlineHtml,
        this.latestResult?.inlineBaseUrl
      );
      return;
    }

    if (shell) {
      setShellState(shell, 'Historico bloqueado por origem inesperada.', 'warning');
      renderEmpty(shell, 'O link do historico foi bloqueado por seguranca porque aponta para uma origem inesperada.');
    }
  };

  private readonly handleLoadMoreClick = (): void => {
    const shell = this.resolveConnectedShell();
    if (!shell || !this.latestParsed) return;
    const visibleTimeline = this.getVisibleTimeline();
    const previousCount = this.renderedCount;
    this.renderedCount = Math.min(this.renderedCount + RENDER_BATCH_SIZE, visibleTimeline.length);
    this.renderStoredTimeline(shell, previousCount);
  };

  private readonly handleSettingsChange = (): void => {
    this.applySettings(loadSettings());
  };

  private readonly handleContextChange = (quickContext: QuickSinPageContext): void => {
    this.syncSettingsFromStorage();
    this.syncContextScope(quickContext);
    if (this.panelOpen) {
      void this.hydrate(true);
      return;
    }
    this.syncClosedState(quickContext);
  };

  constructor(options: AppOptions = {}) {
    this.lifecycle = new PageLifecycle({
      hookAspNet: options.hookAspNet ?? true,
      onContextChange: this.handleContextChange,
      onSettingsChange: this.handleSettingsChange
    });
  }

  init(): void {
    injectStyles();
    this.lifecycle.start();
    if (this.panelOpen) {
      void this.hydrate(true);
      return;
    }

    this.syncClosedState();
  }

  destroy(): void {
    this.loadSerial++;
    this.panelOpen = false;
    this.inlinePanelOverride = null;
    this.currentContext = null;
    this.currentContextKey = null;
    this.lifecycle.destroy();
    this.history.abort();
    this.removeInlineToggle();
    this.clearParsedState();
  }

  applySettings(nextSettings: SinPanelSettings): void {
    const alwaysOpenChanged = nextSettings.alwaysOpen !== this.settings.alwaysOpen;
    const modeChanged = nextSettings.timelineMode !== this.settings.timelineMode;

    if (!alwaysOpenChanged && !modeChanged) return;

    const wasOpen = this.panelOpen;
    this.settings = nextSettings;
    if (alwaysOpenChanged) {
      this.inlinePanelOverride = null;
    }
    this.syncPanelOpenState();
    this.syncInlineToggle(resolveQuickPageContext());

    if (!this.panelOpen) {
      if (wasOpen) {
        this.closePanel();
        return;
      }

      this.syncClosedState();
      return;
    }

    if (!wasOpen) {
      void this.hydrate(true);
      return;
    }

    if (!this.currentShell) {
      void this.hydrate(true);
      return;
    }

    this.syncModeButton(this.currentShell);
    if (modeChanged && this.latestParsed) {
      this.renderedCount = 0;
      this.renderStoredTimeline(this.currentShell);
    }
  }

  async hydrate(force = false): Promise<void> {
    const serial = ++this.loadSerial;
    this.syncSettingsFromStorage();
    this.pruneDisconnectedShell();
    const quickContext = resolveQuickPageContext();
    this.syncContextScope(quickContext);
    this.syncInlineToggle(quickContext);

    if (!this.panelOpen) {
      this.hideCurrentSidebar();
      return;
    }

    const initialContext = resolvePageContext();
    const confirmedContext = await this.confirmTrustedContext(initialContext, serial);
    if (serial !== this.loadSerial || !this.panelOpen) return;

    const context = confirmedContext ?? initialContext;
    this.syncContextScope(context);
    if (!context.viewRoot) {
      this.hideCurrentSidebar();
      return;
    }

    const shell = this.ensureCurrentShell(context.viewRoot);
    this.bindShellActions(shell);
    this.syncModeButton(shell);
    this.setAsideVisible(shell, true);

    if (!context.summaryEl) {
      this.history.abort();
      this.clearParsedState();
      shell.inlineButton.disabled = true;
      setShellMeta(shell, 'Aguardando area de resumo da SIN');
      setShellState(shell, 'A tela ainda nao expôs o resumo da SIN nesta atualizacao.', 'warning');
      renderEmpty(shell, 'Espere a pagina terminar de atualizar e, se precisar, feche e abra o painel quando o resumo reaparecer.');
      return;
    }

    const safeHistoryUrl = getSafeHistoryUrl(context.historyUrl);
    shell.inlineButton.disabled = !Boolean(safeHistoryUrl);

    if (!context.historyIdentity?.absoluteUrl) {
      this.history.abort();
      this.clearParsedState();
      setShellMeta(
        shell,
        context.itemId
          ? `Item ${context.itemId} • aguardando link nativo`
          : 'Aguardando link nativo do acompanhamento'
      );
      setShellState(shell, 'Modo leve: sem link nativo confiavel.', 'warning');
      renderEmpty(shell, 'O painel so busca o acompanhamento quando o link nativo estiver visivel nesta tela.');
      return;
    }

    if (!confirmedContext || !context.isStable) {
      this.history.abort();
      this.clearParsedState();
      setShellMeta(
        shell,
        context.sinId
          ? `SIN ${context.sinId} • aguardando consistencia`
          : 'Aguardando consistencia da SIN'
      );
      setShellState(shell, 'O contexto ainda nao ficou consistente nesta atualizacao.', 'warning');
      renderEmpty(shell, 'Aguarde o proximo refresh da pagina ou feche e abra o painel quando a tela estabilizar.');
      return;
    }

    this.currentContext = confirmedContext;
    setShellMeta(
      shell,
      confirmedContext.sinId
        ? `SIN ${confirmedContext.sinId} • historico sob demanda`
        : 'Historico do item carregado sob demanda'
    );
    setShellState(shell, 'Carregando historico...', 'default');
    renderEmpty(shell, 'Buscando o conteudo de KM Acompanhamento...');

    let result: SinHistoryResult;
    try {
      result = await this.history.get(confirmedContext, force);
    } catch (error) {
      if (serial !== this.loadSerial || isAbortError(error)) return;
      result = {
        mode: 'error',
        timeline: [],
        diagnostic: 'Falha ao buscar ou interpretar o historico.',
        actionHint: 'Feche e abra o painel novamente para tentar de novo.'
      };
    }

    if (serial !== this.loadSerial || !this.panelOpen) return;
    this.renderResult(shell, confirmedContext, result);
  }

  private renderResult(shell: ShellRefs, context: SinPageContext, result: SinHistoryResult): void {
    const safeHistoryUrl = getSafeHistoryUrl(context.historyUrl) || window.location.href;
    this.latestResult = result;

    if (result.mode === 'parsed') {
      this.latestParsed = {
        allTimeline: result.timeline,
        yellowTimeline: result.timeline.filter((event) => event.yellowComments.length > 0),
        historyUrl: safeHistoryUrl,
        result
      };
      this.renderedCount = 0;
      this.renderStoredTimeline(shell);
      return;
    }

    this.clearParsedState();

    if (result.mode === 'session-error') {
      setShellState(shell, 'Sessao expirada ou acesso negado.', 'error');
      const message = [result.diagnostic, result.actionHint].filter(Boolean).join(' ');
      renderEmpty(shell, message || 'A sessao do Klassmatt expirou. Recarregue a pagina (F5).');
      return;
    }

    if (result.mode === 'blocked' && getSafeHistoryUrl(context.historyUrl)) {
      setShellState(shell, 'Historico bloqueado por seguranca.', 'warning');
      renderIframeFallbackPrompt(shell, result.diagnostic, () => {
        setShellState(shell, 'Carregando visualizacao segura...', 'warning');
        renderIframeFallback(
          shell,
          safeHistoryUrl,
          result.diagnostic,
          result.inlineHtml,
          result.inlineBaseUrl
        );
      });
      return;
    }

    if (result.mode === 'empty') {
      setShellState(shell, 'Nenhum evento encontrado no historico.', 'warning');
      renderEmpty(shell, result.diagnostic || 'O historico nao trouxe eventos para este item.');
      return;
    }

    if (result.mode === 'iframe' && getSafeHistoryUrl(context.historyUrl)) {
      setShellState(shell, 'Formato nao reconhecido. Visualizacao segura disponivel sob demanda.', 'warning');
      renderIframeFallbackPrompt(shell, result.diagnostic, () => {
        setShellState(shell, 'Carregando visualizacao segura...', 'warning');
        renderIframeFallback(
          shell,
          safeHistoryUrl,
          result.diagnostic,
          result.inlineHtml,
          result.inlineBaseUrl
        );
      });
      return;
    }

    const displayMsg = [result.diagnostic, result.actionHint].filter(Boolean).join(' ');
    setShellState(shell, result.diagnostic || 'Falha ao carregar o historico.', 'error');
    renderEmpty(shell, displayMsg || 'Nao foi possivel renderizar o acompanhamento.');
  }

  private renderStoredTimeline(shell: ShellRefs, appendFrom?: number): void {
    if (!this.latestParsed) return;

    const visibleTimeline = this.getVisibleTimeline();
    if (visibleTimeline.length === 0) {
      setShellState(shell, 'Nenhum comentario amarelo encontrado.', 'warning');
      renderEmpty(shell, 'Ative o modo Tudo para ver o acompanhamento completo deste item.');
      return;
    }

    if (this.renderedCount === 0) {
      this.renderedCount = Math.min(RENDER_BATCH_SIZE, visibleTimeline.length);
    } else {
      this.renderedCount = Math.min(this.renderedCount, visibleTimeline.length);
    }

    const renderedTimeline = appendFrom === undefined
      ? visibleTimeline.slice(0, this.renderedCount)
      : visibleTimeline.slice(appendFrom, this.renderedCount);
    const loadedCount = appendFrom === undefined ? renderedTimeline.length : this.renderedCount;
    setShellState(shell, this.buildTimelineSummary(loadedCount, visibleTimeline.length), 'default');
    const model = {
      historyUrl: this.latestParsed.historyUrl,
      diagnostic: this.latestParsed.result.diagnostic,
      timeline: renderedTimeline,
      loadedCount,
      totalCount: visibleTimeline.length,
      onLoadMore: renderedTimeline.length < visibleTimeline.length ? this.handleLoadMoreClick : null
    };

    if (appendFrom === undefined) {
      renderTimeline(shell, model);
    } else {
      appendTimeline(shell, {
        ...model
      });
    }
  }

  private ensureCurrentShell(viewRoot: HTMLElement): ShellRefs {
    if (
      this.currentShell
      && this.currentViewRoot === viewRoot
      && this.currentShell.layoutEl.isConnected
    ) {
      return this.currentShell;
    }

    this.currentShell = ensureShell(viewRoot);
    this.currentViewRoot = viewRoot;
    return this.currentShell;
  }

  private resolveConnectedShell(): ShellRefs | null {
    this.pruneDisconnectedShell();

    if (this.currentShell?.layoutEl.isConnected) {
      return this.currentShell;
    }

    const viewRoot = this.currentContext?.viewRoot?.isConnected
      ? this.currentContext.viewRoot
      : resolvePageContext().viewRoot;

    if (!viewRoot) return null;
    return this.ensureCurrentShell(viewRoot);
  }

  private bindShellActions(shell: ShellRefs): void {
    shell.inlineButton.onclick = this.handleInlineRender;
    shell.modeButton.onclick = this.handleModeToggleClick;
  }

  private syncPanelOpenState(): void {
    this.panelOpen = this.inlinePanelOverride ?? this.settings.alwaysOpen;
  }

  private getContextScopeKey(context: QuickSinPageContext | SinPageContext): string | null {
    const identityScope = context.historyIdentity?.fingerprint
      || context.historyUrl
      || context.sinId
      || context.summarySinId
      || null;

    if (!identityScope && !context.itemId) return null;

    return [
      context.itemId || 'sem-item',
      identityScope || 'sem-contexto'
    ].join('|');
  }

  private syncContextScope(context: QuickSinPageContext | SinPageContext): void {
    const nextContextKey = this.getContextScopeKey(context);
    if (!nextContextKey) return;

    if (this.currentContextKey && this.currentContextKey !== nextContextKey) {
      this.inlinePanelOverride = null;
    }

    this.currentContextKey = nextContextKey;
    this.syncPanelOpenState();
  }

  private syncInlineToggle(_context: QuickSinPageContext = resolveQuickPageContext()): void {
    const linkEl = _context.linkEl;
    const parent = linkEl?.parentElement;

    if (!linkEl || !parent) {
      this.removeInlineToggle();
      return;
    }

    const needsNewButton = (
      !this.toggleHost
      || !this.toggleButton
      || !this.toggleHost.isConnected
      || this.toggleParent !== parent
    );

    if (needsNewButton) {
      this.removeInlineToggle();

      const host = document.createElement('span');
      host.className = 'km-sin-inline-toggle';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'km-sin-toggle';
      button.addEventListener('click', this.handleToggleClick);

      host.appendChild(button);
      linkEl.insertAdjacentElement('afterend', host);

      this.toggleHost = host;
      this.toggleButton = button;
      this.toggleParent = parent;
    }

    const toggleHost = this.toggleHost;
    const toggleButton = this.toggleButton;
    if (!toggleHost || !toggleButton) return;

    if (toggleHost.previousElementSibling !== linkEl) {
      linkEl.insertAdjacentElement('afterend', toggleHost);
    }

    const label = getInlinePanelToggleLabel(this.panelOpen);
    toggleButton.textContent = label;
    toggleButton.title = label;
    toggleButton.setAttribute('aria-pressed', String(this.panelOpen));
  }

  private removeInlineToggle(): void {
    if (this.toggleHost?.isConnected) {
      this.toggleHost.remove();
    }

    this.toggleHost = null;
    this.toggleButton = null;
    this.toggleParent = null;
  }

  private syncModeButton(shell: ShellRefs): void {
    const mode = this.settings.timelineMode;
    shell.modeButton.dataset.mode = mode;
    shell.modeButton.textContent = mode === 'all' ? 'Amarelos' : 'Tudo';
    shell.modeButton.title = mode === 'all'
      ? 'Clique para mostrar somente os comentarios amarelos'
      : 'Clique para mostrar todo o acompanhamento';
  }

  private setAsideVisible(shell: ShellRefs, visible: boolean): void {
    shell.asideEl.hidden = !visible;
    shell.layoutEl.classList.toggle('km-sin-collapsed', !visible);
  }

  private async confirmTrustedContext(context: SinPageContext, serial: number): Promise<SinPageContext | null> {
    if (context.isStable && context.historyIdentity?.fingerprint) {
      return context;
    }

    await new Promise<void>((resolve) => {
      window.setTimeout(resolve, 140);
    });

    if (serial !== this.loadSerial || !this.panelOpen) return null;

    const secondRead = resolvePageContext();
    return secondRead.isStable && Boolean(secondRead.historyIdentity?.fingerprint)
      ? secondRead
      : null;
  }

  private syncClosedState(context: QuickSinPageContext = resolveQuickPageContext()): void {
    this.pruneDisconnectedShell();
    this.syncContextScope(context);
    this.syncInlineToggle(context);
    if (!this.panelOpen) {
      this.hideCurrentSidebar();
    }
  }

  private closePanel(): void {
    this.panelOpen = false;
    this.loadSerial++;
    this.history.abort();
    this.clearParsedState();
    this.currentContext = null;
    this.hideCurrentSidebar(true);
    this.syncInlineToggle(resolveQuickPageContext());
  }

  private hideCurrentSidebar(clearBody = false): void {
    if (this.currentShell?.layoutEl.isConnected) {
      if (clearBody) {
        this.currentShell.bodyEl.replaceChildren();
      }
      this.currentShell.inlineButton.disabled = true;
      this.currentShell.asideEl.hidden = true;
      this.currentShell.layoutEl.classList.add('km-sin-collapsed');
    }

    if (this.currentShell && !this.currentShell.layoutEl.isConnected) {
      this.currentShell = null;
      this.currentViewRoot = null;
    }
  }

  private pruneDisconnectedShell(): void {
    if (this.currentShell && !this.currentShell.layoutEl.isConnected) {
      this.currentShell = null;
      this.currentViewRoot = null;
      this.currentContext = null;
    }
  }

  private syncSettingsFromStorage(): void {
    const storedSettings = loadSettings();
    this.settings = storedSettings;
    this.syncPanelOpenState();
  }

  private clearParsedState(): void {
    this.latestParsed = null;
    this.latestResult = null;
    this.renderedCount = 0;
  }

  private getVisibleTimeline(): TimelineEvent[] {
    if (!this.latestParsed) return [];
    return this.settings.timelineMode === 'yellow-only'
      ? this.latestParsed.yellowTimeline
      : this.latestParsed.allTimeline;
  }

  private buildTimelineSummary(loadedCount: number, totalVisible: number): string {
    if (!this.latestParsed) return 'Historico carregado.';

    if (this.settings.timelineMode === 'yellow-only') {
      return loadedCount < totalVisible
        ? `Exibindo ${loadedCount} de ${totalVisible} evento(s) com comentario amarelo`
        : `Exibindo ${totalVisible} evento(s) com comentario amarelo`;
    }

    const totalEventos = this.latestParsed.result.summary.totalEventos;
    const totalYellowEvents = this.latestParsed.result.summary.totalYellowEvents;

    if (loadedCount < totalVisible) {
      return totalYellowEvents > 0
        ? `Exibindo ${loadedCount} de ${totalEventos} evento(s) (${totalYellowEvents} com amarelo)`
        : `Exibindo ${loadedCount} de ${totalEventos} evento(s) da SIN`;
    }

    return totalYellowEvents > 0
      ? `Exibindo ${totalEventos} evento(s) (${totalYellowEvents} com amarelo)`
      : `Exibindo todos os ${totalEventos} evento(s) da SIN`;
  }
}
