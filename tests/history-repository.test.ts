import fs from 'node:fs';
import { classifyErrorForUser, HistoryRepository, type HistoryRequestContext } from '../src/history-repository';
import { extractHistoryIdentityFromUrl } from '../src/history-identity';

const history = fs.readFileSync('tests/fixtures/hist-strict.html', 'utf8');

function context(sinId = '209355', token = ''): HistoryRequestContext {
  const historyUrl = `https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=${sinId}&SomenteLeitura=1${token ? `&k=${token}` : ''}`;
  return { itemId: null, historyUrl, historyIdentity: extractHistoryIdentityFromUrl(historyUrl) };
}

function installHistoryFetch() {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const id = new URL(String(input)).searchParams.get('Id')!;
    return new Response(history.replaceAll('209355', id), { headers: { 'content-type': 'text/html' } });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

describe('HistoryRepository', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('reuses completed results and keeps only the five most recently used histories', async () => {
    const fetchMock = installHistoryFetch();
    const repository = new HistoryRepository();
    for (let id = 209355; id < 209360; id++) {
      expect((await repository.get(context(String(id)))).mode).toBe('parsed');
    }
    await repository.get(context('209355'));
    expect(fetchMock).toHaveBeenCalledTimes(5);
    await repository.get(context('209360'));
    await repository.get(context('209355'));
    expect(fetchMock).toHaveBeenCalledTimes(6);
    await repository.get(context('209356'));
    expect(fetchMock).toHaveBeenCalledTimes(7);
  });

  it('deduplicates in-flight requests and refreshes when forced', async () => {
    const fetchMock = installHistoryFetch();
    const repository = new HistoryRepository();
    const first = repository.get(context());
    const second = repository.get(context());
    expect(await first).toBe(await second);
    expect(fetchMock).toHaveBeenCalledOnce();
    await repository.get(context(), true);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('does not reuse a cache entry when the native link token changes', async () => {
    const fetchMock = installHistoryFetch();
    const repository = new HistoryRepository();
    await repository.get(context());
    await repository.get(context('209355', 'new-token'));
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('blocks untrusted URLs without fetching', async () => {
    const fetchMock = installHistoryFetch();
    const repository = new HistoryRepository();
    const result = await repository.get({ ...context(), historyUrl: 'https://attacker.example/Historico.aspx?Id=209355' });
    expect(result.mode).toBe('blocked');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps the timeout diagnostic available to the panel', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => {
      const error = new Error('Timeout ao carregar o historico.');
      error.name = 'TimeoutError';
      throw error;
    }));
    const result = await new HistoryRepository().get(context());
    expect(result.mode).toBe('iframe');
    expect(result.diagnostic).toContain('demorou demais');
  });

  it.each([
    ['HTTP_STATUS', 401, 'mensagem HTTP mudou'],
    ['HTTP_STATUS', 503, 'mensagem HTTP mudou'],
    ['NETWORK', undefined, 'mensagem de rede mudou'],
    ['TIMEOUT', undefined, 'mensagem de timeout mudou'],
    ['CONTENT_TYPE', undefined, 'mensagem de content type mudou'],
    ['ORIGIN_BLOCKED', undefined, 'mensagem de origem mudou']
  ] as const)('classifies %s from stable metadata instead of its message', async (code, status, message) => {
    const error = new Error(message) as Error & { code: string; status?: number };
    error.code = code;
    if (status !== undefined) error.status = status;
    if (code === 'TIMEOUT') error.name = 'TimeoutError';
    if (code === 'NETWORK') error.name = 'TypeError';
    vi.stubGlobal('fetch', vi.fn(async () => { throw error; }));

    const result = await new HistoryRepository().get(context());

    expect(result.mode).toBe(code === 'ORIGIN_BLOCKED' ? 'blocked' : 'iframe');
    if (code === 'HTTP_STATUS' && status === 401) {
      expect(result.diagnostic).toContain('recusou o acesso');
    } else if (code === 'HTTP_STATUS') {
      expect(result.diagnostic).toContain('erro interno');
    } else if (code === 'NETWORK') {
      expect(result.diagnostic).toContain('Falha de conexao');
    } else if (code === 'TIMEOUT') {
      expect(result.diagnostic).toContain('demorou demais');
    } else if (code === 'CONTENT_TYPE') {
      expect(result.diagnostic).toContain('conteudo inesperado');
    } else {
      expect(result.diagnostic).toContain('origem inesperada');
    }
    expect(result.diagnostic).not.toContain(message);
  });

  it('uses a conservative diagnostic for unknown errors', async () => {
    const secret = 'token-value-that-must-not-reach-the-panel';
    vi.stubGlobal('fetch', vi.fn(async () => {
      throw new Error(`unexpected failure at https://attacker.example/?k=${secret}`);
    }));

    const result = await new HistoryRepository().get(context());

    expect(result.diagnostic).toBe('Falha ao buscar ou interpretar o historico.');
    expect(result.diagnostic).not.toContain(secret);
    expect(result.diagnostic).not.toContain('attacker.example');
  });

  it('does not classify an arbitrary TypeError as a network failure', () => {
    const classified = classifyErrorForUser(new TypeError('parser failed after transport completed'));

    expect(classified.diagnostic).toBe('Falha ao buscar ou interpretar o historico.');
  });

  it.each([
    ['TIMEOUT', 'TypeError'],
    ['ORIGIN_BLOCKED', 'TypeError']
  ] as const)('gives code %s precedence over a conflicting name', (code, name) => {
    const error = Object.assign(new Error('message changed'), { code, name });

    const classified = classifyErrorForUser(error);

    if (code === 'TIMEOUT') {
      expect(classified.diagnostic).toContain('demorou demais');
    } else {
      expect(classified.diagnostic).toContain('origem inesperada');
    }
  });

  it('keeps a replacement request deduplicated and cancellable after the old one settles', async () => {
    const signals: AbortSignal[] = [];
    const fetchMock = vi.fn((_input: RequestInfo | URL, options: RequestInit) => {
      signals.push(options.signal!);
      return new Promise<Response>(() => {});
    });
    vi.stubGlobal('fetch', fetchMock);
    const repository = new HistoryRepository();
    const first = repository.get(context()).catch(error => error);
    const replacement = repository.get(context(), true).catch(error => error);
    expect(await first).toMatchObject({ name: 'AbortError' });
    expect(signals[0].aborted).toBe(true);
    const shared = repository.get(context()).catch(error => error);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    repository.abort();
    expect(signals[1].aborted).toBe(true);
    expect(await replacement).toMatchObject({ name: 'AbortError' });
    expect(await shared).toMatchObject({ name: 'AbortError' });
  });
});
