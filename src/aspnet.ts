interface PageRequestManager {
  add_endRequest(handler: () => void): void;
  remove_endRequest(handler: () => void): void;
}

interface AspNetWindow extends Window {
  Sys?: { WebForms?: { PageRequestManager?: { getInstance?: () => PageRequestManager | null } } };
}

declare const unsafeWindow: AspNetWindow | undefined;

const subscribers = new Set<() => void>();
let manager: PageRequestManager | null = null;
let discoveryTimer = 0;

const notify = (): void => {
  // Snapshot iteration allows a consumer to unsubscribe during notification.
  for (const subscriber of [...subscribers]) {
    if (subscribers.has(subscriber)) subscriber();
  }
};

function stopDiscovery(): void {
  if (discoveryTimer) window.clearInterval(discoveryTimer);
  discoveryTimer = 0;
}

export function subscribeAspNetEndRequest(handler: () => void): () => void {
  const subscriber = (): void => handler();
  subscribers.add(subscriber);
  if (!manager && !discoveryTimer) {
    const deadline = Date.now() + 8000;
    discoveryTimer = window.setInterval(() => {
      if (Date.now() > deadline) {
        stopDiscovery();
        return;
      }
      const pageWindow: AspNetWindow = typeof unsafeWindow !== 'undefined' ? unsafeWindow : window;
      const discovered = pageWindow.Sys?.WebForms?.PageRequestManager?.getInstance?.();
      if (!discovered) return;
      manager = discovered;
      stopDiscovery();
      manager.add_endRequest(notify);
    }, 250);
  }

  return () => {
    subscribers.delete(subscriber);
    if (subscribers.size > 0) return;
    stopDiscovery();
    if (manager) {
      try {
        manager.remove_endRequest(notify);
      } catch {
        // The native manager may already be torn down during page navigation.
      }
      manager = null;
    }
  };
}
