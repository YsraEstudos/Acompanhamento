import fs from 'node:fs';
import path from 'node:path';

const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function buildHistoryResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

describe('main bootstrap', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.restoreAllMocks();
    localStorage.clear();
    document.body.innerHTML = '<div id="boot-placeholder"></div>';
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/ITEM_Edita.aspx?IdItem=665709&IdSIN=486905');
  });

  afterEach(() => {
    window.dispatchEvent(new Event('beforeunload'));
  });

  it('retries bootstrap when the Klassmatt item context appears after startup', async () => {
    const fetchMock = vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html')));
    vi.stubGlobal('fetch', fetchMock);

    localStorage.setItem('km_sin_sidebar_settings_v2', JSON.stringify({ alwaysOpen: true, timelineMode: 'yellow-only' }));

    await import('../src/main');

    expect(document.querySelector('.km-sin-layout')).toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(0);

    document.body.innerHTML = readFixture('item.html');
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.km-sin-layout')).not.toBeNull();
    expect(document.querySelector('.km-sin-title')?.textContent).toBe('KM Acompanhamento');
  });

  it('boots the UNSPSC quick field on the classifications tab without opening the SIN panel', async () => {
    document.body.innerHTML = readFixture('item-classificacoes.html');

    await import('../src/main');
    await flush();

    expect(document.querySelector<HTMLInputElement>('[data-role="unspsc-code"]')?.value).toBe('40141607');
    expect(document.querySelector('.km-sin-layout')).toBeNull();
  });

  it('does not boot the quick field when Klassmatt already renders txtCodUNSPSC', async () => {
    document.body.innerHTML = readFixture('item-classificacoes.html');
    const nativeCode = document.createElement('input');
    nativeCode.id = 'txtCodUNSPSC';
    nativeCode.name = 'ctl00$Body$ucTabs$tabCategoriasMulti$txtCodUNSPSC';
    document.querySelector('#unspsc-cell')?.prepend(nativeCode);

    await import('../src/main');
    await flush();

    expect(document.querySelector('#txtCodUNSPSC')).not.toBeNull();
    expect(document.querySelector('[data-km-unspsc-quick="1"]')).toBeNull();
  });
});
