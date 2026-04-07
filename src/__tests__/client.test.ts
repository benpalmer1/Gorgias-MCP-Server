/**
 * Unit tests for the GorgiasClient HTTP wrapper.
 *
 * Covers:
 *   - buildBaseUrl edge cases (subdomain / full URL / http rejection)
 *   - Query parameter encoding
 *   - 429 retry loop with exponential backoff and Retry-After cap
 *   - 204 / 202 / Content-Length: 0 handling
 *   - JSON content-type variants (application/vnd.api+json, etc.)
 *   - search() shape normalisation
 *   - Constructor missing-credential error
 *
 * The fetch global is replaced with a stub that records every call and
 * returns canned Response objects.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { GorgiasClient } from "../client.js";
import { GorgiasApiError } from "../errors.js";

// ---------------------------------------------------------------------------
// fetch stub helpers
// ---------------------------------------------------------------------------

interface RecordedFetch {
  url: string;
  init?: RequestInit;
}

function makeFetchStub(responses: Response[]): {
  stub: typeof fetch;
  calls: RecordedFetch[];
} {
  const calls: RecordedFetch[] = [];
  let i = 0;
  const stub: typeof fetch = async (input: unknown, init?: unknown) => {
    calls.push({
      url: typeof input === "string" ? input : (input as Request).url,
      init: init as RequestInit | undefined,
    });
    const response = responses[i++];
    if (!response) {
      throw new Error(
        `fetch stub exhausted (call ${i} of ${responses.length})`,
      );
    }
    return response;
  };
  return { stub, calls };
}

function jsonResponse(
  status: number,
  body: unknown,
  contentType = "application/json",
): Response {
  return new Response(JSON.stringify(body), {
    status,
    statusText: status === 200 ? "OK" : "Error",
    headers: { "content-type": contentType },
  });
}

function emptyResponse(status: number, statusText = ""): Response {
  return new Response("", {
    status,
    statusText,
    headers: { "content-length": "0" },
  });
}

function makeClient(): GorgiasClient {
  return new GorgiasClient({
    domain: "testtenant",
    email: "test@example.com",
    apiKey: "test-api-key-1234",
  });
}

// ---------------------------------------------------------------------------
// Constructor / buildBaseUrl
// ---------------------------------------------------------------------------

describe("GorgiasClient constructor", () => {
  it("throws when domain is missing", () => {
    expect(() => new GorgiasClient({ domain: "", email: "x@y.com", apiKey: "k" }))
      .toThrow(/Missing required Gorgias credentials/);
  });

  it("throws when email is missing", () => {
    expect(() => new GorgiasClient({ domain: "x", email: "", apiKey: "k" }))
      .toThrow(/Missing required Gorgias credentials/);
  });

  it("throws when apiKey is missing", () => {
    expect(() => new GorgiasClient({ domain: "x", email: "x@y.com", apiKey: "" }))
      .toThrow(/Missing required Gorgias credentials/);
  });

  it("rejects insecure http:// URLs", () => {
    expect(
      () => new GorgiasClient({ domain: "http://x.gorgias.com", email: "x@y.com", apiKey: "k" }),
    ).toThrow(/Insecure http:\/\/ URLs are not allowed/);
  });
});

// ---------------------------------------------------------------------------
// Query parameter encoding (M12)
// ---------------------------------------------------------------------------

describe("query parameter encoding", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it("appends array values as repeated query params", async () => {
    const { stub, calls } = makeFetchStub([jsonResponse(200, { ok: true })]);
    globalThis.fetch = stub;
    const client = makeClient();
    await client.get("/api/events", { user_ids: [1, 2, 3] });
    const url = calls[0].url;
    expect(url).toContain("user_ids=1");
    expect(url).toContain("user_ids=2");
    expect(url).toContain("user_ids=3");
  });

  it("skips top-level null and undefined values", async () => {
    const { stub, calls } = makeFetchStub([jsonResponse(200, {})]);
    globalThis.fetch = stub;
    const client = makeClient();
    await client.get("/api/customers", { email: null, name: undefined, limit: 30 });
    const url = calls[0].url;
    expect(url).toContain("limit=30");
    expect(url).not.toContain("email=");
    expect(url).not.toContain("name=");
  });

  it("skips null and undefined values inside arrays (no literal 'null'/'undefined')", async () => {
    const { stub, calls } = makeFetchStub([jsonResponse(200, {})]);
    globalThis.fetch = stub;
    const client = makeClient();
    await client.get("/api/events", { user_ids: [1, null, 2, undefined, 3] });
    const url = calls[0].url;
    expect(url).not.toContain("user_ids=null");
    expect(url).not.toContain("user_ids=undefined");
    expect(url).toContain("user_ids=1");
    expect(url).toContain("user_ids=2");
    expect(url).toContain("user_ids=3");
  });

  it("rejects object values rather than coercing to '[object Object]'", async () => {
    const { stub } = makeFetchStub([jsonResponse(200, {})]);
    globalThis.fetch = stub;
    const client = makeClient();
    await expect(
      client.get("/api/customers", { meta: { nested: 1 } }),
    ).rejects.toThrow(/scalar/);
  });

  it("rejects object values inside arrays", async () => {
    const { stub } = makeFetchStub([jsonResponse(200, {})]);
    globalThis.fetch = stub;
    const client = makeClient();
    await expect(
      client.get("/api/events", { user_ids: [1, { nested: true }, 3] }),
    ).rejects.toThrow(/scalar/);
  });
});

// ---------------------------------------------------------------------------
// 429 retry loop with exponential backoff (M8)
// ---------------------------------------------------------------------------

describe("429 retry loop", () => {
  let originalFetch: typeof fetch;

  beforeEach(() => {
    originalFetch = globalThis.fetch;
    vi.useFakeTimers();
  });

  afterEach(() => {
    globalThis.fetch = originalFetch;
    vi.useRealTimers();
  });

  it("retries up to 2 times on 429 (3 total attempts) and succeeds on the 3rd", async () => {
    const { stub, calls } = makeFetchStub([
      new Response("", { status: 429, headers: { "retry-after": "1" } }),
      new Response("", { status: 429, headers: { "retry-after": "1" } }),
      jsonResponse(200, { ok: true }),
    ]);
    globalThis.fetch = stub;

    const client = makeClient();
    const promise = client.get("/api/tickets");

    // Drain all timers including the random jitter
    await vi.runAllTimersAsync();
    const result = await promise;

    expect(calls).toHaveLength(3);
    expect(result).toEqual({ ok: true });
  });

  it("throws GorgiasApiError(429) after 3 unsuccessful attempts", async () => {
    const { stub, calls } = makeFetchStub([
      new Response("", { status: 429, headers: { "retry-after": "1" } }),
      new Response("", { status: 429, headers: { "retry-after": "1" } }),
      new Response("", { status: 429, headers: { "retry-after": "1" } }),
    ]);
    globalThis.fetch = stub;

    const client = makeClient();
    const promise = client.get("/api/tickets");

    // Catch the rejection in parallel with timer advancement
    const errPromise = expect(promise).rejects.toBeInstanceOf(GorgiasApiError);
    await vi.runAllTimersAsync();
    await errPromise;
    expect(calls).toHaveLength(3);
  });

  it("caps Retry-After at 60 seconds even if the server says 999999", async () => {
    // The cap means the fake timer only needs to advance 60s + jitter to
    // unblock the second attempt; if the cap were broken the test would
    // hang past the timer budget.
    const { stub } = makeFetchStub([
      new Response("", { status: 429, headers: { "retry-after": "999999" } }),
      jsonResponse(200, { ok: true }),
    ]);
    globalThis.fetch = stub;

    const client = makeClient();
    const promise = client.get("/api/tickets");

    // Advance just over 60 seconds + max jitter
    await vi.advanceTimersByTimeAsync(60_500);
    await expect(promise).resolves.toEqual({ ok: true });
  });

  it("falls back to exponential backoff when Retry-After is missing or 0", async () => {
    const { stub } = makeFetchStub([
      new Response("", { status: 429 }),
      new Response("", { status: 429, headers: { "retry-after": "0" } }),
      jsonResponse(200, { ok: true }),
    ]);
    globalThis.fetch = stub;

    const client = makeClient();
    const promise = client.get("/api/tickets");
    await vi.runAllTimersAsync();
    await expect(promise).resolves.toEqual({ ok: true });
  });
});

// ---------------------------------------------------------------------------
// Empty-body responses (204 / 202 / Content-Length: 0)
// ---------------------------------------------------------------------------

describe("empty-body responses", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("returns a structured success object for 204 No Content", async () => {
    // 204 responses must have a null body (per the WHATWG fetch spec).
    const { stub } = makeFetchStub([
      new Response(null, { status: 204, statusText: "No Content" }),
    ]);
    globalThis.fetch = stub;
    const result = await makeClient().delete("/api/tickets/1") as { success: boolean; status: number };
    expect(result.success).toBe(true);
    expect(result.status).toBe(204);
  });

  it("returns a structured success object for 202 Accepted with empty body", async () => {
    const { stub } = makeFetchStub([emptyResponse(202, "Accepted")]);
    globalThis.fetch = stub;
    const result = await makeClient().put("/api/customers/1/data", { foo: "bar" }) as { success: boolean; status: number };
    expect(result.success).toBe(true);
    expect(result.status).toBe(202);
  });

  it("returns a structured success object for any 2xx with content-length: 0", async () => {
    const { stub } = makeFetchStub([
      new Response("", { status: 200, headers: { "content-length": "0" } }),
    ]);
    globalThis.fetch = stub;
    const result = await makeClient().get("/api/whatever") as { success: boolean; status: number };
    expect(result.success).toBe(true);
  });

  it("does NOT throw when JSON content-type is set but body is empty (defensive)", async () => {
    const { stub } = makeFetchStub([
      new Response("", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    ]);
    globalThis.fetch = stub;
    const result = await makeClient().get("/api/whatever") as { success: boolean };
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Content-Type variants (M11)
// ---------------------------------------------------------------------------

describe("JSON content-type detection", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("parses application/json", async () => {
    const { stub } = makeFetchStub([jsonResponse(200, { x: 1 }, "application/json")]);
    globalThis.fetch = stub;
    expect(await makeClient().get("/api/x")).toEqual({ x: 1 });
  });

  it("parses application/json; charset=utf-8", async () => {
    const { stub } = makeFetchStub([
      jsonResponse(200, { x: 1 }, "application/json; charset=utf-8"),
    ]);
    globalThis.fetch = stub;
    expect(await makeClient().get("/api/x")).toEqual({ x: 1 });
  });

  it("parses application/vnd.api+json", async () => {
    const { stub } = makeFetchStub([
      jsonResponse(200, { x: 1 }, "application/vnd.api+json"),
    ]);
    globalThis.fetch = stub;
    expect(await makeClient().get("/api/x")).toEqual({ x: 1 });
  });

  it("parses application/problem+json", async () => {
    const { stub } = makeFetchStub([
      jsonResponse(200, { x: 1 }, "application/problem+json"),
    ]);
    globalThis.fetch = stub;
    expect(await makeClient().get("/api/x")).toEqual({ x: 1 });
  });

  it("returns text body wrapped in { content } for non-JSON content types", async () => {
    const { stub } = makeFetchStub([
      new Response("hello,world", {
        status: 200,
        headers: { "content-type": "text/csv" },
      }),
    ]);
    globalThis.fetch = stub;
    expect(await makeClient().get("/api/x")).toEqual({ content: "hello,world" });
  });
});

// ---------------------------------------------------------------------------
// search() shape normalisation
// ---------------------------------------------------------------------------

describe("search() shape normalisation", () => {
  let originalFetch: typeof fetch;
  beforeEach(() => { originalFetch = globalThis.fetch; });
  afterEach(() => { globalThis.fetch = originalFetch; });

  it("returns the array directly when the API responds with a raw array", async () => {
    const { stub } = makeFetchStub([jsonResponse(200, [{ id: 1 }, { id: 2 }])]);
    globalThis.fetch = stub;
    const result = await makeClient().search({ type: "customer" });
    expect(result).toEqual([{ id: 1 }, { id: 2 }]);
  });

  it("unwraps the data field when the API responds with { data: [...] }", async () => {
    const { stub } = makeFetchStub([jsonResponse(200, { data: [{ id: 3 }] })]);
    globalThis.fetch = stub;
    const result = await makeClient().search({ type: "customer" });
    expect(result).toEqual([{ id: 3 }]);
  });
});
