const STYLE_ID = 'km-unspsc-quick-style';
const QUICK_SELECTOR = '[data-km-unspsc-quick="1"]';
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_AUTO_SUBMIT_DELAY_MS = 180;
const PENDING_KEY = 'km_unspsc_pending_v1';

const SELECTORS = {
  nativeCode: 'input#txtCodUNSPSC, input[name$="$txtCodUNSPSC"]',
  nativeValue: 'input#txtUNSPSC, input[name$="$txtUNSPSC"]',
  nativeLookup: 'input#ibutUNSPSC, input[name$="$ibutUNSPSC"]',
  modal: '#tableUNSPSC',
  modalCode: '#tableUNSPSC input[name$="$txtCodigoUnspsc"], #tableUNSPSC input#txtCodigoUnspsc',
  modalSearch: '#tableUNSPSC input[name$="$butPesquisar"], #tableUNSPSC input#butPesquisar',
  modalResults: '#tableUNSPSC #divUNSPSC',
  modalGrid: '#tableUNSPSC #dgUNSPSC',
  modalClose: '#tableUNSPSC input[name$="$butFechar"], #tableUNSPSC input#butFechar',
  modalCancel: '#tableUNSPSC input[name$="$butCancelar"], #tableUNSPSC input#butCancelar'
} as const;

interface PageRequestManagerLike {
  add_endRequest(fn: () => void): void;
  remove_endRequest(fn: () => void): void;
}

interface UnspscQuickFillOptions {
  hookAspNet?: boolean;
  timeoutMs?: number;
  autoSubmitDelayMs?: number;
}

interface NativeUnspscElements {
  value: HTMLInputElement;
  lookup: HTMLInputElement;
}

type StatusTone = 'idle' | 'busy' | 'success' | 'error';
type PendingStage = 'opening' | 'searching' | 'selecting' | 'closing';

interface PendingUnspsc {
  code: string;
  stage: PendingStage;
}

declare const unsafeWindow: (Window & typeof globalThis) | undefined;

function getPageWindow(): Window & typeof globalThis {
  return typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
}

function isUsableElement(element: HTMLElement): boolean {
  if (!element.isConnected || element.hidden) return false;
  const style = (element.getAttribute('style') || '').toLowerCase();
  if (/\bdisplay\s*:\s*none\b/.test(style)) return false;
  if (/\bvisibility\s*:\s*hidden\b/.test(style)) return false;
  return !element.closest('[hidden]');
}

function findNativeUnspscElements(): NativeUnspscElements | null {
  const values = Array.from(document.querySelectorAll<HTMLInputElement>(SELECTORS.nativeValue));

  for (const value of values) {
    if (!value.readOnly || !isUsableElement(value) || value.closest(SELECTORS.modal)) continue;

    const scope = value.parentElement ?? document;
    const localLookup = scope.querySelector<HTMLInputElement>(SELECTORS.nativeLookup);
    const lookup = localLookup ?? document.querySelector<HTMLInputElement>(SELECTORS.nativeLookup);
    if (lookup && isUsableElement(lookup)) return { value, lookup };
  }

  return null;
}

function hasNativeUnspscCodeInput(): boolean {
  return Array.from(document.querySelectorAll<HTMLInputElement>(SELECTORS.nativeCode))
    .some((input) => isUsableElement(input));
}

function extractCurrentCode(value: string): string {
  return value.match(/^\s*(\d{8})(?:\D|$)/)?.[1] || '';
}

