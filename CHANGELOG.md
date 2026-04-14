# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed — critical silent data loss (C1, C3)

- **C1: `gorgias_smart_stats` auto-pagination.** The tool was hardcoded to `limit: 100` with no auto-pagination, silently truncating any reporting query that produced more than 100 rows. Now auto-paginates up to `limit` rows (default 100, max 10000) across multiple upstream pages. A 10-page safety cap converts runaway queries into `isError: true` with a resume cursor. Callers can also pass `cursor` for manual page-by-page control. The default limit stays at 100 to keep token budgets sane for chat agents, but callers can now explicitly raise it up to 10000.
- **M2: `gorgias_smart_stats` aggregate mode.** New `granularity: "none"` option omits time bucketing entirely, collapsing results into a single row per dimension. This is the primary workaround for queries that produce too many time-bucketed rows.
- **M3: `gorgias_smart_stats` 366-day pre-flight validation.** Date ranges exceeding 366 days are now rejected client-side with an actionable error before the API call is made.
- **C3: `gorgias_smart_get_ticket` message auto-pagination.** The tool previously fetched only the first page of messages (30 by default, 100 max per page), silently dropping all subsequent messages on long-running tickets. Now auto-paginates up to `max_messages` (default 1000, hard cap 5000). Truncated conversations return `truncated: true` with a clear hint. The `fetchAllPages` helper in `cache.ts` is now exported for reuse.

### Fixed — shared schema helpers (H19, L5, L3)

- **H19: Repo-wide numeric ID coercion.** All resource ID parameters across 20 tool files now use a shared `idSchema` (`z.coerce.number().int().min(1)`) that accepts both numbers and numeric strings from LLM clients. Previously, `z.number()` rejected string-encoded IDs like `"12345"`, breaking nearly every tool call from clients that serialise numbers as strings.
- **L5: Cursor max-length bound.** All `cursor` parameters now use a shared `cursorSchema` (`z.string().max(512)`) to prevent oversized query strings.
- **L3: Integer filter enforcement.** `gorgias_list_tickets` filter IDs now enforce `.int()` to reject floats.

### Fixed — security hardening (H18, L4, sanitiser cause walking)

- **H18: SSRF hostname allowlist.** `buildBaseUrl` now validates that the resolved hostname is `*.gorgias.com` before returning. Rejects non-Gorgias hosts, raw IPs, confusable trailing-label bypasses, empty/whitespace inputs, and trailing dots.
- **L4: Stack-trace regex tightening.** The sanitiser's stack-trace redaction now requires the `(file:line:col)` suffix, preventing false-positive redaction of prose like "At this point the process stopped".
- **Sanitiser `error.cause` walking.** The error sanitiser now walks the `.cause` chain up to 5 levels deep, extracting and redacting messages from nested errors. Cycle-safe via a `seen` set.

### Fixed — critical write-path bugs (every fix verified against current Gorgias 2026 docs)

- **`gorgias_merge_customers`** now sends `source_id`/`target_id` as **query parameters** instead of body fields, matching the actual Gorgias spec for `PUT /api/customers/merge`. Every previous merge call would have failed with a missing-required-parameter error.
- **`gorgias_update_rules_priorities`** now wraps the priorities array in a `{ priorities: [...] }` body object. The previous bare-array body was rejected by every call.
- **`gorgias_update_ticket`** no longer exposes `created_datetime` (the Gorgias `UpdateTicket` schema does not list it as a writable field; the misleading "can be used to backdate" description has been removed).
- **`gorgias_create_job`** now requires the `params` field, matching the Gorgias spec.
- **`gorgias_create_satisfaction_survey`** and **`gorgias_update_satisfaction_survey`** `score` field now accepts the full integer range 1-5 (was incorrectly limited to literal `1` or `5`).

### Fixed — phantom endpoints and parameters

