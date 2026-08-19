import fs from 'node:fs';
import path from 'node:path';
import {
  normalizeUnspscCode,
  UnspscQuickFillApp
} from '../src/unspsc-quick-fill';

const fixturePath = path.resolve(process.cwd(), 'tests', 'fixtures', 'item-classificacoes.html');

function readFixture(): string {
  return fs.readFileSync(fixturePath, 'utf8');
}

function buildModal(resultCode = '27112104', description = 'Drill bits'): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.id = 'unspsc-modal-host';
  wrapper.innerHTML = `
    <table id="tableUNSPSC">
      <tbody>
        <tr>
          <td>
            <input type="button" name="ctl00$Body$ucTabs$SelecionaUNSPSC1$butPesquisar" id="butPesquisar" value="Pesquisar">
            <input name="ctl00$Body$ucTabs$SelecionaUNSPSC1$txtCodigoUnspsc" id="txtCodigoUnspsc">
          </td>
        </tr>
        <tr>
          <td><div id="divUNSPSC"></div></td>
        </tr>
        <tr>
          <td>
            <input type="button" name="ctl00$Body$ucTabs$SelecionaUNSPSC1$butFechar" id="butFechar" value="Selecionar">
            <input type="button" name="ctl00$Body$ucTabs$SelecionaUNSPSC1$butCancelar" id="butCancelar" value="Cancelar">
          </td>
        </tr>
      </tbody>
    </table>
  `;

  const search = wrapper.querySelector<HTMLInputElement>('#butPesquisar')!;
  search.addEventListener('click', () => {
    window.setTimeout(() => {
      const current = wrapper.querySelector<HTMLElement>('#divUNSPSC');
      const replacement = document.createElement('div');
      replacement.id = 'divUNSPSC';
      const requestedCode = wrapper.querySelector<HTMLInputElement>('#txtCodigoUnspsc')?.value;
      replacement.innerHTML = requestedCode === resultCode
        ? `<table id="dgUNSPSC"><tbody><tr><td><input type="button" name="ctl00$Body$ucTabs$SelecionaUNSPSC1$dgUNSPSC$ctl02$ckSelUNSPSC"></td><td><a id="lbCodigo">${resultCode}</a></td><td><a id="txtDescricao">${description}</a></td></tr></tbody></table>`
        : '<table id="dgUNSPSC"><tbody><tr><td>Nenhum resultado</td></tr></tbody></table>';
      current?.replaceWith(replacement);

      const select = replacement.querySelector<HTMLInputElement>('input[name$="$ckSelUNSPSC"]');
      select?.addEventListener('click', () => {
        window.setTimeout(() => {
          replacement.dataset.selectedCode = resultCode;
          replacement.replaceWith(replacement.cloneNode(true));
        }, 0);
      });
    }, 0);
  });

  const close = wrapper.querySelector<HTMLInputElement>('#butFechar')!;
  close.addEventListener('click', () => {
    window.setTimeout(() => {
      const code = resultCode;
      document.querySelector<HTMLInputElement>('#txtUNSPSC')!.value = `${code}. ${description}`;
      document.querySelector<HTMLInputElement>('#txtUNSPSCSegmento')!.value = `${code.slice(0, 2)}000000. Segment`;
      document.querySelector<HTMLInputElement>('#txtUNSPSCFamilia')!.value = `${code.slice(0, 4)}0000. Family`;
      document.querySelector<HTMLInputElement>('#txtUNSPSCClasse')!.value = `${code.slice(0, 6)}00. Class`;
      document.querySelector<HTMLInputElement>('#txtUNSPSCMercadoria')!.value = `${code}. ${description}`;
      wrapper.remove();
    }, 0);
  });

  wrapper.querySelector<HTMLInputElement>('#butCancelar')?.addEventListener('click', () => {
    window.setTimeout(() => wrapper.remove(), 0);
  });

  return wrapper;
}

async function flush(ms = 0): Promise<void> {
  await new Promise((resolve) => window.setTimeout(resolve, ms));
  await Promise.resolve();
}

function installModalOnLookup(resultCode = '27112104'): HTMLInputElement {
  const lookup = document.querySelector<HTMLInputElement>('#ibutUNSPSC')!;
  lookup.addEventListener('click', (event) => {
    event.preventDefault();
    window.setTimeout(() => document.body.appendChild(buildModal(resultCode)), 0);
  });
  return lookup;
}

function addNativeCodeInput(): void {
  const firstRow = document.querySelector<HTMLTableRowElement>('#unspsc-cell')?.closest('tr');
  const row = document.createElement('tr');
  row.innerHTML = `
    <td><span id="lblCodUNSPSC">Código UNSPSC:</span></td>
    <td>
      <input name="ctl00$Body$ucTabs$tabCategoriasMulti$txtCodUNSPSC" id="txtCodUNSPSC" value="0">
    </td>
  `;
  firstRow?.parentElement?.insertBefore(row, firstRow);
}

describe('normalizeUnspscCode', () => {
  it('accepts pasted punctuation without hiding extra digits', () => {
    expect(normalizeUnspscCode('27.112.104')).toBe('27112104');
    expect(normalizeUnspscCode('abc 2711210499')).toBe('2711210499');
  });
});

