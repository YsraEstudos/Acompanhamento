import {
  getAlwaysOpenMenuLabel,
  getInlinePanelToggleLabel,
  loadSettings,
  saveSettings,
  SETTINGS_KEY
} from '../src/state';

describe('sidebar settings', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    saveSettings({ alwaysOpen: false, timelineMode: 'yellow-only' });
    localStorage.clear();
  });

  it('keeps preferences usable for the session when writes fail and recovers persistence', () => {
    const stored = { alwaysOpen: false, timelineMode: 'all' } as const;
    const next = { alwaysOpen: true, timelineMode: 'yellow-only' } as const;
    saveSettings(stored);
    const event = vi.fn();
    globalThis.addEventListener('km-sin-sidebar-settings-changed', event);
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Blocked', 'SecurityError');
    });
    try {
      expect(saveSettings(next)).toBe(false);
      expect(loadSettings()).toEqual(next);
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual(stored);
      expect(event).toHaveBeenCalledOnce();
      setItem.mockRestore();
      expect(saveSettings(next)).toBe(true);
      expect(JSON.parse(localStorage.getItem(SETTINGS_KEY)!)).toEqual(next);
    } finally {
      globalThis.removeEventListener('km-sin-sidebar-settings-changed', event);
    }
  });

  it('uses session preferences when reads and writes are both blocked', () => {
    vi.spyOn(localStorage, 'getItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new DOMException('Blocked', 'SecurityError'); });
    const next = { alwaysOpen: true, timelineMode: 'all' } as const;
    expect(saveSettings(next)).toBe(false);
    expect(loadSettings()).toEqual(next);
  });

  it('honors a newer stored value from another tab after a failed write', () => {
    saveSettings({ alwaysOpen: false, timelineMode: 'all' });
    const setItem = vi.spyOn(localStorage, 'setItem').mockImplementation(() => { throw new Error('Quota'); });
    expect(saveSettings({ alwaysOpen: true, timelineMode: 'all' })).toBe(false);
    setItem.mockRestore();
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ alwaysOpen: false, timelineMode: 'yellow-only' }));
    expect(loadSettings()).toEqual({ alwaysOpen: false, timelineMode: 'yellow-only' });
  });

  it('defaults to closed and yellow-only on first run', () => {
    expect(loadSettings()).toEqual({ alwaysOpen: false, timelineMode: 'yellow-only' });
  });

  it('keeps saved preferences untouched', () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({ alwaysOpen: false, timelineMode: 'all' }));
    expect(loadSettings()).toEqual({ alwaysOpen: false, timelineMode: 'all' });
  });

  it('persists the always-open preference and the timeline mode', () => {
    saveSettings({ alwaysOpen: true, timelineMode: 'yellow-only' });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')).toEqual({
      alwaysOpen: true,
      timelineMode: 'yellow-only'
    });
    expect(loadSettings()).toEqual({ alwaysOpen: true, timelineMode: 'yellow-only' });
  });

  it('migrates the old always-open setting to the safer closed default', () => {
    localStorage.setItem('km_sin_sidebar_settings_v1', JSON.stringify({
      alwaysOpen: true,
      timelineMode: 'all'
    }));

    expect(loadSettings()).toEqual({ alwaysOpen: false, timelineMode: 'all' });
    expect(JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')).toEqual({
      alwaysOpen: false,
      timelineMode: 'all'
    });
  });

  it('exposes separate labels for the menu and the inline panel toggle', () => {
    expect(getAlwaysOpenMenuLabel(true)).toBe('Desativar acompanhamento sempre visivel');
    expect(getAlwaysOpenMenuLabel(false)).toBe('Ativar acompanhamento sempre visivel');
    expect(getInlinePanelToggleLabel(true)).toBe('Ocultar painel');
    expect(getInlinePanelToggleLabel(false)).toBe('Mostrar painel');
  });
});
