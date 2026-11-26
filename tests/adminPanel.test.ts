// Tests for adminPanel.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  adminPasswordConfigured,
  createAdminToken,
  handleAdminLogin,
  verifyAdminToken,
} from "../functions/api/_lib/adminAuth";
import { handleAdmin } from "../functions/api/_lib/adminHandlers";

const PASSWORD = "correct-horse-battery";
const ENV = {
  ADMIN_PASSWORD: PASSWORD,
  ADMIN_SESSION_SECRET: "test-session-secret",
  MASTER_ENCRYPTION_KEY: "test-master-key",
  SUPABASE_URL: "https://example.supabase.co",
  SUPABASE_ANON_KEY: "anon-test",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-test",
};

function loginRequest(password: string, ip = "10.0.0.1"): Request {
  return new Request("https://app.example.com/api/admin/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", "cf-connecting-ip": ip },
    body: JSON.stringify({ password }),
  });
}

/** Answers the service-role REST calls that `diagnostics` makes. */
function mockDatabase(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      const json = (value: unknown) =>
        new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
      if (url.includes("/rest/v1/providers")) {
        if (url.includes("select=id&limit=1")) return json([{ id: "provider-1" }]);
        return json([{ id: "provider-1" }, { id: "provider-2" }]);
      }
      if (url.includes("/rest/v1/catalog_models")) {
        if (url.includes("select=id&limit=1")) return json([{ id: "model-1" }]);
        return json([{ enabled: true }, { enabled: false }, { enabled: true }]);
      }
      if (url.includes("/rest/v1/app_settings")) return json([{ id: true }]);
      if (url.includes("/rest/v1/usage_events")) return json([{ id: 1 }]);
      return json([]);
    }),
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("admin password gate", () => {
  it("only treats an 8+ character password as configured", () => {
    expect(adminPasswordConfigured({})).toBe(false);
    expect(adminPasswordConfigured({ ADMIN_PASSWORD: "short" })).toBe(false);
    expect(adminPasswordConfigured({ ADMIN_PASSWORD: PASSWORD })).toBe(true);
  });

  it("logs in with the right password and returns a verifiable token", async () => {
    const response = await handleAdminLogin(loginRequest(PASSWORD, "10.0.0.2"), ENV);
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { token: string; expiresAt: string } };
    expect(payload.data.token.split(".").length).toBe(3);
    expect(await verifyAdminToken(ENV, payload.data.token)).toBe(true);
    expect(new Date(payload.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("rejects a wrong password without leaking a token", async () => {
    const response = await handleAdminLogin(loginRequest("wrong-password", "10.0.0.3"), ENV);
    expect(response.status).toBe(401);
    const payload = (await response.json()) as { data?: unknown; error?: { code?: string } };
    expect(payload.data).toBeUndefined();
    expect(payload.error?.code).toBe("invalid_password");
  });

  it("refuses to log in when no password is configured", async () => {
    const response = await handleAdminLogin(loginRequest(PASSWORD, "10.0.0.4"), {});
    expect(response.status).toBe(503);
  });

  it("rejects tampered and expired tokens", async () => {
    const { token } = await createAdminToken(ENV);
    expect(await verifyAdminToken(ENV, `${token}x`)).toBe(false);
    expect(await verifyAdminToken(ENV, token.replace(/\.[^.]+$/, ".forged"))).toBe(false);

    const expired = await createAdminToken(ENV, -1000);
    expect(await verifyAdminToken(ENV, expired.token)).toBe(false);

    // A different signing secret invalidates the same payload.
    expect(await verifyAdminToken({ ...ENV, ADMIN_SESSION_SECRET: "rotated" }, token)).toBe(false);
  });

  it("rejects admin routes without either credential", async () => {
    const response = await handleAdmin(
      new Request("https://app.example.com/api/admin/diagnostics"),
      ENV,
    );
    expect(response.status).toBe(401);
  });
});

describe("admin panel → backend → database", () => {
  it("accepts the login token and reports a live database round trip", async () => {
    mockDatabase();
    const { token } = await createAdminToken(ENV);

    const response = await handleAdmin(
      new Request("https://app.example.com/api/admin/diagnostics", {
        headers: { "x-admin-key": token },
      }),
      ENV,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      data: {
        ok: boolean;
        authMode: string;
        checks: { adminAuth: { ok: boolean }; database: { ok: boolean; tables: Record<string, { ok: boolean }> }; encryption: { ok: boolean } };
        counts: { providers: number; models: number; enabledModels: number };
      };
    };
    expect(payload.data.ok).toBe(true);
    expect(payload.data.authMode).toBe("password");
    expect(payload.data.checks.adminAuth.ok).toBe(true);
    expect(payload.data.checks.encryption.ok).toBe(true);
    expect(Object.values(payload.data.checks.database.tables).every((table) => table.ok)).toBe(true);
    expect(payload.data.counts).toEqual({ providers: 2, models: 3, enabledModels: 2 });
  });

  it("reports the database as unreachable instead of crashing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new Error("connection refused");
      }),
    );
    const { token } = await createAdminToken(ENV);

    const response = await handleAdmin(
      new Request("https://app.example.com/api/admin/diagnostics", {
        headers: { "x-admin-key": token },
      }),
      ENV,
    );

    expect(response.status).toBe(200);
    const payload = (await response.json()) as { data: { ok: boolean; checks: { database: { ok: boolean } } } };
    expect(payload.data.ok).toBe(false);
    expect(payload.data.checks.database.ok).toBe(false);
  });
});

