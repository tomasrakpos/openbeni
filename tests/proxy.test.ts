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
});
