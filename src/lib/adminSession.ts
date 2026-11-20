/**
 * Admin panel token, kept in `sessionStorage` so it dies with the tab.
 * The token is issued by `POST /api/admin/login` and only unlocks `/api/admin/*`
 * on this origin; it is never used for chat or user data.
 */

const TOKEN_KEY = "openharneks.admin.token";
const EXPIRY_KEY = "openharneks.admin.expires";

let memory: AdminSession | null = null;

export interface AdminSession {
  token: string;
  expiresAt: string;
}

export function getAdminSession(): AdminSession | null {
  try {
    const token = window.sessionStorage.getItem(TOKEN_KEY);
    if (!token) return memory && new Date(memory.expiresAt).getTime() > Date.now() ? memory : null;
    const expiresAt = window.sessionStorage.getItem(EXPIRY_KEY) ?? "";
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      clearAdminSession();
      return null;
    }
    return { token, expiresAt };
  } catch {
    return memory && new Date(memory.expiresAt).getTime() > Date.now() ? memory : null;
  }
}

export function getAdminToken(): string | null {
  return getAdminSession()?.token ?? null;
}

export function saveAdminSession(session: AdminSession): void {
  try {
    window.sessionStorage.setItem(TOKEN_KEY, session.token);
    window.sessionStorage.setItem(EXPIRY_KEY, session.expiresAt);
  } catch {
    // Storage can be disabled; the caller falls back to a memory copy.
  }
}

export function clearAdminSession(): void {
  try {
    window.sessionStorage.removeItem(TOKEN_KEY);
    window.sessionStorage.removeItem(EXPIRY_KEY);
  } catch {
    // Ignore.
  }
}