- **Removed `gorgias_delete_users`** entirely. The Gorgias REST API does not document a bulk `DELETE /api/users` endpoint — only the single-id form `DELETE /api/users/{id}` exists. Every previous call to the bulk variant would have returned 404/405. Single-user deletion still works via `gorgias_delete_user`.
- **`gorgias_list_voice_calls`**: stripped 8 phantom query params (`offset`, `order_by`, `direction`, `status`, `customer_id`, `queue_id`, `phone_number_id`, `integration_id`). Per the Gorgias spec, the endpoint accepts only `cursor`, `limit`, `ticket_id`. Same fix applied to `gorgias_list_voice_call_events` (removed `order_by`, `account_id`) and `gorgias_list_voice_call_recordings` (removed `order_by`).
- **`gorgias_delete_voice_call_recording`** description corrected to state "204 No Content" instead of falsely claiming the deleted object is returned.
- **`gorgias_create_custom_field`**, **`gorgias_update_custom_field`**, and **`gorgias_bulk_update_custom_fields`** no longer list `customer_type` in the `managed_type` enum (it was never a documented value).
- **`gorgias_list_custom_fields`** stripped phantom `offset` parameter (the endpoint is cursor-only) and corrected the `order_by` enum from the wrong `created_datetime/updated_datetime` values to the correct `priority:asc/priority:desc` (default `priority:desc`).

### Fixed — silent data loss in `gorgias_smart_stats`

- **Null-measure rows are no longer silently dropped.** The previous null-row filter at `smart-stats.ts:160-164` removed any row where every requested measure was null/undefined. For single-measure scopes like `messages-sent` grouped by `agentId`, this meant inactive agents disappeared entirely from the result, producing a 0-row response with no error. Rows are now preserved and the new `nullMeasureRowCount` field surfaces the count.
- **Column metadata** (`columns` map) is now derived from the **union** of keys across all rows, not just `rows[0]`. Sparse fields like `agentName` are no longer dropped if the first row happens to lack them.
- **Truncation hint corrected.** The previous text recommended "narrow the date range or **add dimensions** for more precise data" — but adding dimensions multiplies row cardinality and makes truncation strictly worse. The new hint suggests removing dimensions, coarsening granularity, or using `gorgias_retrieve_reporting_statistic` for paginated access.
- New response fields: `rawRowCount` (the size of the raw API response page) and `nullMeasureRowCount`.

### Fixed — partial-update support

- **`gorgias_update_macro`** now accepts partial updates. Previously `name` and `actions` were required, blocking common use cases like changing only the intent or language. Per the Gorgias spec, `PUT /api/macros/{id}` has no required body fields.
- **`gorgias_update_rule`** now accepts partial updates for the same reason. You can now toggle `deactivated_datetime`, bump `priority`, or edit `description` without resending the entire rule body.

### Fixed — read endpoint parameters

- **`gorgias_get_ticket`** now exposes the documented `relationships` query parameter (currently `enum: ["custom_fields"]`).
- **`gorgias_list_tickets`** `trashed` description corrected: the Gorgias API default is **true** (trashed tickets are included by default), not false as the previous text claimed.
- **`gorgias_list_customers`** added the documented `view_id`, `channel_type`, and `channel_address` filters.
- **`gorgias_list_users`** added the documented `email`, `external_id`, `roles`, `search`, `available_first`, and `order_by` filters; `limit` is now bounded `1-100`.
- **`gorgias_list_events`** corrections:
  - `user_ids` is now `array<int>` (was a single integer despite the plural name).
  - `types` is now `array<string>` (was a single string).
  - `object_type` enum corrected: `TicketMessage` → `Message`, `Rule` → `TicketRule`, plus added the missing `SatisfactionSurvey` value.
  - Added the documented `created_datetime` comparator filter (`gt`/`gte`/`lt`/`lte`).
  - `order_by` is now an enum and `limit` is bounded.

### Fixed — HTTP client safety

- **Per-request timeout (30 seconds default)**: every `fetch` call now uses an `AbortController`, so a hung Gorgias instance can no longer freeze the MCP tool indefinitely.
- **Exponential backoff with jitter** on 429 retries (1s/2s/4s) when the upstream `Retry-After` header is missing or zero. When the header IS present, its value is honoured but **capped at 60 seconds** so a misconfigured server cannot stall the request for hours. Up to 250ms of random jitter is added to spread retry storms.
- **`202 Accepted` and other empty-body 2xx responses** are now handled correctly. The previous code only special-cased `204 No Content`, so endpoints like `PUT /api/customers/{customer_id}/data` (which returns 202 with empty body) would crash with a JSON parse error. Any 2xx with `Content-Length: 0` now returns a structured success object, and the JSON branch handles empty bodies defensively.
- **Content-Type detection** now accepts JSON variants like `application/vnd.api+json`, `application/problem+json`, `application/hal+json`, `application/ld+json`, and any `+json` suffix.
- **Query parameter coercion**: object values now throw a clear error instead of silently coercing to `"[object Object]"`. `null`/`undefined` inside arrays are skipped instead of being serialised as the literal strings `"null"`/`"undefined"`.

