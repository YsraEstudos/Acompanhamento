import fs from 'node:fs';
import path from 'node:path';
import {
  extractHistoryIdentityFromUrl,
  formatHistoryIdentity
} from '../src/history-identity';
import {
  extractHistoryIdentityFromHref,
  extractHistoryUrlFromHref,
  resolvePageContext
} from '../src/url';

const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures');

describe('history URL helpers', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx?IdSIN=209355');
  });

  it('extracts Historico.aspx from OpenWindowsWHR', () => {
    const href = "javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&SomenteLeitura=1&Id=245373', 680, 500, 1);};";
    expect(extractHistoryUrlFromHref(href)).toBe(
      'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&SomenteLeitura=1&Id=245373'
    );
  });

  it('resolves a stable page context from the item page summary block', () => {
    document.body.innerHTML = fs.readFileSync(path.join(fixturesDir, 'item.html'), 'utf8');
    const context = resolvePageContext();

    expect(context.itemId).toBeNull();
    expect(context.sinId).toBe('209355');
    expect(context.isStable).toBe(true);
    expect(context.historyUrl).toBe(
      'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1'
    );
    expect(context.historyIdentity?.id).toBe('209355');
    expect(context.linkEl?.id).toBe('hlkObs');
    expect(context.summaryEl?.id).toBe('DV_Resumo_sin');
  });

  it('does not synthesize Historico.aspx when only the summary label is visible', () => {
    document.body.innerHTML = `
      <div id="UpdatePanel1">
        <div class="kl-view">
          <div id="DV_Resumo_sin">
            <span id="Label_infoSIN"><b>SIN:</b> 998877</span>
          </div>
        </div>
      </div>
    `;

    const context = resolvePageContext();
    expect(context.sinId).toBe('998877');
    expect(context.isStable).toBe(false);
    expect(context.historyIdentity).toBeNull();
    expect(context.historyUrl).toBeNull();
  });

  it('does not use txtNumero as a SIN fallback', () => {
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx');
    document.body.innerHTML = `
      <div id="UpdatePanel1">
        <div class="kl-view">
          <input id="txtNumero" value="254434">
          <div id="DV_Resumo_sin"></div>
        </div>
      </div>
    `;

    const context = resolvePageContext();

    expect(context.itemId).toBe('254434');
    expect(context.sinId).toBeNull();
    expect(context.isStable).toBe(false);
    expect(context.historyUrl).toBeNull();
  });

  it('does not trust the browser URL as a Historico fallback', () => {
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/SIN_Item_Edita.aspx?IdSIN=887766');
    document.body.innerHTML = `
      <div id="UpdatePanel1">
        <div class="kl-view">
          <div id="DV_Resumo_sin"></div>
        </div>
      </div>
    `;

    const context = resolvePageContext();

    expect(context.sinId).toBeNull();
    expect(context.isStable).toBe(false);
    expect(context.historyUrl).toBeNull();
  });

  it('marks the context as unstable when the link and the summary disagree', () => {
    document.body.innerHTML = `
      <div id="UpdatePanel1">
        <div class="kl-view">
          <div id="DV_Resumo_sin">
            <span id="Label_infoSIN"><b>SIN:</b> 222222</span>
            <a id="hlkObs" href="javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&Id=111111&SomenteLeitura=1', 680, 500, 1)}">Acompanhamento</a>
          </div>
        </div>
      </div>
    `;

    const context = resolvePageContext();

    expect(context.sinId).toBe('111111');
    expect(context.historyIdentity?.id).toBe('111111');
    expect(context.isStable).toBe(false);
    expect(context.historyUrl).toBeNull();
  });

  it('preserves the native k token when extracting identity from the acompanhamento link', () => {
    const href = "javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&Id=84429&SomenteLeitura=1&k=75423vt11qxrtyxxcokhwmo5v3l2_1620', 680, 500, 1)}";

    expect(extractHistoryUrlFromHref(href)).toBe(
      'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=84429&SomenteLeitura=1&k=75423vt11qxrtyxxcokhwmo5v3l2_1620'
    );
    expect(extractHistoryIdentityFromHref(href)?.k).toBe('75423vt11qxrtyxxcokhwmo5v3l2_1620');
  });

  it('rejects cross-origin Historico identities', () => {
    const href = "javascript:{OpenWindowsWHR('https://attacker.example/Historico.aspx?source=SIN&Id=84429&SomenteLeitura=1', 680, 500, 1)}";

    expect(extractHistoryUrlFromHref(href)).toBe(
      'https://attacker.example/Historico.aspx?source=SIN&Id=84429&SomenteLeitura=1'
    );
    expect(extractHistoryIdentityFromHref(href)).toBeNull();
    expect(
      extractHistoryIdentityFromUrl('https://attacker.example/Historico.aspx?source=SIN&Id=84429&SomenteLeitura=1')
    ).toBeNull();
  });

  it('redacts the k token in formatted diagnostics', () => {
    const identity = extractHistoryIdentityFromUrl(
      'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=84429&SomenteLeitura=1&k=75423vt11qxrtyxxcokhwmo5v3l2_1620'
    );

    expect(formatHistoryIdentity(identity)).toContain('k=[redacted]');
    expect(formatHistoryIdentity(identity)).not.toContain('75423vt11qxrtyxxcokhwmo5v3l2_1620');
  });

  it('prefers the visible and newest resumo/link when stale copies remain in the DOM', () => {
    document.body.innerHTML = `
      <div id="UpdatePanel1">
        <div class="kl-view" style="display:none">
          <input id="txtNumero" value="300891">
          <div id="DV_Resumo_sin" style="display:none">
            <span id="Label_infoSIN"><b>SIN:</b> 84429</span>
            <a id="hlkObs" href="javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&Id=84429&SomenteLeitura=1', 680, 500, 1)}">Acompanhamento</a>
          </div>
        </div>
        <div class="kl-view">
          <input id="txtNumero" value="300892">
          <div id="DV_Resumo_sin">
            <span id="Label_infoSIN"><b>SIN:</b> 84413</span>
            <a id="hlkObs" href="javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&Id=84413&SomenteLeitura=1', 680, 500, 1)}">Acompanhamento</a>
          </div>
        </div>
      </div>
    `;

    const context = resolvePageContext();

    expect(context.itemId).toBe('300892');
    expect(context.sinId).toBe('84413');
    expect(context.historyIdentity?.id).toBe('84413');
    expect(context.historyUrl).toContain('Id=84413');
  });

  it('prefers the current item root even when an older visible root still exposes a stale link', () => {
    window.history.replaceState({}, '', 'https://demo.klassmatt.com.br/ITEM_Edita.aspx?IdItem=300892&IdSIN=84413');
    document.body.innerHTML = `
      <div id="UpdatePanel1">
        <div class="kl-view">
          <input id="txtNumero" value="300891">
          <div id="DV_Resumo_sin">
            <span id="Label_infoSIN"><b>SIN:</b> 84429</span>
            <a id="hlkObs" href="javascript:{OpenWindowsWHR('Historico.aspx?source=SIN&Id=84429&SomenteLeitura=1', 680, 500, 1)}">Acompanhamento</a>
          </div>
        </div>
        <div class="kl-view">
          <input id="txtNumero" value="300892">
          <div id="DV_Resumo_sin">
            <span id="Label_infoSIN"><b>SIN:</b> 84413</span>
          </div>
        </div>
      </div>
    `;

    const context = resolvePageContext();

    expect(context.itemId).toBe('300892');
    expect(context.sinId).toBe('84413');
    expect(context.summarySinId).toBe('84413');
    expect(context.historyIdentity).toBeNull();
    expect(context.historyUrl).toBeNull();
    expect(context.isStable).toBe(false);
  });
});
