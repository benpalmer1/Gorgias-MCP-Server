import { describe, it, expect, vi } from "vitest";
import { TtlCache, CACHE_TTL_MS } from "../cache.js";

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
