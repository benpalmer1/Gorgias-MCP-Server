/**
 * TTL caching system for Gorgias reference data.
 *
 * Caches are scoped per GorgiasClient instance via WeakMaps so that
 * multi-tenant deployments (multiple Gorgias accounts) never leak data
 * between clients.
 *
 * Reference data endpoints are fully paginated (cursor-based, 100 per page)
 * so accounts with more than 100 tags, views, users, etc. are not silently
 * truncated.
 */

import type { GorgiasClient } from "./client.js";

export const CACHE_TTL_MS = 10 * 60 * 1000;

export class TtlCache<T> {
  private entries = new Map<string, { value: T; timestamp: number }>();
  private ttl: number;

  constructor(ttl: number = CACHE_TTL_MS) {
    this.ttl = ttl;
  }

  get(key: string): T | undefined {
    const entry = this.entries.get(key);
    if (!entry) return undefined;
    if (Date.now() - entry.timestamp >= this.ttl) {
      this.entries.delete(key);
      return undefined;
    }
    return entry.value;
  }

  set(key: string, value: T): void {
    this.entries.set(key, { value, timestamp: Date.now() });
  }

  clear(): void {
    this.entries.clear();
  }
}

export interface ReferenceData {
  tags: unknown[];
  teams: unknown[];
  customFields: unknown[];
  views: unknown[];
  users: unknown[];
}

// ---------------------------------------------------------------------------
// Per-page limit used when paginating reference data endpoints.
// ---------------------------------------------------------------------------
const PAGE_LIMIT = 100;

// ---------------------------------------------------------------------------
// Pagination helper – fetches all pages from a cursor-paginated Gorgias
// endpoint. Handles both the standard `{ data, meta }` wrapper and plain
// array responses (e.g. /api/teams).
// ---------------------------------------------------------------------------

export interface FetchAllPagesResult {
  items: unknown[];
  pagesFetched: number;
  truncated: boolean;
}

export interface FetchAllPagesOptions {
  /** Per-page request size. Defaults to 100 (the Gorgias maximum for most collections). */
  pageLimit?: number;
  /** Hard cap on total items returned. When reached, truncated=true and pagination stops. */
  maxItems?: number;
}

export async function fetchAllPages(
  client: GorgiasClient,
  endpoint: string,
  options: FetchAllPagesOptions = {},
): Promise<FetchAllPagesResult> {
  const pageLimit = options.pageLimit ?? PAGE_LIMIT;
  const maxItems = options.maxItems ?? Number.POSITIVE_INFINITY;

  const items: unknown[] = [];
  let cursor: string | undefined;
  let pagesFetched = 0;
  let truncated = false;

  do {
    const params: Record<string, unknown> = { limit: pageLimit };
    if (cursor) params.cursor = cursor;

    const response = await client.get(endpoint, params);
    pagesFetched++;

    // Plain-array endpoints (e.g. /api/teams) — single page, no cursor.
    if (Array.isArray(response)) {
      items.push(...response);
      break;
    }

    const body = response as {
      data?: unknown[];
      meta?: { next_cursor?: string | null };
    };

    if (Array.isArray(body.data)) {
      for (const item of body.data) {
        if (items.length >= maxItems) {
          truncated = true;
          break;
        }
        items.push(item);
      }
    }

    if (truncated) break;

    const rawCursor = body.meta?.next_cursor;
    cursor = rawCursor != null && String(rawCursor).length > 0
      ? String(rawCursor)
      : undefined;
  } while (cursor);

  return { items, pagesFetched, truncated };
}

/**
 * Thin shim preserving the old `Promise<unknown[]>` return shape for
 * internal callers (getReferenceData, getCachedUsers) that don't need
 * truncation metadata.
 */
async function fetchAllPagesFlat(
  client: GorgiasClient,
  endpoint: string,
): Promise<unknown[]> {
  const { items } = await fetchAllPages(client, endpoint);
  return items;
}

// ---------------------------------------------------------------------------
// Per-client caches (WeakMap-keyed so clients can be garbage-collected).
// ---------------------------------------------------------------------------
const referenceDataCaches = new WeakMap<object, TtlCache<ReferenceData>>();
const inflightReferenceDataPromises = new WeakMap<object, Promise<ReferenceData>>();

const usersCaches = new WeakMap<object, TtlCache<unknown[]>>();
const inflightUsersPromises = new WeakMap<object, Promise<unknown[]>>();

const REFERENCE_DATA_KEY = "referenceData";
const USERS_CACHE_KEY = "users";

// ---------------------------------------------------------------------------
// getReferenceData – same signature & return type as before.
// ---------------------------------------------------------------------------
export async function getReferenceData(client: GorgiasClient): Promise<ReferenceData> {
  // Ensure per-client cache exists.
  if (!referenceDataCaches.has(client)) {
    referenceDataCaches.set(client, new TtlCache<ReferenceData>());
  }
  const cache = referenceDataCaches.get(client)!;

  const cached = cache.get(REFERENCE_DATA_KEY);
  if (cached) return cached;

  // De-duplicate concurrent requests for the same client.
  const inflight = inflightReferenceDataPromises.get(client);
  if (inflight) return inflight;

  const promise = Promise.all([
    fetchAllPagesFlat(client, "/api/tags"),
    fetchAllPagesFlat(client, "/api/teams"),
    fetchAllPagesFlat(client, "/api/custom-fields?object_type=Ticket"),
    fetchAllPagesFlat(client, "/api/views"),
    fetchAllPagesFlat(client, "/api/users"),
  ]).then(([tags, teams, customFields, views, users]) => {
    const result: ReferenceData = { tags, teams, customFields, views, users };
    cache.set(REFERENCE_DATA_KEY, result);
    inflightReferenceDataPromises.delete(client);
    return result;
  }).catch((error) => {
    inflightReferenceDataPromises.delete(client);
    throw error;
  });

  inflightReferenceDataPromises.set(client, promise);
  return promise;
}

// ---------------------------------------------------------------------------
// getCachedUsers – same signature & return type as before.
// ---------------------------------------------------------------------------
export async function getCachedUsers(client: GorgiasClient): Promise<unknown[]> {
  if (!usersCaches.has(client)) {
    usersCaches.set(client, new TtlCache<unknown[]>());
  }
  const cache = usersCaches.get(client)!;

  const cached = cache.get(USERS_CACHE_KEY);
  if (cached) return cached;

  const inflight = inflightUsersPromises.get(client);
  if (inflight) return inflight;

  const promise = fetchAllPagesFlat(client, "/api/users")
    .then((users) => {
      cache.set(USERS_CACHE_KEY, users);
      inflightUsersPromises.delete(client);
      return users;
    })
    .catch((error) => {
      inflightUsersPromises.delete(client);
      throw error;
    });

  inflightUsersPromises.set(client, promise);
  return promise;
}
