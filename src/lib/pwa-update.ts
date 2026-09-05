type Listener = (needsUpdate: boolean) => void;

const listeners = new Set<Listener>();
let needsUpdate = false;
let updateSW: ((reloadPage?: boolean) => Promise<void>) | null = null;

function emit(next: boolean) {
  needsUpdate = next;
  for (const listener of listeners) listener(needsUpdate);
}

export function bindPwaUpdateHandler(
  handler: (reloadPage?: boolean) => Promise<void>,
) {
  updateSW = handler;
}

export function notifyPwaUpdateAvailable() {
  emit(true);
}

export function subscribePwaUpdate(listener: Listener) {
  listeners.add(listener);
  listener(needsUpdate);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Activate a waiting SW when possible, then wipe registrations + Cache Storage
 * and do a full navigation. Soft reload alone often keeps the old iOS PWA shell.
 */
export async function applyPwaUpdate() {
  try {
    const registration = await navigator.serviceWorker?.getRegistration();
    registration?.waiting?.postMessage({ type: "SKIP_WAITING" });
    await updateSW?.(true);
    // Give the waiting worker time to process skipWaiting before we tear down.
    await new Promise((resolve) => window.setTimeout(resolve, 400));
  } catch {
    // Continue with the hard reset below.
  }

  try {
    const registrations = await navigator.serviceWorker.getRegistrations();
    await Promise.all(registrations.map((registration) => registration.unregister()));
  } catch {
    // Ignore — cache clear + navigation still help.
  }

  try {
    const keys = await caches.keys();
    await Promise.all(keys.map((key) => caches.delete(key)));
  } catch {
    // Ignore.
  }

  // replace() is more reliable than reload() in iOS standalone PWAs.
  window.location.replace(window.location.href);
}
