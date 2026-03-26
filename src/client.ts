import { GorgiasApiError } from "./errors.js";

/**
 * Gorgias API HTTP client with authentication, rate-limit handling, and error parsing.
 */

function buildBaseUrl(domain: string): string {
  let d = domain.trim();

  // Reject insecure http:// URLs to prevent sending credentials over plaintext
  if (d.startsWith("http://")) {
    throw new Error("Insecure http:// URLs are not allowed. Use https:// instead.");
  }

  // Already a full URL – use the URL parser to extract only the origin
  if (d.startsWith("https://")) {
    return new URL(d).origin;
  }

  // Strip trailing slashes and /api/ suffix for non-URL inputs
  d = d.replace(/\/+$/, "").replace(/\/api\/?$/, "");

  // Has domain suffix (e.g., "mycompany.gorgias.com")
  if (d.includes(".")) {
    return `https://${d}`;
  }

  // Just a subdomain name (e.g., "mycompany")
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
            url.searchParams.append(key, String(v));
          }
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
      response = await fetch(url.toString(), {
        method,
        headers,
        body: options?.body !== undefined ? JSON.stringify(options.body) : undefined,
      });

      if (response.status !== 429) {
        break;
      }

      // On last attempt, don't sleep — fall through to throw below
      if (attempt < maxRetries - 1) {
        const retryAfterHeader = response.headers.get("Retry-After");
        const waitSeconds = retryAfterHeader ? Number(retryAfterHeader) : 1;
        const waitMs = (isNaN(waitSeconds) || waitSeconds <= 0 ? 1 : waitSeconds) * 1000;
        await new Promise(resolve => setTimeout(resolve, waitMs));
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

    if (response.status === 204) {
      return { success: true, message: "Operation completed successfully (204 No Content)" };
    }

    const contentType = response.headers.get("content-type") ?? "";
    if (contentType.includes("application/json")) {
      return response.json();
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
