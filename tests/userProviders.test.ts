// Tests for user-owned (BYOK) provider management API (/api/user-providers).
import { afterEach, describe, expect, it, vi } from "vitest";
import { decryptSecret } from "../functions/api/_lib/crypto";
import {
  handleUserProviders,
  maskKeyHint,
  type UserProviderEnv,
} from "../functions/api/_lib/userProviders";

const MASTER_KEY = "fedcba9876543210fedcba9876543210fedcba9876543210fedcba9876543210";

const ENV: UserProviderEnv = {
  SUPABASE_URL: "https://db.example.supabase.co",
  SUPABASE_ANON_KEY: "anon-key",
  SUPABASE_SERVICE_ROLE_KEY: "service-role-key",
  MASTER_ENCRYPTION_KEY: MASTER_KEY,
};

let ipCounter = 50;
function apiRequest(path: string, method = "GET", body?: unknown, token = "jwt-user-1"): Request {
  ipCounter += 1;
  return new Request(`https://app.example.com${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      "cf-connecting-ip": `203.0.113.${ipCounter % 250}`,
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("maskKeyHint", () => {
  it("masks API keys without exposing the middle secret", () => {
    expect(maskKeyHint("sk-1234567890abcdef")).toBe("sk-1…cdef");
    expect(maskKeyHint("short")).toBe("••••");
    expect(maskKeyHint("")).toBe("");
  });
});

describe("handleUserProviders", () => {
  function setupDbMock() {
    let insertedProvider: Record<string, unknown> | null = null;
    let insertedModels: Record<string, unknown>[] = [];
    let deletedPaths: string[] = [];

    const mockFetch = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      const method = (init?.method ?? "GET").toUpperCase();

      if (url.endsWith("/auth/v1/user")) {
        return new Response(
          JSON.stringify({ id: "user-1", email: "user@example.com", user_metadata: { display_name: "Alice" } }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        );
      }

      if (url.startsWith(`${ENV.SUPABASE_URL}/rest/v1/`)) {
        const restPath = url.slice(`${ENV.SUPABASE_URL}/rest/v1/`.length);

        if (restPath.startsWith("profiles?")) {
          return new Response(
            JSON.stringify([
              {
                id: "user-1",
                email: "user@example.com",
                display_name: "Alice",
                role: "user",
                status: "active",
                credits: 0,
                daily_token_limit: null,
                monthly_token_limit: null,
                created_at: "2026-01-01T00:00:00.000Z",
                last_seen_at: new Date().toISOString(),
              },
            ]),
            { status: 200, headers: { "Content-Type": "application/json" } },
          );
        }

        if (restPath === "user_providers" && method === "POST") {
          const rows = JSON.parse(String(init?.body ?? "[]")) as Record<string, unknown>[];
          insertedProvider = {
            id: "up-1",
            ...rows[0],
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          };
          return new Response(JSON.stringify([insertedProvider]), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (restPath.startsWith("user_providers?") && method === "GET") {
          if (restPath.includes("id=eq.up-1")) {
            return new Response(JSON.stringify(insertedProvider ? [insertedProvider] : []), {
              status: 200,
              headers: { "Content-Type": "application/json" },
            });
          }
          return new Response(JSON.stringify(insertedProvider ? [insertedProvider] : []), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (restPath.startsWith("user_providers?") && method === "DELETE") {
          deletedPaths.push(restPath);
          insertedProvider = null;
          return new Response(null, { status: 204 });
        }

        if (restPath.startsWith("user_models") && method === "POST") {
          const rows = JSON.parse(String(init?.body ?? "[]")) as Record<string, unknown>[];
          insertedModels = rows.map((row, idx) => ({
            id: `um-${idx + 1}`,
            ...row,
            created_at: "2026-01-01T00:00:00.000Z",
            updated_at: "2026-01-01T00:00:00.000Z",
          }));
          return new Response(JSON.stringify(insertedModels), {
            status: 201,
            headers: { "Content-Type": "application/json" },
          });
        }

        if (restPath.startsWith("user_models?") && method === "GET") {
          return new Response(JSON.stringify(insertedModels), {
            status: 200,
            headers: { "Content-Type": "application/json" },
          });
        }
      }

      return new Response(JSON.stringify([]), { status: 200, headers: { "Content-Type": "application/json" } });
    });

    vi.stubGlobal("fetch", mockFetch);
    return {
      get insertedProvider() {
        return insertedProvider;
      },
      get deletedPaths() {
        return deletedPaths;
      },
    };
  }

  it("creates a user provider with an encrypted API key, hides ciphertext, and marks models as credit-exempt BYOK", async () => {
    const db = setupDbMock();

    const createRes = await handleUserProviders(
      apiRequest("/api/user-providers", "POST", {
        name: "My OpenAI",
        baseUrl: "https://api.openai.com",
        apiFormat: "openai",
        apiKey: "sk-my-secret-key-9876",
        models: [{ upstreamId: "gpt-4o", displayName: "GPT-4o (BYOK)" }],
      }),
      ENV,
    );

    expect(createRes.status).toBe(201);
    const created = (await createRes.json()) as {
      data: {
        provider: {
          id: string;
          baseUrl: string;
          hasKey: boolean;
          keyHint: string;
          billingSource: string;
          consumesCredits: boolean;
          api_key_ciphertext?: string;
          models: { upstreamId: string; billingSource: string; consumesCredits: boolean }[];
        };
      };
    };

    expect(created.data.provider.baseUrl).toBe("https://api.openai.com/v1");
    expect(created.data.provider.hasKey).toBe(true);
    expect(created.data.provider.keyHint).toBe("sk-m…9876");
    expect(created.data.provider.billingSource).toBe("byok");
    expect(created.data.provider.consumesCredits).toBe(false);
    expect(created.data.provider.api_key_ciphertext).toBeUndefined();
    expect(created.data.provider.models[0]).toMatchObject({
      upstreamId: "gpt-4o",
      billingSource: "byok",
      consumesCredits: false,
    });

    // Verify stored key is actually AES-256-GCM encrypted in DB, not plaintext
    const storedCiphertext = String(db.insertedProvider?.api_key_ciphertext ?? "");
    expect(storedCiphertext).not.toContain("sk-my-secret-key-9876");
    expect(await decryptSecret(MASTER_KEY, storedCiphertext)).toBe("sk-my-secret-key-9876");

    // GET /api/user-providers returns the saved provider without ciphertext
    const listRes = await handleUserProviders(apiRequest("/api/user-providers", "GET"), ENV);
    expect(listRes.status).toBe(200);
    const listed = (await listRes.json()) as { data: { providers: Record<string, unknown>[] } };
    expect(listed.data.providers).toHaveLength(1);
    expect(listed.data.providers[0]).not.toHaveProperty("api_key_ciphertext");

    // DELETE /api/user-providers/:id scopes delete by user_id
    const delRes = await handleUserProviders(apiRequest("/api/user-providers/up-1", "DELETE"), ENV);
    expect(delRes.status).toBe(200);
    expect(db.deletedPaths[0]).toContain("user_id=eq.user-1");
  });

  it("rejects private/SSRF base URLs and unauthenticated callers", async () => {
    setupDbMock();

    const unauth = await handleUserProviders(apiRequest("/api/user-providers", "GET", undefined, ""), ENV);
    expect(unauth.status).toBe(401);

    const ssrf = await handleUserProviders(
      apiRequest("/api/user-providers", "POST", {
        name: "Local",
        baseUrl: "https://169.254.169.254/latest",
        apiFormat: "openai",
      }),
      ENV,
    );
    expect(ssrf.status).toBe(400);
  });
});
