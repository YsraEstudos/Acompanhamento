import { subscribeAspNetEndRequest } from './aspnet';

const STYLE_ID = 'km-unspsc-quick-style';
const QUICK_SELECTOR = '[data-km-unspsc-quick="1"]';
const TOAST_SELECTOR = '[data-km-unspsc-toast="1"]';
const OWNED_SELECTOR = `${QUICK_SELECTOR}, ${TOAST_SELECTOR}`;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_AUTO_SUBMIT_DELAY_MS = 180;
const PENDING_KEY = 'km_unspsc_pending_v1';

const SELECTORS = {
  nativeCode: 'input#txtCodUNSPSC, input[name$="$txtCodUNSPSC"]',
  nativeValue: 'input#txtUNSPSC, input[name$="$txtUNSPSC"]',
  nativeLookup: 'input#ibutUNSPSC, input[name$="$ibutUNSPSC"]',
  modalCode: 'input[name$="$txtCodigoUnspsc"], input#txtCodigoUnspsc',
  modalSearch: 'input[name$="$butPesquisar"], input#butPesquisar',
  modalResults: '#divUNSPSC',
  modalGrid: '#dgUNSPSC',
  modalClose: 'input[name$="$butFechar"], input#butFechar',
  modalCancel: 'input[name$="$butCancelar"], input#butCancelar'
} as const;

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

class UnspscFlowError extends Error {
  constructor(readonly code: 'NOT_FOUND' | 'TIMEOUT' | 'CANCELLED' | 'CONTROL_UNAVAILABLE') {
    super('UNSPSC_' + code);
  }
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
  const modal = findUnspscModal();

  for (const value of values) {
    if (!value.readOnly || !isUsableElement(value) || modal?.contains(value)) continue;

    const scope = value.parentElement ?? document;
    const localLookup = scope.querySelector<HTMLInputElement>(SELECTORS.nativeLookup);
    const lookup = localLookup ?? document.querySelector<HTMLInputElement>(SELECTORS.nativeLookup);
    if (lookup && isUsableElement(lookup)) return { value, lookup };
  }

  return null;
}

function findUnspscModal(): HTMLTableElement | null {
  const codeInputs = Array.from(document.querySelectorAll<HTMLInputElement>(SELECTORS.modalCode));
  for (const codeInput of codeInputs) {
    const table = codeInput.closest<HTMLTableElement>('table');
    if (
      table
      && isUsableElement(codeInput)
      && table.querySelector(SELECTORS.modalSearch)
      && table.querySelector(SELECTORS.modalClose)
    ) {
      return table;
    }
  }
  return null;
}

function markUnspscModal(modal: HTMLTableElement | null): void {
  if (modal) modal.dataset.kmUnspscModal = '1';
}