describe("provider creation", () => {
  interface Call {
    url: string;
    method: string;
    body: unknown;
  }

  function mockProviderWrites(options: { keyInsertStatus?: number } = {}): Call[] {
    const calls: Call[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        const body = typeof init?.body === "string" ? JSON.parse(init.body) : undefined;
        calls.push({ url, method, body });
        const json = (value: unknown, status = 200) =>
          new Response(JSON.stringify(value), { status, headers: { "Content-Type": "application/json" } });
        if (url.includes("/rest/v1/providers") && method === "POST") {
          return json([
            {
              id: "provider-new",
              name: "Gemini",
              base_url: "https://generativelanguage.googleapis.com/v1beta",
              api_format: "gemini",
              auth_header: "x-goog-api-key",
              auth_prefix: "",
              extra_headers: {},
              icon: null,
              color: null,
              notes: null,
              enabled: true,
              created_at: "",
              updated_at: "",
            },
          ]);
        }
        if (url.includes("/rest/v1/provider_keys") && method === "POST") {
          return options.keyInsertStatus && options.keyInsertStatus >= 400
            ? json({ message: "insert failed" }, options.keyInsertStatus)
            : json([], 201);
        }
        if (url.includes("/rest/v1/providers") && method === "DELETE") {
          return new Response(null, { status: 204 });
        }
        return json([]);
      }),
    );
    return calls;
  }

  async function createRequest(body: unknown): Promise<Request> {
    const { token } = await createAdminToken(ENV);
    return new Request("https://app.example.com/api/admin/providers", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-admin-key": token },
      body: JSON.stringify(body),
    });
  }

  const geminiBody = {
    name: "Gemini",
    baseUrl: "https://generativelanguage.googleapis.com",
    apiFormat: "gemini",
    authHeader: "",
    authPrefix: "",
    keys: ["AIza-test"],
  };

  it("defaults Gemini to the x-goog-api-key header, not Authorization", async () => {
    const calls = mockProviderWrites();
    const response = await handleAdmin(await createRequest(geminiBody), ENV);

    expect(response.status).toBe(201);
    const insert = calls.find((call) => call.method === "POST" && call.url.endsWith("/rest/v1/providers"));
    const row = (insert?.body as Array<{ auth_header: string; auth_prefix: string }>)[0];
    expect(row.auth_header).toBe("x-goog-api-key");
    expect(row.auth_prefix).toBe("");
  });

  it("explains a missing Supabase configuration instead of returning a generic 500", async () => {
    const { SUPABASE_URL: _url, SUPABASE_SERVICE_ROLE_KEY: _serviceRole, ...envWithoutSupabase } = ENV;
    const response = await handleAdmin(await createRequest(geminiBody), envWithoutSupabase);

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { error: { code?: string } };
    expect(payload.error.code).toBe("supabase_not_configured");
  });

  it("refuses to create a provider with keys when encryption is not configured", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);
    const { MASTER_ENCRYPTION_KEY: _ignored, ...envWithoutMaster } = ENV;

    const response = await handleAdmin(await createRequest(geminiBody), envWithoutMaster);

    expect(response.status).toBe(503);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rolls back the provider when its keys cannot be stored", async () => {
    const calls = mockProviderWrites({ keyInsertStatus: 500 });
    const response = await handleAdmin(await createRequest(geminiBody), ENV);

    expect(response.status).toBe(500);
    expect(
      calls.some((call) => call.method === "DELETE" && call.url.includes("/rest/v1/providers")),
    ).toBe(true);
  });
});

