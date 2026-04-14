import { GorgiasApiError } from "./errors.js";

/**
 * Gorgias API HTTP client with authentication, rate-limit handling, and error parsing.
 */

const ALLOWED_HOST_SUFFIX = ".gorgias.com";

/**
 * Validates that a resolved URL's hostname is on the Gorgias allowlist.
 * Prevents SSRF by rejecting any hostname that is not gorgias.com or a
 * subdomain of gorgias.com.
 */
function assertGorgiasHost(urlString: string): void {
  const host = new URL(urlString).hostname.toLowerCase();
  if (host !== "gorgias.com" && !host.endsWith(ALLOWED_HOST_SUFFIX)) {
    throw new Error(
      `Domain not on allowlist: hostname "${host}" is not a *.gorgias.com address.`,
    );
  }
}

function buildBaseUrl(domain: string): string {
  let d = domain.trim();

  // Reject empty / whitespace-only input
  if (d.length === 0) {
    throw new Error("Domain must not be empty.");
  }

  // Reject internal whitespace
  if (/\s/.test(d)) {
    throw new Error("Domain must not contain whitespace.");
  }

  // Reject trailing dots
  if (d.endsWith(".")) {
    throw new Error("Domain must not end with a trailing dot.");
  }

  // Reject insecure http:// URLs to prevent sending credentials over plaintext
  if (d.startsWith("http://")) {
    throw new Error("Insecure http:// URLs are not allowed. Use https:// instead.");
  }

  // Already a full URL – use the URL parser to extract only the origin
  if (d.startsWith("https://")) {
    const resolved = new URL(d).origin;
    assertGorgiasHost(resolved);
    return resolved;
  }

  // Strip trailing slashes and /api/ suffix for non-URL inputs
  d = d.replace(/\/+$/, "").replace(/\/api\/?$/, "");

  // Has domain suffix (e.g., "mycompany.gorgias.com")
  if (d.includes(".")) {
    const resolved = `https://${d}`;
    assertGorgiasHost(resolved);
    return resolved;
  }

  // Just a subdomain name (e.g., "mycompany") — always safe
  return `https://${d}.gorgias.com`;
}

export interface GorgiasClientConfig {
  domain: string;
  email: string;
  apiKey: string;
}

export class GorgiasClient {
  private baseUrl: string;
  private authHeader: string;

  constructor(config?: GorgiasClientConfig) {
    const domain = config?.domain ?? process.env.GORGIAS_DOMAIN;
    const email = config?.email ?? process.env.GORGIAS_EMAIL;
    const apiKey = config?.apiKey ?? process.env.GORGIAS_API_KEY;

    if (!domain || !email || !apiKey) {
      const missing = [
        !domain && "domain/GORGIAS_DOMAIN",
        !email && "email/GORGIAS_EMAIL",
        !apiKey && "apiKey/GORGIAS_API_KEY",
      ].filter(Boolean).join(", ");
      throw new Error(`Missing required Gorgias credentials: ${missing}`);
    }

    this.baseUrl = buildBaseUrl(domain);
    this.authHeader =
      "Basic " + Buffer.from(`${email}:${apiKey}`).toString("base64");
  }

  /**
   * Default per-request timeout in milliseconds. Prevents `fetch` from
   * hanging indefinitely on a stalled connection or unresponsive server.
   */
  private static readonly REQUEST_TIMEOUT_MS = 30_000;

  /**
   * Maximum seconds we will sleep on a single 429 retry, regardless of
   * what the server's `Retry-After` header says. Caps the worst case at
   * one minute so a misconfigured upstream cannot stall the MCP tool
   * for hours.
   */
  private static readonly MAX_RETRY_AFTER_SECONDS = 60;

  /**
   * JSON content-type matcher that accepts vendor variants such as
   * `application/vnd.api+json`, `application/problem+json`,
   * `application/hal+json`, and any future `+json` suffix family.
   * `application/json` itself and any `;charset=...` suffix are also
   * accepted.
   */
  private static readonly JSON_CONTENT_TYPE_RE =
    /\bapplication\/(?:[\w.+-]+\+)?json\b/i;

