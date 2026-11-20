// Shared logic bundled; change this helper here and update callers if its contract changes.
import type { Provider } from "@/lib/types";

/** Name shown for the project's own bundled routes in model pickers. */
export const APP_NAME = "OpenHarneks";

/**
 * Providers that ship with the app as project-owned routes and are hidden from
 * the Providers page. Managed providers (Coarena) are *not* bundled: they are
 * visible, but their keys live on the server.
 */
export function isBundledProvider(provider: Provider): boolean {
  return provider.bundled === true;
}

/** Never leak a bundled gateway's brand into the UI: show the site name. */
export function providerDisplayName(provider: Provider): string {
  return isBundledProvider(provider) ? APP_NAME : provider.name;
}
