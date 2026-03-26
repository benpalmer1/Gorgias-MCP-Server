import { describe, it, expect } from "vitest";
import { GorgiasError, GorgiasApiError } from "../errors.js";

describe("GorgiasError", () => {
  it("creates error with message", () => {
    const err = new GorgiasError("test error");
    expect(err.message).toBe("test error");
    expect(err.name).toBe("GorgiasError");
    expect(err).toBeInstanceOf(Error);
  });

  it("preserves cause", () => {
    const cause = new Error("root cause");
    const err = new GorgiasError("wrapped", cause);
    expect(err.cause).toBe(cause);
  });

  it("does not set cause when omitted", () => {
    const err = new GorgiasError("test");
    expect(err.cause).toBeUndefined();
  });
});

describe("GorgiasApiError", () => {
  it("creates API error with status code", () => {
    const err = new GorgiasApiError("not found", 404);
    expect(err.message).toBe("not found");
    expect(err.statusCode).toBe(404);
    expect(err.rateLimited).toBe(false);
    expect(err.retryAfter).toBeNull();
    expect(err.name).toBe("GorgiasApiError");
    expect(err).toBeInstanceOf(GorgiasApiError);
    expect(err).toBeInstanceOf(GorgiasError);
    expect(err).toBeInstanceOf(Error);
  });

  it("creates rate-limited error with retry-after", () => {
    const err = new GorgiasApiError("rate limited", 429, {
      rateLimited: true,
      retryAfter: "5",
    });
    expect(err.statusCode).toBe(429);
    expect(err.rateLimited).toBe(true);
    expect(err.retryAfter).toBe("5");
  });

  it("handles null status code", () => {
    const err = new GorgiasApiError("network error", null);
    expect(err.statusCode).toBeNull();
  });

  it("preserves cause through options", () => {
    const cause = new Error("root cause");
    const err = new GorgiasApiError("api fail", 500, { cause });
    expect(err.cause).toBe(cause);
  });
});
