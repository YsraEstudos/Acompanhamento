import {
  createUnknownHttpError,
  getHttpErrorName,
  HTTP_ERROR_CODES,
  HttpRequestError
} from './http-errors';

const HTTP_TIMEOUT_MS = 30000;

function extractCharsetContentType(contentType: string = ''): string {
  const match = String(contentType || '').match(/charset\s*=\s*["']?([^;"'\s]+)/i);
  return match?.[1] ? match[1].trim().toLowerCase() : '';
}

function extractCharsetMeta(bytes: Uint8Array): string {
  try {
    const head = bytes.slice(0, 8192);
    const ascii = new TextDecoder('ascii').decode(head);
    const charsetMeta = ascii.match(/<meta[^>]*charset=["']?\s*([a-z0-9._-]+)/i);
    if (charsetMeta?.[1]) return charsetMeta[1].trim().toLowerCase();
    const equivMeta = ascii.match(/<meta[^>]*http-equiv=["']content-type["'][^>]*content=["'][^"']*charset=([a-z0-9._-]+)/i);
    if (equivMeta?.[1]) return equivMeta[1].trim().toLowerCase();
  } catch {
    // ignore
  }

  return '';
}

function normalizeCharsetLabel(charset: string = ''): string {
  const value = String(charset || '').toLowerCase();
  if (!value) return '';
  if (value === 'latin1') return 'iso-8859-1';
  if (value === 'cp1252' || value === 'windows1252') return 'windows-1252';
  return value;
}

function decodedTextScore(value: string = ''): number {
  const invalid = (value.match(/\uFFFD/g) || []).length;
  const mojibake = (value.match(/Ã.|Â.|â€|â€œ|â€/g) || []).length;
  return (invalid * 10) + mojibake;
}

function decodeWithCharset(bytes: Uint8Array, charset: string): { text: string; score: number } | null {
  try {
    const text = new TextDecoder(charset, { fatal: false }).decode(bytes);
    return {
      text,
      score: decodedTextScore(text)
    };
  } catch {
    return null;
  }
}

export function decodeHttpText(buffer: ArrayBuffer, contentType: string = ''): string {
  const bytes = new Uint8Array(buffer);
  const headerCharset = normalizeCharsetLabel(extractCharsetContentType(contentType));
  const metaCharset = normalizeCharsetLabel(extractCharsetMeta(bytes));
  const candidates = Array.from(new Set([
    headerCharset,
    metaCharset,
    'utf-8',
    'windows-1252',
    'iso-8859-1'
  ].filter(Boolean)));

  const [primaryCharset = 'utf-8', ...fallbacks] = candidates;
  const primary = decodeWithCharset(bytes, primaryCharset);
  if (!primary) {
    return new TextDecoder('utf-8', { fatal: false }).decode(bytes);
  }

  if (primary.score === 0 || fallbacks.length === 0) {
    return primary.text;
  }

  let bestText = primary.text;
  let bestScore = primary.score;

  for (const charset of fallbacks) {
    const decoded = decodeWithCharset(bytes, charset);
    if (!decoded) continue;

    if (decoded.score < bestScore) {
      bestScore = decoded.score;
      bestText = decoded.text;
    }
    if (bestScore === 0) break;
  }

  return bestText || new TextDecoder('utf-8', { fatal: false }).decode(bytes);
}

export interface FetchHtmlResult {
  html: string;
  responseUrl: string;
  wasRedirected: boolean;
  contentType: string;
}

export interface KlassmattErrorInfo {
  isError: boolean;
  errorMessage: string | null;
  errorId: string | null;
}

interface TampermonkeyResponse {
  status: number;
  response: ArrayBuffer;
  responseHeaders?: string;
  finalUrl?: string;
}

interface TampermonkeyRequestDetails {
  method: 'GET';
  url: string;
  responseType: 'arraybuffer';
  timeout: number;
  onload: (response: TampermonkeyResponse) => void;
  onerror: () => void;
  ontimeout: () => void;
  onabort: () => void;
}

interface TampermonkeyRequestHandle {
  abort: () => void;
}

declare const GM_xmlhttpRequest:
  | ((details: TampermonkeyRequestDetails) => TampermonkeyRequestHandle)
  | undefined;

export function detectKlassmattErrorPage(doc: Document): KlassmattErrorInfo {
  const formAction = doc.querySelector('form')?.getAttribute('action') || '';
  if (/Erro\.aspx/i.test(formAction)) {
    const descriptionEl = doc.querySelector('#DivDescricao');
    const descriptionText = descriptionEl?.textContent?.trim() || null;
    const idMatch = descriptionText?.match(/\bID:\s*(\S+)/i);
    return {
      isError: true,
      errorMessage: descriptionText ? descriptionText.slice(0, 500) : 'Pagina de erro do Klassmatt.',
      errorId: idMatch?.[1] || null
    };
  }

  const errorDiv = doc.querySelector('.d-error');
  if (errorDiv) {
    const text = errorDiv.textContent || '';
    if (/ACESSO\s+N[ÃA]O\s+AUTORIZADO|exce[çc][ãa]o\s+durante|exception/i.test(text)) {
      return {
        isError: true,
        errorMessage: text.trim().slice(0, 500),
        errorId: null
      };
    }
  }

  return { isError: false, errorMessage: null, errorId: null };
}

function isAbortError(error: unknown): boolean {
  return getHttpErrorName(error) === 'AbortError';
}

function isHtmlContentType(contentType: string): boolean {
  if (!contentType) return true;
  return /text\/html|application\/xhtml/i.test(contentType);
}

function resolveAbsoluteUrl(rawUrl: string, fallbackUrl: string): URL {
  return new URL(rawUrl || fallbackUrl, fallbackUrl);
}

interface FetchTransportResult {
  response: Response;
  responseUrl: string;
  wasRedirected: boolean;
}

function getAbortError(): HttpRequestError {
  return new HttpRequestError(
    HTTP_ERROR_CODES.ABORTED,
    'The operation was aborted.',
    { name: 'AbortError' }
  );
}

function getTimeoutError(): HttpRequestError {
  return new HttpRequestError(
    HTTP_ERROR_CODES.TIMEOUT,
    'Timeout ao carregar o historico.',
    { name: 'TimeoutError' }
  );
}

function getNetworkError(cause?: unknown): HttpRequestError {
  return new HttpRequestError(
    HTTP_ERROR_CODES.NETWORK,
    'Falha de conexao com o servidor.',
    { cause }
  );
}

function parseTampermonkeyHeaders(rawHeaders: string = ''): Headers {
  const headers = new Headers();

  for (const line of rawHeaders.split(/\r?\n/)) {
    const separator = line.indexOf(':');
    if (separator <= 0) continue;
    headers.append(line.slice(0, separator).trim(), line.slice(separator + 1).trim());
  }

  return headers;
}

function fetchWithTampermonkey(
  requestedUrl: URL,
  signal?: AbortSignal
): Promise<FetchTransportResult> {
  if (signal?.aborted) {
    return Promise.reject(signal.reason ?? getAbortError());
  }

  if (typeof GM_xmlhttpRequest !== 'function') {
    return Promise.reject(getNetworkError());
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    let request: TampermonkeyRequestHandle | null = null;
    let handleAbort = (): void => undefined;

    const cleanup = (): void => {
      signal?.removeEventListener('abort', handleAbort);
    };

    const settle = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      cleanup();
      callback();
    };

    handleAbort = (): void => {
      if (settled) return;
      request?.abort();
      settle(() => reject(signal?.reason ?? getAbortError()));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    try {
      request = GM_xmlhttpRequest({
        method: 'GET',
        url: requestedUrl.toString(),
        responseType: 'arraybuffer',
        timeout: HTTP_TIMEOUT_MS,
        onload: (response) => {
          settle(() => {
            try {
              const responseUrl = response.finalUrl || requestedUrl.toString();
              resolve({
                response: new Response(response.response, {
                  status: response.status,
                  headers: parseTampermonkeyHeaders(response.responseHeaders)
                }),
                responseUrl,
                wasRedirected: responseUrl !== requestedUrl.toString()
              });
            } catch (error) {
              reject(error);
            }
          });
        },
        onerror: () => settle(() => reject(getNetworkError())),
        ontimeout: () => settle(() => reject(getTimeoutError())),
        onabort: () => settle(() => reject(getAbortError()))
      });

      if (signal?.aborted) handleAbort();
    } catch (error) {
      settle(() => reject(error instanceof TypeError ? getNetworkError(error) : error));
    }
  });
}

async function fetchResponse(
  requestedUrl: URL,
  signal?: AbortSignal
): Promise<FetchTransportResult> {
  try {
    const response = await fetch(requestedUrl.toString(), {
      credentials: 'include',
      cache: 'no-store',
      signal
    });

    return {
      response,
      responseUrl: response.url || requestedUrl.toString(),
      wasRedirected: response.redirected
    };
  } catch (error) {
    if (signal?.aborted) throw signal.reason;
    if (isAbortError(error)) throw error;

    const pageOrigin = new URL(window.location.href).origin;
    if (!(error instanceof TypeError)) {
      throw error;
    }

    if (requestedUrl.origin !== pageOrigin) {
      throw getNetworkError(error);
    }

    return fetchWithTampermonkey(requestedUrl, signal);
  }
}

async function readHtml(
  requestedUrl: URL,
  signal: AbortSignal
): Promise<FetchHtmlResult> {
  try {
    const transport = await fetchResponse(requestedUrl, signal);
    const response = transport.response;

    if (!response.ok) {
      throw new HttpRequestError(
        HTTP_ERROR_CODES.HTTP_STATUS,
        `Falha HTTP ${response.status}`,
        { status: response.status }
      );
    }

    const contentType = response.headers.get('content-type') || '';
    if (!isHtmlContentType(contentType)) {
      throw new HttpRequestError(
        HTTP_ERROR_CODES.CONTENT_TYPE,
        `Response inesperado: content-type ${contentType || 'vazio'}`,
        { contentType }
      );
    }

    const responseUrl = resolveAbsoluteUrl(
      transport.responseUrl || requestedUrl.toString(),
      requestedUrl.toString()
    );

    if (responseUrl.origin !== requestedUrl.origin) {
      throw new HttpRequestError(
        HTTP_ERROR_CODES.ORIGIN_BLOCKED,
        'Redirecionamento bloqueado para origem inesperada.',
        { origin: responseUrl.origin }
      );
    }

    const buffer = await response.arrayBuffer();
    const html = decodeHttpText(buffer, contentType);

    return {
      html,
      responseUrl: responseUrl.toString(),
      wasRedirected: transport.wasRedirected || responseUrl.toString() !== requestedUrl.toString(),
      contentType
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    if (error instanceof TypeError) throw getNetworkError(error);
    throw error instanceof Error ? error : createUnknownHttpError(error);
  }
}

export async function fetchHtml(
  url: string,
  signal?: AbortSignal
): Promise<FetchHtmlResult> {
  if (signal?.aborted) throw getAbortError();
  const requestedUrl = resolveAbsoluteUrl(url, window.location.href);
  const controller = new AbortController();
  let rejectDeadline!: (error: Error | DOMException) => void;
  const deadline = new Promise<never>((_, reject) => {
    rejectDeadline = reject;
  });
  const cancel = (error: Error | DOMException): void => {
    if (controller.signal.aborted) return;
    rejectDeadline(error);
    controller.abort(error);
  };
  const handleAbort = (): void => cancel(getAbortError());
  const timeout = window.setTimeout(() => cancel(getTimeoutError()), HTTP_TIMEOUT_MS);
  signal?.addEventListener('abort', handleAbort, { once: true });

  try {
    // Keep the deadline active through the fallback and response body read.
    return await Promise.race([readHtml(requestedUrl, controller.signal), deadline]);
  } finally {
    window.clearTimeout(timeout);
    signal?.removeEventListener('abort', handleAbort);
  }
}