describe('UnspscQuickFillApp', () => {
  beforeEach(() => {
    document.documentElement.innerHTML = readFixture();
  });

  afterEach(() => {
    document.body.classList.remove('km-unspsc-running');
  });

  it('injects one quick field initialized from the native UNSPSC', () => {
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 300 });
    app.init();
    app.sync();

    expect(document.querySelectorAll('[data-km-unspsc-quick="1"]')).toHaveLength(1);
    expect(document.querySelector<HTMLInputElement>('[data-role="unspsc-code"]')?.value).toBe('40141607');
    expect(document.querySelector('#ibutUNSPSC')).not.toBeNull();

    app.destroy();
  });

  it('does not inject when the page already provides txtCodUNSPSC', () => {
    addNativeCodeInput();
    const app = new UnspscQuickFillApp({ hookAspNet: false });
    app.init();

    expect(document.querySelector('[data-km-unspsc-quick="1"]')).toBeNull();
    expect(document.querySelector('#txtCodUNSPSC')).not.toBeNull();

    app.destroy();
  });

  it('turns an eight-digit code into the complete native selection flow', async () => {
    const lookup = installModalOnLookup();
    const lookupSpy = vi.spyOn(lookup, 'click');
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 500 });
    app.init();

    const quickInput = document.querySelector<HTMLInputElement>('[data-role="unspsc-code"]')!;
    quickInput.value = '27112104';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));

    await flush(80);

    expect(lookupSpy).toHaveBeenCalledTimes(1);
    expect(document.querySelector<HTMLInputElement>('#txtUNSPSC')?.value).toBe('27112104. Drill bits');
    expect(document.querySelector<HTMLInputElement>('#txtUNSPSCSegmento')?.value).toMatch(/^27000000\./);
    expect(document.querySelector<HTMLInputElement>('#txtUNSPSCFamilia')?.value).toMatch(/^27110000\./);
    expect(document.querySelector<HTMLInputElement>('#txtUNSPSCClasse')?.value).toMatch(/^27112100\./);
    expect(document.querySelector<HTMLInputElement>('#txtUNSPSCMercadoria')?.value).toBe('27112104. Drill bits');
    expect(document.querySelector('[data-role="unspsc-status"]')?.textContent).toContain('preenchida');
    expect(document.querySelector('#tableUNSPSC')).toBeNull();

    app.destroy();
  });

  it('does not start the native flow before eight digits', async () => {
    const lookup = installModalOnLookup();
    const lookupSpy = vi.spyOn(lookup, 'click');
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 300 });
    app.init();

    const quickInput = document.querySelector<HTMLInputElement>('[data-role="unspsc-code"]')!;
    quickInput.value = '2711210';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(20);

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-role="unspsc-status"]')?.textContent).toContain('8 dígitos');

    app.destroy();
  });

  it('rejects extra digits instead of selecting a truncated code', async () => {
    const lookup = installModalOnLookup();
    const lookupSpy = vi.spyOn(lookup, 'click');
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 300 });
    app.init();

    const quickInput = document.querySelector<HTMLInputElement>('[data-role="unspsc-code"]')!;
    quickInput.value = '2711210499';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(20);

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-role="unspsc-status"]')?.textContent).toContain('deve ter 8 dígitos');

    app.destroy();
  });

  it('does not reopen the selector when the typed code is already applied', async () => {
    const lookup = installModalOnLookup();
    const lookupSpy = vi.spyOn(lookup, 'click');
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 300 });
    app.init();

    const quickInput = document.querySelector<HTMLInputElement>('[data-role="unspsc-code"]')!;
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(20);

    expect(lookupSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-role="unspsc-status"]')?.textContent).toContain('já preenchida');

    app.destroy();
  });

  it('keeps the previous classification when no exact result exists', async () => {
    installModalOnLookup('40141607');
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 300 });
    app.init();

    const quickInput = document.querySelector<HTMLInputElement>('[data-role="unspsc-code"]')!;
    quickInput.value = '27112104';
    quickInput.dispatchEvent(new Event('input', { bubbles: true }));
    await flush(80);

    expect(document.querySelector<HTMLInputElement>('#txtUNSPSC')?.value).toBe('40141607. Ball valves');
    expect(document.querySelector('[data-role="unspsc-status"]')?.textContent).toContain('não encontrado');
    expect(document.querySelector('#tableUNSPSC')).toBeNull();

    app.destroy();
  });

  it('reinjects once after ASP.NET replaces the classification cell', async () => {
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 300 });
    app.init();

    const oldCell = document.querySelector<HTMLElement>('#unspsc-cell')!;
    const replacement = oldCell.cloneNode(true) as HTMLElement;
    replacement.querySelector('[data-km-unspsc-quick="1"]')?.remove();
    oldCell.replaceWith(replacement);
    await flush(100);

    expect(document.querySelectorAll('[data-km-unspsc-quick="1"]')).toHaveLength(1);

    app.destroy();
  });

  it('removes the quick field when a postback switches to the native code model', async () => {
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 300 });
    app.init();
    expect(document.querySelector('[data-km-unspsc-quick="1"]')).not.toBeNull();

    addNativeCodeInput();
    await flush(100);

    expect(document.querySelector('[data-km-unspsc-quick="1"]')).toBeNull();
    expect(document.querySelector('#txtCodUNSPSC')).not.toBeNull();

    app.destroy();
  });

  it('leaves the native lookup click untouched', () => {
    const lookup = installModalOnLookup();
    const lookupSpy = vi.spyOn(lookup, 'click');
    const app = new UnspscQuickFillApp({ hookAspNet: false, autoSubmitDelayMs: 0, timeoutMs: 300 });
    app.init();

    lookup.click();

    expect(lookupSpy).toHaveBeenCalledTimes(1);
    app.destroy();
  });
});
