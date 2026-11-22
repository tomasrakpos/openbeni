// Local persistence defaults; providers now start empty for every install.
import { clearAllProviders, db } from "@/db";

export const PROVIDERS_RESET_FLAG = "providersResetVersion";

/**
 * Bumped once to wipe every provider a browser still carries from an earlier
 * build, including rows added from the admin panel or the provider wizard.
 *
 * After this runs the app has no providers at all — nothing is seeded back, so
 * the list stays empty until someone adds a provider themselves.
 */
const PROVIDERS_RESET_VERSION = 1;

let inFlight: Promise<void> | null = null;

export function resetProvidersOnce(): Promise<void> {
  if (!inFlight) {
    inFlight = runResetOnce().finally(() => {
      inFlight = null;
    });
  }
  return inFlight;
}

const RESET_CACHE_KEY = "openharness.providersResetVersion";

async function runResetOnce(): Promise<void> {
  try {
    if (localStorage.getItem(RESET_CACHE_KEY) === String(PROVIDERS_RESET_VERSION)) {
      return;
    }
  } catch {
    // Storage may be unavailable; fall back to IndexedDB check.
  }

  const flag = await db.meta.get(PROVIDERS_RESET_FLAG);
  if (flag?.v === PROVIDERS_RESET_VERSION) {
    try {
      localStorage.setItem(RESET_CACHE_KEY, String(PROVIDERS_RESET_VERSION));
    } catch {
      // ignore
    }
    return;
  }

  await clearAllProviders();
  // The catalog cache can still list the site's server-side models; drop it so
  // no provider-shaped entry survives in the browser.
  try {
    localStorage.removeItem("openharness.catalog.v1");
  } catch {
    // Storage may be unavailable; nothing else depends on it.
  }
  await db.meta.put({ k: PROVIDERS_RESET_FLAG, v: PROVIDERS_RESET_VERSION });
  try {
    localStorage.setItem(RESET_CACHE_KEY, String(PROVIDERS_RESET_VERSION));
  } catch {
    // ignore
  }
}
