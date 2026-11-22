// Shared logic api; change this helper here and update callers if its contract changes.
import { getAdminToken } from "@/lib/adminSession";
import { currentAccessToken } from "@/lib/supabase";

export interface ApiErrorPayload {
  status: number;
  message: string;
  code?: string;
}

export class ApiError extends Error {
  status: number;
  code?: string;

  constructor(payload: ApiErrorPayload) {
    super(payload.message);
    this.name = "ApiError";
    this.status = payload.status;
    this.code = payload.code;
  }
}

export interface RequestOptions {
  method?: string;
  body?: unknown;
  /** Attach the Supabase access token. Defaults to true for /api calls. */
  auth?: boolean;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, options: RequestOptions = {}): Promise<T> {
  // Development-only: `/admin` on localhost answers with sample data when no
  // Supabase project is configured. Compiled out of production builds.
  if (import.meta.env.DEV && typeof window !== "undefined" && window.location.pathname.startsWith("/admin")) {
    const { devAdminMock } = await import("@/lib/devAdminMock");
    const mocked = await devAdminMock<T>(path, options);
    if (mocked !== undefined) return mocked;
  }

  const headers = new Headers({ Accept: "application/json" });
  if (options.body !== undefined) headers.set("Content-Type", "application/json");

  // The standalone admin page authenticates with its own short-lived token,
  // never with a visitor account. Only admin routes see it.
  const adminToken = path.startsWith("/api/admin/") ? getAdminToken() : null;
  if (adminToken) headers.set("x-admin-key", adminToken);

  if (options.auth !== false) {
    const token = await currentAccessToken();
    if (token) headers.set("Authorization", `Bearer ${token}`);
  }

  let response: Response;
  try {
    response = await fetch(path, {
      method: options.method ?? (options.body === undefined ? "GET" : "POST"),
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
      signal: options.signal,
      cache: "no-store",
    });
  } catch {
    throw new ApiError({ status: 0, message: "network" });
  }

  const text = await response.text();
  let payload: unknown = null;
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = null;
    }
  }

  if (!response.ok) {
    const error = (payload as { error?: { message?: string; code?: string } } | null)?.error;
    throw new ApiError({
      status: response.status,
      message: error?.message ?? `HTTP ${response.status}`,
      code: error?.code,
    });
  }

  return (payload as { data?: T } | null)?.data as T;
}
