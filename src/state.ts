export type TimelineMode = 'all' | 'yellow-only';

export interface SinPanelSettings {
  alwaysOpen: boolean;
  timelineMode: TimelineMode;
}

export const SETTINGS_KEY = 'km_sin_sidebar_settings_v2';
const LEGACY_SETTINGS_KEY = 'km_sin_sidebar_settings_v1';
export const SETTINGS_CHANGED_EVENT = 'km-sin-sidebar-settings-changed';

const DEFAULT_SETTINGS: SinPanelSettings = {
  alwaysOpen: false,
  timelineMode: 'yellow-only'
};

// Unsaved preferences last only for this page session. A newer persisted value
// (for example, from another tab) takes precedence over this fallback.
let unsavedSettings: SinPanelSettings | null = null;
let storedBeforeFailure: string | null | undefined;

function normalizeTimelineMode(value: unknown): TimelineMode {
  return value === 'yellow-only' ? 'yellow-only' : 'all';
}

export function getAlwaysOpenMenuLabel(alwaysOpen: boolean): string {
  return alwaysOpen
    ? 'Desativar acompanhamento sempre visivel'
    : 'Ativar acompanhamento sempre visivel';
}

export function getInlinePanelToggleLabel(panelOpen: boolean): string {
  return panelOpen ? 'Ocultar painel' : 'Mostrar painel';
}

function parseStoredSettings(raw: string): SinPanelSettings {
  const parsed = JSON.parse(raw) as Partial<SinPanelSettings>;
  return {
    alwaysOpen: parsed.alwaysOpen === true,
    timelineMode: normalizeTimelineMode(parsed.timelineMode)
  };
}

export function loadSettings(): SinPanelSettings {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (unsavedSettings && (storedBeforeFailure === undefined || raw === storedBeforeFailure)) {
      return { ...unsavedSettings };
    }
    unsavedSettings = null;
    if (raw) return parseStoredSettings(raw);

    const legacyRaw = localStorage.getItem(LEGACY_SETTINGS_KEY);
    if (!legacyRaw) return { ...DEFAULT_SETTINGS };

    const migratedSettings: SinPanelSettings = {
      ...parseStoredSettings(legacyRaw),
      alwaysOpen: false
    };
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(migratedSettings));
    return migratedSettings;
  } catch {
    return { ...(unsavedSettings ?? DEFAULT_SETTINGS) };
  }
}

export function saveSettings(settings: SinPanelSettings): boolean {
  let persisted = false;
  storedBeforeFailure = undefined;
  try {
    storedBeforeFailure = localStorage.getItem(SETTINGS_KEY);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    unsavedSettings = null;
    persisted = true;
  } catch {
    unsavedSettings = { ...settings };
  }
  globalThis.dispatchEvent(new CustomEvent<SinPanelSettings>(SETTINGS_CHANGED_EVENT, {
    detail: settings
  }));
  return persisted;
}
