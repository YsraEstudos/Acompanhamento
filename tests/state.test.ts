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
