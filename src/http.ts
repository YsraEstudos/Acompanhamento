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
  return error instanceof Error && error.name === 'AbortError';
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

function isNetworkFetchError(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  return /failed to fetch|networkerror|network request failed/i.test(error.message);
}

function getAbortError(): DOMException {
  return new DOMException('The operation was aborted.', 'AbortError');
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
  if (typeof GM_xmlhttpRequest !== 'function') {
    return Promise.reject(new TypeError('Failed to fetch'));
  }

  if (signal?.aborted) {
    return Promise.reject(getAbortError());
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
      settle(() => reject(getAbortError()));
    };

    signal?.addEventListener('abort', handleAbort, { once: true });

    try {
      request = GM_xmlhttpRequest({
        method: 'GET',
        url: requestedUrl.toString(),
        responseType: 'arraybuffer',
        timeout: 30000,
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
        onerror: () => settle(() => reject(new TypeError('Failed to fetch'))),
        ontimeout: () => settle(() => reject(new Error('Network timeout'))),
        onabort: () => settle(() => reject(getAbortError()))
      });

      if (signal?.aborted) handleAbort();
    } catch (error) {
      settle(() => reject(error));
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
    if (isAbortError(error)) throw error;

    const pageOrigin = new URL(window.location.href).origin;
    if (!isNetworkFetchError(error) || requestedUrl.origin !== pageOrigin) {
      throw error;
    }

    return fetchWithTampermonkey(requestedUrl, signal);
  }
}

export async function fetchHtml(
  url: string,
  signal?: AbortSignal
): Promise<FetchHtmlResult> {
  const requestedUrl = resolveAbsoluteUrl(url, window.location.href);

  try {
    const transport = await fetchResponse(requestedUrl, signal);
    const response = transport.response;

    if (!response.ok) {
      throw new Error(`Falha HTTP ${response.status}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (!isHtmlContentType(contentType)) {
      throw new Error(`Response inesperado: content-type ${contentType || 'vazio'}`);
    }

    const buffer = await response.arrayBuffer();
    const html = decodeHttpText(buffer, contentType);
    const responseUrl = resolveAbsoluteUrl(
      transport.responseUrl || requestedUrl.toString(),
      requestedUrl.toString()
    );

    if (responseUrl.origin !== requestedUrl.origin) {
      throw new Error(`Redirecionamento bloqueado para origem inesperada: ${responseUrl.origin}`);
    }

    return {
      html,
      responseUrl: responseUrl.toString(),
      wasRedirected: transport.wasRedirected || responseUrl.toString() !== requestedUrl.toString(),
      contentType
    };
  } catch (error) {
    if (isAbortError(error)) throw error;
    throw error instanceof Error ? error : new Error(String(error));
  }
}
