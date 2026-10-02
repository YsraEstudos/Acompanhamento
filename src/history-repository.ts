import { detectKlassmattErrorPage, fetchHtml } from './http';
import {
  extractHistoryIdentityFromUrl,
  formatHistoryIdentity,
  validateHistoryIdentity,
  type HistoryIdentity
} from './history-identity';
import {
  parseHistoryStrict,
  scopeTimelineToItem,
  type ParseHistoryResult,
  type TimelineEvent
} from './parse';
import {
  getHttpErrorCode,
  getHttpErrorName,
  getHttpErrorStatus,
  HTTP_ERROR_CODES
} from './http-errors';
import type { SinPageContext } from './url';

export type HistoryRequestContext = Pick<SinPageContext, 'itemId' | 'historyUrl' | 'historyIdentity'>;

interface ParsedHistorySnapshot {
  summary: ParseHistoryResult['summary'];
  warnings: string[];
  confidence: ParseHistoryResult['confidence'];
  documentIdentity: HistoryIdentity | null;
  inlineHtml: string;
  inlineBaseUrl: string;
}

export interface ParsedHistoryResult extends ParsedHistorySnapshot {
  mode: 'parsed';
  timeline: TimelineEvent[];
  diagnostic?: string;
}

export interface EmptyHistoryResult extends ParsedHistorySnapshot {
  mode: 'empty';
  timeline: [];
  diagnostic: string;
  actionHint: string;
}

export interface BlockedHistoryResult {
  mode: 'blocked';
  timeline: [];
  diagnostic: string;
  actionHint: string;
  summary?: ParseHistoryResult['summary'];
  warnings?: string[];
  confidence?: ParseHistoryResult['confidence'];
  documentIdentity?: HistoryIdentity | null;
  inlineHtml?: string;
  inlineBaseUrl?: string;
}

export interface FallbackHistoryResult {
  mode: 'iframe' | 'error' | 'session-error';
  timeline: [];
  diagnostic: string;
  actionHint: string;
  inlineHtml?: string;
  inlineBaseUrl?: string;
}

export type SinHistoryResult =
  | ParsedHistoryResult
  | EmptyHistoryResult
  | BlockedHistoryResult
  | FallbackHistoryResult;

interface InflightHistoryRequest {
  controller: AbortController;
  task: Promise<SinHistoryResult>;
}

const MAX_HISTORY_CACHE_ENTRIES = 5;

