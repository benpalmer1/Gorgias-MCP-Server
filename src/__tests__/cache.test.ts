import { describe, it, expect, vi } from "vitest";
import { TtlCache, CACHE_TTL_MS, fetchAllPages } from "../cache.js";
import type { GorgiasClient } from "../client.js";

describe("TtlCache", () => {
  it("stores and retrieves values", () => {
    const cache = new TtlCache<string>();
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");
  });

  it("returns undefined for missing keys", () => {
    const cache = new TtlCache<string>();
    expect(cache.get("missing")).toBeUndefined();
  });

  it("expires entries after TTL", () => {
    vi.useFakeTimers();
    const cache = new TtlCache<string>(100); // 100ms TTL
    cache.set("key1", "value1");
    expect(cache.get("key1")).toBe("value1");

    vi.advanceTimersByTime(150);
    expect(cache.get("key1")).toBeUndefined();
    vi.useRealTimers();
  });

  it("clears all entries", () => {
    const cache = new TtlCache<string>();
    cache.set("a", "1");
    cache.set("b", "2");
    cache.clear();
    expect(cache.get("a")).toBeUndefined();
    expect(cache.get("b")).toBeUndefined();
  });

  it("has default TTL of 5 minutes", () => {
    expect(CACHE_TTL_MS).toBe(10 * 60 * 1000);
  });
});

// ---------------------------------------------------------------------------
// B2/C3 — fetchAllPages exported helper
// ---------------------------------------------------------------------------

function makeFetchClient(responses: unknown[]) {
  let idx = 0;
  const calls: Array<{ path: string; query?: Record<string, unknown> }> = [];
  const client = {
    async get(path: string, query?: Record<string, unknown>) {
      calls.push({ path, query });
      return responses[idx++] ?? { data: [] };
    },
    async post() { return {}; },
    async put() { return {}; },
    async delete() { return {}; },
    async request() { throw new Error("not implemented"); },
    async search() { return []; },
  } as unknown as GorgiasClient;
  return { client, calls };
}

describe("fetchAllPages", () => {
  it("C3.1: single page array response returns items, no truncation", async () => {
    const { client } = makeFetchClient([[1, 2, 3]]);
    const result = await fetchAllPages(client, "/api/teams");
    expect(result.items).toEqual([1, 2, 3]);
    expect(result.pagesFetched).toBe(1);
    expect(result.truncated).toBe(false);
  });

  it("C3.2: multi-page wrapped response concatenates all pages", async () => {
    const { client } = makeFetchClient([
      { data: [1, 2], meta: { next_cursor: "p2" } },
      { data: [3, 4], meta: { next_cursor: null } },
    ]);
    const result = await fetchAllPages(client, "/api/tickets/1/messages");
    expect(result.items).toEqual([1, 2, 3, 4]);
    expect(result.pagesFetched).toBe(2);
    expect(result.truncated).toBe(false);
  });

  it("C3.3: stops at maxItems mid-page and sets truncated=true", async () => {
    const { client } = makeFetchClient([
      { data: Array.from({ length: 100 }, (_, i) => i), meta: { next_cursor: "p2" } },
    ]);
    const result = await fetchAllPages(client, "/api/test", { maxItems: 15 });
    expect(result.items.length).toBe(15);
    expect(result.truncated).toBe(true);
  });

  it("C3.4: stops at maxItems exactly at page boundary without truncation", async () => {
    const { client } = makeFetchClient([
      { data: Array.from({ length: 100 }, (_, i) => i), meta: { next_cursor: null } },
    ]);
    const result = await fetchAllPages(client, "/api/test", { maxItems: 100 });
    expect(result.items.length).toBe(100);
    expect(result.truncated).toBe(false);
  });

  it("C3.5: empty next_cursor terminates loop", async () => {
    const { client, calls } = makeFetchClient([
      { data: [1, 2], meta: { next_cursor: "" } },
    ]);
    const result = await fetchAllPages(client, "/api/test");
    expect(result.items).toEqual([1, 2]);
    expect(calls.length).toBe(1);
  });

  it("C3.6: pagesFetched counter accurate across N pages", async () => {
    const { client } = makeFetchClient([
      { data: [1], meta: { next_cursor: "p2" } },
      { data: [2], meta: { next_cursor: "p3" } },
      { data: [3], meta: { next_cursor: null } },
    ]);
    const result = await fetchAllPages(client, "/api/test");
    expect(result.pagesFetched).toBe(3);
  });

  it("C3.7: wire format sends limit=100 on every page", async () => {
    const { client, calls } = makeFetchClient([
      { data: [1], meta: { next_cursor: "p2" } },
      { data: [2], meta: { next_cursor: null } },
    ]);
    await fetchAllPages(client, "/api/test");
    expect(calls[0].query).toEqual({ limit: 100 });
    expect(calls[1].query).toEqual({ limit: 100, cursor: "p2" });
  });
});