  async request(
    method: string,
    path: string,
    options?: {
      query?: Record<string, unknown>;
      body?: unknown;
    }
  ): Promise<unknown> {
    const url = new URL(path, this.baseUrl);

    if (options?.query) {
      for (const [key, value] of Object.entries(options.query)) {
        if (value === undefined || value === null) continue;
        if (Array.isArray(value)) {
          for (const v of value) {
            // Skip null/undefined inside arrays so they aren't serialised
            // as the literal strings "null"/"undefined".
            if (v === undefined || v === null) continue;
            if (typeof v === "object") {
              throw new Error(
                `Query parameter "${key}" array element must be a scalar (got ${typeof v})`,
              );
            }
            url.searchParams.append(key, String(v));
          }
        } else if (typeof value === "object") {
          // Reject objects rather than letting them coerce to "[object Object]".
          throw new Error(
            `Query parameter "${key}" must be a scalar or array of scalars (got object)`,
          );
        } else {
          url.searchParams.set(key, String(value));
        }
      }
    }

    const headers: Record<string, string> = {
      Authorization: this.authHeader,
      Accept: "application/json",
    };

    if (options?.body !== undefined) {
      headers["Content-Type"] = "application/json";
    }

    const maxRetries = 3;
    let response!: Response;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
      // Set up an AbortController so the request times out cleanly
      // rather than hanging if the upstream stalls.
      const controller = new AbortController();
      const timer = setTimeout(
        () => controller.abort(),
        GorgiasClient.REQUEST_TIMEOUT_MS,
      );

      try {
        response = await fetch(url.toString(), {
          method,
          headers,
          body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }

      if (response.status !== 429) {
        break;
      }

      // On last attempt, don't sleep — fall through to throw below.
      if (attempt < maxRetries - 1) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const headerSeconds = retryAfterHeader ? Number(retryAfterHeader) : NaN;
        // Exponential backoff base: 1s, 2s, 4s. The header value (if
        // present and sane) overrides this, but is capped to
        // MAX_RETRY_AFTER_SECONDS so a malicious or misconfigured server
        // cannot stall the request indefinitely.
        const expBackoffSeconds = Math.min(2 ** attempt, GorgiasClient.MAX_RETRY_AFTER_SECONDS);
        const baseSeconds =
          !isNaN(headerSeconds) && headerSeconds > 0
            ? Math.min(headerSeconds, GorgiasClient.MAX_RETRY_AFTER_SECONDS)
            : expBackoffSeconds;
        // Add up to 250ms of jitter to spread out retry storms.
        const jitterMs = Math.floor(Math.random() * 250);
        await new Promise(resolve => setTimeout(resolve, baseSeconds * 1000 + jitterMs));
      }
    }

    // Rate-limit info for context
    const callLimit = response.headers.get("X-Gorgias-Account-Api-Call-Limit");
    const retryAfter = response.headers.get("Retry-After");

    if (response.status === 429) {
      throw new GorgiasApiError(
        `Rate limited by Gorgias API. Retry after ${retryAfter ?? "unknown"} seconds. Usage: ${callLimit ?? "unknown"}`,
        429,
        { rateLimited: true, retryAfter }
      );
    }

    if (!response.ok) {
      let errorBody: string;
      try {
        errorBody = await response.text();
      } catch {
        errorBody = "(could not read response body)";
      }
      throw new GorgiasApiError(
        `Gorgias API error ${response.status} ${response.statusText}: ${errorBody}`,
        response.status
      );
    }

    // 204 No Content and 202 Accepted (often empty body, e.g.
    // PUT /api/customers/{id}/data). Also covers any other 2xx with
    // Content-Length: 0.
    const contentLength = response.headers.get("content-length");
    if (response.status === 204 || response.status === 202 || contentLength === "0") {
      return {
        success: true,
        status: response.status,
        message: `Operation accepted (${response.status} ${response.statusText})`,
      };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (GorgiasClient.JSON_CONTENT_TYPE_RE.test(contentType)) {
      // Defensive: if the body really is empty despite the Content-Type
      // header, return a structured success object instead of throwing
      // a confusing JSON parse error.
      const text = await response.text();
      if (text.length === 0) {
        return {
          success: true,
          status: response.status,
          message: `Empty body (${response.status} ${response.statusText})`,
        };
      }
      try {
        return JSON.parse(text);
      } catch {
        // The server claimed JSON but sent malformed body. Return as raw
        // text rather than crashing.
        return { content: text };
      }
    }

    // For non-JSON responses (e.g., file downloads)
    return { content: await response.text() };
  }

  async get(path: string, query?: Record<string, unknown>): Promise<unknown> {
    return this.request("GET", path, { query });
  }

  async post(path: string, body?: unknown, query?: Record<string, unknown>): Promise<unknown> {
    return this.request("POST", path, { body, query });
  }

  async put(path: string, body?: unknown, query?: Record<string, unknown>): Promise<unknown> {
    return this.request("PUT", path, { body, query });
  }

  async delete(path: string, body?: unknown, query?: Record<string, unknown>): Promise<unknown> {
    return this.request("DELETE", path, { body, query });
  }

  /**
   * POST search that handles both raw array and { data: [...] } response formats.
   */
  async search(body: unknown): Promise<unknown[]> {
    const result = await this.post("/api/search", body);
    if (Array.isArray(result)) return result;
    if (result && typeof result === "object" && "data" in result && Array.isArray((result as any).data)) {
      return (result as any).data;
    }
    return [];
  }
}
