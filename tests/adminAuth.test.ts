// Tests for adminAuth.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAdmin } from "../functions/api/_lib/auth";

const ENV = {
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
};

function profileRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "user-1",
    email: "user@example.com",
    display_name: "User",
    role: "user",
    status: "active",
    daily_token_limit: null,
    monthly_token_limit: null,
    created_at: "2026-01-01T00:00:00.000Z",
    last_seen_at: "2026-01-01T00:00:00.000Z",
    ...overrides,
  };
}

function mockSupabase(profile: Record<string, unknown> | null) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      if (url.endsWith("/auth/v1/user")) {
        return new Response(JSON.stringify({ id: profile?.id ?? "user-1", email: "user@example.com" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/rest/v1/profiles") && method === "GET") {
        return new Response(JSON.stringify(profile ? [profile] : []), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      if (url.includes("/rest/v1/profiles") && (method === "PATCH" || method === "POST")) {
        return new Response(JSON.stringify([profile ?? profileRow()]), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response(JSON.stringify({}), { status: 200 });
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin role check", () => {
  it("rejects a request without a bearer token", async () => {
    mockSupabase(profileRow());
    const result = await requireAdmin(new Request("https://app.example.com/api/admin/providers"), ENV);
    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(401);
  });

  it("rejects an authenticated non-admin", async () => {
    mockSupabase(profileRow({ role: "user" }));
    const request = new Request("https://app.example.com/api/admin/providers", {
      headers: { Authorization: "Bearer token" },
    });
    const result = await requireAdmin(request, ENV);
    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(403);
  });

  it("accepts an email listed in ADMIN_EMAILS", async () => {
    mockSupabase(profileRow({ role: "user" }));
    const request = new Request("https://app.example.com/api/admin/providers", {
      headers: { Authorization: "Bearer token" },
    });
    const result = await requireAdmin(request, { ...ENV, ADMIN_EMAILS: "user@example.com" });
    expect("context" in result).toBe(true);
    if ("context" in result) {
      expect(result.context.isAdmin).toBe(true);
    }
  });

  it("rejects a blocked admin", async () => {
    mockSupabase(profileRow({ role: "admin", status: "blocked" }));
    const request = new Request("https://app.example.com/api/admin/providers", {
      headers: { Authorization: "Bearer token" },
    });
    const result = await requireAdmin(request, ENV);
    expect("response" in result).toBe(true);
    if ("response" in result) expect(result.response.status).toBe(403);
  });

  it("rejects when Supabase is not configured", async () => {
    const request = new Request("https://app.example.com/api/admin/providers", {
      headers: { Authorization: "Bearer token" },
    });
    const result = await requireAdmin(request, {});
    expect("response" in result).toBe(true);
  });
});