function setInputValue(input: HTMLInputElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value')?.set;
  if (setter) setter.call(input, value);
  else input.value = value;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function readPendingUnspsc(): PendingUnspsc | null {
  try {
    const raw = sessionStorage.getItem(PENDING_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<PendingUnspsc>;
    return parsed.code && parsed.code.length === 8 && parsed.stage
      ? { code: parsed.code, stage: parsed.stage }
      : null;
  } catch {
    return null;
  }
}

function writePendingUnspsc(pending: PendingUnspsc): void {
  try {
    sessionStorage.setItem(PENDING_KEY, JSON.stringify(pending));
  } catch {
    // The native flow still works when browser storage is unavailable.
  }
}

function clearPendingUnspsc(): void {
  try {
    sessionStorage.removeItem(PENDING_KEY);
  } catch {
    // Ignore storage teardown and privacy-mode errors.
  }
}

function findExactResult(code: string): HTMLInputElement | null {
  const grid = document.querySelector<HTMLElement>(SELECTORS.modalGrid);
  if (!grid) return null;

  for (const row of grid.querySelectorAll<HTMLTableRowElement>('tr')) {
    const codeElement = Array.from(row.querySelectorAll<HTMLElement>('a, span, td'))
      .find((element) => element.id === 'lbCodigo' || /\$lbCodigo$/.test(element.getAttribute('name') || ''));
    if (normalizeUnspscCode(codeElement?.textContent || '') !== code) continue;

    const selector = row.querySelector<HTMLInputElement>(
      'input[name$="$ckSelUNSPSC"], input[id$="ckSelUNSPSC"]'
    );
    if (selector) return selector;
  }

  return null;
}

export function normalizeUnspscCode(value: string): string {
  return String(value || '').replace(/\D/g, '');
}

export class UnspscQuickFillApp {
  private readonly hookAspNet: boolean;
  private readonly timeoutMs: number;
  private readonly autoSubmitDelayMs: number;
  private observer: MutationObserver | null = null;
  private destroyAspNet: (() => void) | null = null;
  private syncTimer = 0;
  private autoSubmitTimer = 0;
  private serial = 0;
  private running = false;
  private activeCode = '';
  private statusMessage = 'Digite os 8 dígitos.';
  private statusTone: StatusTone = 'idle';
  private host: HTMLElement | null = null;
  private codeInput: HTMLInputElement | null = null;
  private status: HTMLElement | null = null;
  private toast: HTMLElement | null = null;
  private nativeValue: HTMLInputElement | null = null;

  constructor(options: UnspscQuickFillOptions = {}) {
    this.hookAspNet = options.hookAspNet ?? true;
    this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    this.autoSubmitDelayMs = options.autoSubmitDelayMs ?? DEFAULT_AUTO_SUBMIT_DELAY_MS;
  }

  init(): void {
    this.injectStyles();
    this.sync();
    this.bindMutationObserver();
    if (this.hookAspNet) this.destroyAspNet = this.bindAspNetEndRequest();
    void this.resumePending();
  }

  destroy(): void {
    this.serial++;
    this.running = false;
    if (this.syncTimer) window.clearTimeout(this.syncTimer);
    if (this.autoSubmitTimer) window.clearTimeout(this.autoSubmitTimer);
    this.observer?.disconnect();
    this.destroyAspNet?.();
    this.removeHost();
    this.toast?.remove();
    document.body?.classList.remove('km-unspsc-running');
    this.observer = null;
    this.destroyAspNet = null;
    this.toast = null;
  }

  sync(): void {
    if (hasNativeUnspscCodeInput()) {
      this.removeHost();
      return;
    }

    const native = findNativeUnspscElements();
    if (!native) {
      this.removeHost();
      return;
    }

    const existingHost = native.value.parentElement?.querySelector<HTMLElement>(QUICK_SELECTOR) || null;
    const needsHost = (
      !existingHost
      || !existingHost.isConnected
      || this.nativeValue !== native.value
    );

    if (needsHost) {
      if (this.host?.isConnected && this.host !== existingHost) this.host.remove();
      this.createHost(native.value);
    } else {
      this.host = existingHost;
      this.codeInput = existingHost.querySelector<HTMLInputElement>('[data-role="unspsc-code"]');
      this.status = existingHost.querySelector<HTMLElement>('[data-role="unspsc-status"]');
    }

    this.nativeValue = native.value;
    if (this.codeInput && document.activeElement !== this.codeInput) {
      this.codeInput.value = this.running
        ? this.activeCode
        : extractCurrentCode(native.value.value);
    }
    this.renderState();
  }

  private createHost(nativeValue: HTMLInputElement): void {
    const host = document.createElement('span');
    host.className = 'km-unspsc-quick';
    host.dataset.kmUnspscQuick = '1';

    const label = document.createElement('span');
    label.className = 'km-unspsc-quick-label';
    label.textContent = 'Código rápido';

    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'km-unspsc-quick-input';
    input.dataset.role = 'unspsc-code';
    input.inputMode = 'numeric';
    input.autocomplete = 'off';
    input.maxLength = 16;
    input.pattern = '[0-9]{8}';
    input.setAttribute('aria-label', 'Código UNSPSC com 8 dígitos');
    input.value = this.running ? this.activeCode : extractCurrentCode(nativeValue.value);
    input.addEventListener('input', this.handleInput);
    input.addEventListener('keydown', this.handleKeyDown);
    input.addEventListener('blur', this.handleBlur);

    const status = document.createElement('span');
    status.className = 'km-unspsc-quick-status';
    status.dataset.role = 'unspsc-status';
    status.setAttribute('aria-live', 'polite');

    host.append(label, input, status);
    nativeValue.insertAdjacentElement('beforebegin', host);

    this.host = host;
    this.codeInput = input;
    this.status = status;
    this.nativeValue = nativeValue;
  }

  private readonly handleInput = (event: Event): void => {
    const input = event.currentTarget as HTMLInputElement;
    const code = normalizeUnspscCode(input.value);
    if (input.value !== code) input.value = code;

    if (this.autoSubmitTimer) window.clearTimeout(this.autoSubmitTimer);
    if (code.length !== 8) {
      this.setState(
        code.length > 8 ? 'Código deve ter 8 dígitos.' : 'Digite os 8 dígitos.',
        code.length > 8 ? 'error' : 'idle'
      );
      return;
    }

    this.autoSubmitTimer = window.setTimeout(() => {
      this.autoSubmitTimer = 0;
      void this.startFill(code);
    }, this.autoSubmitDelayMs);
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (event.key !== 'Enter') return;
    event.preventDefault();
    if (this.autoSubmitTimer) window.clearTimeout(this.autoSubmitTimer);
    const code = normalizeUnspscCode((event.currentTarget as HTMLInputElement).value);
    if (code.length === 8) void this.startFill(code);
  };

  private readonly handleBlur = (event: FocusEvent): void => {
    const code = normalizeUnspscCode((event.currentTarget as HTMLInputElement).value);
    if (code.length !== 8 || this.running || this.autoSubmitTimer) return;
    void this.startFill(code);
  };

  private async startFill(code: string): Promise<void> {
    if (this.running || code.length !== 8) return;

    const native = findNativeUnspscElements();
    if (!native) {
      this.setState('Abra a aba Classificações e tente novamente.', 'error');
      return;
    }

    if (extractCurrentCode(native.value.value) === code) {
      this.setState('UNSPSC já preenchida.', 'success');
      return;
    }

    const serial = ++this.serial;
    this.running = true;
    this.activeCode = code;
    writePendingUnspsc({ code, stage: 'opening' });
    document.body.classList.add('km-unspsc-running');
    this.setState('Abrindo consulta UNSPSC...', 'busy');

    try {
      const previousModal = document.querySelector(SELECTORS.modal);
      native.lookup.click();
      await this.waitForCondition(() => {
        const modal = document.querySelector(SELECTORS.modal);
        return Boolean(modal && modal !== previousModal);
      }, serial);

      const modalCode = this.requireInput(SELECTORS.modalCode);
      const search = this.requireInput(SELECTORS.modalSearch);
      setInputValue(modalCode, code);
      this.setState('Pesquisando código UNSPSC...', 'busy');
      writePendingUnspsc({ code, stage: 'searching' });

      const previousResults = document.querySelector<HTMLElement>(SELECTORS.modalResults);
      const previousResultsHtml = previousResults?.innerHTML || '';
      search.click();
      await this.waitForCondition(() => {
        const results = document.querySelector<HTMLElement>(SELECTORS.modalResults);
        return Boolean(
          results
          && (results !== previousResults || results.innerHTML !== previousResultsHtml)
        );
      }, serial);

      const resultSelector = findExactResult(code);
      if (!resultSelector) throw new Error('UNSPSC_NOT_FOUND');

      this.setState('Selecionando classificação...', 'busy');
      writePendingUnspsc({ code, stage: 'selecting' });
      const previousGrid = document.querySelector<HTMLElement>(SELECTORS.modalGrid);
      const previousGridHtml = previousGrid?.outerHTML || '';
      resultSelector.click();
      await this.waitForCondition(() => {
        const grid = document.querySelector<HTMLElement>(SELECTORS.modalGrid);
        return !resultSelector.isConnected || grid !== previousGrid || grid?.outerHTML !== previousGridHtml;
      }, serial);

      const close = this.requireInput(SELECTORS.modalClose);
      this.setState('Aplicando UNSPSC ao item...', 'busy');
      writePendingUnspsc({ code, stage: 'closing' });
      close.click();
      await this.waitForCondition(() => !document.querySelector(SELECTORS.modal), serial);
      await this.waitForCondition(() => {
        const current = findNativeUnspscElements();
        return Boolean(current && extractCurrentCode(current.value.value) === code);
      }, serial);

      this.running = false;
      this.activeCode = '';
      clearPendingUnspsc();
      document.body.classList.remove('km-unspsc-running');
      this.sync();
      this.setState('UNSPSC preenchida.', 'success');
    } catch (error) {
      if (serial !== this.serial) return;
      await this.cancelModal(serial);
      this.running = false;
      this.activeCode = '';
      clearPendingUnspsc();
      document.body.classList.remove('km-unspsc-running');
      this.sync();
      this.setState(
        error instanceof Error && error.message === 'UNSPSC_NOT_FOUND'
          ? 'Código UNSPSC não encontrado.'
          : 'Falha na consulta. Use a lupa.',
        'error'
      );
    }
  }

  private async resumePending(): Promise<void> {
    const pending = readPendingUnspsc();
    if (!pending || this.running) return;

    const native = findNativeUnspscElements();
    if (!native) return;

    const currentModal = document.querySelector(SELECTORS.modal);
    if (!currentModal) {
      if (pending.stage === 'closing' && extractCurrentCode(native.value.value) === pending.code) {
        clearPendingUnspsc();
        this.setState('UNSPSC preenchida.', 'success');
      }
      return;
    }

    const serial = ++this.serial;
    this.running = true;
    this.activeCode = pending.code;
    document.body.classList.add('km-unspsc-running');
    this.setState('Retomando consulta UNSPSC...', 'busy');

    try {
      if (pending.stage === 'selecting' || pending.stage === 'closing') {
        const close = this.requireInput(SELECTORS.modalClose);
        writePendingUnspsc({ code: pending.code, stage: 'closing' });
        close.click();
        await this.waitForCondition(() => !document.querySelector(SELECTORS.modal), serial);
      } else {
        const grid = document.querySelector(SELECTORS.modalGrid);
        if (grid) {
          const resultSelector = findExactResult(pending.code);
          if (!resultSelector) throw new Error('UNSPSC_NOT_FOUND');

          writePendingUnspsc({ code: pending.code, stage: 'selecting' });
          resultSelector.click();
          await this.waitForCondition(() => {
            const nextGrid = document.querySelector<HTMLElement>(SELECTORS.modalGrid);
            return !resultSelector.isConnected || nextGrid !== grid || nextGrid?.outerHTML !== grid.outerHTML;
          }, serial);

          const close = this.requireInput(SELECTORS.modalClose);
          writePendingUnspsc({ code: pending.code, stage: 'closing' });
          close.click();
          await this.waitForCondition(() => !document.querySelector(SELECTORS.modal), serial);
        } else {
          const modalCode = this.requireInput(SELECTORS.modalCode);
          const search = this.requireInput(SELECTORS.modalSearch);
          setInputValue(modalCode, pending.code);
          writePendingUnspsc({ code: pending.code, stage: 'searching' });
          search.click();
          await this.waitForCondition(() => {
            const results = document.querySelector<HTMLElement>(SELECTORS.modalResults);
            return Boolean(results?.querySelector(SELECTORS.modalGrid));
          }, serial);
        }
      }

      const updated = findNativeUnspscElements();
      if (updated && extractCurrentCode(updated.value.value) === pending.code) {
        clearPendingUnspsc();
        this.running = false;
        this.activeCode = '';
        document.body.classList.remove('km-unspsc-running');
        this.sync();
        this.setState('UNSPSC preenchida.', 'success');
      }
    } catch (error) {
      if (serial !== this.serial) return;
      await this.cancelModal(serial);
      clearPendingUnspsc();
      this.running = false;
      this.activeCode = '';
      document.body.classList.remove('km-unspsc-running');
      this.sync();
      this.setState(
        error instanceof Error && error.message === 'UNSPSC_NOT_FOUND'
          ? 'Código UNSPSC não encontrado.'
          : 'Falha na consulta. Use a lupa.',
        'error'
      );
    }
  }

  private requireInput(selector: string): HTMLInputElement {
    const input = document.querySelector<HTMLInputElement>(selector);
    if (!input) throw new Error(`Controle UNSPSC indisponível: ${selector}`);
    return input;
  }

  private waitForCondition(condition: () => boolean, serial: number): Promise<void> {
    if (condition()) return Promise.resolve();

    return new Promise((resolve, reject) => {
      let settled = false;
      const root = document.body ?? document.documentElement;
      const timerHost = root.ownerDocument?.defaultView ?? window;

      const finish = (error?: Error): void => {
        if (settled) return;
        settled = true;
        observer.disconnect();
        timerHost.clearInterval(interval);
        timerHost.clearTimeout(timeout);
        if (error) reject(error);
        else resolve();
      };

      const check = (): void => {
        if (serial !== this.serial) {
          finish(new Error('UNSPSC_CANCELLED'));
          return;
        }
        if (condition()) finish();
      };

      const observer = new MutationObserver(check);
      observer.observe(root, { childList: true, subtree: true, attributes: true });
      const interval = timerHost.setInterval(check, 50);
      const timeout = timerHost.setTimeout(() => finish(new Error('UNSPSC_TIMEOUT')), this.timeoutMs);
    });
  }

  private async cancelModal(serial: number): Promise<void> {
    const cancel = document.querySelector<HTMLInputElement>(SELECTORS.modalCancel);
    if (!cancel || serial !== this.serial) return;

    try {
      cancel.click();
      await this.waitForCondition(() => !document.querySelector(SELECTORS.modal), serial);
    } catch {
      // Reveal the native modal as the final fallback when cancellation also fails.
    }
  }

  private setState(message: string, tone: StatusTone): void {
    this.statusMessage = message;
    this.statusTone = tone;
    this.renderState();
  }

  private renderState(): void {
    if (this.codeInput) this.codeInput.disabled = this.running;
    if (this.status) {
      this.status.textContent = this.statusMessage;
      this.status.dataset.tone = this.statusTone;
    }

    const toast = this.ensureToast();
    toast.textContent = this.statusMessage;
    toast.hidden = !this.running;
  }

  private ensureToast(): HTMLElement {
    if (this.toast?.isConnected) return this.toast;
    const toast = document.createElement('div');
    toast.className = 'km-unspsc-toast';
    toast.dataset.kmUnspscToast = '1';
    toast.hidden = true;
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    document.body.appendChild(toast);
    this.toast = toast;
    return toast;
  }

  private clearHostRefs(): void {
    this.host = null;
    this.codeInput = null;
    this.status = null;
    this.nativeValue = null;
  }

  private removeHost(): void {
    for (const host of document.querySelectorAll<HTMLElement>(QUICK_SELECTOR)) host.remove();
    this.clearHostRefs();
  }

  private scheduleSync(): void {
    if (this.syncTimer) return;
    this.syncTimer = window.setTimeout(() => {
      this.syncTimer = 0;
      this.sync();
    }, 60);
  }

  private bindMutationObserver(): void {
    const root = document.body ?? document.documentElement;
    this.observer = new MutationObserver(() => this.scheduleSync());
    this.observer.observe(root, { childList: true, subtree: true });
  }

  private bindAspNetEndRequest(): () => void {
    let disposed = false;
    let intervalId = 0;
    let manager: PageRequestManagerLike | null = null;
    const handler = (): void => this.scheduleSync();
    const deadline = Date.now() + 8000;

    intervalId = window.setInterval(() => {
      if (disposed || Date.now() > deadline) {
        window.clearInterval(intervalId);
        return;
      }

      const maybeManager = (getPageWindow() as any).Sys?.WebForms?.PageRequestManager?.getInstance?.() as PageRequestManagerLike | null | undefined;
      if (!maybeManager) return;

      window.clearInterval(intervalId);
      manager = maybeManager;
      manager.add_endRequest(handler);
    }, 250);

    return () => {
      disposed = true;
      if (intervalId) window.clearInterval(intervalId);
      if (!manager) return;
      try {
        manager.remove_endRequest(handler);
      } catch {
        // Ignore teardown races during full page navigation.
      }
    };
  }

  private injectStyles(): void {
    if (document.getElementById(STYLE_ID)) return;
    const style = document.createElement('style');
    style.id = STYLE_ID;
    style.textContent = `
      .km-unspsc-quick{display:flex;align-items:center;gap:7px;width:fit-content;min-height:30px;margin:0 0 5px;padding:4px 7px;border:1px solid #b8c3d3;border-left:3px solid #3d557f;background:#f6f8fb;box-sizing:border-box;font-family:Verdana,Tahoma,sans-serif}
      .km-unspsc-quick-label{color:#3d557f;font-size:10px;font-weight:bold;white-space:nowrap;text-transform:uppercase;letter-spacing:.03em}
      .km-unspsc-quick-input{width:92px;height:23px;padding:2px 6px;border:1px solid #7e8da5;background:#fff;color:#1f2937;box-sizing:border-box;font:bold 12px Verdana,Tahoma,sans-serif;letter-spacing:.05em}
      .km-unspsc-quick-input:focus{outline:2px solid #93b4df;outline-offset:1px;border-color:#3d557f}
      .km-unspsc-quick-input:disabled{background:#e9edf3;color:#52606d}
      .km-unspsc-quick-status{min-width:142px;color:#52606d;font-size:10px;white-space:nowrap}
      .km-unspsc-quick-status[data-tone="busy"]{color:#725400;font-weight:bold}
      .km-unspsc-quick-status[data-tone="success"]{color:#17663a;font-weight:bold}
      .km-unspsc-quick-status[data-tone="error"]{color:#a12622;font-weight:bold}
      body.km-unspsc-running #tableUNSPSC{visibility:hidden!important;pointer-events:none!important}
      .km-unspsc-toast{position:fixed;z-index:2147483647;top:22px;left:50%;transform:translateX(-50%);padding:10px 16px;border:1px solid #223c66;border-radius:3px;background:#3d557f;color:#fff;box-shadow:0 8px 24px rgba(25,40,65,.25);font:bold 12px Verdana,Tahoma,sans-serif}
      .km-unspsc-toast[hidden]{display:none!important}
    `;
    document.head.appendChild(style);
  }
}
