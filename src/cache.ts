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
async function fetchAllPages(
  client: GorgiasClient,
  endpoint: string,
): Promise<unknown[]> {
  const allResults: unknown[] = [];
  let cursor: string | undefined;

  do {
    const params: Record<string, unknown> = { limit: PAGE_LIMIT };
    if (cursor) params.cursor = cursor;

    const response = await client.get(endpoint, params);

    // Some Gorgias endpoints (e.g. /api/teams) return a plain array.
    if (Array.isArray(response)) {
      allResults.push(...response);
      break; // plain arrays are not paginated
    }

    const body = response as {
      data?: unknown[];
      meta?: { next_cursor?: string | null };
    };

    if (Array.isArray(body.data)) {
      allResults.push(...body.data);
    }

    cursor =
      body.meta?.next_cursor != null ? String(body.meta.next_cursor) : undefined;
  } while (cursor);

  return allResults;
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
    fetchAllPages(client, "/api/tags"),
    fetchAllPages(client, "/api/teams"),
    fetchAllPages(client, "/api/custom-fields?object_type=Ticket"),
    fetchAllPages(client, "/api/views"),
    fetchAllPages(client, "/api/users"),
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

  const promise = fetchAllPages(client, "/api/users")
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
