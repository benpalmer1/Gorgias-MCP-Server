import { describe, it, expect } from "vitest";
import { sanitiseErrorForLLM } from "../error-sanitiser.js";

describe("sanitiseErrorForLLM", () => {
  it("passes through clean error messages", () => {
    const result = sanitiseErrorForLLM(new Error("Ticket not found"));
    expect(result).toBe("Ticket not found");
  });

  it("strips Basic auth headers", () => {
    const msg = "Authorization: Basic dXNlcjpwYXNz failed";
    const result = sanitiseErrorForLLM(new Error(msg));
    expect(result).not.toContain("Basic dXNlcjpwYXNz");
    expect(result).toContain("[REDACTED]");
  });

  it("strips Bearer tokens", () => {
    const msg = "Bearer eyJhbGciOiJIUzI1NiJ9.eyJ0ZXN0IjoiMSJ9.abc123 invalid";
    const result = sanitiseErrorForLLM(new Error(msg));
    expect(result).not.toContain("eyJ");
  });

  it("strips file paths", () => {
    const msg = "Error at /Users/john/project/src/index.ts:42";
    const result = sanitiseErrorForLLM(new Error(msg));
    expect(result).not.toContain("/Users/john");
  });

  it("strips connection strings", () => {
    const msg = "Cannot connect to postgres://user:pass@db.example.com:5432/mydb";
    const result = sanitiseErrorForLLM(new Error(msg));
    expect(result).not.toContain("postgres://");
  });

  it("strips internal IPs", () => {
    const msg = "Connection refused to 192.168.1.100:3000";
    const result = sanitiseErrorForLLM(new Error(msg));
    expect(result).not.toContain("192.168.1.100");
  });

  it("handles non-Error inputs", () => {
    expect(sanitiseErrorForLLM("string error")).toBe("string error");
    expect(sanitiseErrorForLLM(42)).toBeTruthy();
    expect(sanitiseErrorForLLM(null)).toBeTruthy();
    expect(sanitiseErrorForLLM(undefined)).toBeTruthy();
  });

  it("returns generic message for fully redacted content", () => {
    const msg = "Basic dXNlcjpwYXNz";
    const result = sanitiseErrorForLLM(new Error(msg));
    expect(result.length).toBeGreaterThan(0);
  });

  describe("JWT tokens (standalone)", () => {
    it("strips a standalone JWT that is not inside a Bearer header", () => {
      const jwt =
        "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abc123signature";
      const msg = `Token ${jwt} has expired`;
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("eyJhbGciOiJIUzI1NiJ9");
      expect(result).not.toContain("abc123signature");
      expect(result).toContain("Token");
      expect(result).toContain("[REDACTED]");
    });

    it("strips a JWT embedded mid-sentence", () => {
      const jwt =
        "eyJhbGciOiJSUzI1NiJ9.eyJpc3MiOiJ0ZXN0In0.longSignatureValue";
      const msg = `Validation of ${jwt} failed due to clock skew`;
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("eyJhbGciOiJSUzI1NiJ9");
      expect(result).toContain("Validation of");
      expect(result).toContain("failed due to clock skew");
    });
  });

  describe("API key query parameters", () => {
    it("strips api_key from a URL query string", () => {
      const msg = "Failed at url?api_key=secret123&other=value";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("secret123");
      expect(result).not.toContain("api_key=secret123");
      expect(result).toContain("Failed at");
      expect(result).toContain("[REDACTED]");
    });

    it("strips apiKey parameter (camelCase variant)", () => {
      const msg = "Request to endpoint?apiKey=sk_live_abc123 returned 403";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("sk_live_abc123");
      expect(result).toContain("Request to");
      expect(result).toContain("[REDACTED]");
    });

    it("strips api-secret parameter", () => {
      const msg = "Error: api-secret=topSecretVal was rejected";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("topSecretVal");
      expect(result).toContain("[REDACTED]");
    });

    it("strips access_key parameter", () => {
      const msg = "Signed with access_key = AKIAIOSFODNN7EXAMPLE";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("AKIAIOSFODNN7EXAMPLE");
      expect(result).toContain("[REDACTED]");
    });
  });

  describe("SQL statements", () => {
    it("strips SELECT statements", () => {
      const msg = "SELECT * FROM users WHERE id = 5;";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("SELECT");
      expect(result).not.toContain("users");
      expect(result).not.toContain("WHERE id = 5");
      expect(result).toContain("[REDACTED]");
    });

    it("strips DELETE statements", () => {
      const msg = "DELETE FROM sessions WHERE expired = true;";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("DELETE");
      expect(result).not.toContain("sessions");
      expect(result).not.toContain("expired = true");
      expect(result).toContain("[REDACTED]");
    });

    it("strips INSERT statements", () => {
      const msg =
        "Failed query: INSERT INTO logs (msg) VALUES ('test');";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("INSERT");
      expect(result).not.toContain("logs");
      expect(result).toContain("Failed query:");
      expect(result).toContain("[REDACTED]");
    });

    it("strips UPDATE statements", () => {
      const msg = "Error running UPDATE users SET name = 'x' WHERE id = 1;";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("UPDATE");
      expect(result).not.toContain("users");
      expect(result).toContain("Error running");
      expect(result).toContain("[REDACTED]");
    });
  });

  describe("Windows paths", () => {
    it("strips a Windows file path", () => {
      const msg = "Error at C:\\Users\\admin\\secrets\\config.json";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("C:\\Users\\admin");
      expect(result).not.toContain("config.json");
      expect(result).toContain("Error at");
      expect(result).toContain("[REDACTED]");
    });

    it("strips a Windows path with spaces", () => {
      const msg = "Loading D:\\Program Files\\App\\data.db failed";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("D:\\Program Files");
      expect(result).not.toContain("data.db");
      expect(result).toContain("[REDACTED]");
    });
  });

  describe("stack traces", () => {
    it("strips Node.js stack trace lines", () => {
      const msg =
        "TypeError: Cannot read property\n    at Module._compile (internal/modules/cjs/loader.js:999:30)\n    at Object.Module._extensions (internal/modules/cjs/loader.js:1027:10)";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("Module._compile");
      expect(result).not.toContain("internal/modules/cjs/loader.js");
      expect(result).not.toContain("999:30");
      expect(result).toContain("TypeError: Cannot read property");
    });

    it("strips a single stack trace line", () => {
      const msg =
        "Failure occurred\n    at processTicksAndRejections (internal/process/task_queues.js:95:5)";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("processTicksAndRejections");
      expect(result).not.toContain("task_queues.js");
      expect(result).toContain("Failure occurred");
    });
  });

  describe("internal IPs (all three private ranges)", () => {
    it("strips 10.x.x.x addresses", () => {
      const msg = "Cannot reach service at 10.0.1.50:8080";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("10.0.1.50");
      expect(result).toContain("Cannot reach service at");
      expect(result).toContain("[REDACTED]");
    });

    it("strips 172.16.x.x addresses", () => {
      const msg = "Timeout connecting to 172.16.0.1 on port 443";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("172.16.0.1");
      expect(result).toContain("Timeout connecting to");
      expect(result).toContain("on port 443");
      expect(result).toContain("[REDACTED]");
    });

    it("strips 192.168.x.x addresses", () => {
      const msg = "Host 192.168.1.1 is unreachable";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("192.168.1.1");
      expect(result).toContain("Host");
      expect(result).toContain("is unreachable");
      expect(result).toContain("[REDACTED]");
    });

    it("strips 172.31.x.x (upper bound of 172 private range)", () => {
      const msg = "DNS lookup failed for 172.31.255.254";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("172.31.255.254");
      expect(result).toContain("[REDACTED]");
    });
  });

  describe("Gorgias URL preservation", () => {
    it("does NOT strip gorgias.com URLs", () => {
      const msg = "Error calling https://mycompany.gorgias.com/api/tickets";
      const result = sanitiseErrorForLLM(msg);
      expect(result).toContain("https://mycompany.gorgias.com/api/tickets");
      expect(result).toContain("Error calling");
    });

    it("does NOT strip gorgias.com URLs while still stripping other sensitive data", () => {
      const msg =
        "Request to https://acme.gorgias.com/api/users failed with Bearer tok_secret123";
      const result = sanitiseErrorForLLM(msg);
      expect(result).toContain("https://acme.gorgias.com/api/users");
      expect(result).not.toContain("tok_secret123");
    });
  });

  describe("connection strings", () => {
    it("strips postgres connection strings", () => {
      const msg = "Failed to connect: postgres://user:pass@host:5432/db";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("postgres://");
      expect(result).not.toContain("user:pass");
      expect(result).not.toContain("host:5432");
      expect(result).toContain("Failed to connect:");
      expect(result).toContain("[REDACTED]");
    });

    it("strips mongodb connection strings", () => {
      const msg = "Connection error: mongodb://admin:pass@host/db";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("mongodb://");
      expect(result).not.toContain("admin:pass");
      expect(result).toContain("Connection error:");
      expect(result).toContain("[REDACTED]");
    });

    it("strips mysql connection strings", () => {
      const msg = "mysql://root:secret@127.0.0.1:3306/app timed out";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("mysql://");
      expect(result).not.toContain("root:secret");
      expect(result).toContain("[REDACTED]");
    });

    it("strips redis connection strings", () => {
      const msg = "redis://default:password@cache.internal:6379 unreachable";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("redis://");
      expect(result).not.toContain("password");
      expect(result).toContain("[REDACTED]");
    });
  });

  describe("fallback message", () => {
    it("returns the generic fallback for an empty string", () => {
      const result = sanitiseErrorForLLM("");
      expect(result).toBe("An internal error occurred");
    });

    it("returns the generic fallback for a whitespace-only string", () => {
      const result = sanitiseErrorForLLM("   \n\n   ");
      expect(result).toBe("An internal error occurred");
    });

    it("returns the generic fallback for an Error with empty message", () => {
      const result = sanitiseErrorForLLM(new Error(""));
      expect(result).toBe("An internal error occurred");
    });

    it("replaces fully-sensitive input with [REDACTED] rather than leaving raw secrets", () => {
      // When the entire message is a secret, it becomes "[REDACTED]" --
      // the sensitive content is removed even if the fallback is not triggered.
      const msg = "Basic dXNlcjpwYXNz";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("dXNlcjpwYXNz");
      expect(result).toContain("[REDACTED]");
    });

    it("replaces a lone Bearer token with [REDACTED]", () => {
      const msg = "Bearer some-opaque-token-value";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("some-opaque-token-value");
      expect(result).toContain("[REDACTED]");
    });
  });

  describe("object with .message property", () => {
    it("extracts and sanitises the message property from a plain object", () => {
      const err = {
        message: "Error with Bearer token123",
        code: 500,
      };
      const result = sanitiseErrorForLLM(err);
      expect(result).not.toContain("token123");
      expect(result).not.toContain("Bearer token123");
      expect(result).toContain("Error with");
      expect(result).toContain("[REDACTED]");
    });

    it("extracts message from object with extra properties", () => {
      const err = {
        message: "Query failed: SELECT id FROM secrets;",
        status: 500,
        details: "should be ignored",
      };
      const result = sanitiseErrorForLLM(err);
      expect(result).not.toContain("SELECT");
      expect(result).not.toContain("secrets");
      expect(result).toContain("Query failed:");
      // The details property should not appear since only .message is extracted
      expect(result).not.toContain("should be ignored");
    });
  });

  describe("non-sensitive data preservation", () => {
    it("preserves non-sensitive content while redacting email-adjacent sensitive patterns", () => {
      // Emails are not in the redaction list, so they should survive.
      // The test verifies we don't over-redact non-sensitive text.
      const msg = "Customer john@example.com had a billing issue";
      const result = sanitiseErrorForLLM(msg);
      expect(result).toContain("Customer");
      expect(result).toContain("john@example.com");
      expect(result).toContain("had a billing issue");
    });

    it("preserves descriptive error text around a redacted token", () => {
      const msg =
        "Authentication failed for user admin with Bearer tk_live_xyz123 at endpoint /v1/tickets";
      const result = sanitiseErrorForLLM(msg);
      expect(result).not.toContain("tk_live_xyz123");
      expect(result).toContain("Authentication failed for user admin with");
      expect(result).toContain("[REDACTED]");
    });

    it("preserves plain error messages with numbers and punctuation", () => {
      const msg = "Rate limit exceeded: 429 Too Many Requests (retry after 30s)";
      const result = sanitiseErrorForLLM(msg);
      expect(result).toBe(
        "Rate limit exceeded: 429 Too Many Requests (retry after 30s)"
      );
    });
  });
});
