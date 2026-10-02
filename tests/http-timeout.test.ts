import { fetchHtml } from '../src/http';

const historyUrl = 'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=209355';
const stalled = () => new Promise<never>(() => {});

function htmlResponse(arrayBuffer: () => Promise<ArrayBuffer>): Response {
  return {
    ok: true,
    headers: new Headers({ 'content-type': 'text/html' }),
    url: historyUrl,
    redirected: false,
    arrayBuffer
  } as Response;
}

describe('HTTP request deadline', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('times out a stalled native fetch without starting the GM fallback', async () => {
    const native = vi.fn((_url: string, _options: RequestInit) => stalled());
    const gm = vi.fn();
    vi.stubGlobal('fetch', native);
    vi.stubGlobal('GM_xmlhttpRequest', gm);
    const result = fetchHtml(historyUrl).catch(error => error);
    await vi.advanceTimersByTimeAsync(29999);
    expect(native.mock.calls).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(await result).toMatchObject({ name: 'TimeoutError', message: expect.stringMatching(/timeout/i) });
    expect(native.mock.calls[0][1].signal?.aborted).toBe(true);
    expect(gm).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('includes body reading in the original 30 second deadline', async () => {
    const body = vi.fn(stalled);
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>(resolve => {
      window.setTimeout(() => resolve(htmlResponse(body)), 20000);
    })));
    const result = fetchHtml(historyUrl).catch(error => error);
    await vi.advanceTimersByTimeAsync(20000);
    expect(body).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('keeps the original deadline when switching to the GM fallback and aborts it', async () => {
    vi.stubGlobal('fetch', vi.fn(() => new Promise<Response>((_, reject) => {
      window.setTimeout(() => reject(new TypeError('Failed to fetch')), 20000);
    })));
    const abort = vi.fn();
    const gm = vi.fn(() => ({ abort }));
    vi.stubGlobal('GM_xmlhttpRequest', gm);
    const result = fetchHtml(historyUrl).catch(error => error);
    await vi.advanceTimersByTimeAsync(20000);
    expect(gm).toHaveBeenCalledOnce();
    await vi.advanceTimersByTimeAsync(10000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('reports a GM timeout using the same timeout error', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    vi.stubGlobal('GM_xmlhttpRequest', vi.fn((details: { ontimeout: () => void }) => {
      queueMicrotask(details.ontimeout);
      return { abort: vi.fn() };
    }));
    await expect(fetchHtml(historyUrl)).rejects.toMatchObject({ name: 'TimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it('preserves timeout when GM abort fires synchronously and ignores late load callbacks', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch'); }));
    let callbacks!: {
      onabort: () => void;
      onload: (response: { status: number; response: ArrayBuffer }) => void;
    };
    const abort = vi.fn(() => callbacks.onabort());
    vi.stubGlobal('GM_xmlhttpRequest', vi.fn((details: typeof callbacks) => {
      callbacks = details;
      return { abort };
    }));
    const result = fetchHtml(historyUrl).catch(error => error);
    await vi.advanceTimersByTimeAsync(30000);
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(abort).toHaveBeenCalledOnce();
    callbacks.onload({ status: 200, response: new ArrayBuffer(0) });
    expect(await result).toMatchObject({ name: 'TimeoutError' });
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(['headers', 'body', 'GM'])('preserves caller cancellation during %s', async (phase) => {
    const abort = vi.fn();
    vi.stubGlobal('GM_xmlhttpRequest', vi.fn(() => ({ abort })));
    vi.stubGlobal('fetch', vi.fn(async () => {
      if (phase === 'GM') throw new TypeError('Failed to fetch');
      return phase === 'body' ? htmlResponse(stalled) : stalled();
    }));
    const controller = new AbortController();
    const result = fetchHtml(historyUrl, controller.signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await result).toMatchObject({ name: 'AbortError' });
    if (phase === 'GM') expect(abort).toHaveBeenCalledOnce();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('does not issue a request for a pre-aborted caller', async () => {
    const native = vi.fn(stalled);
    vi.stubGlobal('fetch', native);
    const controller = new AbortController();
    controller.abort();
    await expect(fetchHtml(historyUrl, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(native).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each([200, 500])('clears its timer and caller listener after HTTP %s', async (status) => {
    const response = htmlResponse(async () => new TextEncoder().encode('<p>ok</p>').buffer);
    vi.stubGlobal('fetch', vi.fn(async () => ({ ...response, ok: status === 200, status })));
    const controller = new AbortController();
    const remove = vi.spyOn(controller.signal, 'removeEventListener');
    const result = await fetchHtml(historyUrl, controller.signal).catch(error => error);
    if (status === 200) expect(result.html).toBe('<p>ok</p>');
    else expect(result.message).toContain('500');
    expect(vi.getTimerCount()).toBe(0);
    expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
  });
});