function isAbortError(error: unknown): boolean {
  return getHttpErrorName(error) === 'AbortError';
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

export function classifyErrorForUser(error: unknown, wasRedirected = false): { diagnostic: string; actionHint: string } {
  const code = getHttpErrorCode(error);
  const name = getHttpErrorName(error);
  const status = getHttpErrorStatus(error);

  if (code === HTTP_ERROR_CODES.HTTP_STATUS || status !== undefined) {
    if (status === 401 || status === 403) {
      return {
        diagnostic: 'O Klassmatt recusou o acesso ao historico.',
        actionHint: 'Recarregue a pagina (F5) para renovar a sessao.'
      };
    }

    if (status !== undefined && status >= 500 && status <= 599) {
      return {
        diagnostic: 'O servidor do Klassmatt retornou um erro interno.',
        actionHint: 'Recarregue a pagina (F5) ou feche e abra o painel novamente quando quiser tentar.'
      };
    }
  }

  if (code === HTTP_ERROR_CODES.NETWORK) {
    return {
      diagnostic: 'Falha de conexao com o servidor.',
      actionHint: 'Verifique sua rede e, depois, reabra o painel ou recarregue a pagina (F5).'
    };
  }

  if (code === HTTP_ERROR_CODES.TIMEOUT || (!code && name === 'TimeoutError')) {
    return {
      diagnostic: 'O servidor demorou demais para responder.',
      actionHint: 'Feche e abra o painel novamente para tentar de novo.'
    };
  }

  if (code === HTTP_ERROR_CODES.CONTENT_TYPE) {
    return {
      diagnostic: 'O servidor retornou um conteudo inesperado (nao HTML).',
      actionHint: 'Use o botao Ver inline para abrir uma visualizacao segura do historico.'
    };
  }

  if (code === HTTP_ERROR_CODES.ORIGIN_BLOCKED) {
    return {
      diagnostic: 'O carregamento foi bloqueado porque o servidor tentou responder por uma origem inesperada.',
      actionHint: 'Recarregue a pagina (F5) e confirme se o link nativo do historico ainda aponta para o Klassmatt.'
    };
  }

  if (wasRedirected) {
    return {
      diagnostic: 'O Klassmatt redirecionou a solicitacao para outra pagina.',
      actionHint: 'A sessao pode ter expirado. Recarregue a pagina (F5).'
    };
  }

  return {
    diagnostic: 'Falha ao buscar ou interpretar o historico.',
    actionHint: 'Feche e abra o painel novamente para tentar de novo.'
  };
}

export class HistoryRepository {
  private readonly cache = new Map<string, SinHistoryResult>();
  private readonly inflight = new Map<string, InflightHistoryRequest>();
  private activeFetch: AbortController | null = null;
  private activeFetchKey: string | null = null;

  async get(context: HistoryRequestContext, force = false): Promise<SinHistoryResult> {
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
    if (!force) {
      const cached = this.cache.get(cacheKey);
      if (cached) {
        this.cache.delete(cacheKey);
        this.cache.set(cacheKey, cached);
        return cached;
      }
    }
    if (!force && this.inflight.has(cacheKey)) {
      return this.inflight.get(cacheKey)!.task;
    }

    if (this.activeFetch && (force || this.activeFetchKey !== cacheKey)) {
      this.abort();
    }
    const controller = new AbortController();
    this.activeFetch = controller;
    this.activeFetchKey = cacheKey;

    const task = (async () => {
      try {
        const fetchResult = await fetchHtml(historyUrl, controller.signal);
        if (fetchResult.wasRedirected && !/Historico\.aspx/i.test(fetchResult.responseUrl)) {
          this.cache.delete(cacheKey);
          return {
            mode: 'session-error',
            timeline: [],
            diagnostic: /Erro\.aspx|Login\.aspx|default\.aspx/i.test(fetchResult.responseUrl)
              ? 'O Klassmatt redirecionou para uma pagina de erro ou login.'
              : 'O servidor redirecionou para uma pagina inesperada.',
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
              : 'O Klassmatt retornou uma pagina de erro.',
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
            diagnostic: scopedTimeline.diagnostic || 'O historico nao pode ser associado com seguranca ao item atual.',
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

        this.setCachedHistory(cacheKey, result);
        this.purgeStaleCacheEntries(context.itemId, cacheKey);
        return result;
      } catch (error) {
        if (isAbortError(error)) throw error;
        if (getHttpErrorCode(error) === HTTP_ERROR_CODES.ORIGIN_BLOCKED) {
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
        if (this.activeFetch === controller) {
          this.activeFetch = null;
          this.activeFetchKey = null;
        }
        if (this.inflight.get(cacheKey)?.controller === controller) {
          this.inflight.delete(cacheKey);
        }
      }
    })();

    this.inflight.set(cacheKey, { controller, task });
    return task;
  }

  abort(): void {
    if (this.activeFetch) {
      this.activeFetch.abort();
    }
    this.activeFetch = null;
    this.activeFetchKey = null;
  }

  private getHistoryCacheKey(context: HistoryRequestContext): string {
    return [
      context.itemId || 'sem-item',
      context.historyIdentity?.fingerprint || context.historyUrl || 'sem-historico'
    ].join('|');
  }

  private setCachedHistory(cacheKey: string, result: SinHistoryResult): void {
    this.cache.delete(cacheKey);
    this.cache.set(cacheKey, result);

    while (this.cache.size > MAX_HISTORY_CACHE_ENTRIES) {
      const oldestKey = this.cache.keys().next().value;
      if (oldestKey === undefined) break;
      this.cache.delete(oldestKey);
    }
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
