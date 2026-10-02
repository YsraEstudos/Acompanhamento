import { PageLifecycle } from '../src/page-lifecycle';
import { saveSettings, SETTINGS_KEY } from '../src/state';
import { UnspscQuickFillApp } from '../src/unspsc-quick-fill';

describe('PageLifecycle', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    document.body.innerHTML = '<div id="UpdatePanel1"><div class="kl-view"><input id="txtNumero" value="123"></div></div>';
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('filters storage events and only handles restored pageshow events', () => {
    const onContextChange = vi.fn();
    const onSettingsChange = vi.fn();
    const lifecycle = new PageLifecycle({ hookAspNet: false, onContextChange, onSettingsChange });
    try {
      lifecycle.start();
      window.dispatchEvent(new StorageEvent('storage', { key: 'other-setting' }));
      window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
      window.dispatchEvent(new StorageEvent('storage', { key: null }));
      expect(onSettingsChange).toHaveBeenCalledTimes(2);
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: false }));
      expect(onContextChange).not.toHaveBeenCalled();
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
      window.dispatchEvent(new Event('popstate'));
      window.dispatchEvent(new Event('hashchange'));
      expect(onContextChange).toHaveBeenCalledTimes(3);
    } finally {
      lifecycle.destroy();
    }
  });

  it('debounces context mutations and ignores owned UI changes', async () => {
    const onContextChange = vi.fn();
    const lifecycle = new PageLifecycle({ hookAspNet: false, onContextChange, onSettingsChange: vi.fn() });
    try {
      lifecycle.start();
      document.querySelector('.kl-view')!.insertAdjacentHTML('beforeend', '<div class="km-sin-layout">UI</div>');
      await vi.advanceTimersByTimeAsync(100);
      expect(onContextChange).not.toHaveBeenCalled();
      document.querySelector('#txtNumero')!.setAttribute('value', '456');
      document.querySelector('#txtNumero')!.setAttribute('value', '789');
      await vi.advanceTimersByTimeAsync(100);
      expect(onContextChange).toHaveBeenCalledOnce();
      expect(onContextChange.mock.calls[0][0].itemId).toBe('789');
    } finally {
      lifecycle.destroy();
    }
  });

  it('removes browser listeners and pending mutation work on destroy', async () => {
    const onContextChange = vi.fn();
    const onSettingsChange = vi.fn();
    const lifecycle = new PageLifecycle({ hookAspNet: false, onContextChange, onSettingsChange });
    lifecycle.start();
    document.querySelector('#txtNumero')!.setAttribute('value', '456');
    await Promise.resolve();
    lifecycle.destroy();
    window.dispatchEvent(new Event('popstate'));
    window.dispatchEvent(new StorageEvent('storage', { key: SETTINGS_KEY }));
    await vi.advanceTimersByTimeAsync(100);
    expect(onContextChange).not.toHaveBeenCalled();
    expect(onSettingsChange).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('discovers the ASP.NET manager and removes the registered handler', async () => {
    const manager = { add_endRequest: vi.fn(), remove_endRequest: vi.fn() };
    vi.stubGlobal('unsafeWindow', { Sys: { WebForms: { PageRequestManager: { getInstance: () => manager } } } });
    const onContextChange = vi.fn();
    const lifecycle = new PageLifecycle({ onContextChange, onSettingsChange: vi.fn() });
    lifecycle.start();
    await vi.advanceTimersByTimeAsync(250);
    expect(manager.add_endRequest).toHaveBeenCalledOnce();
    const handler = manager.add_endRequest.mock.calls[0][0];
    handler();
    expect(onContextChange).toHaveBeenCalledOnce();
    lifecycle.destroy();
    expect(manager.remove_endRequest).toHaveBeenCalledWith(handler);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('stops ASP.NET discovery when destroyed before the manager is available', async () => {
    vi.stubGlobal('unsafeWindow', {});
    const lifecycle = new PageLifecycle({ onContextChange: vi.fn(), onSettingsChange: vi.fn() });
    lifecycle.start();
    lifecycle.destroy();
    await vi.advanceTimersByTimeAsync(9000);
    expect(vi.getTimerCount()).toBe(0);
  });

  it('shares one ASP.NET handler with UNSPSC and disposes consumers independently', async () => {
    const manager = { add_endRequest: vi.fn(), remove_endRequest: vi.fn() };
    vi.stubGlobal('unsafeWindow', { Sys: { WebForms: { PageRequestManager: { getInstance: () => manager } } } });
    const onContextChange = vi.fn();
    const lifecycle = new PageLifecycle({ onContextChange, onSettingsChange: vi.fn() });
    const quickFill = new UnspscQuickFillApp();
    try {
      lifecycle.start();
      quickFill.init();
      lifecycle.start();
      quickFill.init();
      await vi.advanceTimersByTimeAsync(250);
      expect(manager.add_endRequest).toHaveBeenCalledOnce();
      const handler = manager.add_endRequest.mock.calls[0][0];
      quickFill.destroy();
      expect(manager.remove_endRequest).not.toHaveBeenCalled();
      handler();
      expect(onContextChange).toHaveBeenCalledOnce();
      lifecycle.destroy();
      expect(manager.remove_endRequest).toHaveBeenCalledWith(handler);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      quickFill.destroy();
      lifecycle.destroy();
    }
  });

  it('notifies the current page even when saving preferences fails', () => {
    const onSettingsChange = vi.fn();
    const lifecycle = new PageLifecycle({ hookAspNet: false, onContextChange: vi.fn(), onSettingsChange });
    const write = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('blocked', 'SecurityError');
    });
    try {
      lifecycle.start();
      expect(saveSettings({ alwaysOpen: true, timelineMode: 'all' })).toBe(false);
      expect(onSettingsChange).toHaveBeenCalledOnce();
      lifecycle.destroy();
      saveSettings({ alwaysOpen: false, timelineMode: 'yellow-only' });
      expect(onSettingsChange).toHaveBeenCalledOnce();
    } finally {
      lifecycle.destroy();
      write.mockRestore();
      saveSettings({ alwaysOpen: false, timelineMode: 'yellow-only' });
      localStorage.clear();
    }
  });
});