### Fixed — error sanitiser

- **SQL keyword false positives.** The previous patterns matched any line containing `SELECT`/`INSERT`/`UPDATE`/`DELETE` (case-insensitive) and replaced everything to end-of-line. Ordinary English like "Please SELECT a ticket from the dropdown" or "We tried to UPDATE your browser" had its trailing text silently swallowed. The new patterns are case-sensitive uppercase keywords AND require a terminating semicolon.
- **Email addresses now redacted** as `[REDACTED_EMAIL]` (customer PII).
- **Vendor API key prefixes** now redacted: Stripe (`sk_live_`/`sk_test_`/`pk_*`/`whsec_`), Slack (`xox[abprs]-`), GitHub (`ghp_`/`gho_`), AWS (`AKIA`), Google (`AIza`).
- **Windows drive letters** are now case-insensitive (lowercase `c:\` is also redacted).
- **Unix paths** coverage extended beyond `{Users,home,var,tmp}` to include `/etc/`, `/root/`, `/proc/`, `/sys/`, `/opt/`, `/srv/`, `/mnt/`, `/private/`, plus UNC paths (`\\server\share\…`).
- **Loopback / link-local IPs** now redacted: IPv4 `127.0.0.0/8`, `169.254.0.0/16`, IPv6 `::1`, `fe80::/10`, and ULA `fc00::/7` / `fd00::/8`.

### Fixed — `_accessFilterStats` dead code

The startup log previously read `_accessFilterStats` from the returned `rawServer`, but `withAccessFilter` exposed this property only via its proxy — and the proxy was discarded by `createGorgiasServer` to work around an `McpServer` private-fields incompatibility. The startup log therefore always silently dropped the tool count segment.

Stats are now stored in a module-level `WeakMap<McpServer, AccessFilterStats>` keyed by the raw server, and read via the new exported helper `getAccessFilterStats(server)`. Admin mode also wraps `registerTool` (without filtering) so the count appears for every level. The startup log now reads, e.g. `Gorgias MCP server started — 113 tools registered (access level: admin)`.

### Documentation

- New **Troubleshooting** section in the README covering 401/403/429, missing tools, domain format errors, the 366-day reporting period limit, and the smart_stats 100-row cap.
- **Security** section expanded with the in-memory cache TTL, the admin-default warning, the 30-second request timeout, and the secrets-in-source-control reminder.
- **Tool count** corrected from 114 to 113 after removing `gorgias_delete_users` (Users category 6 → 5).
- **`engines.node`** bumped from `>=18.0.0` to `>=20.0.0`. Node 18 reached end-of-life on 2025-04-30.
- **`exports` condition order** in `package.json` now lists `types` before `import`, matching TypeScript / Node best practice. With `moduleResolution: "nodenext"` or `"bundler"`, the previous order could cause TypeScript consumers to see the package as untyped.

### Added — tests

The unit test suite has grown from 146 tests to **234 tests** (88 new tests), covering every fix above plus several previously-untested modules:

- **`src/__tests__/wire-format.test.ts`** (new file): 38 tests verifying the wire format of write-path tools using a stub `GorgiasClient` and stub server. Covers `merge_customers` query placement, `update_rules_priorities` body wrapper, satisfaction survey score range, `create_job` params requirement, `update_ticket` field removal, voice-calls phantom param removal, partial macro/rule updates, `smart_stats` null preservation, events array params and corrected enum, and the `customer_type` `managed_type` removal.
- **`src/__tests__/client.test.ts`** (new file): 24 tests for `GorgiasClient` using a stub `fetch` global. Covers query encoding, the 429 retry loop with `vi.useFakeTimers()`, the 60s `Retry-After` cap, 204/202/empty-body handling, JSON content-type variants, and `search()` shape normalisation.
- **`src/__tests__/error-sanitiser.test.ts`**: 22 new tests for SQL false-positive guards, email redaction, vendor API key prefixes, Windows path case insensitivity, extended Unix path coverage, and IPv4/IPv6 loopback / link-local.
- **`src/__tests__/access-control.test.ts`**: 4 new tests for `getAccessFilterStats` covering all three access levels.
