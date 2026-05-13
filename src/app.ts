import { detectKlassmattErrorPage, fetchHtml } from './http';
import {
  extractHistoryIdentityFromUrl,
  formatHistoryIdentity,
  type HistoryIdentity,
  validateHistoryIdentity
} from './history-identity';
import {
  parseHistoryStrict,
  scopeTimelineToItem,
  type ParseHistoryResult,
  type TimelineEvent
} from './parse';
import {
  getInlinePanelToggleLabel,
  loadSettings,
  saveSettings,
  SETTINGS_KEY,
  type SinPanelSettings,
  type TimelineMode
} from './state';
import {
  ensureShell,
  injectStyles,
  renderEmpty,
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

interface PageRequestManagerLike {
  add_endRequest(fn: () => void): void;
  remove_endRequest(fn: () => void): void;
}

export type RefreshMode = 'manual' | 'semi-auto' | 'auto';

interface AppOptions {
  refreshMode?: RefreshMode;
  hookAspNet?: boolean;
}

interface ResolvedAppOptions {
  refreshMode: RefreshMode;
  hookAspNet: boolean;
}

export interface SinHistoryResult {
  mode: 'parsed' | 'iframe' | 'error' | 'empty' | 'blocked' | 'session-error';
  timeline: TimelineEvent[];
  diagnostic?: string;
  actionHint?: string;
  summary?: ParseHistoryResult['summary'];
  warnings?: string[];
  confidence?: ParseHistoryResult['confidence'];
  documentIdentity?: HistoryIdentity | null;
  inlineHtml?: string;
  inlineBaseUrl?: string;
}

interface ParsedTimelineState {
  allTimeline: TimelineEvent[];
  yellowTimeline: TimelineEvent[];
  historyUrl: string;
  result: SinHistoryResult & { mode: 'parsed'; summary: NonNullable<SinHistoryResult['summary']> };
}

const RENDER_BATCH_SIZE = 30;
declare const unsafeWindow: (Window & typeof globalThis) | undefined;

function resolveRefreshMode(options: AppOptions): RefreshMode {
  return options.refreshMode ?? 'manual';
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}

function getPageWindow(): Window & typeof globalThis {
  return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
}

function getSafeHistoryUrl(rawUrl: string | null | undefined): string | null {
  return extractHistoryIdentityFromUrl(rawUrl)?.absoluteUrl || null;
}

function buildBlockedDiagnostic(
  title: string,
  reasons: string[],
  expectedIdentity: HistoryIdentity | null,
  actualIdentity: HistoryIdentity | null
): string {
  const parts = [
    title,
    ...reasons,
    expectedIdentity ? `Esperado: ${formatHistoryIdentity(expectedIdentity)}.` : '',
    actualIdentity ? `Retornado: ${formatHistoryIdentity(actualIdentity)}.` : ''
  ].filter(Boolean);

  return parts.join(' ');
}

function isSecurityBlockedError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /origem inesperada|redirecionamento bloqueado/i.test(error.message);
}

function classifyErrorForUser(error: unknown, wasRedirected?: boolean): { diagnostic: string; actionHint: string } {
  if (error instanceof Error) {
    const msg = error.message.toLowerCase();

    if (/falha http 401|falha http 403/i.test(msg)) {
      return {
        diagnostic: 'O Klassmatt recusou o acesso ao historico.',
        actionHint: 'Recarregue a pagina (F5) para renovar a sessao.'
      };
    }

    if (/falha http 5\d\d/i.test(msg)) {
      return {
        diagnostic: 'O servidor do Klassmatt retornou um erro interno.',
        actionHint: 'Recarregue a pagina (F5) ou feche e abra o painel novamente quando quiser tentar.'
      };
    }

    if (/network|fetch|econnreset|econnrefused|socket/i.test(msg)) {
      return {
        diagnostic: 'Falha de conexao com o servidor.',
        actionHint: 'Verifique sua rede e, depois, reabra o painel ou recarregue a pagina (F5).'
      };
    }

    if (/timeout/i.test(msg)) {
      return {
        diagnostic: 'O servidor demorou demais para responder.',
        actionHint: 'Feche e abra o painel novamente para tentar de novo.'
      };
    }

    if (/content-type/i.test(msg)) {
      return {
        diagnostic: 'O servidor retornou um conteudo inesperado (nao HTML).',
        actionHint: 'Use o botao Ver inline para abrir uma visualizacao segura do historico.'
      };
    }

    if (/origem inesperada|redirecionamento bloqueado/i.test(msg)) {
      return {
        diagnostic: 'O carregamento foi bloqueado porque o servidor tentou responder por uma origem inesperada.',
        actionHint: 'Recarregue a pagina (F5) e confirme se o link nativo do historico ainda aponta para o Klassmatt.'
      };
    }
  }

  if (wasRedirected) {
    return {
      diagnostic: 'O Klassmatt redirecionou a solicitacao para outra pagina.',
      actionHint: 'A sessao pode ter expirado. Recarregue a pagina (F5).'
    };
  }

  const message = error instanceof Error ? error.message : String(error);
  return {
    diagnostic: `Falha ao buscar ou interpretar o historico: ${message}`,
    actionHint: 'Feche e abra o painel novamente para tentar de novo.'
  };
}

