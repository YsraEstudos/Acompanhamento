import { SinSidebarApp } from './app';
import {
  getAlwaysOpenMenuLabel,
  loadSettings,
  saveSettings,
  SETTINGS_CHANGED_EVENT,
  SETTINGS_KEY,
  type SinPanelSettings
} from './state';
import { shouldBootstrapSinSidebar } from './runtime-guard';

declare const GM_registerMenuCommand:
  | ((caption: string, onClick: () => void, accessKey?: string) => number | string)
  | undefined;
declare const GM_unregisterMenuCommand:
  | ((menuCommandId: number | string) => void)
  | undefined;

let app: SinSidebarApp | null = null;
let alwaysOpenMenuId: number | string | null = null;

function unregisterAlwaysOpenMenu(): void {
  if (alwaysOpenMenuId === null || typeof GM_unregisterMenuCommand !== 'function') return;
  GM_unregisterMenuCommand(alwaysOpenMenuId);
  alwaysOpenMenuId = null;
}

function syncAlwaysOpenMenu(): void {
  if (typeof GM_registerMenuCommand !== 'function') return;

  unregisterAlwaysOpenMenu();
  const settings = loadSettings();
  const label = getAlwaysOpenMenuLabel(settings.alwaysOpen);

  alwaysOpenMenuId = GM_registerMenuCommand(label, () => {
    const currentSettings = loadSettings();
    const nextSettings: SinPanelSettings = {
      ...currentSettings,
      alwaysOpen: !currentSettings.alwaysOpen
    };

    saveSettings(nextSettings);
    app?.applySettings(nextSettings);
    syncAlwaysOpenMenu();
  });
}

function handleStorageEvent(event: Event): void {
  const storageEvent = event as StorageEvent;
  if (storageEvent.key !== null && storageEvent.key !== SETTINGS_KEY) return;
  syncAlwaysOpenMenu();
}

function handleSettingsChanged(): void {
  syncAlwaysOpenMenu();
}

function start(): void {
  if (!shouldBootstrapSinSidebar()) return;
  app = new SinSidebarApp();
  app.init();
}

syncAlwaysOpenMenu();

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', start, { once: true });
} else {
  start();
}

globalThis.addEventListener('storage', handleStorageEvent);
globalThis.addEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged as EventListener);
globalThis.addEventListener('beforeunload', () => {
  globalThis.removeEventListener('storage', handleStorageEvent);
  globalThis.removeEventListener(SETTINGS_CHANGED_EVENT, handleSettingsChanged as EventListener);
  unregisterAlwaysOpenMenu();
  app?.destroy();
}, { once: true });