function observeUnspscChanges(onChange: () => void): () => void {
  let disposed = false;
  let scheduled = false;
  let roots: Element[] = [];
  const selector = Object.values(SELECTORS).join(', ');
  const isOwned = (node: Node): boolean => {
    const element = node instanceof Element ? node : node.parentElement;
    return Boolean(element?.closest(OWNED_SELECTOR));
  };
  const notify = (): void => {
    if (scheduled || disposed) return;
    scheduled = true;
    queueMicrotask(() => {
      scheduled = false;
      if (disposed) return;
      bindLocalRoots();
      onChange();
    });
  };
  const local = new MutationObserver(records => {
    if (records.some(record => !isOwned(record.target))) notify();
  });
  const bindLocalRoots = (): void => {
    const value = findNativeUnspscElements()?.value;
    const code = document.querySelector<HTMLInputElement>(SELECTORS.nativeCode);
    const scope = (element: HTMLElement | null | undefined): Element | null => {
      if (!element) return null;
      const parent = element.closest('table') ?? element.parentElement;
      return parent && parent !== document.body ? parent : element;
    };
    const next = [scope(value), scope(code), findUnspscModal()].filter((element): element is Element => Boolean(element));
    if (roots.length === next.length && roots.every((root, index) => root === next[index])) return;
    roots = next;
    local.disconnect();
    for (const root of roots) local.observe(root, {
      childList: true, subtree: true, characterData: true,
      attributes: true, attributeFilter: ['value', 'checked', 'class', 'style', 'hidden']
    });
  };
  const replacements = new MutationObserver(records => {
    const relevant = records.some(record => [...record.addedNodes, ...record.removedNodes].some(node => {
      if (!(node instanceof Element) || isOwned(node)) return false;
      return node.matches(selector) || Boolean(node.querySelector(selector));
    }));
    if (relevant) notify();
  });
  bindLocalRoots();
  // Child replacements can occur outside the original container after postback.
  // Broad attribute observation is limited to the local tables above.
  replacements.observe(document.body ?? document.documentElement, { childList: true, subtree: true });
  return () => {
    disposed = true;
    replacements.disconnect();
    local.disconnect();
  };
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
    const stage = parsed.stage;
    return typeof parsed.code === 'string' && /^\d{8}$/.test(parsed.code)
      && (stage === 'opening' || stage === 'searching' || stage === 'selecting' || stage === 'closing')
      ? { code: parsed.code, stage }
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
  const grid = findUnspscModal()?.querySelector<HTMLElement>(SELECTORS.modalGrid);
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
  private destroyDomObserver: (() => void) | null = null;
  private readonly cancelWaits = new Set<() => void>();
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
    if (this.destroyDomObserver) return;
    this.injectStyles();
    this.sync();
    this.bindMutationObserver();
    if (this.hookAspNet) this.destroyAspNet = subscribeAspNetEndRequest(() => this.scheduleSync());
    void this.resumePending();
  }

  destroy(): void {
    this.serial++;
    this.running = false;
    if (this.syncTimer) window.clearTimeout(this.syncTimer);
    if (this.autoSubmitTimer) window.clearTimeout(this.autoSubmitTimer);
    for (const cancel of [...this.cancelWaits]) cancel();
    this.destroyDomObserver?.();
    this.destroyAspNet?.();
    this.removeHost();
    this.toast?.remove();
    document.body?.classList.remove('km-unspsc-running');
    this.destroyDomObserver = null;
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

  private beginOperation(code: string, message: string): number {
    this.running = true;
    this.activeCode = code;
    document.body.classList.add('km-unspsc-running');
    this.setState(message, 'busy');
    return ++this.serial;
  }

  private async startFill(code: string): Promise<void> {
    if (this.running || !/^\d{8}$/.test(code)) return;
    const native = findNativeUnspscElements();
    if (!native) {
      this.setState('Abra a aba Classificações e tente novamente.', 'error');
      return;
    }
    if (extractCurrentCode(native.value.value) === code) {
      this.setState('UNSPSC já preenchida.', 'success');
      return;
    }
    const serial = this.beginOperation(code, 'Abrindo consulta UNSPSC...');
    writePendingUnspsc({ code, stage: 'opening' });
    await this.executeFill(code, 'opening', serial, native.lookup);
  }

  private async resumePending(): Promise<void> {
    const pending = readPendingUnspsc();
    if (!pending || this.running || !findNativeUnspscElements()) return;
    const modal = findUnspscModal();
    if (!modal && pending.stage !== 'closing') return;
    const serial = this.beginOperation(pending.code, 'Retomando consulta UNSPSC...');
    await this.executeFill(pending.code, pending.stage, serial);
  }

  private async executeFill(code: string, stage: PendingStage, serial: number, lookup?: HTMLInputElement): Promise<void> {
    let message = 'UNSPSC preenchida.';
    let tone: StatusTone = 'success';
    try {
      if (lookup) {
        const previousModal = findUnspscModal();
        lookup.click();
        await this.waitForCondition(() => {
          const modal = findUnspscModal();
          return Boolean(modal && modal !== previousModal);
        }, serial);
      }
      this.assertActive(serial);
      markUnspscModal(findUnspscModal());
      if (stage === 'opening' || stage === 'searching') {
        const modal = findUnspscModal();
        const existingResults = stage === 'searching'
          && modal?.querySelector<HTMLInputElement>(SELECTORS.modalCode)?.value === code
          && modal.querySelector(SELECTORS.modalGrid);
        if (!existingResults) await this.searchCode(code, serial);
        await this.selectCode(code, serial);
      }
      this.assertActive(serial);
      if (findUnspscModal()) {
        this.setState('Aplicando UNSPSC ao item...', 'busy');
        writePendingUnspsc({ code, stage: 'closing' });
        this.requireInput(SELECTORS.modalClose).click();
        await this.waitForCondition(() => !findUnspscModal(), serial);
      }
      // Native postbacks can assign the property after removing the modal,
      // without emitting a DOM mutation or an input event.
      await this.waitForCondition(() => {
        const native = findNativeUnspscElements();
        return Boolean(native && extractCurrentCode(native.value.value) === code);
      }, serial, 100);
    } catch (error) {
      if (serial !== this.serial) return;
      await this.cancelModal(serial);
      message = error instanceof UnspscFlowError && error.code === 'NOT_FOUND'
        ? 'Código UNSPSC não encontrado.' : 'Falha na consulta. Use a lupa.';
      tone = 'error';
    } finally {
      if (serial === this.serial) {
        clearPendingUnspsc();
        this.running = false;
        this.activeCode = '';
        document.body.classList.remove('km-unspsc-running');
        this.sync();
        this.setState(message, tone);
      }
    }
  }

  private async searchCode(code: string, serial: number): Promise<void> {
    this.assertActive(serial);
    const modalCode = this.requireInput(SELECTORS.modalCode);
    const search = this.requireInput(SELECTORS.modalSearch);
    setInputValue(modalCode, code);
    this.setState('Pesquisando código UNSPSC...', 'busy');
    writePendingUnspsc({ code, stage: 'searching' });
    const previous = findUnspscModal()?.querySelector(SELECTORS.modalResults);
    const child = previous?.firstElementChild;
    const text = previous?.textContent;
    search.click();
    await this.waitForCondition(() => {
      const results = findUnspscModal()?.querySelector(SELECTORS.modalResults);
      return Boolean(results && (results !== previous || results.firstElementChild !== child || results.textContent !== text));
    }, serial);
  }

  private async selectCode(code: string, serial: number): Promise<void> {
    this.assertActive(serial);
    const selector = findExactResult(code);
    if (!selector) throw new UnspscFlowError('NOT_FOUND');
    this.setState('Selecionando classificação...', 'busy');
    writePendingUnspsc({ code, stage: 'selecting' });
    const previous = findUnspscModal()?.querySelector(SELECTORS.modalGrid);
    const child = previous?.firstElementChild;
    const text = previous?.textContent;
    const checked = selector.checked;
    selector.click();
    await this.waitForCondition(() => {
      const grid = findUnspscModal()?.querySelector(SELECTORS.modalGrid);
      return !selector.isConnected || grid !== previous || grid?.firstElementChild !== child
        || grid?.textContent !== text || selector.checked !== checked;
    }, serial);
  }

  private assertActive(serial: number): void {
    if (serial !== this.serial) throw new UnspscFlowError('CANCELLED');
  }

  private requireInput(selector: string): HTMLInputElement {
    const input = findUnspscModal()?.querySelector<HTMLInputElement>(selector);
    if (!input) throw new UnspscFlowError('CONTROL_UNAVAILABLE');
    return input;
  }

  private waitForCondition(condition: () => boolean, serial: number, pollMs = 0): Promise<void> {
    this.assertActive(serial);
    if (condition()) return Promise.resolve();
    return new Promise((resolve, reject) => {
      let settled = false;
      let stopObserving = (): void => {};
      let interval = 0;
      let timeout = 0;
      const finish = (error?: UnspscFlowError): void => {
        if (settled) return;
        settled = true;
        stopObserving();
        if (interval) window.clearInterval(interval);
        window.clearTimeout(timeout);
        this.cancelWaits.delete(cancel);
        if (error) reject(error);
        else resolve();
      };
      const cancel = (): void => finish(new UnspscFlowError('CANCELLED'));
      const check = (): void => {
        if (serial !== this.serial) cancel();
        else if (condition()) finish();
      };
      this.cancelWaits.add(cancel);
      stopObserving = observeUnspscChanges(check);
      if (pollMs) interval = window.setInterval(check, pollMs);
      timeout = window.setTimeout(() => finish(new UnspscFlowError('TIMEOUT')), this.timeoutMs);
      check();
    });
  }

  private async cancelModal(serial: number): Promise<void> {
    const cancel = findUnspscModal()?.querySelector<HTMLInputElement>(SELECTORS.modalCancel);
    if (!cancel || serial !== this.serial) return;

    try {
      cancel.click();
      await this.waitForCondition(() => !findUnspscModal(), serial);
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
    if (this.codeInput && this.codeInput.disabled !== this.running) {
      this.codeInput.disabled = this.running;
    }
    if (this.status) {
      if (this.status.textContent !== this.statusMessage) {
        this.status.textContent = this.statusMessage;
      }
      if (this.status.dataset.tone !== this.statusTone) {
        this.status.dataset.tone = this.statusTone;
      }
    }

    const toast = this.ensureToast();
    if (toast.textContent !== this.statusMessage) {
      toast.textContent = this.statusMessage;
    }
    const nextHidden = !this.running;
    if (toast.hidden !== nextHidden) {
      toast.hidden = nextHidden;
    }
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
      void this.resumePending();
    }, 60);
  }

  private bindMutationObserver(): void {
    this.destroyDomObserver = observeUnspscChanges(() => this.scheduleSync());
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
      body.km-unspsc-running [data-km-unspsc-modal="1"]{visibility:hidden!important;pointer-events:none!important}
      .km-unspsc-toast{position:fixed;z-index:2147483647;top:22px;left:50%;transform:translateX(-50%);padding:10px 16px;border:1px solid #223c66;border-radius:3px;background:#3d557f;color:#fff;box-shadow:0 8px 24px rgba(25,40,65,.25);font:bold 12px Verdana,Tahoma,sans-serif}
      .km-unspsc-toast[hidden]{display:none!important}
    `;
    document.head.appendChild(style);
  }
}