export class SinSidebarApp {
  private readonly options: ResolvedAppOptions;
  private readonly cache = new Map<string, SinHistoryResult>();
  private readonly inflight = new Map<string, Promise<SinHistoryResult>>();
  private settings: SinPanelSettings = loadSettings();
  private destroyAspNet: (() => void) | null = null;
  private destroyContextEvents: (() => void) | null = null;
  private loadSerial = 0;
  private activeFetch: AbortController | null = null;
  private activeFetchKey: string | null = null;
  private currentShell: ShellRefs | null = null;
  private currentViewRoot: HTMLElement | null = null;
  private currentContext: SinPageContext | null = null;
  private latestParsed: ParsedTimelineState | null = null;
  private latestResult: SinHistoryResult | null = null;
  private renderedCount = 0;
  private inlinePanelOverride: boolean | null = null;
  private panelOpen = this.settings.alwaysOpen;
  private currentContextKey: string | null = null;
  private observedContextSignature: string | null = null;
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
      this.abortActiveFetch();
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
    this.renderedCount = Math.min(this.renderedCount + RENDER_BATCH_SIZE, visibleTimeline.length);
    this.renderStoredTimeline(shell);
  };

  private readonly handleStorageEvent = (event: Event): void => {
    const storageEvent = event as StorageEvent;
    if (storageEvent.key !== null && storageEvent.key !== SETTINGS_KEY) return;

    this.applySettings(loadSettings());
  };

  private readonly handlePageLifecycleEvent = (event?: Event): void => {
    if (event?.type === 'pageshow') {
      const pageShowEvent = event as PageTransitionEvent;
      if (!pageShowEvent.persisted) {
        return;
      }
    }

    this.syncSettingsFromStorage();
    const quickContext = resolveQuickPageContext();
    this.observedContextSignature = this.captureContextSignature(quickContext);
    this.syncContextScope(quickContext);
    if (this.panelOpen) {
      void this.hydrate(true);
      return;
    }

    this.syncClosedState(quickContext);
  };

  constructor(options: AppOptions = {}) {
    this.options = {
      refreshMode: resolveRefreshMode(options),
      hookAspNet: options.hookAspNet ?? true
    };
  }

  init(): void {
    injectStyles();
    this.destroyContextEvents = this.bindContextEvents();
    if (this.options.hookAspNet) this.destroyAspNet = this.bindAspNetEndRequest();
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
    if (this.destroyAspNet) this.destroyAspNet();
    if (this.destroyContextEvents) this.destroyContextEvents();
    this.abortActiveFetch();
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
      this.abortActiveFetch();
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
      this.abortActiveFetch();
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
      this.abortActiveFetch();
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
      result = await this.getHistoryResult(confirmedContext, force);
    } catch (error) {
      if (serial !== this.loadSerial || isAbortError(error)) return;
      const message = error instanceof Error ? error.message : String(error);
      result = {
        mode: 'error',
        timeline: [],
        diagnostic: `Falha ao buscar ou interpretar o historico: ${message}`
      };
    }

    if (serial !== this.loadSerial || !this.panelOpen) return;
    this.renderResult(shell, confirmedContext, result);
  }

  private renderResult(shell: ShellRefs, context: SinPageContext, result: SinHistoryResult): void {
    const safeHistoryUrl = getSafeHistoryUrl(context.historyUrl) || window.location.href;
    this.latestResult = result;

    if (result.mode === 'parsed' && result.summary) {
      const parsedResult = result as SinHistoryResult & {
        mode: 'parsed';
        summary: NonNullable<SinHistoryResult['summary']>;
      };
      this.latestParsed = {
        allTimeline: parsedResult.timeline,
        yellowTimeline: parsedResult.timeline.filter((event) => event.yellowComments.length > 0),
        historyUrl: safeHistoryUrl,
        result: parsedResult
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

  private renderStoredTimeline(shell: ShellRefs): void {
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

    const renderedTimeline = visibleTimeline.slice(0, this.renderedCount);
    setShellState(shell, this.buildTimelineSummary(renderedTimeline.length, visibleTimeline.length), 'default');
    renderTimeline(shell, {
      historyUrl: this.latestParsed.historyUrl,
      diagnostic: this.latestParsed.result.diagnostic,
      timeline: renderedTimeline,
      loadedCount: renderedTimeline.length,
      totalCount: visibleTimeline.length,
      onLoadMore: renderedTimeline.length < visibleTimeline.length ? this.handleLoadMoreClick : null
    });
  }

  private async getHistoryResult(context: SinPageContext, force = false): Promise<SinHistoryResult> {
    const historyUrl = getSafeHistoryUrl(context.historyUrl);
    if (!historyUrl) {
      return {
        mode: 'blocked',
        timeline: [],
        diagnostic: 'O link do historico aponta para uma origem inesperada ou nao confiavel.',
        actionHint: 'Recarregue a pagina (F5) e confirme que o link nativo da SIN esta correto.'
      };
    }

    const cacheKey = this.getHistoryCacheKey(context);
    if (force) {
      this.cache.delete(cacheKey);
      this.purgeStaleCacheEntries(context.itemId, cacheKey);
    }
    if (!force && this.cache.has(cacheKey)) {
      return this.cache.get(cacheKey)!;
    }
    if (!force && this.inflight.has(cacheKey)) {
      return this.inflight.get(cacheKey)!;
    }

    const task = (async () => {
      try {
        if (this.activeFetch && (force || this.activeFetchKey !== cacheKey)) {
          this.abortActiveFetch();
        }

        this.activeFetch = new AbortController();
        this.activeFetchKey = cacheKey;

        const fetchResult = await fetchHtml(historyUrl, this.activeFetch.signal);
        if (fetchResult.wasRedirected && !/Historico\.aspx/i.test(fetchResult.responseUrl)) {
          this.cache.delete(cacheKey);
          return {
            mode: 'session-error',
            timeline: [],
            diagnostic: /Erro\.aspx|Login\.aspx|default\.aspx/i.test(fetchResult.responseUrl)
              ? 'O Klassmatt redirecionou para uma pagina de erro ou login.'
              : `O servidor redirecionou para ${fetchResult.responseUrl}.`,
            actionHint: 'A sessao pode ter expirado. Recarregue a pagina (F5).'
          } satisfies SinHistoryResult;
        }

        const doc = new DOMParser().parseFromString(fetchResult.html, 'text/html');
        const errorCheck = detectKlassmattErrorPage(doc);
        if (errorCheck.isError) {
          this.cache.delete(cacheKey);
          return {
            mode: 'session-error',
            timeline: [],
            diagnostic: /ACESSO\s+N[ÃA]O\s+AUTORIZADO/i.test(errorCheck.errorMessage || '')
              ? 'Acesso nao autorizado ao historico.'
              : `O Klassmatt retornou uma pagina de erro: ${(errorCheck.errorMessage || 'Erro desconhecido').slice(0, 200)}`,
            actionHint: 'Recarregue a pagina (F5) ou feche e abra o painel novamente quando quiser tentar de novo.'
          } satisfies SinHistoryResult;
        }

        const parsed = parseHistoryStrict(doc, fetchResult.responseUrl);
        const inlineBaseUrl = fetchResult.responseUrl || historyUrl;
        const identityValidation = validateHistoryIdentity(context.historyIdentity, parsed.documentIdentity);

        if (!identityValidation.isValid) {
          return {
            mode: 'blocked',
            timeline: [],
            diagnostic: buildBlockedDiagnostic(
              'Historico bloqueado por divergencia entre o link nativo e o HTML retornado.',
              identityValidation.reasons,
              context.historyIdentity,
              parsed.documentIdentity || null
            ),
            actionHint: 'Use o botao Ver inline para conferir a pagina nativa.',
            summary: parsed.summary,
            warnings: [...identityValidation.reasons, ...parsed.warnings],
            confidence: 'low',
            documentIdentity: parsed.documentIdentity,
            inlineHtml: fetchResult.html,
            inlineBaseUrl
          } satisfies SinHistoryResult;
        }

        if (parsed.confidence !== 'high') {
          return {
            mode: 'blocked',
            timeline: [],
            diagnostic: buildBlockedDiagnostic(
              'Historico bloqueado por baixa confianca do parser estrito.',
              parsed.warnings,
              context.historyIdentity,
              parsed.documentIdentity || null
            ),
            actionHint: 'O formato do historico pode ter mudado. Use o botao Ver inline.',
            summary: parsed.summary,
            warnings: parsed.warnings,
            confidence: parsed.confidence,
            documentIdentity: parsed.documentIdentity,
            inlineHtml: fetchResult.html,
            inlineBaseUrl
          } satisfies SinHistoryResult;
        }

        const scopedTimeline = context.itemId
          ? scopeTimelineToItem(parsed.timeline, context.itemId)
          : null;

        if (scopedTimeline?.status === 'ambiguous') {
          return {
            mode: 'blocked',
            timeline: [],
            diagnostic: scopedTimeline.diagnostic,
            actionHint: 'Use o botao Ver inline para conferir o historico completo da SIN.',
            summary: parsed.summary,
            warnings: [...parsed.warnings, scopedTimeline.diagnostic || ''],
            confidence: 'low',
            documentIdentity: parsed.documentIdentity,
            inlineHtml: fetchResult.html,
            inlineBaseUrl
          } satisfies SinHistoryResult;
        }

        const effectiveTimeline = scopedTimeline?.status === 'filtered'
          ? scopedTimeline.timeline
          : parsed.timeline;
        const effectiveSummary = scopedTimeline?.status === 'filtered'
          ? scopedTimeline.summary
          : parsed.summary;
        const effectiveDiagnostic = scopedTimeline?.status === 'filtered'
          ? scopedTimeline.diagnostic
          : undefined;

        const result: SinHistoryResult = effectiveTimeline.length > 0
          ? {
              mode: 'parsed',
              timeline: effectiveTimeline,
              diagnostic: effectiveDiagnostic,
              summary: effectiveSummary,
              warnings: parsed.warnings,
              confidence: parsed.confidence,
              documentIdentity: parsed.documentIdentity,
              inlineHtml: fetchResult.html,
              inlineBaseUrl
            }
          : {
              mode: 'empty',
              timeline: [],
              diagnostic: 'O popup foi carregado, mas nao continha eventos reconheciveis.',
              actionHint: 'Use o botao Ver inline para verificar.',
              summary: effectiveSummary,
              warnings: parsed.warnings,
              confidence: parsed.confidence,
              documentIdentity: parsed.documentIdentity,
              inlineHtml: fetchResult.html,
              inlineBaseUrl
            };

        this.cache.set(cacheKey, result);
        this.purgeStaleCacheEntries(context.itemId, cacheKey);
        return result;
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (isSecurityBlockedError(error)) {
          const classified = classifyErrorForUser(error);
          return {
            mode: 'blocked',
            timeline: [],
            diagnostic: classified.diagnostic,
            actionHint: classified.actionHint
          } satisfies SinHistoryResult;
        }

        const classified = classifyErrorForUser(error);
        return {
          mode: historyUrl ? 'iframe' : 'error',
          timeline: [],
          diagnostic: classified.diagnostic,
          actionHint: classified.actionHint
        } satisfies SinHistoryResult;
      } finally {
        if (this.activeFetchKey === cacheKey) {
          this.activeFetch = null;
          this.activeFetchKey = null;
        }
        this.inflight.delete(cacheKey);
      }
    })();

    this.inflight.set(cacheKey, task);
    return task;
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
    } else if (this.toggleHost.previousElementSibling !== linkEl) {
      linkEl.insertAdjacentElement('afterend', this.toggleHost);
    }

    const label = getInlinePanelToggleLabel(this.panelOpen);
    this.toggleButton.textContent = label;
    this.toggleButton.title = label;
    this.toggleButton.setAttribute('aria-pressed', String(this.panelOpen));
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

  private abortActiveFetch(): void {
    if (this.activeFetch) {
      this.activeFetch.abort();
    }
    this.activeFetch = null;
    this.activeFetchKey = null;
  }

  private captureContextSignature(context: QuickSinPageContext = resolveQuickPageContext()): string {
    return [
      window.location.href,
      context.itemId || 'sem-item',
      context.summarySinId || 'sem-sin-resumo',
      context.historyIdentity?.fingerprint || context.historyUrl || context.sinId || 'sem-historico'
    ].join('|');
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
    this.abortActiveFetch();
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

  private bindContextEvents(): () => void {
    let disposed = false;
    let mutationObserver: MutationObserver | null = null;
    let mutationTimer = 0;
    const observeRoot = document.body ?? document.documentElement;
    const timerHost = observeRoot.ownerDocument?.defaultView ?? globalThis;

    const handleMutation = (): void => {
      if (disposed) return;
      mutationTimer = 0;
      const nextSignature = this.captureContextSignature();
      if (nextSignature === this.observedContextSignature) return;
      this.observedContextSignature = nextSignature;
      this.handlePageLifecycleEvent();
    };

    window.addEventListener('storage', this.handleStorageEvent);
    window.addEventListener('pageshow', this.handlePageLifecycleEvent);
    window.addEventListener('popstate', this.handlePageLifecycleEvent);
    window.addEventListener('hashchange', this.handlePageLifecycleEvent);

    if (observeRoot) {
      this.observedContextSignature = this.captureContextSignature();
      mutationObserver = new MutationObserver(() => {
        if (mutationTimer) return;
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
      window.removeEventListener('pageshow', this.handlePageLifecycleEvent);
      window.removeEventListener('popstate', this.handlePageLifecycleEvent);
      window.removeEventListener('hashchange', this.handlePageLifecycleEvent);
    };
  }

  private bindAspNetEndRequest(): () => void {
    let disposed = false;
    let intervalId = 0;
    let handler: (() => void) | null = null;
    let manager: PageRequestManagerLike | null = null;
    const deadline = Date.now() + 8000;

    intervalId = window.setInterval(() => {
      if (disposed || Date.now() > deadline) {
        window.clearInterval(intervalId);
        return;
      }

      const maybeManager = (getPageWindow() as any).Sys?.WebForms?.PageRequestManager?.getInstance?.() as PageRequestManagerLike | null | undefined;
      if (!maybeManager) return;

      window.clearInterval(intervalId);
      manager = maybeManager;
      handler = this.handlePageLifecycleEvent;
      manager.add_endRequest(handler);
    }, 250);

    return () => {
      disposed = true;
      if (intervalId) window.clearInterval(intervalId);
      if (manager && handler) {
        try {
          manager.remove_endRequest(handler);
        } catch {
          // ignore
        }
      }
    };
  }

  private getHistoryCacheKey(context: SinPageContext): string {
    return [
      context.itemId || 'sem-item',
      context.historyIdentity?.fingerprint || context.historyUrl || 'sem-historico'
    ].join('|');
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

  private purgeStaleCacheEntries(itemId: string | null, keepKey?: string): void {
    if (!itemId) return;
    const prefix = `${itemId}|`;
    for (const key of this.cache.keys()) {
      if (key.startsWith(prefix) && key !== keepKey) {
        this.cache.delete(key);
      }
    }
  }
}