describe("admin users analytics, blocking & model visibility sync", () => {
  it("returns online status, offlineDays, message counts, and admin vs default models per user", async () => {
    const nowIso = new Date().toISOString();
    const fourDaysAgo = new Date(Date.now() - 4 * 86_400_000 - 3_600_000).toISOString();

    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const url = String(input);
        const json = (value: unknown) =>
          new Response(JSON.stringify(value), { status: 200, headers: { "Content-Type": "application/json" } });
        if (url.includes("/rest/v1/profiles")) {
          return json([
            { id: "u-online", email: "ali@example.com", display_name: "Ali", role: "user", status: "active", created_at: fourDaysAgo, last_seen_at: nowIso },
            { id: "u-away", email: "sara@example.com", display_name: "Sara", role: "user", status: "active", created_at: fourDaysAgo, last_seen_at: fourDaysAgo },
          ]);
        }
        if (url.includes("/rest/v1/user_usage_summary")) {
          return json([
            { user_id: "u-online", prompt_tokens: 1200, completion_tokens: 800, requests: 3 },
            { user_id: "u-away", prompt_tokens: 300, completion_tokens: 200, requests: 1 },
          ]);
        }
        if (url.includes("/rest/v1/providers")) {
          return json([{ id: "prov-admin-1", name: "OpenRouter" }]);
        }
        if (url.includes("/rest/v1/usage_events")) {
          return json([
            { user_id: "u-online", provider_id: "prov-admin-1", model_name: "Claude 3.7 Sonnet", provider_name: "OpenRouter", prompt_tokens: 500, completion_tokens: 400, created_at: nowIso },
            { user_id: "u-online", provider_id: "prov-admin-1", model_name: "Claude 3.7 Sonnet", provider_name: "OpenRouter", prompt_tokens: 400, completion_tokens: 200, created_at: nowIso },
            { user_id: "u-online", provider_id: null, model_name: "OpenHarneks Default", provider_name: "OpenHarneks", prompt_tokens: 300, completion_tokens: 200, created_at: nowIso },
            { user_id: "u-away", provider_id: null, model_name: "OpenHarneks Default", provider_name: "OpenHarneks", prompt_tokens: 300, completion_tokens: 200, created_at: fourDaysAgo },
          ]);
        }
        return json([]);
      }),
    );

    const { token } = await createAdminToken(ENV);
    const res = await handleAdmin(
      new Request("https://app.example.com/api/admin/users", { headers: { "x-admin-key": token } }),
      ENV,
    );
    expect(res.status).toBe(200);
    const payload = (await res.json()) as {
      data: {
        users: Array<{
          id: string;
          online: boolean;
          offlineDays: number;
          messagesSent: number;
          modelsUsed: Array<{ model: string; source: string; messages: number }>;
        }>;
      };
    };

    const ali = payload.data.users.find((u) => u.id === "u-online")!;
    expect(ali.online).toBe(true);
    expect(ali.offlineDays).toBe(0);
    expect(ali.messagesSent).toBe(3);
    expect(ali.modelsUsed).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ model: "Claude 3.7 Sonnet", source: "admin", messages: 2 }),
        expect.objectContaining({ model: "OpenHarneks Default", source: "default", messages: 1 }),
      ]),
    );

    const sara = payload.data.users.find((u) => u.id === "u-away")!;
    expect(sara.online).toBe(false);
    expect(sara.offlineDays).toBeGreaterThanOrEqual(4);
    expect(sara.messagesSent).toBe(1);
  });

  it("updates both site_paid and tier when toggling a model between Free, Paid, and Hidden", async () => {
    const patches: Record<string, unknown>[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
        const url = String(input);
        const method = (init?.method ?? "GET").toUpperCase();
        if (url.includes("/rest/v1/catalog_models") && method === "PATCH") {
          const body = JSON.parse(String(init?.body ?? "{}")) as Record<string, unknown>;
          patches.push(body);
          return new Response(
            JSON.stringify([
              {
                id: "m-1",
                provider_id: "p-1",
                upstream_id: "gpt-4o",
                display_name: "GPT-4o",
                enabled: body.enabled ?? true,
                site_paid: body.site_paid ?? false,
                tier: body.tier ?? "free",
                upstream_verified: true,
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }
        return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );

    const { token } = await createAdminToken(ENV);
    // Mark as Free & visible
    const freeRes = await handleAdmin(
      new Request("https://app.example.com/api/admin/models/m-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": token },
        body: JSON.stringify({ enabled: true, paid: false }),
      }),
      ENV,
    );
    expect(freeRes.status).toBe(200);
    expect(patches[0]).toMatchObject({ enabled: true, site_paid: false, tier: "free" });

    // Mark as Paid
    const paidRes = await handleAdmin(
      new Request("https://app.example.com/api/admin/models/m-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": token },
        body: JSON.stringify({ enabled: true, paid: true }),
      }),
      ENV,
    );
    expect(paidRes.status).toBe(200);
    expect(patches[1]).toMatchObject({ enabled: true, site_paid: true, tier: "paid" });

    // Mark as Hidden
    const hideRes = await handleAdmin(
      new Request("https://app.example.com/api/admin/models/m-1", {
        method: "PATCH",
        headers: { "Content-Type": "application/json", "x-admin-key": token },
        body: JSON.stringify({ enabled: false }),
      }),
      ENV,
    );
    expect(hideRes.status).toBe(200);
    expect(patches[2]).toMatchObject({ enabled: false });
  });
});

