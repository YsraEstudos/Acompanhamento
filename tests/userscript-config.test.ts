import fs from 'node:fs';
import path from 'node:path';

const viteConfigPath = path.resolve(process.cwd(), 'vite.config.ts');

describe('userscript metadata hardening', () => {
  it('publishes the script as KM Acompanhamento', () => {
    const source = fs.readFileSync(viteConfigPath, 'utf8');

    expect(source).toContain("name: 'KM Acompanhamento'");
  });

  it('limits matches to https Klassmatt item routes', () => {
    const source = fs.readFileSync(viteConfigPath, 'utf8');

    expect(source).toContain("'https://*.klassmatt.com.br/*SIN_Item_Edita.aspx*'");
    expect(source).toContain("'https://*.klassmatt.com.br/*ITEM_Edita.aspx*'");
    expect(source).not.toContain("'*://");
  });

  it('uses stable metadata updates plus immutable release downloads', () => {
    const source = fs.readFileSync(viteConfigPath, 'utf8');

    expect(source).toContain("sin-inline.meta.js");
    expect(source).toContain("releases/${version}/sin-inline.user.js");
  });
});
