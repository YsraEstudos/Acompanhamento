import { fetchHtml } from '../src/http';

describe('Tampermonkey HTTP fallback', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('uses GM_xmlhttpRequest when native fetch cannot reach same-origin history', async () => {
    const historyUrl = 'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1';
    const html = '<form action="/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1"></form>';
    const encoded = new TextEncoder().encode(html);
    const body = encoded.buffer.slice(encoded.byteOffset, encoded.byteOffset + encoded.byteLength);

    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }));

    const gmRequestMock = vi.fn((details: {
      onload: (response: {
        status: number;
        response: ArrayBuffer;
        responseHeaders: string;
        finalUrl: string;
      }) => void;
    }) => {
      queueMicrotask(() => details.onload({
        status: 200,
        response: body,
        responseHeaders: 'Content-Type: text/html; charset=utf-8',
        finalUrl: historyUrl
      }));
      return { abort: vi.fn() };
    });
    vi.stubGlobal('GM_xmlhttpRequest', gmRequestMock);

    const result = await fetchHtml(historyUrl);

    expect(gmRequestMock).toHaveBeenCalledTimes(1);
    expect(gmRequestMock.mock.calls[0][0]).toMatchObject({
      method: 'GET',
      url: historyUrl,
      responseType: 'arraybuffer'
    });
    expect(result.html).toContain('Id=209355');
    expect(result.responseUrl).toBe(historyUrl);
  });

  it('uses the same-origin fallback for the native TypeError regardless of its message', async () => {
    const historyUrl = 'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1';
    const bytes = new TextEncoder().encode('<form action="/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1"></form>');

    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('browser-specific network wording changed');
    }));
    const gmRequestMock = vi.fn((details: {
      onload: (response: { status: number; response: ArrayBuffer; responseHeaders: string; finalUrl: string }) => void;
    }) => {
      queueMicrotask(() => details.onload({
        status: 200,
        response: bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
        responseHeaders: 'Content-Type: text/html; charset=utf-8',
        finalUrl: historyUrl
      }));
      return { abort: vi.fn() };
    });
    vi.stubGlobal('GM_xmlhttpRequest', gmRequestMock);

    await expect(fetchHtml(historyUrl)).resolves.toMatchObject({ responseUrl: historyUrl });
    expect(gmRequestMock).toHaveBeenCalledOnce();
  });

  it('normalizes GM transport failures to a network error code', async () => {
    const historyUrl = 'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1';

    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx');
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new TypeError('native network wording changed');
    }));
    vi.stubGlobal('GM_xmlhttpRequest', vi.fn((details: { onerror: () => void }) => {
      queueMicrotask(details.onerror);
      return { abort: vi.fn() };
    }));

    await expect(fetchHtml(historyUrl)).rejects.toMatchObject({
      code: 'NETWORK',
      name: 'HttpRequestError'
    });
  });
});
