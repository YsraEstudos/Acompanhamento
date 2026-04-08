import fs from 'node:fs';
import path from 'node:path';
import { SinSidebarApp } from '../src/app';
import { loadSettings, SETTINGS_KEY, type SinPanelSettings } from '../src/state';

const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

function setSettings(settings: SinPanelSettings): void {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

function buildItemPage(options: {
  sinId?: string;
  itemId?: string;
  includeLink?: boolean;
  includeLabel?: boolean;
  historyToken?: string;
  historyHref?: string;
} = {}): string {
  const {
    sinId = '209355',
    itemId,
    includeLink = true,
    includeLabel = true,
    historyToken,
    historyHref
  } = options;

  const summaryParts: string[] = [];
  if (includeLabel) {
    summaryParts.push(`<span id="Label_infoSIN"><b>SIN:</b> ${sinId} <b>Solicitante:</b> TESTE</span>`);
  }
  if (includeLink) {
    const tokenQuery = historyToken ? `&amp;k=${historyToken}` : '';
    const href = historyHref
      ? historyHref
      : `javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&amp;Id=${sinId}&amp;SomenteLeitura=1${tokenQuery}', 680, 500, 1)}`;
    summaryParts.push(
      `<a id="hlkObs" class="txt-hyperlink" href="${href}">Acompanhamento</a>`
    );
  }

  return `
    <form id="aspnetForm">
      <div id="UpdatePanel1">
        <div class="kl-view">
          ${itemId ? `<input id="txtNumero" value="${itemId}">` : ''}
          <div id="DV_Resumo_sin" class="DV_Resumo_sin">
            <div class="DV-info-sup">
              <div class="dv-info-sup-esq">
                ${includeLabel ? summaryParts[0] : ''}
              </div>
              <div class="dv-info-sup-dir">
                ${includeLink ? summaryParts[includeLabel ? 1 : 0] : ''}
              </div>
            </div>
            <div class="dv-info-sin">
              <span id="Label_Ajuda">Item de teste Klassmatt</span>
            </div>
          </div>
        </div>
      </div>
    </form>
  `;
}

function wrapHistoryHtml(body: string, query: string = 'source=SIN&Id=209355&SomenteLeitura=1'): string {
  return `
    <form action="./Historico.aspx?${query}">
      ${body}
    </form>
  `;
}

function buildHistoryResponse(body: string): Response {
  return new Response(body, {
    status: 200,
    headers: { 'content-type': 'text/html; charset=utf-8' }
  });
}

function dispatchSettingsStorageEvent(previousValue: string | null, nextValue: string): void {
  const event = new Event('storage');
  Object.defineProperties(event, {
    key: { value: SETTINGS_KEY },
    oldValue: { value: previousValue },
    newValue: { value: nextValue },
    storageArea: { value: localStorage },
    url: { value: window.location.href }
  });
  window.dispatchEvent(event);
}

function buildLargeHistory(total: number): string {
  const rows = Array.from({ length: total }, (_, index) => `
    <div class="row"><a id="hlinkUsuario">USR.${String(index + 1).padStart(3, '0')}*</a></div>
    <div class="row result">
      <span id="lblHora">${String(8 + Math.floor(index / 6)).padStart(2, '0')}:${String((index % 6) * 10).padStart(2, '0')}:00</span>
      <span id="lblDescricao">
        Solicitação enviada para ETAPA-${index + 1}
        ${index % 4 === 0 ? `<br><span style="background-color: yellow">Nota amarela ${index + 1}</span>` : ''}
      </span>
    </div>
  `).join('');

  return wrapHistoryHtml(`
    <fieldset class="hist-fieldset">
      <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
      ${rows}
    </fieldset>
  `);
}

const noYellowHistory = wrapHistoryHtml(`
  <fieldset class="hist-fieldset">
    <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
    <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
    <div class="row result">
      <span id="lblHora">10:00:00</span>
      <span id="lblDescricao">Solicitacao enviada para FISCAL-INTEGRA</span>
    </div>
  </fieldset>
`);

const mixedHistory = wrapHistoryHtml(`
  <fieldset class="hist-fieldset">
    <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
    <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
    <div class="row result">
      <span id="lblHora">10:00:00</span>
      <span id="lblDescricao">Solicitacao enviada para FISCAL-INTEGRA</span>
    </div>
    <div class="row"><a id="hlinkUsuario">BIA.TESTE*</a></div>
    <div class="row result">
      <span id="lblHora">10:05:00</span>
      <span id="lblDescricao">
        Solicitacao enviada para REAVALIACAO-CATALOG
        <br>
        <span style="background-color: yellow">Revisar NCM 99887766</span>
      </span>
    </div>
  </fieldset>
`);

async function flush(): Promise<void> {
  await Promise.resolve();
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

async function initApp(options?: ConstructorParameters<typeof SinSidebarApp>[0]): Promise<SinSidebarApp> {
  const app = new SinSidebarApp(options);
  app.init();
  await flush();
  return app;
}

describe('SinSidebarApp', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = readFixture('item.html');
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx?IdSIN=209355');
    vi.restoreAllMocks();
    vi.useRealTimers();
    delete (globalThis as any).Sys;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as any).Sys;
  });

  it('starts open on a clean install with yellow-only mode already active', async () => {
    const fetchMock = vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html')));
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.km-sin-layout')).not.toBeNull();
    expect(document.querySelector('.km-sin-title')?.textContent).toBe('KM Acompanhamento');
    expect(document.querySelector<HTMLButtonElement>('[data-role="mode"]')?.textContent).toBe('Amarelos');
    expect(loadSettings()).toEqual({ alwaysOpen: true, timelineMode: 'yellow-only' });
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(1);
    app.destroy();
  });

  it('opens the panel automatically when always-open is enabled', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html')));
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.km-sin-layout')).not.toBeNull();
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('[data-role="mode"]')?.textContent).toBe('Tudo');
    app.destroy();
  });

  it('keeps the panel lightweight while closed after ASP.NET endRequest', async () => {
    vi.useFakeTimers();

    let endRequestHandler: (() => void) | null = null;
    const manager = {
      add_endRequest: vi.fn((fn: () => void) => {
        endRequestHandler = fn;
      }),
      remove_endRequest: vi.fn()
    };

    (globalThis as any).Sys = {
      WebForms: {
        PageRequestManager: {
          getInstance: () => manager
        }
      }
    };

    setSettings({ alwaysOpen: false, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html')));
    vi.stubGlobal('fetch', fetchMock);

    const app = new SinSidebarApp();
    app.init();
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(document.querySelector('.km-sin-layout')).toBeNull();

    document.body.innerHTML = buildItemPage({ sinId: '209356' });
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx?IdSIN=209356');

    expect(endRequestHandler).not.toBeNull();
    (endRequestHandler as unknown as () => void)();
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(document.querySelector('.km-sin-layout')).toBeNull();
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    app.destroy();
  });

  it('keeps the panel closed when always-open is disabled', async () => {
    setSettings({ alwaysOpen: false, timelineMode: 'all' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('Id=209356')) {
        return buildHistoryResponse(wrapHistoryHtml(`
          <fieldset class="hist-fieldset">
            <legend class="hist-legend">sexta-feira, 13 de fevereiro de 2026</legend>
            <div class="row"><a id="hlinkUsuario">BIA.TESTE*</a></div>
            <div class="row result">
              <span id="lblHora">11:00:00</span>
              <span id="lblDescricao">Solicitacao enviada para FISCAL-INTEGRA</span>
            </div>
          </fieldset>
        `, 'source=SIN&Id=209356&SomenteLeitura=1'));
      }

      return buildHistoryResponse(readFixture('hist-strict.html'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(document.querySelector('.km-sin-layout')).toBeNull();
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    expect(loadSettings()).toEqual({ alwaysOpen: false, timelineMode: 'all' });

    document.body.innerHTML = buildItemPage({ sinId: '209356' });
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx?IdSIN=209356');
    await app.hydrate(true);

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(document.querySelector('.km-sin-layout')).toBeNull();
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    app.destroy();
  });

  it('refreshes the open panel after ASP.NET endRequest', async () => {
    vi.useFakeTimers();

    let endRequestHandler: (() => void) | null = null;
    const manager = {
      add_endRequest: vi.fn((fn: () => void) => {
        endRequestHandler = fn;
      }),
      remove_endRequest: vi.fn()
    };

    (globalThis as any).Sys = {
      WebForms: {
        PageRequestManager: {
          getInstance: () => manager
        }
      }
    };

    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes('Id=209356')) {
        return buildHistoryResponse(wrapHistoryHtml(`
          <fieldset class="hist-fieldset">
            <legend class="hist-legend">sexta-feira, 13 de fevereiro de 2026</legend>
            <div class="row"><a id="hlinkUsuario">BIA.TESTE*</a></div>
            <div class="row result">
              <span id="lblHora">11:00:00</span>
              <span id="lblDescricao">
                Solicitacao enviada para FISCAL-INTEGRA
                <br>
                <span style="background-color: yellow">Revisar NCM 99887766</span>
              </span>
            </div>
          </fieldset>
        `, 'source=SIN&Id=209356&SomenteLeitura=1'));
      }

      return buildHistoryResponse(readFixture('hist-strict.html'));
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = new SinSidebarApp();
    app.init();
    await vi.advanceTimersByTimeAsync(500);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(1);

    document.body.innerHTML = buildItemPage({ sinId: '209356' });
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx?IdSIN=209356');

    expect(endRequestHandler).not.toBeNull();
    (endRequestHandler as unknown as () => void)();
    await vi.advanceTimersByTimeAsync(150);
    await flushMicrotasks();

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector('.km-sin-meta')?.textContent).toContain('SIN 209356');
    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(1);
    app.destroy();
  });

  it('persists the always-open preference together with the timeline mode', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => buildHistoryResponse(mixedHistory));
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });

    const modeButton = document.querySelector<HTMLButtonElement>('[data-role="mode"]');
    modeButton?.click();
    await flush();

    expect(loadSettings()).toEqual({ alwaysOpen: true, timelineMode: 'yellow-only' });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')).toEqual({
      alwaysOpen: true,
      timelineMode: 'yellow-only'
    });

    app.destroy();

    const secondApp = await initApp({ hookAspNet: false });
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(document.querySelector<HTMLButtonElement>('[data-role="mode"]')?.textContent).toBe('Amarelos');
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    secondApp.destroy();
  });

  it('syncs the timeline mode across tabs while open', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(mixedHistory)));

    const app = await initApp({ hookAspNet: false });

    const modeButton = document.querySelector<HTMLButtonElement>('[data-role="mode"]');
    expect(modeButton?.textContent).toBe('Tudo');
    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(2);

    const allSettings = JSON.stringify({ alwaysOpen: true, timelineMode: 'all' });
    const yellowSettings = JSON.stringify({ alwaysOpen: true, timelineMode: 'yellow-only' });

    localStorage.setItem(SETTINGS_KEY, yellowSettings);
    dispatchSettingsStorageEvent(allSettings, yellowSettings);
    await flush();

    expect(modeButton?.textContent).toBe('Amarelos');
    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(1);

    localStorage.setItem(SETTINGS_KEY, allSettings);
    dispatchSettingsStorageEvent(yellowSettings, allSettings);
    await flush();

    expect(modeButton?.textContent).toBe('Tudo');
    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(2);
    app.destroy();
  });

  it('opens the panel when always-open is enabled from another tab', async () => {
    setSettings({ alwaysOpen: false, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html')));
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });
    expect(fetchMock).toHaveBeenCalledTimes(0);

    const previousValue = JSON.stringify({ alwaysOpen: false, timelineMode: 'all' });
    const nextValue = JSON.stringify({ alwaysOpen: true, timelineMode: 'all' });
    localStorage.setItem(SETTINGS_KEY, nextValue);
    dispatchSettingsStorageEvent(previousValue, nextValue);
    await flush();
    await flush();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.km-sin-layout')).not.toBeNull();
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    app.destroy();
  });

  it('closes the panel when always-open is disabled from another tab', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html'))));

    const app = await initApp({ hookAspNet: false });
    expect(document.querySelector('.km-sin-aside')?.hasAttribute('hidden')).toBe(false);

    const previousValue = JSON.stringify({ alwaysOpen: true, timelineMode: 'all' });
    const nextValue = JSON.stringify({ alwaysOpen: false, timelineMode: 'all' });
    localStorage.setItem(SETTINGS_KEY, nextValue);
    dispatchSettingsStorageEvent(previousValue, nextValue);
    await flush();

    expect(document.querySelector('.km-sin-aside')?.hasAttribute('hidden')).toBe(true);
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    app.destroy();
  });

  it('shows iframe fallback only after explicit user action when the fetch fails', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.km-sin-frame')).toBeNull();
    expect(document.querySelector<HTMLButtonElement>('[data-act="load-fallback"]')).not.toBeNull();

    document.querySelector<HTMLButtonElement>('[data-act="load-fallback"]')?.click();
    await flush();

    const iframe = document.querySelector<HTMLIFrameElement>('.km-sin-frame');
    expect(iframe).not.toBeNull();
    expect(iframe?.srcdoc).toContain('Nenhum snapshot seguro estava disponivel para este historico.');
    expect(iframe?.srcdoc).toContain('Abrir historico nativo em nova aba');
    expect(iframe?.srcdoc).not.toContain('<script');
    app.destroy();
  });

  it('renders the inline iframe fallback without fetching again', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html')));
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    document.querySelector<HTMLButtonElement>('[data-role="inline"]')?.click();
    await flush();

    const iframe = document.querySelector<HTMLIFrameElement>('.km-sin-frame');
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(iframe).not.toBeNull();
    expect(iframe?.getAttribute('sandbox')).toBe('');
    expect(iframe?.referrerPolicy).toBe('no-referrer');
    expect(iframe?.getAttribute('data-darkreader-ignore')).toBe('');
    expect(iframe?.srcdoc).toContain('meta name="darkreader-lock"');
    expect(iframe?.srcdoc).toContain('Visualizacao segura em modo somente leitura');
    expect(iframe?.srcdoc).not.toContain('<base ');
    expect(iframe?.srcdoc).not.toContain('<script');
    app.destroy();
  });

  it('sanitizes active content before rendering the inline secure snapshot', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(wrapHistoryHtml(`
      <meta http-equiv="refresh" content="0;url=https://attacker.example">
      <link rel="stylesheet" href="https://attacker.example/style.css">
      <fieldset class="hist-fieldset">
        <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
        <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
        <div class="row result">
          <span id="lblHora">10:00:00</span>
          <span id="lblDescricao">Solicitacao enviada para FISCAL-INTEGRA</span>
        </div>
      </fieldset>
      <iframe src="https://attacker.example/frame"></iframe>
      <object data="https://attacker.example/file"></object>
      <embed src="https://attacker.example/embed">
    `))));

    const app = await initApp({ hookAspNet: false });

    document.querySelector<HTMLButtonElement>('[data-role="inline"]')?.click();
    await flush();

    const iframe = document.querySelector<HTMLIFrameElement>('.km-sin-frame');
    expect(iframe?.srcdoc).not.toContain('http-equiv="refresh"');
    expect(iframe?.srcdoc).not.toContain('<link');
    expect(iframe?.srcdoc).not.toContain('<iframe');
    expect(iframe?.srcdoc).not.toContain('<object');
    expect(iframe?.srcdoc).not.toContain('<embed');
    app.destroy();
  });

  it('keeps unsafe history links as inert text in the rendered app timeline', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(wrapHistoryHtml(`
      <fieldset class="hist-fieldset">
        <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
        <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
        <div class="row result">
          <span id="lblHora">10:00:00</span>
          <span id="lblDescricao">
            Veja
            <a href="https://attacker.example/phish">externo</a>
            e
            <a href="/ITEM_Edita.aspx?IdItem=77">interno</a>
          </span>
        </div>
      </fieldset>
    `))));

    const app = await initApp({ hookAspNet: false });

    const anchors = Array.from(document.querySelectorAll<HTMLAnchorElement>('.km-sin-desc a'));
    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe('https://demo.klassmatt.com.br/ITEM_Edita.aspx?IdItem=77');
    expect(document.querySelector('.km-sin-desc')?.textContent).toContain('externo');
    expect(document.querySelector('.km-sin-desc')?.innerHTML).not.toContain('attacker.example');
    app.destroy();
  });

  it('does not fetch or render cross-origin Historico links', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html')));
    vi.stubGlobal('fetch', fetchMock);

    document.body.innerHTML = buildItemPage({
      sinId: '209355',
      historyHref: "javascript:{OpenWindowsWHR('https://attacker.example/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1', 680, 500, 1)}"
    });

    const app = await initApp({ hookAspNet: false });

    expect(fetchMock).toHaveBeenCalledTimes(0);
    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(0);
    expect(document.querySelector('.km-sin-frame')).toBeNull();
    app.destroy();
  });

  it('blocks redirected cross-origin history responses before parsing them', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const html = wrapHistoryHtml(`
      <fieldset class="hist-fieldset">
        <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
        <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
        <div class="row result">
          <span id="lblHora">10:00:00</span>
          <span id="lblDescricao">Solicitacao enviada para FISCAL-INTEGRA</span>
        </div>
      </fieldset>
    `);
    const bytes = new TextEncoder().encode(html);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: async () => bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
      url: 'https://attacker.example/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1',
      redirected: true
    }) as Response));

    const app = await initApp({ hookAspNet: false });

    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(0);
    expect(document.querySelector('.km-sin-state')?.textContent).toContain('bloqueado por seguranca');
    expect(document.querySelector<HTMLButtonElement>('[data-act="load-fallback"]')).not.toBeNull();
    app.destroy();
  });

  it('uses only the strict parser in the normal runtime path', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(readFixture('hist-loose.html'))));

    const app = await initApp({ hookAspNet: false });

    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(0);
    expect(document.querySelector('.km-sin-state')?.textContent).toContain('bloqueado');
    expect(document.querySelector<HTMLButtonElement>('[data-act="load-fallback"]')).not.toBeNull();
    app.destroy();
  });

  it('renders large timelines in batches and loads more on demand', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(buildLargeHistory(40))));

    const app = await initApp({ hookAspNet: false });

    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(30);
    const loadMoreButton = document.querySelector<HTMLButtonElement>('[data-act="load-more"]');
    expect(loadMoreButton).not.toBeNull();

    loadMoreButton?.click();
    await flush();
    await flush();

    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(40);
    expect(document.querySelector('[data-act="load-more"]')).toBeNull();
    app.destroy();
  });

  it('does not render a page toggle when the panel is controlled globally', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(readFixture('hist-strict.html'))));

    const app = await initApp({ hookAspNet: false });

    expect(document.querySelector('.km-sin-layout')).not.toBeNull();
    expect(document.querySelector('.km-sin-toggle')).toBeNull();

    document.body.innerHTML = buildItemPage({ sinId: '209356' });
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx?IdSIN=209356');
    await app.hydrate(true);

    expect(document.querySelector('.km-sin-layout')).not.toBeNull();
    expect(document.querySelector('.km-sin-toggle')).toBeNull();
    app.destroy();
  });

  it('does not auto retry network errors', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    });
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.km-sin-state')?.textContent).toContain('Formato nao reconhecido');
    app.destroy();
  });

  it('does not attempt token refresh in background when the session is unauthorized', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const fetchMock = vi.fn(async () => buildHistoryResponse(readFixture('error-page.html')));
    vi.stubGlobal('fetch', fetchMock);

    const app = await initApp({ hookAspNet: false });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(document.querySelector('.km-sin-state')?.textContent).toContain('Sessao expirada');
    expect(document.querySelector('.km-sin-empty')?.textContent).toMatch(/F5|feche e abra/i);
    app.destroy();
  });

  it('keeps k redacted in blocked diagnostics', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    const k = '75423vt11qxrtyxxcokhwmo5v3l2_1620';
    document.body.innerHTML = buildItemPage({ sinId: '84429', historyToken: k });
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx?IdSIN=84429');

    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(wrapHistoryHtml(`
      <fieldset class="hist-fieldset">
        <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
        <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
        <div class="row result">
          <span id="lblHora">10:00:00</span>
          <span id="lblDescricao">Solicitacao enviada para FISCAL-INTEGRA</span>
        </div>
      </fieldset>
    `, `source=SIN&Id=999999&SomenteLeitura=1&k=${k}`))));

    const app = await initApp({ hookAspNet: false });

    const bannerText = document.querySelector('.km-sin-banner')?.textContent || '';
    expect(bannerText).toContain('k=[redacted]');
    expect(bannerText).not.toContain(k);
    app.destroy();
  });

  it('renders all events when the history has no yellow comments', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(noYellowHistory)));

    const app = await initApp({ hookAspNet: false });

    expect(document.querySelectorAll('.km-sin-item')).toHaveLength(1);
    expect(document.querySelector('.km-sin-empty')).toBeNull();
    app.destroy();
  });

  it('highlights NBS mentions in red in the rendered timeline', async () => {
    setSettings({ alwaysOpen: true, timelineMode: 'all' });
    vi.stubGlobal('fetch', vi.fn(async () => buildHistoryResponse(wrapHistoryHtml(`
      <fieldset class="hist-fieldset">
        <legend class="hist-legend">quinta-feira, 12 de fevereiro de 2026</legend>
        <div class="row"><a id="hlinkUsuario">ANA.TESTE*</a></div>
        <div class="row result">
          <span id="lblHora">10:00:00</span>
          <span id="lblDescricao">Validar NBS 12345678 antes da aprovacao</span>
        </div>
      </fieldset>
    `))));

    const app = await initApp({ hookAspNet: false });

    expect(document.querySelectorAll('.km-sin-item.is-attention')).toHaveLength(1);
    expect(document.querySelector('.km-sin-attention-chip')?.textContent).toBe('Destaque');
    expect(document.querySelector('.km-sin-desc')?.textContent).toContain('NBS 12345678');
    app.destroy();
  });
});
