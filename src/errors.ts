/**
 * Base error class for all Gorgias-related errors.
 */
export class GorgiasError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "GorgiasError";
    if (cause) this.cause = cause;
  }
}

/**
 * Error from the Gorgias HTTP API with status code and rate-limit awareness.
 */
export class GorgiasApiError extends GorgiasError {
  readonly statusCode: number | null;
  readonly rateLimited: boolean;
  readonly retryAfter: string | null;

  constructor(
    message: string,
    statusCode: number | null,
    options?: { rateLimited?: boolean; retryAfter?: string | null; cause?: unknown }
  ) {
    super(message, options?.cause);
    Object.setPrototypeOf(this, new.target.prototype);
    this.name = "GorgiasApiError";
    this.statusCode = statusCode;
    this.rateLimited = options?.rateLimited ?? false;
    this.retryAfter = options?.retryAfter ?? null;
  }
}
