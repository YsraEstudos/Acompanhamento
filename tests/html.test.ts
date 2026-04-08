import { sanitizeInlineHtml, sanitizeSnapshotHtml } from '../src/html';

describe('HTML hardening helpers', () => {
  const historyUrl = 'https://demo.klassmatt.com.br/Historico.aspx?source=SIN&Id=209355&SomenteLeitura=1';

  it('keeps only same-origin https anchors in inline html', () => {
    const sanitized = sanitizeInlineHtml(`
      Veja
      <a href="https://demo.klassmatt.com.br/ITEM_Edita.aspx?IdItem=1">interno</a>,
      <a href="https://attacker.example/phish">externo</a>
      e <a href="javascript:alert(1)">js</a>.
    `, historyUrl);

    const doc = new DOMParser().parseFromString(`<div>${sanitized}</div>`, 'text/html');
    const anchors = Array.from(doc.querySelectorAll('a'));

    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe('https://demo.klassmatt.com.br/ITEM_Edita.aspx?IdItem=1');
    expect(doc.body.textContent).toContain('externo');
    expect(sanitized).not.toContain('attacker.example');
    expect(sanitized).not.toContain('javascript:');
  });

  it('removes active content and external links from snapshot html', () => {
    const sanitized = sanitizeSnapshotHtml(`
      <form action="/Historico.aspx"><input value="abc"></form>
      <script>alert(1)</script>
      <img src="https://attacker.example/pixel.png">
      <div>
        <a href="https://attacker.example/phish">externo</a>
        <a href="/ITEM_Edita.aspx?IdItem=77">interno</a>
      </div>
    `, historyUrl);

    const doc = new DOMParser().parseFromString(`<div>${sanitized}</div>`, 'text/html');
    const anchors = Array.from(doc.querySelectorAll('a'));

    expect(sanitized).not.toContain('<script');
    expect(sanitized).not.toContain('<form');
    expect(sanitized).not.toContain('<img');
    expect(anchors).toHaveLength(1);
    expect(anchors[0].href).toBe('https://demo.klassmatt.com.br/ITEM_Edita.aspx?IdItem=77');
    expect(doc.body.textContent).toContain('externo');
  });

  it('strips additional active snapshot vectors like refresh, stylesheets and embeds', () => {
    const sanitized = sanitizeSnapshotHtml(`
      <meta http-equiv="refresh" content="0;url=https://attacker.example/phish">
      <link rel="stylesheet" href="https://attacker.example/style.css">
      <iframe src="https://attacker.example/frame"></iframe>
      <object data="https://attacker.example/file"></object>
      <embed src="https://attacker.example/embed">
      <p>conteudo seguro</p>
    `, historyUrl);

    expect(sanitized).not.toContain('http-equiv="refresh"');
    expect(sanitized).not.toContain('<link');
    expect(sanitized).not.toContain('<iframe');
    expect(sanitized).not.toContain('<object');
    expect(sanitized).not.toContain('<embed');
    expect(sanitized).toContain('conteudo seguro');
  });
});
