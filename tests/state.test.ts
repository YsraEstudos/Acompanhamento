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

  it('defaults to always-open and yellow-only on first run', () => {
    expect(loadSettings()).toEqual({ alwaysOpen: true, timelineMode: 'yellow-only' });
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

  it('exposes separate labels for the menu and the inline panel toggle', () => {
    expect(getAlwaysOpenMenuLabel(true)).toBe('Desativar acompanhamento sempre visivel');
    expect(getAlwaysOpenMenuLabel(false)).toBe('Ativar acompanhamento sempre visivel');
    expect(getInlinePanelToggleLabel(true)).toBe('Ocultar painel');
    expect(getInlinePanelToggleLabel(false)).toBe('Mostrar painel');
  });
});
