// Tests for proxy.test; add or update cases here to match observable behavior.
import { afterEach, describe, expect, it, vi } from "vitest";
import { handleProxy } from "../functions/api/proxy";

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
    ...init,
  });
}

describe("handleProxy", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("answers CORS preflight without touching the upstream", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await handleProxy(
      new Request("http://localhost/api/proxy", {
        method: "OPTIONS",
        headers: { Origin: "http://localhost:5173" },
      }),
    );

    expect(response.status).toBe(204);
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("http://localhost:5173");
    expect(response.headers.get("Access-Control-Allow-Origin")).not.toBe("*");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("rejects a missing url parameter", async () => {
    const response = await handleProxy(new Request("http://localhost/api/proxy"));
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({ error: { status: 400 } });
  });

  it("blocks loopback targets", async () => {
    const response = await handleProxy(
      new Request(`http://localhost/api/proxy?url=${encodeURIComponent("http://127.0.0.1:8080/v1/models")}`),
    );
    expect(response.status).toBe(403);
  });

  it("forwards an allowed host, strips browser headers, and keeps the stream open", async () => {
    const upstreamHeaders = new Headers({
      "Content-Type": "text/event-stream",
      "Set-Cookie": "session=secret",
      "Transfer-Encoding": "chunked",
    });
    const fetchMock = vi.fn(async () => new Response("data: {\"x\":1}\n\n", { status: 200, headers: upstreamHeaders }));
    vi.stubGlobal("fetch", fetchMock);

    const target = "https://api.iteracompute.com/v1/chat/completions";
    const response = await handleProxy(
      new Request(`http://localhost/api/proxy?url=${encodeURIComponent(target)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer secret-key",
          Origin: "http://localhost:5173",
          Referer: "http://localhost:5173/chat",
          Cookie: "session=abc",
        },
        body: JSON.stringify({ model: "Auto" }),
      }),
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [calledUrl, calledInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(calledUrl).toBe(target);
    const sent = new Headers(calledInit.headers);
    expect(sent.get("authorization")).toBe("Bearer secret-key");
    expect(sent.get("content-type")).toBe("application/json");
    expect(sent.get("origin")).toBeNull();
    expect(sent.get("referer")).toBeNull();
    expect(sent.get("cookie")).toBeNull();

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("text/event-stream");
    expect(response.headers.get("Set-Cookie")).toBeNull();
    expect(response.headers.get("Transfer-Encoding")).toBeNull();
    await expect(response.text()).resolves.toContain("data:");
  });

  it("honours ALLOWED_HOSTS", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [] })));
    const blocked = await handleProxy(
      new Request(`http://localhost/api/proxy?url=${encodeURIComponent("https://example.com/v1/models")}`),
      { ALLOWED_HOSTS: "api.openai.com,*.openrouter.ai" },
    );
    expect(blocked.status).toBe(403);

    const allowed = await handleProxy(
      new Request(`http://localhost/api/proxy?url=${encodeURIComponent("https://eu.openrouter.ai/v1/models")}`),
      { ALLOWED_HOSTS: "api.openai.com,*.openrouter.ai" },
    );
    expect(allowed.status).toBe(200);
  });

  it("requires PROXY_TOKEN in the header, never the query string", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({})));
    const url = `http://localhost/api/proxy?url=${encodeURIComponent("https://api.openai.com/v1/models")}`;
    const denied = await handleProxy(new Request(url), { PROXY_TOKEN: "s3cret" });
    expect(denied.status).toBe(401);

    const queryToken = await handleProxy(new Request(`${url}&token=s3cret`), { PROXY_TOKEN: "s3cret" });
    expect(queryToken.status).toBe(401);

    const accepted = await handleProxy(new Request(url, { headers: { "x-proxy-token": "s3cret" } }), {
      PROXY_TOKEN: "s3cret",
    });
    expect(accepted.status).toBe(200);
  });

  it("returns 502 when the upstream cannot be reached", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Promise.reject(new Error("boom"))));
    const response = await handleProxy(
      new Request(`http://localhost/api/proxy?url=${encodeURIComponent("https://api.example.com/v1/models")}`),
    );
    expect(response.status).toBe(502);
  });

  it("allows same-origin browser requests on non-localhost deployments while blocking unauthenticated external calls", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ data: [] })));
    const url = `https://app.example.com/api/proxy?url=${encodeURIComponent("https://api.openai.com/v1/models")}`;

    const external = await handleProxy(new Request(url));
    expect(external.status).toBe(503);

    const sameOriginPost = await handleProxy(
      new Request(url, {
        method: "POST",
        headers: { Origin: "https://app.example.com" },
      }),
    );
    expect(sameOriginPost.status).toBe(200);

    const sameOriginGet = await handleProxy(
      new Request(url, {
        method: "GET",
        headers: { "Sec-Fetch-Site": "same-origin" },
      }),
    );
    expect(sameOriginGet.status).toBe(200);

    const crossOrigin = await handleProxy(
      new Request(url, {
        method: "POST",
        headers: { Origin: "https://evil.example.com" },
      }),
    );
    expect(crossOrigin.status).toBe(403);
  });

  it("allows same-host https Origin behind TLS-terminating reverse proxies (http backend URL) while blocking cross-origin", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => jsonResponse({ choices: [{ message: { content: "ok" } }] })));
    const httpBackendUrl = `http://5173-sandbox.e2b.app/api/proxy?url=${encodeURIComponent(
      "https://openrouter.ai/api/v1/chat/completions",
    )}`;

    const sameHostHttps = await handleProxy(
      new Request(httpBackendUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Origin: "https://5173-sandbox.e2b.app",
          "Sec-Fetch-Site": "same-origin",
        },
        body: JSON.stringify({ model: "openai/gpt-4o-mini", messages: [{ role: "user", content: "hi" }] }),
      }),
    );
    expect(sameHostHttps.status).toBe(200);
    expect(sameHostHttps.headers.get("Access-Control-Allow-Origin")).toBe("https://5173-sandbox.e2b.app");

    const evilOrigin = await handleProxy(
      new Request(httpBackendUrl, {
        method: "POST",
        headers: { Origin: "https://evil.example.com" },
        body: JSON.stringify({}),
      }),
    );
    expect(evilOrigin.status).toBe(403);
  });

  it("protects proxy CORS/security headers from upstream overrides, strips x-proxy-token, and requests identity encoding for SSE", async () => {
    const fetchMock = vi.fn(async () =>
      new Response("data: {\"choices\":[{\"delta\":{\"content\":\"hi\"}}]}\n\n", {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream",
          "Access-Control-Allow-Origin": "*",
          "Permissions-Policy": "payment=(self)",
          "Referrer-Policy": "unsafe-url",
        },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const target = "https://openrouter.ai/api/v1/chat/completions";
    const response = await handleProxy(
      new Request(`https://app.example.com/api/proxy?url=${encodeURIComponent(target)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream, application/json",
          Authorization: "Bearer sk-user",
          Origin: "https://app.example.com",
          "x-proxy-token": "my-secret-proxy-token",
        },
        body: JSON.stringify({ model: "m", stream: true, messages: [{ role: "user", content: "hi" }] }),
      }),
      { PROXY_TOKEN: "my-secret-proxy-token" },
    );

    expect(response.status).toBe(200);
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const sent = new Headers(init.headers);
    expect(sent.get("x-proxy-token")).toBeNull();
    expect(sent.get("accept-encoding")).toBe("identity");
    expect(response.headers.get("Access-Control-Allow-Origin")).toBe("https://app.example.com");
    expect(response.headers.get("Referrer-Policy")).toBe("no-referrer");
    expect(response.headers.get("Permissions-Policy")).toBeNull();
  });

  it("retries once without stream_options when an upstream gateway rejects stream_options with 400", async () => {
    const bodies: string[] = [];
    const fetchMock = vi.fn(async (_url: RequestInfo | URL, init?: RequestInit) => {
      const decoded = init?.body instanceof ArrayBuffer ? new TextDecoder().decode(init.body) : String(init?.body ?? "");
      bodies.push(decoded);
      if (bodies.length === 1) {
        return new Response(JSON.stringify({ error: { message: "Unknown field: stream_options" } }), {
          status: 400,
          headers: { "Content-Type": "application/json" },
        });
      }
      return new Response("data: {\"choices\":[{\"delta\":{\"content\":\"fast!\"}}]}\n\ndata: [DONE]\n\n", {
        status: 200,
        headers: { "Content-Type": "text/event-stream" },
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const target = "https://gateway.example.com/v1/chat/completions";
    const response = await handleProxy(
      new Request(`http://localhost/api/proxy?url=${encodeURIComponent(target)}`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "text/event-stream",
        },
        body: JSON.stringify({
          model: "my-model",
          stream: true,
          stream_options: { include_usage: true },
          messages: [{ role: "user", content: "hi" }],
        }),
      }),
    );

    expect(response.status).toBe(200);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(JSON.parse(bodies[0]!)).toHaveProperty("stream_options");
    expect(JSON.parse(bodies[1]!)).not.toHaveProperty("stream_options");
    await expect(response.text()).resolves.toContain("fast!");
  });

  it("canonically rewrites /v1 and /api to /api/v1 for coarena.ai and openrouter.ai without hitting an HTML 404", async () => {
    const called: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        called.push(String(input));
        return jsonResponse({ choices: [{ message: { content: "hi from coarena" } }] });
      }),
    );

    for (const rawUrl of [
      "https://coarena.ai/v1/chat/completions",
      "https://coarena.ai/api/chat/completions",
    ]) {
      const res = await handleProxy(
        new Request(`http://localhost/api/proxy?url=${encodeURIComponent(rawUrl)}`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: "Bearer coa_test" },
          body: JSON.stringify({ model: "claude-fable-5", messages: [{ role: "user", content: "hi" }] }),
        }),
      );
      expect(res.status).toBe(200);
    }

    expect(called).toEqual([
      "https://coarena.ai/api/v1/chat/completions",
      "https://coarena.ai/api/v1/chat/completions",
    ]);
  });

  it("auto-recovers custom /v1 providers returning HTML 404 by retrying at /api/v1 and returns clean JSON if still HTML", async () => {
    const called: string[] = [];
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: RequestInfo | URL) => {
        const u = String(input);
        called.push(u);
        if (u.includes("/api/v1/")) {
          return jsonResponse({ choices: [{ message: { content: "recovered!" } }] });
        }
        return new Response("<!DOCTYPE html><html>404</html>", {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        });
      }),
    );

    const recovered = await handleProxy(
      new Request(
        `http://localhost/api/proxy?url=${encodeURIComponent("https://custom-next-ai.example.com/v1/chat/completions")}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ model: "m", messages: [{ role: "user", content: "hi" }] }),
        },
      ),
    );
    expect(recovered.status).toBe(200);
    expect(called).toEqual([
      "https://custom-next-ai.example.com/v1/chat/completions",
      "https://custom-next-ai.example.com/api/v1/chat/completions",
    ]);

    // When both return HTML 404, surface a clean JSON error instead of raw HTML
    vi.stubGlobal(
      "fetch",
      vi.fn(async () =>
        new Response("<!DOCTYPE html><html>not found</html>", {
          status: 404,
          headers: { "Content-Type": "text/html; charset=utf-8" },
        }),
      ),
    );
    const stillHtml = await handleProxy(
      new Request(
        `http://localhost/api/proxy?url=${encodeURIComponent("https://bad-host.example.com/v1/chat/completions")}`,
        { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" },
      ),
    );
    expect(stillHtml.status).toBe(404);
    const errPayload = (await stillHtml.json()) as { error: { message: string } };
    expect(errPayload.error.message).toContain("HTML 404");
    expect(errPayload.error.message).not.toContain("<!DOCTYPE");
  });
});
