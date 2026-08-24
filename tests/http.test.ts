import fs from 'node:fs';
import path from 'node:path';
import { decodeHttpText, detectKlassmattErrorPage, fetchHtml } from '../src/http';

const fixturesDir = path.resolve(process.cwd(), 'tests', 'fixtures');

function readFixture(name: string): string {
  return fs.readFileSync(path.join(fixturesDir, name), 'utf8');
}

describe('HTTP text decoding', () => {
  it('decodes windows-1252 payloads without mojibake', () => {
    const html = '<meta charset="windows-1252"><body>Solicitação enviada para APROVAÇÃO</body>';
    const buffer = Buffer.from(html, 'latin1');
    const decoded = decodeHttpText(
      buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      'text/html; charset=windows-1252'
    );

    expect(decoded).toContain('Solicitação enviada para APROVAÇÃO');
    expect(decoded).not.toContain('SolicitaÃ§Ã£o');
  });
});

describe('fetchHtml security checks', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('blocks redirected responses that land on another origin', async () => {
    const html = '<form action="/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1"></form>';
    const buffer = new TextEncoder().encode(html);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      url: 'https://attacker.example/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1',
      redirected: true
    }) as unknown as Response));

    await expect(fetchHtml(
      'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1'
    )).rejects.toThrow(/origem inesperada/i);
  });

  it('blocks responses whose final url lands on another origin even without redirected=true', async () => {
    const html = '<form action="/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1"></form>';
    const buffer = new TextEncoder().encode(html);

    vi.stubGlobal('fetch', vi.fn(async () => ({
      ok: true,
      headers: { get: () => 'text/html; charset=utf-8' },
      arrayBuffer: async () => buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength),
      url: 'https://attacker.example/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1',
      redirected: false
    }) as unknown as Response));

    await expect(fetchHtml(
      'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1'
    )).rejects.toThrow(/origem inesperada/i);
  });
});

describe('detectKlassmattErrorPage', () => {
  it('detects the real Klassmatt error page (Erro.aspx with ACESSO NÃO AUTORIZADO)', () => {
    const html = readFixture('error-page.html');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result = detectKlassmattErrorPage(doc);

    expect(result.isError).toBe(true);
    expect(result.errorMessage).toContain('ACESSO');
    expect(result.errorId).toBeTruthy();
  });

  it('does not flag a normal Historico.aspx page as error', () => {
    const html = readFixture('hist-strict.html');
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result = detectKlassmattErrorPage(doc);

    expect(result.isError).toBe(false);
    expect(result.errorMessage).toBeNull();
  });

  it('detects error via d-error div even without Erro.aspx in form action', () => {
    const html = `
      <html><body>
        <form action="./SomePage.aspx"></form>
        <div class="d-error">
          <div>ACESSO NÃO AUTORIZADO À PAGINA</div>
        </div>
      </body></html>
    `;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result = detectKlassmattErrorPage(doc);

    expect(result.isError).toBe(true);
    expect(result.errorMessage).toContain('ACESSO');
  });

  it('ignores d-error with unrelated content', () => {
    const html = `
      <html><body>
        <form action="./Historico.aspx?source=SIN&Id=123"></form>
        <div class="d-error">Some other content</div>
      </body></html>
    `;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result = detectKlassmattErrorPage(doc);

    expect(result.isError).toBe(false);
  });

  it('detects exception message in d-error', () => {
    const html = `
      <html><body>
        <form action="./Page.aspx"></form>
        <div class="d-error">
          Ocorreu uma exceção durante o processamento de sua solicitação!
        </div>
      </body></html>
    `;
    const doc = new DOMParser().parseFromString(html, 'text/html');
    const result = detectKlassmattErrorPage(doc);

    expect(result.isError).toBe(true);
  });
});
