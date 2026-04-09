# Gorgias MCP Server — Follow-up Fix Requirements

| Field | Value |
|---|---|
| **Document version** | 1.0 |
| **Date** | 2026-04-07 |
| **Baseline branch** | `claude/fix-gorgias-mcp-bugs-5UA4i` |
| **Baseline commit** | `d5a2f74` |
| **Source PR** | #2 (tracking the first wave of fixes) |
| **Owner** | Unassigned |
| **Repository** | Public (no PII, staff names, customer identifiers, or real credentials in examples) |

---

## Overview

This document specifies the follow-up fix work that was identified by the original 20-agent audit of the Gorgias MCP Server but **was not applied in PR #2**. Each requirement below was independently confirmed as a real bug by a skeptic-mode validator pass (the second round of agents, whose job was specifically to refute first-pass findings). Items that were refused by the validators as false positives are documented in PR #2's description and are deliberately NOT in this document.

The structure of each requirement entry is uniform (problem statement → evidence → desired behaviour → proposed fix → acceptance criteria → test requirements → edge cases → backward compatibility → dependencies → effort estimate), so the document can be consumed as a to-do list during implementation. Reading tip: start at the CRITICAL section, then walk the proposed sequencing table in Section 6 to see which items group into natural batches.

For the baseline of what PR #2 already shipped (what is NOT in this document), see [`CHANGELOG.md`](./CHANGELOG.md) on the baseline branch. The short version: PR #2 fixed roughly 40 items across the critical write-path schemas, the error sanitiser, the HTTP client timeouts, the `_accessFilterStats` dead code, and the read endpoint parameters — this document covers the items that were validated as TRUE but that the author ran out of rounds to implement, plus several items that were deliberately deferred pending live-tenant verification.

## Severity distribution

| Severity | Count | Rough character |
|---|---|---|
| **CRITICAL** | 2 | Silent data loss in user-visible tools |
| **HIGH** | 7 | Security hardening, schema correctness, user-visible routing bugs |
| **MEDIUM** | 8 | Validation polish, UX, small correctness fixes |
| **LOW** | 7 | Cosmetic, defensive-coding, minor enum tightening |
| **DEFERRED** | 5 | Validated but need a live-tenant API probe before shipping |
| **Total** | **29** | |

## Glossary

| Term | Meaning |
|---|---|
| **Validated TRUE** | A claim from the first-pass audit that was independently confirmed by a skeptic-mode validator agent. Only validated-TRUE items are in this document. |
| **Deferred** | A validated-TRUE claim that could not be definitively resolved without a live Gorgias tenant probe, because the rendered Gorgias documentation (a JS-rendered SPA) did not yield conclusive schema information. These are NOT skipped — they are scheduled for a follow-up after a live probe. |
| **Refused** | A first-pass claim that the skeptic validators refuted. Refused items are NOT in this document; they are documented in PR #2's description under "What was NOT applied". |
| **Skeptic-mode validator** | A second-pass agent explicitly instructed to treat every prior-audit claim as potentially wrong and to verify each against the actual source code and current 2026 Gorgias docs before accepting it. Roughly 15% of first-pass claims were refused by the validator pass. |
| **Round** | One of the 8 commits that make up PR #2. Each round focused on a thematically-related batch of fixes (e.g. "Round 5 — sanitiser sweep"). |

---

## Table of contents

- [Section 1 — CRITICAL](#section-1--critical)
  - [C1: `smart_stats` 100-row silent truncation + missing pagination](#c1-smart_stats-100-row-silent-truncation--missing-pagination)
  - [C3: `smart_ticket_detail` message pagination](#c3-smart_ticket_detail-message-pagination)
- [Section 2 — HIGH (security + types)](#section-2--high-security--types)
  - [H18: SSRF hostname allowlist in `buildBaseUrl`](#h18-ssrf-hostname-allowlist-in-buildbaseurl)
  - [H19: Repo-wide numeric ID coercion](#h19-repo-wide-numeric-id-coercion)
- [Section 3 — HIGH (schema correctness)](#section-3--high-schema-correctness)
  - [H14: Integration update — partial-update support](#h14-integration-update--partial-update-support)
  - [H16: Satisfaction survey update — missing required fields](#h16-satisfaction-survey-update--missing-required-fields)
  - [H20: `smart_search` strategy ordering + missing `search_type: "view"`](#h20-smart_search-strategy-ordering--missing-search_type-view)
  - [Widget `template.type` literal](#widget-templatetype-literal)
- [Section 4 — MEDIUM](#section-4--medium)
  - [M2: `smart_stats` granularity `"none"` aggregate mode](#m2-smart_stats-granularity-none-aggregate-mode)
  - [M3: `smart_stats` client-side 366-day validation](#m3-smart_stats-client-side-366-day-validation)
  - [M10: `smart_search` client-filter silent data loss warning](#m10-smart_search-client-filter-silent-data-loss-warning)
  - [M13: `buildBaseUrl` edge cases](#m13-buildbaseurl-edge-cases)
  - [M23: User `language` enum](#m23-user-language-enum)
  - [M26: `update_customer.timezone` nullable](#m26-update_customertimezone-nullable)
  - [`order_by` enum corrections (tags, rules, integrations)](#order_by-enum-corrections-tags-rules-integrations)
  - [Sanitiser `error.cause` walking](#sanitiser-errorcause-walking)
- [Section 5 — LOW](#section-5--low)
- [Section 6 — DEFERRED (require live-tenant verification)](#section-6--deferred-require-live-tenant-verification)
  - [C4/C5: `update_ticket_field` / `update_customer_field_value` body format](#c4c5-update_ticket_field--update_customer_field_value-body-format)
  - [C12: User `role.name` full enum](#c12-user-rolename-full-enum)
  - [C15: `statistics.ts` legacy endpoint — rewrite or remove](#c15-statisticsts-legacy-endpoint--rewrite-or-remove)
  - [H21: `ticket-sla` reporting-scope filter member](#h21-ticket-sla-reporting-scope-filter-member)
  - [M5: `tags` reporting scope time dimension and default measure](#m5-tags-reporting-scope-time-dimension-and-default-measure)
- [Section 7 — Proposed implementation sequencing](#section-7--proposed-implementation-sequencing)

---

## Section 1 — CRITICAL

These two items are silent data-loss bugs in user-visible smart tools. Both must land before this requirements doc is considered closed; everything else is fixable in parallel or deferrable.

---

### C1: `smart_stats` 100-row silent truncation + missing pagination

**Severity:** CRITICAL
**Category:** silent data loss / pagination
**Validated by:** Skeptic-mode validator pass (Round 2, validator 1) — reconfirmed by every test that hit the 100-row ceiling

#### Problem statement

`gorgias_smart_stats` constructs a Gorgias reporting query and posts it via `client.post("/api/reporting/stats", { query }, { limit: 100 })`. The `limit: 100` is hardcoded as a query parameter to the underlying HTTP call, and the tool's `inputSchema` exposes neither `limit` nor `cursor` to callers. Any reporting query that produces more than 100 rows is silently truncated at the 100-row boundary; the truncation is surfaced only as a soft `_hint` string buried in the response object, never as `isError: true`.

The fix landed in PR #2's Round 1 (commit `882d371`) only corrected the misleading hint text — it explicitly removed the "add dimensions" advice that made truncation worse, but it did not expose `limit` to callers or auto-paginate. PR #2's Round 3 fix to the null-row filter (commit `ea96d21`) made things subtly worse: the truncation-warning check at line 193 (`if (rows.length >= 100)`) now runs against the *raw* page count (because nulls are no longer dropped before the check), but the upstream `limit: 100` ceiling is unchanged — so the tool still loses every row past 100, but now also loses every legitimate non-null row that the null filter would previously have kept inside the 100-row window. The two fixes interact poorly because the underlying ceiling was never raised.

The raw sibling tool `gorgias_retrieve_reporting_statistic` at `src/tools/reporting.ts` already exposes `limit` (max 10000) and cursor pagination — so the upstream API supports both, the smart wrapper just doesn't surface them. A multi-agent reporting query for 24 months grouped by `agentId` and `day` produces ~180 × 730 ≈ 130,000 rows; the current tool returns the first 100 of those and the LLM consumer treats them as the complete answer. Real-world testing on the codebase has produced multiple instances of charts and tables that silently dropped 5+ months of historical data because the caller had no way to know the result was truncated.

#### Evidence

- **File:** `src/tools/smart-stats.ts` line 154 (the hardcoded ceiling):
  ```ts
  const result = await client.post("/api/reporting/stats", { query }, { limit: 100 }) as any;
  ```
- **File:** `src/tools/smart-stats.ts` lines 193-195 (the soft warning):
  ```ts
  if (rows.length >= 100) {
    hint += " WARNING: Results were capped at 100 rows by this tool and may be truncated. ...";
  }
  ```
- **Reference implementation that works correctly:** `src/tools/reporting.ts` line 14 — `limit: z.number().min(1).max(10000).optional().describe("...default: 30, max: 10000")`, and the handler forwards `limit` and `cursor` as the third arg to `client.post`.
- **Observable symptom:** A caller passes `{ scope: "tickets-created", start_date: "2024-01-01", end_date: "2025-12-31", dimensions: ["agentId"], granularity: "day" }` and receives a `data` array of length exactly 100, with `_hint` containing a soft warning. The caller's downstream chart shows 100 days; the actual underlying period contains 730 days × N agents.
- **Why existing tests do not catch this:** PR #2's wire-format tests verify the body shape and the hint text, but no test asserts that more than 100 rows are returned for a query that should produce more, because the tool can't be invoked with anything that yields more than 100 rows.

#### Desired behaviour

The tool exposes a `limit` input parameter (positive integer, sensible default, hard maximum of 10000 to match the underlying reporting API) and a `cursor` input parameter (opaque string, advanced use). When `cursor` is supplied, the tool fetches a single page and returns it (the caller is driving pagination manually). When `cursor` is not supplied, the tool auto-paginates the underlying API in page-sized chunks (per-page size = `min(limit, 1000)`), accumulating rows until either: (a) the upstream returns no `next_cursor`, (b) the accumulated row count reaches the requested `limit`, or (c) a hard safety cap of 10 page fetches is reached.

If the safety cap is hit while there is still a `next_cursor` available upstream, the tool returns `isError: true` with a structured error payload containing the partial count, the safety cap, the last seen cursor (so the caller can resume), and a hint pointing at the cursor-based mode. **Soft hints are no longer used as the primary truncation signal — silent data loss is converted to a hard error.** The safety cap exists only to prevent a runaway tool call from a confused LLM hammering the API; it is not the normal truncation path.

The default `limit` value is 1000, not 100. This is a deliberate increase: 100 was an arbitrary number that silently dropped real-world queries; 1000 covers the vast majority of reporting use cases without paginating, and the auto-pagination path handles anything larger. Callers who want explicit per-page control can still pass any value up to 10000.

The tool's response includes a new field `pagesFetched` showing how many upstream pages were combined, alongside the existing `rawRowCount` (added by PR #2's null-filter fix) and `nullMeasureRowCount` fields. The `_hint` text is updated to surface the new fields and to recommend `granularity: "none"` (see M2 — must land in the same batch as this fix) as the primary workaround for queries that legitimately produce 1000+ rows.

#### Proposed fix

**File:** `src/tools/smart-stats.ts`

```ts
// 1. Schema additions (alongside existing input fields, before the closing brace)
limit: z.number().int().min(1).max(10000).optional().describe(
  "Maximum number of rows to return after auto-pagination (default: 1000, max: 10000). " +
  "The tool fetches upstream pages of up to 1000 rows each and accumulates results " +
  "until this limit is reached or the upstream runs out of data. For queries that " +
  "would produce far more than 1000 rows, prefer 'granularity: \"none\"' (aggregate " +
  "mode — see M2) over raising this limit."
),
cursor: z.string().optional().describe(
  "Advanced: opaque pagination cursor from a previous response's `nextCursor` field. " +
  "When supplied, the tool fetches a single page and returns its rows + the next cursor. " +
  "Auto-pagination is disabled in this mode — the caller drives the loop."
),

// 2. Replace the single client.post call (line 154) with the new pagination loop
const requestedLimit = args.limit ?? 1000;
const PAGE_SIZE = Math.min(requestedLimit, 1000);
const SAFETY_CAP_PAGES = 10;
const singlePageMode = args.cursor !== undefined;

let rows: any[] = [];
let pagesFetched = 0;
let nextCursor: string | undefined = args.cursor;
let safetyCapReached = false;

while (true) {
  const queryParams: Record<string, unknown> = { limit: PAGE_SIZE };
  if (nextCursor) queryParams.cursor = nextCursor;

  const page = await client.post("/api/reporting/stats", { query }, queryParams) as any;
  pagesFetched++;

  const pageRows: any[] = Array.isArray(page?.data) ? page.data
    : Array.isArray(page) ? page
    : [];
  rows.push(...pageRows);

  const upstreamNextCursor: string | undefined =
    page?.meta?.next_cursor ?? page?.next_cursor ?? undefined;

  // Single-page mode: caller is driving pagination, return after first fetch.
  if (singlePageMode) {
    nextCursor = upstreamNextCursor;
    break;
  }

  // No more pages upstream — natural termination.
  if (!upstreamNextCursor) {
    nextCursor = undefined;
    break;
  }

  // Reached the requested limit — stop accumulating.
  if (rows.length >= requestedLimit) {
    nextCursor = upstreamNextCursor;
    break;
  }

  // Safety cap — convert silent runaway into a hard error.
  if (pagesFetched >= SAFETY_CAP_PAGES) {
    safetyCapReached = true;
    nextCursor = upstreamNextCursor;
    break;
  }

  nextCursor = upstreamNextCursor;
}

// Trim accumulated rows to exactly requestedLimit (the last page may have overshot).
if (!singlePageMode && rows.length > requestedLimit) {
  rows = rows.slice(0, requestedLimit);
}

// Hard error on safety cap — never let a runaway query silently truncate.
if (safetyCapReached) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        error: `Reporting query exceeded the ${SAFETY_CAP_PAGES}-page safety cap.`,
        scope,
        partialRowCount: rows.length,
        pagesFetched,
        nextCursor,
        _hint:
          `${rows.length} rows fetched across ${pagesFetched} pages, but more data is ` +
          `available upstream. Either: (1) re-issue with 'cursor: \"${nextCursor}\"' to ` +
          `continue from where this call stopped, (2) coarsen 'granularity' (e.g. 'week' ` +
          `or 'month' instead of 'day'), (3) use 'granularity: \"none\"' for an aggregate ` +
          `query that collapses the time axis, or (4) shorten the date range.`,
      }, null, 2),
    }],
    isError: true,
  };
}
```

The existing null-filter logic (lines 161-167 after PR #2) runs after the pagination loop completes, against the full accumulated `rows` array. The `rawRowCount` field already added by PR #2 should now reflect the **pre-trim**, post-filter count — the full accumulated data the API returned, not the trimmed-to-limit subset.

The response object additions:

```ts
const response = {
  scope,
  dateRange: { start: args.start_date, end: args.end_date },
  timezone: tz,
  granularity,
  columns,
  data: rows,
  totalRows: rows.length,
  rawRowCount,                    // existing — pre-filter raw count
  nullMeasureRowCount,            // existing — null-filter count
  pagesFetched,                   // NEW — how many upstream pages were combined
  nextCursor: nextCursor ?? null, // NEW — for caller-driven pagination
  _hint: hint,                    // updated to reference granularity: "none"
};
```

#### Acceptance criteria

1. The tool's `inputSchema` exposes `limit` (positive integer, max 10000, default 1000) and `cursor` (optional opaque string).
2. With no `limit` argument, queries that legitimately return up to 1000 rows are returned in full (no truncation, no hint warning).
3. With `limit: 5000`, queries that legitimately return up to 5000 rows are returned in full via auto-pagination (multiple upstream page fetches combined).
4. With `cursor: "<opaque>"`, the tool fetches exactly one upstream page and returns it; the response includes a non-null `nextCursor` if more data is available.
5. With no `cursor` and a query that would require more than 10 page fetches at the chosen page size, the tool returns `isError: true` with a non-null `nextCursor` so the caller can manually resume.
6. The response includes `pagesFetched` (integer ≥ 1) and `nextCursor` (string | null).
7. `rawRowCount` reflects the pre-trim, post-filter accumulated row count across all pages, not just the final trimmed result.
8. The null-measure preservation logic from PR #2 still works correctly across multiple pages.
9. The `_hint` text never recommends "add dimensions" (regression guard for the M4 fix that PR #2 already shipped).
10. Default behaviour (no `limit`, no `cursor`) for any query that would have returned ≤100 rows under the old code returns identical results — this is a strict superset, not a behaviour change for callers who were already inside the old ceiling.
11. The tool description is updated to document `limit`, `cursor`, the auto-pagination behaviour, the safety cap, and the relationship to `granularity: "none"`.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | `default limit returns single page when upstream has no cursor` | unit (mocked client) | Mock upstream returns `{data: [50 rows], meta: {next_cursor: null}}`. Assert tool returns 50 rows, `pagesFetched: 1`, `nextCursor: null`. |
| 2 | `default limit auto-paginates two pages` | unit | Mock returns `{data: [1000 rows], meta: {next_cursor: "abc"}}` then `{data: [50 rows], meta: {next_cursor: null}}`. Assert tool returns 1050 rows accumulated, `pagesFetched: 2`. Wait — default limit is 1000, so this should TRIM to 1000. Adjust: assert returns exactly 1000 rows, `nextCursor: "abc"` preserved (since more is available), `pagesFetched: 2`. |
| 3 | `explicit limit 5000 paginates five pages and returns all 5000` | unit | Mock returns 5 pages of 1000 each, last page has `next_cursor: null`. Assert returns 5000 rows, `pagesFetched: 5`, `nextCursor: null`. |
| 4 | `explicit limit 5000 stops at 5000 even if more available` | unit | Mock returns 6 pages of 1000 each, all with `next_cursor`. Assert returns 5000 rows (trimmed), `pagesFetched: 5`, `nextCursor` of the 5th page preserved. |
| 5 | `safety cap returns isError after 10 pages` | unit | Mock returns 11 pages of 1000 each, all with `next_cursor`. Assert `isError: true`, partial row count, `nextCursor` populated, hint mentions cursor resume. Default limit is 1000 — but to hit the safety cap we need limit > 10 × page size = 10000, so use `limit: 10000`. |
| 6 | `cursor mode fetches exactly one page` | unit | Mock returns one page with `next_cursor: "next"`. Call with `cursor: "start"`. Assert one upstream call made, response includes the page rows, `nextCursor: "next"`, `pagesFetched: 1`. |
| 7 | `cursor mode does not auto-paginate` | unit | Mock returns one page with `next_cursor: "next"`. Call with `cursor: "start"`. Assert exactly one upstream call (no second fetch). |
| 8 | `cursor passed to upstream as query param` | unit | Mock captures `client.post` query arg. Assert second call has `cursor: <upstream-returned cursor>`. |
| 9 | `null filter still works across paginated pages` | unit | Two pages, half the rows have null measures. Assert `nullMeasureRowCount` reflects the full accumulated count, not just one page. |
| 10 | `rawRowCount reflects pre-trim count` | unit | Two pages of 1000 each, default limit 1000. Assert `data.length === 1000` (trimmed) but `rawRowCount === 2000` (accumulated before trim). |
| 11 | `_hint never contains "add dimensions"` | unit | Regression guard for the M4 hint fix. |
| 12 | `_hint mentions granularity: "none" when limit is reached` | unit | Trigger truncation, assert hint text mentions the workaround. |
| 13 | `tool input schema exposes limit and cursor` | unit | Snapshot test against the registered tool's `inputSchema` keys. |
| 14 | `limit > 10000 rejected at schema layer` | unit | Zod validation error. |
| 15 | `limit < 1 rejected at schema layer` | unit | Zod validation error. |
| 16 | `legacy callers (no limit) get up to 1000 rows` | unit | Backward-compat assertion that callers who omit `limit` are no longer capped at 100. |

Target number of new tests: 16

#### Edge cases to handle

- **Upstream returns `data: null`** — treat as empty page, terminate loop.
- **Upstream returns plain array (no `meta`)** — terminate loop after first page (no cursor available).
- **Upstream `next_cursor` is empty string `""`** — treat as no next cursor (per the existing `body.meta?.next_cursor != null` check pattern in `src/cache.ts`).
- **Safety cap reached on the very first page** — should not be possible (cap is 10), but assert in code that `pagesFetched >= SAFETY_CAP_PAGES` is the loop terminator, not `> SAFETY_CAP_PAGES`.
- **`limit: 1` with multi-page upstream** — page size becomes 1, accumulator stops after first row, single upstream call.
- **`limit: 10000` with sparse upstream (only 50 rows total)** — terminates naturally on `next_cursor: null`, `pagesFetched: 1`, no truncation.
- **Caller passes both `cursor` and `limit`** — `cursor` wins (single-page mode), `limit` is ignored or used to bound the single page size. Document the precedence in the tool description.
- **Upstream HTTP error mid-pagination (e.g. 500 on page 5 of 8)** — propagates through `safeHandler`; the partial accumulated rows are not surfaced. Acceptable: a partial result with error semantics is more confusing than a clean failure that the caller retries.
- **Rate-limited mid-pagination (429 retry-after)** — handled by the existing client retry loop (PR #2 added exponential backoff). Each page fetch independently respects the retry semantics.

#### Backward compatibility

Strict superset for any caller whose query previously returned ≤100 rows: identical output. Callers whose query previously hit the 100-row ceiling will now receive more rows (up to 1000 by default), and may need to update downstream chart/aggregation code that hardcoded the assumption "always 100 rows or fewer". This is a behavioural improvement, not a regression — the previous behaviour was silent data loss.

The new `pagesFetched` and `nextCursor` response fields are additive. Existing callers that ignore unknown fields are unaffected.

The CHANGELOG entry must explicitly call out the default-limit increase (100 → 1000) and the new auto-pagination so consumers can plan for the increased token usage on large queries.

#### Dependencies on other requirements

- **C2 (PR #2)**: this fix builds directly on the null-row preservation already shipped. The pagination loop must accumulate raw rows BEFORE the null filter runs.
- **M2 (granularity: "none")**: the tool description and the safety-cap error hint both point at `granularity: "none"` as the primary workaround. M2 should land in the same batch as this fix so the recommendation is actually available.
- **M3 (366-day validation)**: independent, but if both ship together the pre-flight 366-day check runs before the pagination loop, avoiding wasted API calls on out-of-range queries.
- No conflict with H19 (numeric ID coercion). The new `limit` field is bounded numeric, not an ID.

#### Estimated effort

- **New lines of code:** ~75 (schema additions, pagination loop, safety-cap branch, response field additions)
- **Modified lines of code:** ~10 (replacing the single `client.post` call site, hint-text adjustments)
- **New test cases:** 16
- **Affected existing tests:** 2-3 in `wire-format.test.ts` that may snapshot the response shape — additive new fields should not break them but may require fixture refresh
- **Risk level:** medium — touches the hot path of the most-used reporting tool, interacts with PR #2's null-filter and hint changes
- **Rough time estimate:** M (half a day, including the test matrix and a careful review of the loop termination conditions)

---

### C3: `smart_ticket_detail` message pagination

**Severity:** CRITICAL
**Category:** silent data loss / pagination
**Files:** `src/tools/smart-ticket-detail.ts`, `src/cache.ts`
**Validated by:** Skeptic-mode validator (Round 2, Agent 11) — confirmed TRUE
**Effort estimate:** ~80 LOC, ~10 modified, ~15 new tests, M risk

#### Problem statement

`gorgias_smart_get_ticket` fetches a ticket and its messages in parallel and presents them as a chronologically sorted thread. The messages fetch is a single, unpaginated `client.get()` call against `/api/tickets/{id}/messages` — but that endpoint is cursor-paginated server-side, defaults to 30 messages per page, and caps at 100 per page. For any ticket with more than 30 messages (the Gorgias default page size, which the call doesn't override) the tool silently drops every message past the first page.

This is the same shape of bug as C1 (`smart_stats` 100-row truncation): a smart-tool wrapper that bills itself as "the full conversation thread" but in practice only returns the first chunk that the upstream endpoint chose to send. There is no warning, no `truncated` flag, and the tool's own `_hint` cheerfully states "N message(s) shown chronologically" using the truncated count — actively misleading the LLM into believing it has the complete history.

The user-visible blast radius is large. A long-running B2B conversation, a SaaS support thread that bounces back-and-forth with logs and screenshots, or any escalated case can easily exceed 30 messages. When the LLM is asked "summarise this ticket" or "what was the customer's last response", it gets a confident answer based on a window that excludes the most recent — or most relevant — exchanges. Critically, the cutoff is invisible from the response shape alone, because the projected payload looks well-formed.

#### Evidence

`src/tools/smart-ticket-detail.ts:21-24`:

```ts
const [ticketRaw, messagesRaw] = await Promise.all([
  client.get(`/api/tickets/${id}`),
  client.get(`/api/tickets/${id}/messages`),
]);
```

No `limit`, no `cursor`, no follow-up call. The handler then unwraps `messagesRaw.data` (or accepts a plain array), sorts, projects, and returns whatever was on that single page.

`src/tools/smart-ticket-detail.ts:46-48` — the `_hint` confidently reports the truncated count as if it were complete:

```ts
hint += `${projectedMessages.length} message(s) shown chronologically (oldest first). `;
```

Compare with `src/cache.ts:62-95`, where the project already has a working cursor-pagination helper (`fetchAllPages`) used for reference data — but it is module-private and not reusable from `smart-ticket-detail.ts`.

The Gorgias API documentation for `/api/tickets/{id}/messages` (the readme.io rendered page, verified during the second-round skeptic validation) lists `limit` (1–100, default 30) and `cursor` query parameters and a `meta.next_cursor` response field — i.e. it is a standard cursor-paginated collection, not a special "messages are inlined on the ticket" endpoint.

Note that `ticket.messages_count` is also unreliable as a sanity check: it is updated by Gorgias asynchronously and the existing comment at `src/tools/smart-ticket-detail.ts:42` already acknowledges that ("Use actual fetched count, not potentially stale ticket.messages_count") — which is the correct decision, but it means there is no second source of truth to even *detect* truncation today.

#### Desired behaviour

`gorgias_smart_get_ticket` must return the *complete* message history of a ticket up to a generous, explicit upper bound, and must surface a `truncated: true` marker (with the items-fetched count) on the rare occasion that the bound is hit. Specifically:

1. The handler auto-paginates the messages endpoint via the existing `fetchAllPages` helper (now exported and extended), requesting `limit=100` per page (the server-side maximum) until `meta.next_cursor` is empty.
2. A safety cap of `max_messages` (default 1000, hard ceiling 5000) prevents pathological tickets from exhausting memory or rate-limit budget. 1000 messages comfortably covers >99.9% of real tickets; 5000 is the absolute upper limit a single tool call may emit.
3. When the safety cap *is* reached, the response includes `truncated: true` and `truncatedReason: "max_messages reached"` at the top level (not just inside `_hint`), and the `_hint` is rewritten to instruct the LLM "this is a partial conversation — N messages out of an unknown larger total".
4. The handler exposes a new `max_messages` input parameter (1–5000, default 1000) so a power user can lower the cap (cheap recall) or raise it (long-history audit) without code changes.
5. Backward compatibility: the response shape stays a strict superset. Existing fields (`ticket`, `messages`, `_hint`) keep their meaning. New fields (`truncated`, `truncatedReason`, `pagesFetched`) are additive.

#### Proposed fix

##### Step 1 — promote `fetchAllPages` to a reusable export

`src/cache.ts` currently keeps `fetchAllPages` module-private. Make it exported, and extend it with an optional `maxItems` cap. The signature changes to return both the items and a truncation marker:

```ts
// src/cache.ts

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
```

Internal callers (`getReferenceData`, `getCachedUsers`) currently expect the old `Promise<unknown[]>` shape. Add a thin shim so the public callers don't have to change:

```ts
// src/cache.ts

async function fetchAllPagesFlat(
  client: GorgiasClient,
  endpoint: string,
): Promise<unknown[]> {
  const { items } = await fetchAllPages(client, endpoint);
  return items;
}
```

…and replace the existing `fetchAllPages(client, "/api/...")` calls inside `getReferenceData` and `getCachedUsers` with `fetchAllPagesFlat(...)`. This is a strict refactor — no behaviour change for reference-data callers.

##### Step 2 — wire the new helper into `smart-ticket-detail.ts`

```ts
// src/tools/smart-ticket-detail.ts

import { fetchAllPages } from "../cache.js";

const DEFAULT_MAX_MESSAGES = 1000;
const HARD_CAP_MAX_MESSAGES = 5000;

server.registerTool("gorgias_smart_get_ticket", {
  title: "Smart Get Ticket",
  description:
    "Retrieve a ticket with its full conversation thread, projected to a clean format optimised for LLM consumption. Auto-paginates the messages endpoint up to max_messages (default 1000) so long conversations are returned in full. If the ticket has more messages than max_messages, the response will include truncated=true. Messages are sorted chronologically (oldest first). Use gorgias_smart_search to find tickets first. For raw API data, use gorgias_get_ticket.",
  inputSchema: {
    id: z.number().int().min(1).describe("The unique ID of the ticket to retrieve with its full conversation"),
    max_messages: z
      .number()
      .int()
      .min(1)
      .max(HARD_CAP_MAX_MESSAGES)
      .optional()
      .describe(
        `Maximum number of messages to fetch (default ${DEFAULT_MAX_MESSAGES}, hard cap ${HARD_CAP_MAX_MESSAGES}). ` +
        `Long-running tickets with more messages than this cap will return truncated=true. ` +
        `Lower this for cheap recall on tickets you only need a summary of; raise it for full audit history.`,
      ),
  },
  annotations: { readOnlyHint: true, openWorldHint: true },
}, safeHandler(async ({ id, max_messages }) => {
  const messageCap = max_messages ?? DEFAULT_MAX_MESSAGES;

  try {
    // Parallel fetch ticket + paginated messages
    const [ticketRaw, messagesResult] = await Promise.all([
      client.get(`/api/tickets/${id}`),
      fetchAllPages(client, `/api/tickets/${id}/messages`, { maxItems: messageCap }),
    ]);

    const messages = messagesResult.items as unknown[];
    const truncated = messagesResult.truncated;
    const pagesFetched = messagesResult.pagesFetched;

    // Sort messages chronologically (oldest first)
    const sorted = sortMessagesChronologically(messages as any[]);

    // Project messages
    const projectedMessages = sorted.map(projectMessage);

    // Use actual fetched count, not potentially stale ticket.messages_count
    const ticket = projectTicket(ticketRaw, projectedMessages.length);

    // Build _hint
    const noteCount = projectedMessages.filter(m => m.isInternalNote).length;
    let hint = `Ticket #${ticket.id}: "${ticket.subject ?? "(no subject)"}". `;
    if (truncated) {
      hint += `PARTIAL CONVERSATION — ${projectedMessages.length} message(s) shown (oldest first), but the ticket has more messages than the cap of ${messageCap}. `;
      hint += `If you need the full history, retry with a higher max_messages (up to ${HARD_CAP_MAX_MESSAGES}). `;
    } else {
      hint += `${projectedMessages.length} message(s) shown chronologically (oldest first). `;
    }
    hint += `Present as a threaded conversation — show sender name, whether agent or customer, and message text. `;
    if (noteCount > 0) {
      hint += `${noteCount} message(s) are internal notes (isInternalNote=true) — these are agent-to-agent and were not seen by the customer. `;
    }
    hint += `Status: ${ticket.status}, Priority: ${ticket.priority}.`;

    const result: Record<string, unknown> = {
      ticket,
      messages: projectedMessages,
      _hint: hint,
    };
    if (truncated) {
      result.truncated = true;
      result.truncatedReason = `max_messages cap of ${messageCap} reached`;
      result.pagesFetched = pagesFetched;
    }

    return {
      content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
    };
  } catch (err) {
    // ...existing error path unchanged...
  }
}));
```

#### Acceptance criteria

1. Calling `gorgias_smart_get_ticket` against a ticket with **31 messages** returns all 31 messages, not 30 (proves a multi-page fetch happened).
2. Calling against a ticket with **305 messages** returns all 305, the response has no `truncated` field, and `pagesFetched` is absent or omitted (because we don't surface it on the happy path — only on truncation).
3. Calling with `max_messages: 50` against a ticket with 305 messages returns exactly 50 messages, `truncated: true`, `truncatedReason: "max_messages cap of 50 reached"`, and `pagesFetched: 1` (since 50 fits inside the first 100-row page).
4. Calling with `max_messages: 250` against a ticket with 305 messages returns exactly 250 messages, `truncated: true`, and `pagesFetched: 3` (pages 1+2 give 200, page 3 fills to 250 then short-circuits).
5. The `_hint` for a truncated response leads with `PARTIAL CONVERSATION` and instructs the LLM to retry with a higher cap, naming the hard cap value.
6. Omitting `max_messages` uses the default of 1000.
7. `max_messages > 5000` is rejected by Zod at the input boundary (Gorgias-side error never reached).
8. `max_messages < 1` is rejected by Zod at the input boundary.
9. Wire format: every `client.get()` call to `/api/tickets/{id}/messages` is observed to include `limit=100` (and `cursor=...` from page 2 onwards). Verified with stub-client tests.
10. Existing reference-data callers (`getReferenceData`, `getCachedUsers`) continue to receive a `Promise<unknown[]>` and continue to work — no behaviour change for them. Verified by the existing `cache.test.ts` suite still passing.
11. The exported `fetchAllPages` is now reachable from outside `cache.ts` and is documented as the canonical paginator helper for any future smart tool that wraps a cursor-paginated endpoint.

#### Test requirements

| # | Test name | What it verifies |
|---|---|---|
| 1 | `fetchAllPages – single page array response returns items, no truncation` | Plain-array endpoints (e.g. `/api/teams`) keep working. |
| 2 | `fetchAllPages – multi-page wrapped response concatenates all pages` | Two-page `{data, meta.next_cursor}` chain returns flattened items. |
| 3 | `fetchAllPages – stops at maxItems mid-page and sets truncated=true` | maxItems=15, page returns 100; result has 15 items + truncated flag. |
| 4 | `fetchAllPages – stops at maxItems exactly at page boundary` | maxItems=100, single page of 100 → truncated=false (didn't *exceed*). |
| 5 | `fetchAllPages – empty next_cursor terminates loop` | Cursor of "" or null treated as end-of-pages. |
| 6 | `fetchAllPages – pagesFetched counter accurate across N pages` | Counter increments per HTTP request, not per item. |
| 7 | `fetchAllPagesFlat – returns plain array (refactor compatibility)` | Internal shim preserves the old API shape. |
| 8 | `smart_get_ticket – ticket with 31 messages returns all 31` | End-to-end, default cap, two-page fetch. |
| 9 | `smart_get_ticket – ticket with 305 messages returns all 305 (default cap 1000)` | No truncation, no truncated field in response. |
| 10 | `smart_get_ticket – max_messages=50 returns 50, truncated=true` | Per-page fits within first page; cap hits mid-page. |
| 11 | `smart_get_ticket – max_messages=250 returns 250, truncated=true, pagesFetched=3` | Cap hits mid-page on page 3. |
| 12 | `smart_get_ticket – truncated _hint leads with PARTIAL CONVERSATION` | LLM-facing wording assertion. |
| 13 | `smart_get_ticket – max_messages=6000 rejected by Zod (hard cap 5000)` | Input validation. |
| 14 | `smart_get_ticket – max_messages=0 rejected by Zod` | Input validation. |
| 15 | `smart_get_ticket – wire format: limit=100 on every messages page` | Stub-client request log assertion. |
| 16 | `smart_get_ticket – existing 404/429 error paths unchanged` | Regression guard for the catch block. |

#### Edge cases

- **Plain-array message responses.** Some legacy Gorgias endpoints return a bare array. The new `fetchAllPages` already handles this (single push, immediate break). The test suite must explicitly cover this for `/api/tickets/{id}/messages` because we don't actually know whether the endpoint sometimes returns one or the other, and we don't want to regress the existing fallback at `src/tools/smart-ticket-detail.ts:28-34`.
- **Ticket with zero messages.** `fetchAllPages` returns `{ items: [], pagesFetched: 1, truncated: false }`. Downstream code already handles an empty `messages` array, so the projected output is `messages: []` and the `_hint` reads "0 message(s) shown chronologically".
- **Rate-limit (429) hit mid-pagination.** The existing `client.get()` path already retries on 429 with exponential backoff and a 60-second cap (Round 6 of PR #2). If retries are exhausted, the error propagates out of `fetchAllPages` and the existing catch block in `smart-ticket-detail.ts` handles it via `GorgiasApiError` — including the existing 429-specific user-facing hint.
- **Upstream `data: null` instead of `data: []`.** Gorgias has been observed to return `data: null` on permission-edge cases. The `Array.isArray(body.data)` guard already handles this — `data: null` becomes "no items added on this page", and pagination still terminates via the missing `next_cursor`.
- **Cursor that points back to a previous page (server bug).** Not handled — we trust the upstream cursor. Unbounded loops are prevented by the `maxItems` cap, which is the intended safety net for any pathological server behaviour.
- **Concurrent calls for the same ticket.** No de-duplication. Two parallel `smart_get_ticket(123)` calls will each issue independent paginated fetches. This is acceptable: messages are not cached (unlike reference data), and the smart-ticket-detail tool is invoked at "look up this specific ticket" granularity, not in tight loops.
- **Ticket fetch succeeds but messages fetch fails.** `Promise.all` rejects on the first failure. The existing catch block sees the rejection. There is no partial-success return — by design, because a ticket without its messages is not the contract this tool advertises.

#### Backward compatibility

- **Response shape:** strict superset. `ticket`, `messages`, and `_hint` retain their existing meaning. `truncated`, `truncatedReason`, and `pagesFetched` are new and only appear on the (rare) truncation path.
- **Input shape:** strict superset. `id` retains its existing schema. `max_messages` is optional with a sensible default.
- **Description text:** updated to mention the new behaviour. Existing LLM clients reading the description will see "auto-paginates… up to max_messages" but the `id`-only call shape still works.
- **Internal cache callers:** unchanged by virtue of the `fetchAllPagesFlat` shim. `getReferenceData` and `getCachedUsers` continue to receive `Promise<unknown[]>` and existing tests should pass without modification.

#### Dependencies

- **None blocking.** This requirement can land independently of C1.
- **Soft interaction with C1:** both critical fixes share the same conceptual pattern (smart tool wrapping a paginated endpoint with no auto-pagination). Landing both in the same PR is natural but not required.
- **Touches `src/cache.ts`:** any future requirement that wants to consume the same paginator (e.g. a hypothetical future smart-list tool) will benefit from the export. No other current items in this document depend on this change.

#### Effort estimate

| Item | Lines |
|---|---|
| `src/cache.ts` — extended `fetchAllPages` + new types + `fetchAllPagesFlat` shim + caller updates | ~50 new, ~5 modified |
| `src/tools/smart-ticket-detail.ts` — new input field, paginator wiring, truncation handling, hint rewrite | ~30 new, ~5 modified |
| Tests (unit) — 7 new `cache.test.ts` cases + 9 new `smart-ticket-detail.test.ts` cases | ~250 LOC of test code |
| **Total production LOC** | **~80 new + ~10 modified** |
| **Risk** | Medium — the cache refactor touches a hot path used by every tool that calls `getReferenceData`. The shim mitigates the regression risk, but the cache test suite must run green before merge. |
| **Time category** | M (medium) |

---

## Section 2 — HIGH (security + types)

These two HIGH-severity items are foundational. H18 closes an SSRF vector that gates the safety of every outbound request the MCP server makes. H19 introduces a shared numeric-ID coercion helper that downstream batches reuse to fix dozens of small write-path schema bugs without copy-pasting the same Zod chain.

---

### H18: SSRF hostname allowlist and input normalisation in `buildBaseUrl`

**Severity:** HIGH
**Category:** security (SSRF / credential exfiltration)
**Validated by:** Skeptic-mode validator pass

#### Problem statement

`buildBaseUrl` in `src/client.ts:7-30` accepts any `https://` URL or dotted string and trusts it as a Gorgias API host. Once the `GorgiasClient` constructor runs at `src/client.ts:56-58`, the computed `baseUrl` is combined with a `Basic` auth header derived from `GORGIAS_EMAIL`/`GORGIAS_API_KEY` on every subsequent `fetch` call at `src/client.ts:143`. There is no validation that the resolved host is actually a Gorgias tenant, so a malicious or typoed `GORGIAS_DOMAIN` such as `https://evil.example`, `https://10.0.0.1`, `https://127.0.0.1:8080`, or the confusable `https://evil.gorgias.com.attacker.example` will cause the client to POST the operator's API credentials to an attacker-controlled origin on the first tool invocation.

PR #2 added three HTTP-level hardening items (30 s per-request `AbortController` timeout, 60 s `Retry-After` cap, exponential backoff with jitter) and expanded the README Security section to warn operators to only set `GORGIAS_DOMAIN` to a `.gorgias.com` value. None of those changes introduced an in-code host check. The README note is advisory only; the code path is still fully permissive.

On top of the SSRF hole, the same function has previously-flagged input-normalisation gaps: an empty or whitespace-only `domain` (after `trim()`) falls through to the final branch and produces the nonsense URL `https://.gorgias.com`; an input with embedded whitespace such as `"my company"` yields the invalid host `https://my company.gorgias.com` which `new URL(...)` later mangles; a trailing-dot input like `"mycompany.gorgias.com."` is accepted and produces a host that bypasses a naive suffix check. All of these must be closed in the same change because the allowlist logic depends on a canonicalised hostname.

#### Evidence

- **File:line:** `src/client.ts` lines 7-30
- **Current code:**
  ```ts
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
  ```
- **Observable symptom:** With `GORGIAS_DOMAIN=https://evil.example` set, the first `gorgias_*` tool call issues a real HTTPS request to `evil.example` carrying an `Authorization: Basic <base64(email:apiKey)>` header. The attacker-controlled host observes both the email and the API key in cleartext (post-TLS) and can replay them against `https://<real>.gorgias.com`. No log line, error, or warning surfaces before the request goes out.

#### Desired behaviour

`buildBaseUrl` must resolve the final base URL using the existing branches, then validate the resulting hostname against a strict `.gorgias.com` suffix allowlist before returning. The suffix match must be anchored so that `evil.gorgias.com.attacker.example` is rejected (i.e. compare against `.gorgias.com` with the leading dot, or require `host === "gorgias.com" || host.endsWith(".gorgias.com")`). Inputs that cannot be parsed, that are empty or whitespace-only after trimming, that contain internal whitespace, or that have a trailing dot must be rejected with a clear, actionable error message that names the offending input class without leaking the raw value into the error chain twice.

Legitimate inputs — `"mycompany"`, `"mycompany.gorgias.com"`, `"https://mycompany.gorgias.com"`, `"https://mycompany.gorgias.com/api"` — must continue to resolve to `https://mycompany.gorgias.com` exactly as before. The error message for disallowed hosts should explain the allowlist rule and point at the `GORGIAS_DOMAIN` env var by name.

#### Proposed fix

**File:** `src/client.ts`

```ts
// At module scope, alongside buildBaseUrl
const ALLOWED_HOST_SUFFIX = ".gorgias.com";

function assertGorgiasHost(urlString: string): void {
  let parsed: URL;
  try {
    parsed = new URL(urlString);
  } catch {
    throw new Error(
      `GORGIAS_DOMAIN did not resolve to a valid URL (got ${JSON.stringify(urlString)}). ` +
      `Expected a value like "mycompany", "mycompany.gorgias.com", or "https://mycompany.gorgias.com".`,
    );
  }
  const host = parsed.hostname.toLowerCase();
  // Reject trailing dots, empty labels, and anything that does not end in .gorgias.com.
  // The leading-dot check blocks the "evil.gorgias.com.attacker.example" class of bypass
  // because the suffix match requires the literal ".gorgias.com" to be the final segment.
  if (
    host.length === 0 ||
    host.endsWith(".") ||
    !(host === "gorgias.com" || host.endsWith(ALLOWED_HOST_SUFFIX))
  ) {
    throw new Error(
      `GORGIAS_DOMAIN host "${host}" is not on the allowlist. ` +
      `Only *.gorgias.com hosts are permitted; refusing to send credentials to an untrusted origin.`,
    );
  }
}

function buildBaseUrl(domain: string): string {
  const raw = domain ?? "";
  const d = raw.trim();

  if (d.length === 0) {
    throw new Error("GORGIAS_DOMAIN is empty or whitespace-only.");
  }
  if (/\s/.test(d)) {
    throw new Error(`GORGIAS_DOMAIN must not contain whitespace (got ${JSON.stringify(raw)}).`);
  }
  if (d.startsWith("http://")) {
    throw new Error("Insecure http:// URLs are not allowed. Use https:// instead.");
  }

  let resolved: string;
  if (d.startsWith("https://")) {
    resolved = new URL(d).origin;
  } else {
    const stripped = d.replace(/\/+$/, "").replace(/\/api\/?$/, "");
    if (stripped.endsWith(".")) {
      throw new Error(`GORGIAS_DOMAIN must not end with "." (got ${JSON.stringify(raw)}).`);
    }
    resolved = stripped.includes(".")
      ? `https://${stripped}`
      : `https://${stripped}.gorgias.com`;
  }

  assertGorgiasHost(resolved);
  return resolved;
}
```

#### Acceptance criteria

1. `buildBaseUrl("https://evil.example")` throws an error naming the allowlist rule; no `fetch` is issued.
2. `buildBaseUrl("https://10.0.0.1")` and `buildBaseUrl("https://127.0.0.1:8080")` both throw.
3. `buildBaseUrl("https://evil.gorgias.com.attacker.example")` throws — the trailing-label bypass is blocked.
4. `buildBaseUrl("https://gorgias.com.attacker.example")` throws.
5. `buildBaseUrl("mycompany")`, `buildBaseUrl("mycompany.gorgias.com")`, `buildBaseUrl("https://mycompany.gorgias.com")`, and `buildBaseUrl("https://mycompany.gorgias.com/api")` all return `"https://mycompany.gorgias.com"`.
6. `buildBaseUrl("")`, `buildBaseUrl("   ")`, `buildBaseUrl("\t\n")` all throw an empty/whitespace error without attempting to build `"https://.gorgias.com"`.
7. `buildBaseUrl("my company")` throws an internal-whitespace error.
8. `buildBaseUrl("mycompany.gorgias.com.")` throws a trailing-dot error.
9. The existing plaintext-`http://` rejection behaviour is preserved (test kept from PR #2).
10. The `GorgiasClient` constructor surfaces the thrown error unchanged so operators see it at startup, before any tool handler runs.
11. All existing tests in `src/__tests__/client.test.ts` continue to pass; no legitimate test fixture is broken.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | rejects non-gorgias https host | unit | `buildBaseUrl("https://evil.example")` throws matching `/allowlist/`. |
| 2 | rejects raw IPv4 literal | unit | `buildBaseUrl("https://10.0.0.1")` throws. |
| 3 | rejects loopback IPv4 with port | unit | `buildBaseUrl("https://127.0.0.1:8080")` throws. |
| 4 | rejects confusable trailing-label host | unit | `buildBaseUrl("https://evil.gorgias.com.attacker.example")` throws. |
| 5 | rejects bare `gorgias.com.<evil>` | unit | `buildBaseUrl("https://gorgias.com.attacker.example")` throws. |
| 6 | accepts subdomain short form | unit | `buildBaseUrl("mycompany") === "https://mycompany.gorgias.com"`. |
| 7 | accepts full hostname form | unit | `buildBaseUrl("mycompany.gorgias.com") === "https://mycompany.gorgias.com"`. |
| 8 | accepts full https URL form | unit | `buildBaseUrl("https://mycompany.gorgias.com") === "https://mycompany.gorgias.com"`. |
| 9 | accepts https URL with `/api` suffix | unit | Trailing `/api` is stripped; result is `"https://mycompany.gorgias.com"`. |
| 10 | rejects empty string | unit | `buildBaseUrl("")` throws empty/whitespace error. |
| 11 | rejects whitespace-only string | unit | `buildBaseUrl("   \t\n")` throws empty/whitespace error. |
| 12 | rejects internal whitespace | unit | `buildBaseUrl("my company")` throws whitespace error. |
| 13 | rejects trailing dot | unit | `buildBaseUrl("mycompany.gorgias.com.")` throws trailing-dot error. |
| 14 | preserves http:// rejection | unit | `buildBaseUrl("http://mycompany.gorgias.com")` still throws plaintext error. |
| 15 | GorgiasClient ctor surfaces allowlist error | unit | `new GorgiasClient({domain: "https://evil.example", email, apiKey})` throws; no fetch is mocked-called. |
| 16 | case-insensitive host match | unit | `buildBaseUrl("https://MyCompany.Gorgias.Com")` is accepted (host compare is lowercased). |

Target number of new tests: 16

#### Edge cases to handle

- IPv6 literals such as `https://[::1]` — `new URL(...).hostname` returns `[::1]` with brackets included on some runtimes; the suffix check naturally rejects it, but the test fixture should pin behaviour.
- Mixed-case hosts (`MyCompany.Gorgias.Com`) must be accepted; the allowlist compares the lowercased hostname.
- Unicode / IDN hosts (`xn--...gorgias.com`) — explicitly document that only ASCII `.gorgias.com` hosts are supported.
- Ports on allowlisted hosts (`https://mycompany.gorgias.com:8443`) — currently the code path via `new URL(d).origin` preserves the port; acceptance behaviour is "allowed as long as host matches", no port restriction.
- `userinfo` components in URLs (`https://user:pass@mycompany.gorgias.com`) — `.origin` strips userinfo, preserving the allowlist semantics; add a test that asserts the credentials in the URL are discarded.
- The `domain` argument being `undefined` (TypeScript-level but defensively guarded by the constructor at `src/client.ts:47-54` which already throws).

#### Backward compatibility

Fully backward-compatible for any legitimate configuration. The only `GORGIAS_DOMAIN` values that break are those that were never intended to work against a real Gorgias tenant in the first place (non-Gorgias hosts, malformed inputs, whitespace-only). The error messages are new and distinct, so operators who hit them get an immediately actionable message rather than an opaque downstream `fetch` failure.

#### Dependencies on other requirements

- None. Stands alone; does not interact with the H19 Zod coercion change.
- Complements the README security note added in PR #2 by enforcing the documented constraint in code.

#### Estimated effort

- **New lines of code:** ~45 (new `assertGorgiasHost` helper + normalisation branches + comments)
- **Modified lines of code:** ~15 (restructuring of `buildBaseUrl` body)
- **New test cases:** 16
- **Affected existing tests:** 0-2 (the existing `client.test.ts` `buildBaseUrl` coverage if any fixture uses a non-`gorgias.com` host for unrelated tests — sweep and update)
- **Risk level:** low
- **Rough time estimate:** S (half a day including test authoring and review)

### H19: Repo-wide `z.coerce.number().int().min(1)` for ID parameters

**Severity:** HIGH
**Category:** type safety / LLM tool-call reliability
**Validated by:** Skeptic-mode validator pass

#### Problem statement

Across `src/tools/`, 166 `z.number()` occurrences are spread over 21 tool files. A substantial fraction of these describe resource IDs that end up interpolated into URL paths (e.g. `/api/tickets/${id}`, `/api/users/${id}`, `/api/customers/${id}/data`). Only three ID sites currently use the stricter `z.number().int().min(1)` pattern: `src/tools/smart-ticket-detail.ts:15` (the reference implementation for this requirement) and `src/tools/customers.ts:129,130` (`source_id` and `target_id` on `merge_customers`). Every other ID parameter is the bare `z.number()`.

In Zod 4, `z.number()` is strict: a JSON string `"123"` is rejected with `"Invalid arguments: expected number, received string"`. LLM-driven MCP clients routinely emit numeric tool arguments as strings — the model's JSON output for `{"id": "12345"}` is often indistinguishable at the wire level from the desired `{"id": 12345}`, and some transports (HTTP form bodies, URL query string proxies) canonicalise scalars to strings regardless of the model's intent. The result is that nearly every numeric-ID tool call from a well-behaved LLM client fails validation before the handler body is entered, and the failure surfaces to the end user as the Zod error string. This is a very-high-visibility correctness bug that silently bricks large parts of the tool surface for real LLM clients.

PR #2 did not touch ID validation. The HTTP client safety round (timeouts, backoff, JSON variants, query-param coercion) is orthogonal to Zod schema definitions, so the failure mode described above is unchanged on the current branch at commit `d5a2f74`. The fix is mechanical but broad: introduce a shared ID helper that uses `z.coerce.number().int().min(1)`, then replace `z.number()` at every ID call-site in `src/tools/`. Non-ID numeric parameters (`limit`, `offset`, `priority`, `score`, etc.) are intentionally left alone or bounded separately.

#### Evidence

- **File:line (reference "good" site):** `src/tools/smart-ticket-detail.ts` line 15
- **Reference code:**
  ```ts
  id: z.number().int().min(1).describe("The unique ID of the ticket to retrieve with its full conversation"),
  ```
- **File:line (representative "bad" site):** `src/tools/tickets.ts` line 123
- **Current code:**
  ```ts
  id: z.number().describe("The unique ID of the ticket to update"),
  ```
- **Scale:** 166 `z.number()` occurrences across 21 files under `src/tools/` (verified by grep on current branch). Excluding `limit` / `offset` / `priority` / `score` / `max_…` / `page_size` non-ID numerics, the ID-parameter subset is the large majority.
- **Observable symptom:** An LLM client invokes `gorgias_update_ticket` with arguments `{"id": "12345", "status": "closed"}`. The MCP runtime rejects the call with `Invalid arguments: id: Expected number, received string`. The handler never runs, the ticket is never updated, and the user sees a cryptic type error. The same pattern repeats for `gorgias_get_ticket`, `gorgias_delete_customer`, `gorgias_create_ticket_message`, `gorgias_update_macro`, `gorgias_retrieve_voice_call`, and dozens more.

#### Desired behaviour

All ID parameters across `src/tools/` use a single shared schema that accepts both numbers and numeric strings, rejects floats and negative values, and enforces a minimum of 1 (positive IDs) or 0 (the small set of sentinel sites documented below). The shared schema lives in a new module `src/tools/_id.ts` and is imported across every tool file that currently declares an ID parameter.

The change must be mechanical and reviewable — no behavioural change beyond the coercion relaxation and minimum-value guarantees. Non-ID numeric parameters (`limit`, `offset`, `priority`, `score`, etc.) are NOT touched by this requirement, so reviewers can scan a diff and confirm only ID lines moved.

#### Proposed fix

**File:** `src/tools/_id.ts` (new)

```ts
import { z } from "zod";

/**
 * Shared ID schema for resource identifiers across Gorgias tool
 * definitions. Uses `z.coerce.number()` so that LLM clients which emit
 * numeric arguments as JSON strings (e.g. `"12345"`) are accepted.
 *
 * Coercion caveats to be aware of:
 *   - `true`  -> 1     (accepted, but `.int().min(1)` still passes)
 *   - `false` -> 0     (rejected by `.min(1)`)
 *   - `""`    -> 0     (rejected by `.min(1)`)
 *   - `null`  -> 0     (rejected by `.min(1)`)
 *   - `"1.5"` -> 1.5   (rejected by `.int()`)
 *   - `"abc"` -> NaN   (rejected by `z.coerce.number()`)
 *
 * `.int()` alone accepts 0, so the `.min(1)` floor is load-bearing.
 * Use `idSchema` for the 99% case, and `idOrZeroSchema` only for the
 * six documented sentinel sites below.
 */
export const idSchema = z.coerce.number().int().min(1);

/**
 * Sentinel-allowing variant. Only used where the Gorgias API treats
 * `id=0` (or `id=null`) as a meaningful sentinel value:
 *
 *   - `src/tools/users.ts:27`       get_user:    id=0 -> authenticated user
 *   - `src/tools/users.ts:66`       update_user: id=0 -> authenticated user
 *   - `src/tools/views.ts:140`      search_view_items: view_id=0 -> inline query
 *   - `src/tools/tickets.ts:84`     create_ticket:    assignee_user.id=0 -> unassign
 *   - `src/tools/tickets.ts:87`     create_ticket:    assignee_team.id=0 -> unassign
 *   - `src/tools/tickets.ts:129`    update_ticket:    assignee_user.id=0/null -> unassign
 *   - `src/tools/tickets.ts:132`    update_ticket:    assignee_team.id=0/null -> unassign
 *
 * All other ID sites must use `idSchema`.
 */
export const idOrZeroSchema = z.coerce.number().int().min(0);
```

**File (representative change):** `src/tools/tickets.ts`

```ts
import { idSchema, idOrZeroSchema } from "./_id.js";

// ...

// gorgias_update_ticket
id: idSchema.describe("The unique ID of the ticket to update"),

// assignee_user.id on create_ticket / update_ticket
id: idOrZeroSchema.nullable().optional().describe(
  "ID of the user to assign. Set to null or 0 to unassign.",
),
```

Repeat mechanically across every file in the list below:

`account.ts`, `custom-fields.ts`, `customers.ts`, `events.ts`, `integrations.ts`, `jobs.ts`, `macros.ts`, `reporting.ts`, `rules.ts`, `satisfaction-surveys.ts`, `search.ts`, `smart-search.ts`, `smart-stats.ts`, `smart-ticket-detail.ts`, `statistics.ts`, `tags.ts`, `teams.ts`, `ticket-messages.ts`, `tickets.ts`, `users.ts`, `views.ts`, `voice-calls.ts`, `widgets.ts`. (`smart-ticket-detail.ts` already uses `.int().min(1)` but still switches to `idSchema` for consistency and coercion.)

#### Acceptance criteria

1. New module `src/tools/_id.ts` exports exactly two schemas: `idSchema` and `idOrZeroSchema`, both built on `z.coerce.number().int()`.
2. Every `z.number()` occurrence that represents a resource identifier is replaced by `idSchema` (or `idOrZeroSchema` at the six sentinel sites enumerated above) across all listed tool files.
3. Non-ID numeric parameters (`limit`, `offset`, `priority`, `score`, `version`, `timeout_ms`, etc.) are NOT modified. A grep for `limit: z\.number\(\)` should still return results (unchanged) after the refactor.
4. `gorgias_update_ticket({"id": "12345", "status": "closed"})` succeeds validation and calls `PUT /api/tickets/12345` — verified via stub client.
5. `gorgias_get_user({"id": "0"})` succeeds and calls `GET /api/users/0` (sentinel for authenticated user).
6. `gorgias_update_ticket({"id": "0"})` **fails** validation (positive-ID schema rejects 0).
7. `gorgias_update_ticket({"id": "-5"})` fails validation.
8. `gorgias_update_ticket({"id": "12.5"})` fails validation (non-integer rejected).
9. `gorgias_update_ticket({"id": "abc"})` fails validation with a clean Zod error.
10. `gorgias_update_ticket({"id": ""})` fails validation (empty string coerces to 0, `.min(1)` rejects).
11. `gorgias_update_ticket({"id": null})` fails validation (coerces to 0).
12. Existing tests in `src/__tests__/wire-format.test.ts` continue to pass; any fixture that relied on `z.number()` strict rejection of strings is updated to reflect the new coercion semantics (the briefing notes PR #2 did not touch ID validation, so no such fixture is expected).
13. Each of the six sentinel sites explicitly uses `idOrZeroSchema` and has an inline comment pointing back to `_id.ts` for the rationale.
14. The refactor is delivered either as one large commit with clear `git diff --stat` output or split into reviewable file-group commits (one per tool file, or grouped by category); either form is acceptable.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | `idSchema` coerces numeric string | unit | `idSchema.parse("123") === 123`. |
| 2 | `idSchema` accepts bare number | unit | `idSchema.parse(123) === 123`. |
| 3 | `idSchema` rejects zero | unit | `idSchema.safeParse(0).success === false`. |
| 4 | `idSchema` rejects zero as string | unit | `idSchema.safeParse("0").success === false`. |
| 5 | `idSchema` rejects negative number | unit | `idSchema.safeParse(-1).success === false`. |
| 6 | `idSchema` rejects negative string | unit | `idSchema.safeParse("-5").success === false`. |
| 7 | `idSchema` rejects float | unit | `idSchema.safeParse(1.5).success === false`. |
| 8 | `idSchema` rejects float as string | unit | `idSchema.safeParse("1.5").success === false`. |
| 9 | `idSchema` rejects non-numeric string | unit | `idSchema.safeParse("abc").success === false`. |
| 10 | `idSchema` rejects empty string | unit | `idSchema.safeParse("").success === false` (empty coerces to 0). |
| 11 | `idSchema` rejects null | unit | `idSchema.safeParse(null).success === false`. |
| 12 | `idSchema` rejects boolean true | unit | `idSchema.safeParse(true).success === false` (documented: accepts coercion to 1 but guard against accidental boolean pass-through — document the final decision in code comment, then pin it with a test). |
| 13 | `idOrZeroSchema` accepts zero | unit | `idOrZeroSchema.parse("0") === 0`. |
| 14 | `idOrZeroSchema` rejects negative | unit | `idOrZeroSchema.safeParse("-1").success === false`. |
| 15 | `update_ticket` accepts string ID | integration | Stub-client test invokes `gorgias_update_ticket` with `{id: "12345", status: "closed"}`, asserts PUT URL ends in `/api/tickets/12345`. |
| 16 | `get_user` accepts sentinel "0" | integration | Stub-client test invokes `gorgias_get_user` with `{id: "0"}`, asserts GET URL ends in `/api/users/0`. |
| 17 | `create_ticket` unassign via `{id: 0}` | integration | Asserts the payload round-trips with `assignee_user.id === 0`. |
| 18 | `update_ticket` unassign via `{id: null}` | integration | Asserts the payload round-trips with `assignee_user.id === null`. |
| 19 | `get_ticket` string ID regression | integration | Regression test for the original bug report: `{id: "98765"}` succeeds. |
| 20 | `delete_customer` rejects `id: "0"` | integration | Asserts the non-sentinel site still rejects 0. |

Target number of new tests: 20

#### Edge cases to handle

- Boolean coercion: `z.coerce.number()` maps `true -> 1` and `false -> 0`. `.min(1)` therefore silently lets `true` through as `1`. Decide and pin: either (a) accept and document (the simpler route, matches the briefing's note about coercion semantics) or (b) pre-refine with `.refine(v => typeof originalInput !== "boolean")`. Recommendation: accept and document explicitly in the `_id.ts` doc comment.
- Empty string and `null` both coerce to 0; the `.min(1)` floor rejects them for positive IDs but accepts them for `idOrZeroSchema`. Ensure the six sentinel sites document what `id=0` means at each call-site (already stated in existing `describe()` text for most of them).
- Arrays of IDs (e.g. `user_ids: z.array(z.number())` on `events.ts` — PR #2 already fixed the scalar-vs-array shape, but the element schema is still `z.number()`). Replace with `z.array(idSchema)` so string elements are coerced too.
- IDs nested inside object schemas (e.g. `assignee_user: z.object({ id: z.number()... })` on `tickets.ts`, `customer: z.object({ id: z.number()... })` on `tickets.ts:80`). Replace the inner `id:` only; the outer object shape is unchanged.
- `custom_fields: z.array(z.object({ id: z.number()... }))` on `tickets.ts:97` — the custom field definition ID is a resource ID; use `idSchema`.
- Tools where `id` is part of a path variable (`/api/tickets/${id}`) vs. body field — both get the same schema; no distinction needed.
- Watch for any `z.number().positive()` or `z.number().nonnegative()` variants that may exist in a handful of sites — sweep with a broader grep during implementation.

#### Backward compatibility

Strictly a relaxation for clients that were already passing numbers correctly (the schema still accepts them) plus acceptance of string-encoded numbers (the new behaviour). The only regression vector is if any caller was relying on the schema rejecting strings as a validation signal — there are no such call sites in the repo.

External API contract: unchanged. The coerced `number` is what ends up interpolated into URL paths and JSON bodies, exactly as before.

#### Dependencies on other requirements

- Independent of H18. Can land in either order.
- Should precede any future "strict tool-args contract" requirement so the new contract includes coerced IDs from day one.

#### Estimated effort

- **New lines of code:** ~60 (new `_id.ts` module with doc comments; ~10 lines of schema + ~50 lines of commentary and import lines across consumers)
- **Modified lines of code:** ~140-170 (one replacement per ID site across 21 tool files; exact count depends on how the non-ID numerics shake out during the sweep — the briefing's "171 occurrences" upper bound is the worst case, the verified grep gives 166 total of which roughly 120-140 are IDs)
- **New test cases:** 20
- **Affected existing tests:** 0-5 (wire-format tests may need minor updates where a fixture hard-codes a numeric ID — sweep during implementation)
- **Risk level:** medium (wide blast radius across every tool file; mitigated by mechanical nature, strong test coverage, and a one-site-at-a-time review pass)
- **Rough time estimate:** M (1-2 days including the full sweep, the test matrix above, and reviewer walk-through of each file-group commit)
---

## Section 3 — HIGH (schema correctness)

The four schema-correctness items below cause user-visible misbehaviour today: write tools that reject valid input, smart-search strategies that ignore the most useful surface, and a widget literal that fails the type check. They are batched together because each one is a self-contained schema diff with the same review pattern.

---

### H14: Integration update — partial-update support and strict enums

**Severity:** HIGH
**Category:** schema / validation
**Validated by:** Skeptic-mode validator pass

#### Problem statement

The `gorgias_update_integration` tool models the nested `http` object as if it were the create payload: `url`, `method`, `request_content_type`, and `response_content_type` are all declared with non-optional Zod types. Per the Gorgias REST spec, `PUT /api/integrations/{id}` requires only `name` at the top level and only `url` inside the `http` object; every other `http` field has a server-side default and is optional on a partial update. A caller who only wants to bump the integration name, flip one trigger flag, or rotate an HMAC secret is currently forced to resend a full `http` block or receive a validation failure from the MCP layer before the request ever reaches Gorgias.

Alongside the partial-update gap, both the create and update tools let several fields drift wider than the documented enum surface. The top-level `type` is `z.string()` even though only `"http"` integrations are creatable through the REST API. The nested `request_content_type` and `response_content_type` are free-form strings, but the docs enumerate only `"application/json"` / `"application/x-www-form-urlencoded"` for the request side and `"application/json"` for the response side. The `http.form` field is modelled as a plain record, but the spec explicitly types it as `anyOf [object, null]`, so clients that want to clear the form payload on an update cannot do so through the current schema.

Note: a previous audit pass flagged `business_hours_id` as a phantom field; the validator subsequently confirmed it IS a real documented field (relevant for phone integrations only). It must be left exactly as it is in both create and update.

#### Evidence

- **File:line:** `src/tools/integrations.ts:83-85` (update), `src/tools/integrations.ts:43,48-50` (create)
- **Current code:**
  ```ts
  // update — lines 83-85
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).describe("HTTP verb ..."),
  request_content_type: z.string().describe("MIME type of the outbound request body ..."),
  response_content_type: z.string().describe("Expected MIME type ..."),

  // create — line 43
  type: z.string().describe("Type of integration being created. Use 'http' ..."),

  // create — line 50
  form: z.record(z.string(), z.string()).optional().describe("Key-value pairs ..."),
  ```
- **Observable symptom:** A caller sending `{ id, name, http: { url } }` to rename an integration fails Zod validation with "method is required / request_content_type is required / response_content_type is required" before any network call. Callers who send `type: "phone"` on create succeed at the schema layer and then receive an opaque 400 from Gorgias.

#### Desired behaviour

On update, only `id` and `name` should be required at the top level, and only `url` should be required inside `http`. Every other `http` field must be optional so that a caller can send a minimal patch. On both create and update, the top-level `type` must be a `z.literal("http")` (HTTP is the only type the REST endpoint creates). `http.request_content_type` must be `z.enum(["application/json", "application/x-www-form-urlencoded"])`. `http.response_content_type` must be `z.enum(["application/json"])`. `http.form` must be `.nullable()` so callers can clear it. `business_hours_id` stays untouched.

#### Proposed fix

**File:** `src/tools/integrations.ts`

```ts
// Shared enum constants near the top of the file
const INTEGRATION_TYPE = z.literal("http");
const REQUEST_CT = z.enum(["application/json", "application/x-www-form-urlencoded"]);
const RESPONSE_CT = z.enum(["application/json"]);

// --- Create Integration (lines 38-70) ---
type: INTEGRATION_TYPE.describe("Only 'http' integrations are creatable via the REST API"),
// ...
request_content_type: REQUEST_CT.describe("MIME type of the outbound request body"),
response_content_type: RESPONSE_CT.describe("Expected MIME type of the response body"),
form: z.record(z.string(), z.string()).nullable().optional().describe(
  "Key-value pairs sent as the request body or query params. Pass null to clear.",
),

// --- Update Integration (lines 72-106) ---
http: z.object({
  url: z.string().describe("Target endpoint URL (required on update when http is present)"),
  method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).optional(),
  request_content_type: REQUEST_CT.optional(),
  response_content_type: RESPONSE_CT.optional(),
  form: z.record(z.string(), z.string()).nullable().optional(),
  headers: z.record(z.string(), z.string()).optional(),
  hmac_secret: z.string().optional(),
  triggers: z.object({ /* unchanged */ }).optional(),
}).optional(),
```

#### Acceptance criteria

1. `gorgias_update_integration` accepts `{ id, name, http: { url } }` and forwards it to `PUT /api/integrations/{id}` with no schema rejection.
2. `gorgias_update_integration` accepts `{ id, name }` (no `http` block at all) for renames.
3. `gorgias_create_integration` rejects `type: "phone"`, `type: "shopify"`, or any non-`"http"` literal at the schema layer.
4. Both create and update reject `request_content_type: "text/xml"` and `response_content_type: "application/xml"` at the schema layer.
5. `http.form: null` is accepted by both create and update.
6. `business_hours_id` remains present on create and is unchanged by this requirement.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | `update_integration accepts minimal http patch` | wire-format | Send `{ id: 1, name: "x", http: { url: "https://e.x" } }`; assert PUT body equals input. |
| 2 | `update_integration accepts rename without http` | wire-format | Send `{ id: 1, name: "x" }`; assert no http key in body. |
| 3 | `update_integration accepts partial method-only change` | wire-format | Send http with `url` + `method` only; assert no other http keys serialised. |
| 4 | `create_integration rejects non-http type` | schema | Assert Zod rejects `type: "shopify"`. |
| 5 | `create_integration rejects invalid request_content_type` | schema | Assert Zod rejects `request_content_type: "text/plain"`. |
| 6 | `update_integration rejects invalid response_content_type` | schema | Assert Zod rejects `response_content_type: "application/xml"`. |
| 7 | `create_integration accepts form: null` | schema | Assert validation passes. |
| 8 | `business_hours_id still accepted on create` | regression | Guard against accidental removal. |

Target number of new tests: 8

#### Edge cases to handle

- Caller sends `http: {}` with no `url` — schema should reject (url is still required inside an http block, even on update).
- Caller sends `http: null` — should be rejected because the Zod type is `.optional()`, not `.nullable()`; document this or add `.nullable()` if the docs permit.
- Caller omits the entire `http` key on update — must pass.

#### Backward compatibility

Strictly loosening required fields on update is backward-compatible: any caller that currently sends all four `http` fields continues to work. Tightening `type` to `z.literal("http")` and the content-type fields to enums is a breaking change at the schema layer, but only rejects inputs that would already 400 at the Gorgias API — no previously-successful call is broken.

#### Dependencies on other requirements

- None. Self-contained schema fix.

#### Estimated effort

- **New lines of code:** ~15
- **Modified lines of code:** ~12
- **New test cases:** 8
- **Affected existing tests:** 0
- **Risk level:** low
- **Rough time estimate:** S

---

### H16: Satisfaction survey update — missing required fields on full-replacement PUT

**Severity:** HIGH
**Category:** schema / validation
**Validated by:** Skeptic-mode validator pass

#### Problem statement

`PUT /api/satisfaction-surveys/{id}` is documented as a full-replacement update: the entire survey object is replaced by the request body, and any documented non-nullable field omitted from the body will either be rejected by the server or be wiped to a null/default. The current `gorgias_update_satisfaction_survey` schema omits three fields that the Gorgias spec lists in the PUT body entirely: `customer_id`, `ticket_id`, and `created_datetime`. The first two are documented as non-nullable, which makes them effectively required on an update — the caller must re-send them to preserve the survey's linkage to its owning customer and ticket.

The recent changelog fix to the `score` range (PR #2) proves the update tool is actively used for mutations — callers who use it to change a survey score today are silently depending on the fact that the Gorgias API happens to tolerate a body missing `customer_id` / `ticket_id`. That tolerance is undocumented and cannot be relied on. Any future API tightening, or any caller on a stricter tenant, will see surveys orphaned or requests rejected.

The third field, `created_datetime`, is documented as nullable on the survey object but may be supplied in the PUT body to preserve the original creation timestamp through a full replacement. Omitting it from the schema means callers cannot round-trip a GET→modify→PUT workflow without losing the creation timestamp.

#### Evidence

- **File:line:** `src/tools/satisfaction-surveys.ts:61-69`
- **Current code:**
  ```ts
  inputSchema: {
    id: z.number().describe("The unique ID ..."),
    body_text: z.string().max(1000).nullable().optional().describe(...),
    meta: z.record(z.string(), z.unknown()).nullable().optional().describe(...),
    score: z.number().int().min(1).max(5).nullable().optional().describe(...),
    scored_datetime: z.string().nullable().optional().describe(...),
    sent_datetime: z.string().nullable().optional().describe(...),
    should_send_datetime: z.string().nullable().optional().describe(...),
  },
  ```
- **Observable symptom:** A caller who reads a survey, edits its score, and PUTs it back loses the `customer_id`/`ticket_id` linkage from the body entirely (they're dropped by the schema before the serialiser runs). The create tool correctly requires both IDs (lines 41-42), making the inconsistency more glaring.

#### Desired behaviour

The update schema must require `customer_id` and `ticket_id` as integer IDs, matching the shape already used by the create tool. `created_datetime` should be added as an optional nullable ISO 8601 string so callers can preserve it through a round-trip. All other optional fields remain optional so surface behaviour for existing callers (who only set `score` or `body_text`) is unchanged except that those callers must now additionally supply the two linkage IDs.

#### Proposed fix

**File:** `src/tools/satisfaction-surveys.ts`

```ts
// Update Satisfaction Survey inputSchema — lines 61-69
inputSchema: {
  id: z.number().describe("The unique ID of the satisfaction survey to update"),
  customer_id: z.number().int().describe(
    "The ID of the customer who filled the survey. Required: PUT is a full-replacement " +
    "operation and this field is non-nullable on the Survey object.",
  ),
  ticket_id: z.number().int().describe(
    "The ID of the ticket the survey is associated with. Required: PUT is a full-replacement " +
    "operation and this field is non-nullable on the Survey object.",
  ),
  created_datetime: z.string().nullable().optional().describe(
    "ISO 8601 datetime the survey was created. Include to preserve the original creation " +
    "timestamp through a full-replacement PUT; omit to let the server keep its stored value.",
  ),
  body_text: z.string().max(1000).nullable().optional().describe(...),
  meta: z.record(z.string(), z.unknown()).nullable().optional().describe(...),
  score: z.number().int().min(1).max(5).nullable().optional().describe(...),
  scored_datetime: z.string().nullable().optional().describe(...),
  sent_datetime: z.string().nullable().optional().describe(...),
  should_send_datetime: z.string().nullable().optional().describe(...),
},
```

#### Acceptance criteria

1. `gorgias_update_satisfaction_survey` rejects any payload missing `customer_id` at the schema layer.
2. `gorgias_update_satisfaction_survey` rejects any payload missing `ticket_id` at the schema layer.
3. `customer_id`, `ticket_id`, and `created_datetime` are forwarded verbatim in the PUT body when supplied.
4. `created_datetime: null` is accepted and forwarded.
5. The existing `score` range test (PR #2) still passes with the new required fields added to its fixture.
6. Tool description explicitly notes that PUT is a full replacement and that linkage IDs must be re-sent.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | `update_survey requires customer_id` | schema | Assert Zod rejects body without `customer_id`. |
| 2 | `update_survey requires ticket_id` | schema | Assert Zod rejects body without `ticket_id`. |
| 3 | `update_survey forwards linkage IDs` | wire-format | PUT body must contain both IDs verbatim. |
| 4 | `update_survey accepts created_datetime string` | schema | Assert valid ISO 8601 string passes. |
| 5 | `update_survey accepts created_datetime null` | schema | Nullable path. |

Target number of new tests: 5

#### Edge cases to handle

- Caller sends `customer_id: null` — schema rejects (non-nullable).
- Caller sends a float for `customer_id` — schema rejects (`.int()` guard).
- `created_datetime` omitted entirely — schema passes, field is not serialised.

#### Backward compatibility

This is a breaking change for any caller currently issuing `update_satisfaction_survey` without the two linkage IDs. Since the Gorgias API documents these as required in the PUT body, any such caller was already relying on undocumented server behaviour. The `CHANGELOG.md` entry must call this out under "Fixed — schema correctness" and recommend reading the survey first via `gorgias_get_satisfaction_survey` to obtain the IDs.

#### Dependencies on other requirements

- Loosely related to H14 (both enforce full-replacement PUT semantics correctly), but independently landable.

#### Estimated effort

- **New lines of code:** ~15
- **Modified lines of code:** ~2
- **New test cases:** 5
- **Affected existing tests:** ~1 (any existing update-survey fixture needs `customer_id`/`ticket_id` added)
- **Risk level:** medium (schema breaking change)
- **Rough time estimate:** S

---

### H20: smart_search strategy ordering, missing `view` search_type, and silent client-filter truncation (includes H11b)

**Severity:** HIGH
**Category:** routing / observability
**Validated by:** Skeptic-mode validator pass

#### Problem statement

The `gorgias_smart_search` tool runs auto-detection through eight ordered strategies. Strategy 5 — topic-keyword match via `queryMatchesTopicKeyword` — short-circuits to `searchByKeyword` before Strategy 6 (view match) or Strategy 7 (customer-name match) is ever consulted. The `TOPIC_KEYWORDS` set is large and deliberately loose: it contains common English words such as `"refund"`, `"shipping"`, `"urgent"`, `"post"`, `"sale"`, `"address"`, `"manager"`, and `"order"`. Any customer whose full name, first name, or last name contains one of those tokens — or any view whose name is `"Shipping"`, `"Returns"`, `"Urgent"`, `"Refunds"`, etc. — is unreachable through auto-detection. The query lands in keyword search and the caller gets a subject-line match (or nothing) instead of the intended customer or view.

The tool offers no escape hatch for view search either. The input schema's `search_type` enum lists `["auto", "order_number", "ticket_id", "email", "customer_name", "keyword"]` — six values, no `"view"`. A caller who knows they want "give me the tickets in the `Urgent` view" cannot express that explicitly; they must either rename the view or accept the keyword-search miss. `customer_name` has an explicit override; `view` does not, so the asymmetry is not intentional.

Finally — and this is the H11b finding from validator pass 19 that was not in the original audit list — `applyClientFilters` is called after every strategy's upstream API fetch. The API is asked for `limit` rows, and the client filter then drops rows whose `status` / `start_date` / `end_date` do not match. A caller who sends `limit: 50, status: "open"` receives back a response whose `totalFound` field reflects only the subset of those 50 rows that happened to be open. The remaining open tickets beyond the 50-row window are silently invisible and the response carries no warning. A caller reading `totalFound: 22` naturally assumes "22 open tickets exist matching this query" when in reality the upstream may have many more.

#### Evidence

- **File:line:** `src/tools/smart-search.ts:499-504` (schema enum), `src/tools/smart-search.ts:598-614` (strategy order), `src/tools/smart-search.ts:240-258` (client filter), `src/tools/smart-search.ts:301-302, 342-343, 378-379, 412-413, 448-449, 467-468` (every strategy call site).
- **Current code:**
  ```ts
  // Schema enum — line 500
  search_type: z.enum(["auto", "order_number", "ticket_id", "email", "customer_name", "keyword"])

  // Strategy ordering — lines 598-614
  // Strategy 5: Topic keyword -> keyword search on subjects
  if (queryMatchesTopicKeyword(query)) {
    return await searchByKeyword(client, query, args, limit);
  }
  // Strategy 6: Try view match
  const viewResult = await searchByView(client, query, args, limit);
  if (viewResult) return viewResult;
  // Strategy 7: Try customer name search
  const customerResult = await searchByCustomerName(client, query, args, limit);

  // Client filter — lines 240-258
  function applyClientFilters(tickets: any[], args: SearchArgs): any[] {
    let filtered = tickets;
    if (args.status) filtered = filtered.filter((t: any) => t.status === args.status);
    // ... date filters ...
    return filtered;
  }
  ```
- **Observable symptom 1:** Query `"Refund Department"` (a hypothetical customer name) hits Strategy 5 via the `"refund"` keyword and returns keyword hits instead of that customer's tickets. Query `"Urgent"` (a view name) does the same via the `"urgent"` keyword.
- **Observable symptom 2:** A caller cannot force view search by any means — there is no `search_type: "view"` and no query that reliably avoids the keyword trap.
- **Observable symptom 3:** `{ query: "recent", status: "open", limit: 50 }` returns `totalFound: 17` with no indication that 33 non-open tickets were dropped client-side and that more open tickets may exist beyond the 50-row window.

#### Desired behaviour

Add `"view"` to the `search_type` enum and route it to `searchByView` as an explicit branch. When `searchByView` returns `null` inside the explicit branch, return an empty `buildResponse` with a `_hint` explaining no view matched — do not silently fall through to keyword search.

Reorder auto-detection so that Strategy 5 (topic keyword) runs after the view and customer-name strategies, OR keep the current order and document the tradeoff in the tool description: "auto-detection prefers keyword search for topic terms; pass `search_type: 'view'` or `search_type: 'customer_name'` to force the alternative." The validator's preference is the reorder, because auto-detection is the dominant code path and the explicit override is a workaround not every caller will discover.

For H11b, `applyClientFilters` must be upgraded to return a structured result (pre-filter count, post-filter count, dropped count) rather than just the filtered array. Every strategy's `_hint` must include a warning when rows were dropped AND the pre-filter count equals the requested `limit` (meaning the API window may have been exhausted): `"Note: 33 of 50 rows were dropped by client-side status/date filters. The API window was at the requested limit, so more matching tickets may exist beyond this page — try narrowing the query or raising the limit."`

#### Proposed fix

**File:** `src/tools/smart-search.ts`

```ts
// ------- Schema enum (line 500) -------
search_type: z.enum([
  "auto", "order_number", "ticket_id", "email",
  "customer_name", "keyword", "view",
]).optional().describe(/* updated: describe view */),

// ------- Explicit view branch, alongside existing explicit branches -------
if (searchType === "view") {
  const result = await searchByView(client, query, args, limit);
  return result ?? buildResponse([], "view", `No view found matching '${query}'.`);
}

// ------- Reordered auto-detection (lines 598-617) -------
// Strategy 5: Try view match (before topic keywords)
const viewResult = await searchByView(client, query, args, limit);
if (viewResult) return viewResult;

// Strategy 6: Try customer name search (before topic keywords)
const customerResult = await searchByCustomerName(client, query, args, limit);
if (customerResult) return customerResult;

// Strategy 7: Topic keyword -> keyword search on subjects
if (queryMatchesTopicKeyword(query)) {
  return await searchByKeyword(client, query, args, limit);
}

// Strategy 8: Fallback to keyword search
return await searchByKeyword(client, query, args, limit);

// ------- applyClientFilters returns a structured result (H11b) -------
interface FilterResult {
  tickets: any[];
  preFilterCount: number;
  postFilterCount: number;
  droppedCount: number;
  apiWindowExhausted: boolean;
}

function applyClientFilters(
  tickets: any[],
  args: SearchArgs,
  requestedLimit: number,
): FilterResult {
  const pre = tickets.length;
  let filtered = tickets;
  if (args.status) filtered = filtered.filter((t: any) => t.status === args.status);
  if (args.start_date) { /* ... */ }
  if (args.end_date) { /* ... */ }
  return {
    tickets: filtered,
    preFilterCount: pre,
    postFilterCount: filtered.length,
    droppedCount: pre - filtered.length,
    apiWindowExhausted: pre >= requestedLimit,
  };
}

// ------- buildResponse accepts an optional filter-warning suffix -------
function buildResponse(
  tickets: ProjectedTicket[],
  searchStrategy: string,
  hint: string,
  filterResult?: FilterResult,
): SearchResult {
  let finalHint = hint;
  if (filterResult && filterResult.droppedCount > 0) {
    finalHint += ` Note: ${filterResult.droppedCount} of ${filterResult.preFilterCount} ` +
      `rows were dropped by client-side filters (status/date).`;
    if (filterResult.apiWindowExhausted) {
      finalHint += " The API window was at the requested limit, so more matching tickets " +
        "may exist beyond this page — narrow the query or raise the limit.";
    }
  }
  const payload = {
    tickets,
    totalFound: tickets.length,
    searchStrategy,
    _hint: finalHint,
    ...(filterResult && {
      preFilterCount: filterResult.preFilterCount,
      postFilterCount: filterResult.postFilterCount,
    }),
  };
  return { content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }] };
}
```

Every call site of `applyClientFilters` (there are six) must be updated to pass `limit` and to forward the returned `FilterResult` to `buildResponse`.

#### Acceptance criteria

1. `search_type: "view"` is accepted by the schema and routes to `searchByView`.
2. Explicit `view` branch returns an empty response with a clear `_hint` when no view matches, and does not fall through to keyword search.
3. Auto-detection: a query equal to an existing view name matches the view even when the name contains a topic keyword.
4. Auto-detection: a query equal to an existing customer name matches the customer even when the name contains a topic keyword.
5. `applyClientFilters` returns a structured `FilterResult`.
6. When rows are dropped by client filters, the `_hint` string contains the drop count.
7. When the pre-filter count equals the requested limit AND rows were dropped, the `_hint` warns that more tickets may exist beyond the API window.
8. Response payload includes `preFilterCount` and `postFilterCount` whenever client filters ran.
9. Existing smart-search tests are updated to assert the new fields where filters are active and to assert their absence where filters are inactive.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | `smart_search explicit search_type view routes to searchByView` | wire-format | Assert `PUT /api/views/{id}/items` was called. |
| 2 | `smart_search explicit view returns empty on no match without keyword fallback` | wire-format | Assert no `PUT /api/views/0/items` (keyword search call). |
| 3 | `smart_search auto matches view name containing topic keyword` | routing | Query `"Urgent"` against a view named `"Urgent"`; assert view strategy wins. |
| 4 | `smart_search auto matches customer name containing topic keyword` | routing | Use a customer-name fixture with the word `"returns"`; assert customer_name strategy wins. |
| 5 | `smart_search auto still routes pure topic keyword to keyword search` | routing | Query `"shipping delay"` with no matching view/customer; assert keyword strategy. |
| 6 | `applyClientFilters returns structured FilterResult` | unit | Stub tickets array, assert `preFilterCount`, `postFilterCount`, `droppedCount`, `apiWindowExhausted`. |
| 7 | `smart_search emits drop warning in _hint when rows dropped` | response-shape | Assert hint substring `"dropped by client-side filters"`. |
| 8 | `smart_search emits window-exhausted warning when dropped AND pre count equals limit` | response-shape | Assert the "more matching tickets may exist" sentence. |
| 9 | `smart_search does not emit warning when no rows dropped` | response-shape | Negative assertion. |
| 10 | `smart_search response includes preFilterCount when filters ran` | response-shape | Assert key present. |
| 11 | `smart_search response omits preFilterCount when no filters supplied` | response-shape | Assert key absent. |

Target number of new tests: 11

#### Edge cases to handle

- Query `"urgent"` (lowercase topic keyword) with no view and no customer match — must still reach keyword search via the reordered Strategy 7.
- View strategy matches fuzzily with a low score — current fuzzy threshold is 65; keep it.
- Empty ticket array returned by API (`preFilterCount: 0`) — `apiWindowExhausted` must be false (`0 >= limit` is only true when limit is 0, which is rejected by `z.number().min(1)`).
- Client filters applied but `droppedCount: 0` — no warning suffix, `preFilterCount`/`postFilterCount` still included for observability.
- Explicit `search_type: "view"` with a query that would otherwise be auto-detected as an email or ticket ID — explicit wins, always.

#### Backward compatibility

- Adding `"view"` to the enum is additive and non-breaking.
- Reordering auto-detection changes observable behaviour for queries that used to match a topic keyword AND a view/customer name. This is a deliberate fix, but it does alter routing for some callers. The CHANGELOG entry must describe the new precedence.
- The `FilterResult` struct is internal; callers only see the new `preFilterCount` / `postFilterCount` fields and the augmented `_hint`. No existing field is renamed or removed, so JSON consumers remain compatible.

#### Dependencies on other requirements

- None. Self-contained within `smart-search.ts`.

#### Estimated effort

- **New lines of code:** ~60
- **Modified lines of code:** ~40 (six call sites of `applyClientFilters`, the strategy reorder, the schema enum, the explicit branch)
- **New test cases:** 11
- **Affected existing tests:** ~3 smart-search tests that assert `_hint` contents or call-site argument counts
- **Risk level:** medium (touches hot routing path)
- **Rough time estimate:** M

---

### Widget template.type literal — tighten `z.string()` to `z.literal("wrapper")`

**Severity:** HIGH
**Category:** schema / validation
**Validated by:** Skeptic-mode validator pass

#### Problem statement

Both `gorgias_create_widget` and `gorgias_update_widget` declare `template.type` as `z.string()` even though the field's own description reads "Must be 'wrapper' at the root level". The Gorgias widget template format recognises a single root-level type — `"wrapper"` — and any other value is rejected server-side with an opaque 400. A caller who passes `template: { type: "card", widgets: [...] }` (a natural mistake, because `"card"` is a valid *child* component type) currently sails through schema validation and then receives an opaque server error.

This is the smallest fix in the document, but it belongs in the requirements list because the code already self-documents the constraint in the field's description string — the loose `z.string()` is a validation gap, not a deliberate design decision. Tightening it to a literal is a one-token change per call site and immediately surfaces the constraint at the MCP boundary instead of at the HTTP boundary.

#### Evidence

- **File:line:** `src/tools/widgets.ts:44` (create), `src/tools/widgets.ts:77` (update)
- **Current code:**
  ```ts
  // Create, line 44
  type: z.string().describe("Must be 'wrapper' at the root level"),
  // Update, line 77
  type: z.string().describe("Must be 'wrapper' at the root level"),
  ```
- **Observable symptom:** `{ template: { type: "card", widgets: [] } }` passes MCP-side Zod and then returns an opaque server-side validation failure with no actionable message for the LLM caller.

#### Desired behaviour

Both create and update must reject any root-level `template.type` value other than the literal string `"wrapper"` at the Zod validation layer. The description string is unchanged — it already documents the constraint correctly.

#### Proposed fix

**File:** `src/tools/widgets.ts`

```ts
// Create — line 44
template: z.object({
  type: z.literal("wrapper").describe("Must be 'wrapper' at the root level"),
  widgets: z.array(z.object({ /* unchanged */ })).describe(...),
}).describe("Template to render the data of the widget"),

// Update — line 77
template: z.object({
  type: z.literal("wrapper").describe("Must be 'wrapper' at the root level"),
  widgets: z.array(z.object({ /* unchanged */ })).describe(...),
}).optional().describe("Template to render the data of the widget. Replaces the entire template on update"),
```

#### Acceptance criteria

1. `gorgias_create_widget` rejects `template.type: "card"` at the schema layer.
2. `gorgias_create_widget` rejects `template.type: "text"` at the schema layer.
3. `gorgias_create_widget` accepts `template.type: "wrapper"`.
4. `gorgias_update_widget` enforces the same three rules above.
5. The child-widget `type` field (inside `template.widgets[]`) remains `z.string()` — the literal constraint is root-level only.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | `create_widget rejects non-wrapper root template type` | schema | Assert Zod rejects `{ template: { type: "card", widgets: [] } }`. |
| 2 | `create_widget accepts wrapper root template type` | schema | Happy path. |
| 3 | `update_widget rejects non-wrapper root template type` | schema | Same as #1 for update. |
| 4 | `update_widget accepts wrapper root template type` | schema | Happy path. |
| 5 | `create_widget still accepts arbitrary child widget types` | schema | Regression: `template.widgets[0].type: "card"` must pass. |

Target number of new tests: 5

#### Edge cases to handle

- `template.type: "Wrapper"` (capital W) — must be rejected; Zod literals are case-sensitive, which is the desired behaviour.
- `template.type: " wrapper"` (leading space) — must be rejected.
- Update-side `template` omitted entirely — must still pass because the outer `template` remains `.optional()`.

#### Backward compatibility

This tightens the schema. Any caller previously sending a non-`"wrapper"` root type was already broken at the API layer, so no working integration is affected. The change is safe to land without a deprecation window.

#### Dependencies on other requirements

- None. Two-line change, fully independent.

#### Estimated effort

- **New lines of code:** 0
- **Modified lines of code:** 2
- **New test cases:** 5
- **Affected existing tests:** 0
- **Risk level:** low
- **Rough time estimate:** S
---

## Section 4 — MEDIUM

The MEDIUM section is the longest in the document. Items here are validation polish, UX improvements, and small correctness fixes that accumulated across the audit. None are silent data loss; all are real bugs that a user *would* notice if they hit them.

---

### M2: `smart_stats` granularity "none" aggregate mode

**Severity:** MEDIUM
**Category:** Tool schema / query construction
**Validated by:** Skeptic-mode validator pass

#### Problem statement

`gorgias_smart_stats` defaults `granularity` to `"day"` and unconditionally appends a `time_dimensions` entry to the outgoing reporting query. The MCP tool exposes no way for a caller to request an aggregate-only query — i.e. one with no time bucketing at all. Per the Gorgias reporting API, aggregate mode is achieved by **omitting** the `time_dimensions` array entirely; there is no `"none"` or `"all"` value at the API layer.

Aggregate mode is the single most important workaround for the 100-row ceiling tracked in C1. A multi-agent `messages-sent` query bucketed by day will explode row count as `agents * days`, blowing past the 100-row cap for even a modestly sized team over a two-week window. Aggregate mode collapses the time axis and returns one row per agent, fitting comfortably within the cap. Not exposing this mode is a functional gap.

#### Evidence

- **File:line:** `src/tools/smart-stats.ts:42` — enum currently excludes `"none"`:
  ```ts
  granularity: z.enum(["hour", "day", "week", "month"]).optional()
  ```
- **File:line:** `src/tools/smart-stats.ts:52` — default is `"day"`:
  ```ts
  const granularity = args.granularity ?? "day";
  ```
- **File:line:** `src/tools/smart-stats.ts:148-151` — `time_dimensions` unconditionally appended:
  ```ts
  time_dimensions: [{
    dimension: timeDimField,
    granularity,
  }],
  ```

#### Desired behaviour

Callers can pass `granularity: "none"` to request an aggregate-only query. When `"none"` is supplied, the tool omits `time_dimensions` from the outgoing query body entirely (not `null`, not an empty array — the key is absent). The response echoes `granularity: "none"` so the caller can confirm the mode. All other granularity values behave exactly as before.

#### Proposed fix

**File:** `src/tools/smart-stats.ts`

```ts
// Schema
granularity: z.enum(["hour", "day", "week", "month", "none"]).optional()
  .describe("Time grouping granularity (default: 'day'). Use 'none' for aggregate mode (no time bucketing) — the primary workaround for the 100-row cap on multi-agent queries."),

// Handler
const granularity = args.granularity ?? "day";

// Build query — omit time_dimensions entirely when granularity is "none"
const query: Record<string, unknown> = {
  scope,
  filters: allFilters,
  timezone: tz,
  dimensions: resolvedDimensions.length > 0 ? resolvedDimensions : undefined,
  measures,
};
if (granularity !== "none") {
  query.time_dimensions = [{ dimension: timeDimField, granularity }];
}
```

The response object continues to include `granularity` as-is so callers see `"none"` in the echoed metadata.

#### Acceptance criteria

1. Passing `granularity: "none"` produces an outgoing POST body where `time_dimensions` is absent (verified via stub-client body capture — not `undefined`, not `[]`, not present).
2. Passing `granularity: "day"` (or omitting it) produces a body with `time_dimensions: [{ dimension, granularity: "day" }]` exactly as before.
3. The response `granularity` field echoes the input, including `"none"`.
4. Tool description mentions `"none"` as the aggregate-mode opt-out and cross-references the 100-row cap workaround.
5. Schema validation rejects any value outside the extended enum.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | smart_stats granularity none omits time_dimensions | unit | Stub client, assert captured body has no `time_dimensions` key |
| 2 | smart_stats granularity day still includes time_dimensions | unit | Regression: existing default behaviour unchanged |
| 3 | smart_stats response echoes granularity none | unit | Parse tool response, assert `granularity === "none"` |
| 4 | smart_stats rejects unknown granularity | unit | Zod validation error on e.g. `"yearly"` |
| 5 | smart_stats aggregate mode avoids 100-row cap on multi-agent | integration-style | Stubbed large result; verify row count stays low |

Target number of new tests: 5

#### Edge cases to handle

- `granularity: "none"` combined with zero dimensions — should still succeed and return a single aggregated row.
- `granularity: "none"` combined with `dimensions: ["agentId"]` — should return one row per agent.
- `time_dimensions` must not be sent as `undefined` — some JSON serialisers emit `"time_dimensions": null` which the API may reject differently from omission.

#### Backward compatibility

Fully backward compatible. The default remains `"day"`. `"none"` is a strict superset of the existing enum. No existing callers can break.

#### Dependencies on other requirements

- **C1** (100-row cap): aggregate mode is the documented workaround. M2 should land in the same PR as C1 so the workaround referenced in C1's error message is actually available.
- No conflicts with other smart_stats work (M3 validation lives in a different code path).

#### Estimated effort

- **New lines of code:** ~15
- **Modified lines of code:** ~8
- **New test cases:** 5
- **Affected existing tests:** 1 (existing granularity-default test may need a no-regression touch-up)
- **Risk level:** low
- **Rough time estimate:** S

---

### M3: `smart_stats` client-side 366-day validation

**Severity:** MEDIUM
**Category:** Input validation / UX
**Validated by:** Skeptic-mode validator pass

#### Problem statement

The Gorgias reporting API rejects any query whose date range exceeds 366 days with the upstream error `"Maximum allowed period size is 366 days"`. Callers currently discover this only after a round-trip, and the error surfaces through the sanitiser with no actionable context — no mention of which range was attempted, no pointer to the split-query workaround. For annual-comparison queries (e.g. "YoY for last 400 days") this is a common footgun.

A client-side guard can catch this before the HTTP call, return a concrete error listing the actual span and the max, and tell the caller how to recover (split into multiple sub-queries and merge client-side).

#### Evidence

- **File:line:** `src/tools/smart-stats.ts:89` — after the broken-scope and required-filter checks, there is no date-range size validation.
- **Observed upstream error:** HTTP 400 `"Maximum allowed period size is 366 days"` (Gorgias reporting API).
- **README Troubleshooting section** already documents the 366-day ceiling (see CHANGELOG entry for the new Troubleshooting block), but the tool itself does not enforce it.

#### Desired behaviour

Before constructing the outgoing reporting query, the tool computes the period length in whole days from `start_date` to `end_date` (inclusive, using the same UTC parsing as the existing date regex validator). If the span exceeds 366 days, the tool returns an `isError: true` response containing: the actual span in days, the 366-day maximum, a reference to the scope, and a `_hint` suggesting the caller split into sub-queries (e.g. two 183-day halves) and merge client-side. No API call is made.

#### Proposed fix

**File:** `src/reporting-knowledge.ts` (new exports)

```ts
export const MAX_PERIOD_DAYS = 366;

export function periodLengthDays(startDate: string, endDate: string): number {
  // Assumes YYYY-MM-DD; caller already validates format via regex.
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1; // inclusive
}
```

**File:** `src/tools/smart-stats.ts` (new block after the required-filter check, before dimension resolution)

```ts
const periodDays = periodLengthDays(args.start_date, args.end_date);
if (periodDays > MAX_PERIOD_DAYS) {
  return {
    content: [{
      type: "text" as const,
      text: JSON.stringify({
        error: `Requested date range is ${periodDays} days; the Gorgias reporting API limit is ${MAX_PERIOD_DAYS} days.`,
        scope,
        requestedDays: periodDays,
        maxDays: MAX_PERIOD_DAYS,
        _hint: `Split the query into sub-ranges of ${MAX_PERIOD_DAYS} days or fewer and merge results client-side.`,
      }, null, 2),
    }],
    isError: true,
  };
}
```

#### Acceptance criteria

1. A request with `start_date` and `end_date` exactly 366 days apart (inclusive) is accepted.
2. A request with 367+ days is rejected **without** an HTTP call to the Gorgias API (verified via stub client call counter: zero calls).
3. The error payload includes the computed `requestedDays`, the `maxDays` constant, and a user-facing split-query hint.
4. `MAX_PERIOD_DAYS` and `periodLengthDays` are exported from `src/reporting-knowledge.ts` and reusable by other tools (e.g. `retrieve_reporting_statistic`).
5. `periodLengthDays` treats dates inclusively (e.g. `2024-01-01` to `2024-01-01` → 1 day).

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | periodLengthDays inclusive boundary | unit | Same-date → 1; one-day gap → 2 |
| 2 | periodLengthDays leap-year handling | unit | 2024 (leap) full year = 366 |
| 3 | smart_stats accepts 366 day span | unit | Stub client, verify call is made |
| 4 | smart_stats rejects 367 day span | unit | Stub client, verify call count is 0, error payload shape |
| 5 | smart_stats error payload hint mentions split | unit | Regex the `_hint` field |
| 6 | MAX_PERIOD_DAYS exported constant | unit | Import check |

Target number of new tests: 6

#### Edge cases to handle

- Non-UTC dates are out of scope — the tool's regex already enforces `YYYY-MM-DD`.
- Reversed range (`end_date < start_date`) produces a negative or zero span; the guard should still reject this cleanly (negative days → covered by a separate reversed-range check, or this check short-circuits with a descriptive error).
- Leap-year boundary: 2024-01-01 to 2024-12-31 inclusive = 366 days, accepted.
- Exactly 367 days must be rejected.

#### Backward compatibility

Fully backward compatible for any caller under 367 days. Callers currently sending 400+ day ranges will shift from a cryptic upstream 400 error to a concrete client-side error — a strict UX improvement, no contract breakage.

#### Dependencies on other requirements

- Independent of M2 (touches a different code path).
- Shares the reusable helper with any future `retrieve_reporting_statistic` work.

#### Estimated effort

- **New lines of code:** ~25
- **Modified lines of code:** ~3
- **New test cases:** 6
- **Affected existing tests:** 0
- **Risk level:** low
- **Rough time estimate:** S

---

### M10: `smart_search` client-filter silent data loss warning

**Severity:** MEDIUM
**Category:** Data integrity / UX

**See H20** in the HIGH-severity section of this document. The client-filter silent-data-loss issue in `src/tools/smart-search.ts` (every strategy that invokes `applyClientFilters`) is tracked there as a single consolidated requirement. M10 is retained as a cross-reference anchor so reviewers searching by ID can find the entry.

If H20 is not included in the final document (e.g. the other agent dropped it), M10 should be promoted back to a full standalone entry using the same template structure and the original brief: every `applyClientFilters` invocation must surface a `clientFilterDroppedCount` field (or similar) in the response so callers can detect when post-API filtering silently removed rows from a truncated page, and the tool should emit an actionable warning when that count is non-zero.

---

### M13: `buildBaseUrl` edge cases

**Severity:** MEDIUM
**Category:** Input validation

**See H18** in the HIGH-severity section. The SSRF / URL-parsing hardening for `buildBaseUrl` in `src/client.ts:7-30` is tracked there; the validation edge cases listed in the brief (empty string after trim, whitespace-only, internal spaces such as `"my company"`, trailing dots such as `"mycompany."`) are a natural subset of the SSRF requirement and should be rolled in together so the rejection rules land in a single validation block.

If H18 is not present in the final document, M13 should be promoted to a full standalone entry covering:
- Reject empty / whitespace-only `domain` with a clear error naming the `GORGIAS_DOMAIN` env var.
- Reject any `domain` containing whitespace characters (`\s`) after trimming.
- Reject trailing-dot domains (post-strip length check).
- Reject any value that fails a subsequent `new URL(...)` round-trip with a wrapped, user-readable error rather than the raw `TypeError: Invalid URL`.
- All rejections must fire before the insecure-http check already at line 11, or at the same point, so callers see consistent input-validation errors.

---

### M23: User `language` enum

**Severity:** MEDIUM
**Category:** Tool schema / API contract fidelity
**Validated by:** Skeptic-mode validator pass

#### Problem statement

The Gorgias `User` object restricts the `language` field to a two-value enum — the UI locale of the agent, not the language of tickets they handle. The documented enum is `["fr", "en"]`. The current tool schemas on both create and update accept `z.string().optional()` / `z.string().nullable().optional()`, so callers can pass any ISO 639-1 code (or any string at all), only to receive a cryptic validation error from the upstream API.

This is a surprising restriction — most helpdesks support more than two UI languages — so the doc comment and test suite should call it out explicitly. The restriction is documented but may have been widened server-side since, so a live-API smoke test is recommended before shipping to avoid flipping to an overly strict local schema if Gorgias has expanded the enum.

#### Evidence

- **File:line:** `src/tools/users.ts:54` (create) — `language: z.string().optional()`
- **File:line:** `src/tools/users.ts:77` (update) — `language: z.string().nullable().optional()`
- **Gorgias docs:** `User.language` enum `["fr", "en"]`, scoped to the agent UI locale.

#### Desired behaviour

Both create and update tool schemas constrain `language` to `z.enum(["fr", "en"])` (with `.nullable().optional()` on update to preserve the `null` clear semantics). The `.describe(...)` text states explicitly that this is the UI locale of the agent, that the Gorgias API only accepts `"fr"` or `"en"`, and that this differs from the ticket-content language.

#### Proposed fix

**File:** `src/tools/users.ts`

```ts
// Line 54 — create
language: z.enum(["fr", "en"]).optional()
  .describe("UI locale for the user's Gorgias interface. Gorgias restricts this field to 'fr' or 'en' (agent UI language, not ticket content language)."),

// Line 77 — update
language: z.enum(["fr", "en"]).nullable().optional()
  .describe("UI locale for the user. 'fr' or 'en' only. Pass null to clear."),
```

#### Acceptance criteria

1. `gorgias_create_user` rejects `language: "de"` (or any non-enum value) with a Zod validation error before the HTTP call.
2. `gorgias_create_user` accepts `language: "fr"` and `language: "en"`.
3. `gorgias_update_user` additionally accepts `language: null` (clear).
4. The `.describe` text explicitly flags the restriction as surprising and distinguishes UI locale from ticket-content language.
5. A pre-ship manual test ticket in the repo notes (or a commit message) records the live-API check of whether Gorgias still rejects non-enum values as of the PR date.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | create_user accepts fr | unit | Stub client, verify call succeeds with `"fr"` |
| 2 | create_user accepts en | unit | Stub client, verify call succeeds with `"en"` |
| 3 | create_user rejects de | unit | Zod validation error |
| 4 | update_user accepts null language | unit | Stub client, verify body includes `language: null` |
| 5 | update_user rejects arbitrary string | unit | Zod validation error |

Target number of new tests: 5

#### Edge cases to handle

- `null` is valid on update (clear the field) but invalid on create (field is optional, not nullable).
- Case sensitivity: the enum is lowercase only; `"EN"` should be rejected.
- If the live-API check reveals the enum has been widened, extend the enum rather than revert to `z.string()`.

#### Backward compatibility

Callers currently passing `"en"` or `"fr"` are unaffected. Callers passing any other value will now fail client-side with a clearer error instead of failing server-side with a less clear one — a net improvement, not a regression. Any caller relying on sending e.g. `"de"` was already broken.

#### Dependencies on other requirements

- Independent of other medium items.
- Recommended: live-API smoke test as a pre-flight gate before merging.

#### Estimated effort

- **New lines of code:** ~6
- **Modified lines of code:** ~2
- **New test cases:** 5
- **Affected existing tests:** 0
- **Risk level:** low (with the smoke-test caveat)
- **Rough time estimate:** S

---

### M26: `update_customer.timezone` nullable

**Severity:** MEDIUM
**Category:** Tool schema / API contract fidelity
**Validated by:** Skeptic-mode validator pass

#### Problem statement

The `gorgias_update_customer` tool's `timezone` field is declared as `z.string().optional()`, but the Gorgias `UpdateCustomer` schema documents `timezone` as `type: ["string", "null"]` — i.e. callers can pass `null` to clear the customer's timezone. The current schema rejects `null` with a Zod validation error before the request is sent, making it impossible to clear a previously-set timezone via this tool.

Every other clearable field on `update_customer` (`name`, `email`, `external_id`, `language`) is already declared `.nullable().optional()`; `timezone` is the outlier.

#### Evidence

- **File:line:** `src/tools/customers.ts:85`
  ```ts
  timezone: z.string().optional().describe("The customer's preferred timezone (IANA timezone name, e.g. 'America/New_York'). Default: 'UTC'."),
  ```
- **Gorgias docs:** `UpdateCustomer.timezone` — `type: ["string", "null"]`.
- **Adjacent fields in same schema block** (lines 81-84) are all `.nullable().optional()`.

#### Desired behaviour

`timezone` accepts `string | null | undefined`. Passing `null` serialises to `{"timezone": null}` in the outgoing body and clears the field upstream. The `.describe` text mentions `null` as a valid value to clear the field.

#### Proposed fix

**File:** `src/tools/customers.ts:85`

```ts
timezone: z.string().nullable().optional()
  .describe("The customer's preferred timezone (IANA timezone name, e.g. 'America/New_York'). Pass null to clear. Default on create: 'UTC'."),
```

#### Acceptance criteria

1. `gorgias_update_customer` accepts `timezone: null` and sends `{"timezone": null}` in the PUT body (verified via stub-client body capture).
2. `gorgias_update_customer` accepts `timezone: "America/New_York"` and `timezone: undefined` (omission) exactly as before.
3. The `.describe` text mentions that `null` clears the field.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | update_customer accepts null timezone | unit | Stub client captures body, asserts `timezone === null` |
| 2 | update_customer accepts string timezone | unit | Regression |
| 3 | update_customer omits timezone when undefined | unit | Body should not contain `timezone` key |

Target number of new tests: 3

#### Edge cases to handle

- `timezone: ""` (empty string) is still invalid upstream and should probably be surfaced as a Zod `.min(1)` check — out of scope for this entry but worth noting.
- `null` must survive JSON serialisation as `null`, not be stripped by the HTTP layer (verify with the existing query-param coercion rules: body serialisation does not strip nulls today, confirmed by the wire-format test suite).

#### Backward compatibility

Strict widening. No existing caller breaks. Callers who previously hit the Zod error on `null` gain a new capability.

#### Dependencies on other requirements

- None.

#### Estimated effort

- **New lines of code:** ~1
- **Modified lines of code:** ~1
- **New test cases:** 3
- **Affected existing tests:** 0
- **Risk level:** low
- **Rough time estimate:** S

---

### order_by enum corrections (tags, rules, integrations)

**Severity:** MEDIUM
**Category:** Tool schema / API contract fidelity
**Validated by:** Skeptic-mode validator pass

#### Problem statement

Three list tools currently declare `order_by` as a free-form `z.string().optional()` despite the upstream Gorgias API accepting only a specific enum of values per endpoint. Free-form strings let the LLM construct plausible-looking but invalid values (e.g. `"priority:desc"` on a tag list, `"name:asc"` on a rule list), which then fail at the upstream API with a 400 error. Constraining the enum client-side surfaces the error earlier, improves LLM tool-call accuracy, and documents the supported sort fields directly in the schema.

Additionally, `gorgias_list_integrations`'s `type` filter should be constrained to the documented enum `["http"]` — but this may already be covered by H14 in the HIGH-severity section. If H14 covers it, only the `order_by` change is in scope here.

#### Evidence

- **File:line:** `src/tools/tags.ts:15`
  ```ts
  order_by: z.string().optional().describe("Sort order, e.g. 'created_datetime:desc'"),
  ```
- **File:line:** `src/tools/rules.ts:15`
  ```ts
  order_by: z.string().optional().describe("Sort order, e.g. 'created_datetime:desc' or 'created_datetime:asc'"),
  ```
- **File:line:** `src/tools/integrations.ts:15-16`
  ```ts
  order_by: z.string().optional().describe("Field and direction to sort results by, e.g. 'created_datetime:desc'"),
  type: z.string().optional().describe("Filter integrations by type (e.g. 'http')"),
  ```

#### Desired behaviour

Each `order_by` field becomes a Zod enum constrained to the exact set of `<field>:<direction>` values the Gorgias API accepts for that endpoint:

- **tags:** `["created_datetime:asc", "created_datetime:desc", "name:asc", "name:desc", "usage:asc", "usage:desc"]`
- **rules:** `["created_datetime:asc", "created_datetime:desc"]`
- **integrations:** whatever the Gorgias docs list (at minimum `["created_datetime:asc", "created_datetime:desc"]`; verify against the latest docs before finalising)

`integrations.type` becomes `z.enum(["http"]).optional()` **only if** H14 does not already cover it.

#### Proposed fix

**File:** `src/tools/tags.ts:15`

```ts
order_by: z.enum([
  "created_datetime:asc", "created_datetime:desc",
  "name:asc", "name:desc",
  "usage:asc", "usage:desc",
]).optional().describe("Sort order. Default: created_datetime:desc."),
```

**File:** `src/tools/rules.ts:15`

```ts
order_by: z.enum([
  "created_datetime:asc",
  "created_datetime:desc",
]).optional().describe("Sort order. Default: created_datetime:desc."),
```

**File:** `src/tools/integrations.ts:15-16`

```ts
order_by: z.enum([
  "created_datetime:asc",
  "created_datetime:desc",
]).optional().describe("Sort order. Default: created_datetime:desc."),
// Only if not covered by H14:
type: z.enum(["http"]).optional().describe("Filter by integration type."),
```

#### Acceptance criteria

1. Each tool rejects an unknown `order_by` value (e.g. `"priority:desc"` on tags) with a Zod validation error before the HTTP call.
2. Each tool accepts every value in its respective enum and passes it through unchanged in the query string.
3. Default behaviour (no `order_by` supplied) is unchanged — the key is omitted from the outgoing query.
4. The `.describe` text documents the default sort.
5. If H14 is absent, `integrations.type` is also constrained to `["http"]`.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | list_tags rejects unknown order_by | unit | Zod validation on `"priority:desc"` |
| 2 | list_tags accepts name:asc | unit | Stub client captures query string |
| 3 | list_rules rejects unknown order_by | unit | Zod validation on `"name:asc"` |
| 4 | list_rules accepts created_datetime:asc | unit | Regression |
| 5 | list_integrations rejects unknown order_by | unit | Zod validation |
| 6 | list_integrations accepts created_datetime:desc | unit | Regression |
| 7 | order_by omitted when undefined | unit | Body / query should not contain the key for all three |

Target number of new tests: 7

#### Edge cases to handle

- The Gorgias API may silently ignore unknown `order_by` values in some endpoints; the client-side enum guard protects the caller regardless.
- If a future Gorgias release adds new sort fields, the enum must be expanded — flag this in the tool-update checklist.
- Case sensitivity: Gorgias requires lowercase; the enum enforces exact case.

#### Backward compatibility

Callers currently sending documented enum values are unaffected. Callers sending undocumented values (which were already failing upstream) will now fail client-side with a clearer error — strict improvement.

#### Dependencies on other requirements

- Potential overlap with **H14** on `integrations.type`. Coordinate with the HIGH-severity doc author: if H14 covers the type enum, drop it from this requirement and keep only the `order_by` changes.

#### Estimated effort

- **New lines of code:** ~18
- **Modified lines of code:** ~4
- **New test cases:** 7
- **Affected existing tests:** 0 (no existing tests for these fields)
- **Risk level:** low
- **Rough time estimate:** S

---

### Sanitiser `error.cause` walking

**Severity:** MEDIUM
**Category:** Security / error handling
**Validated by:** Skeptic-mode validator pass

#### Problem statement

`sanitiseErrorForLLM` in `src/error-sanitiser.ts` only extracts `error.message` when the input is an `Error` instance. Since ES2022, `Error` supports a `cause` property that points at an underlying error — and that underlying error's `.message` can itself contain secrets (database DSNs, file paths, IPs, API keys) that never reach the sanitiser because they live one level deeper in the chain.

This means an error chain of the form `new Error("Upstream failed", { cause: new Error("FATAL: /etc/gorgias/secrets.env: permission denied, connecting as postgres://user:p4ssw0rd@10.0.0.5:5432/db") })` has its outer message sanitised correctly (`"Upstream failed"`) but the dangerous inner message is silently discarded. Worse, some callers downstream may `JSON.stringify` the thrown error after the sanitiser runs and end up re-serialising the full chain anyway — but that is outside this requirement's scope.

Separately, `error.stack` may also contain secrets embedded in source file paths or argument dumps. Most stack-trace content is high-noise and low-signal for an LLM, so including it is likely a net loss; we recommend NOT walking the stack and documenting the choice explicitly.

#### Evidence

- **File:line:** `src/error-sanitiser.ts:95-111` — `sanitiseErrorForLLM` reads only `error.message`:
  ```ts
  if (error instanceof Error) {
    message = error.message;
  }
  ```
- **ECMAScript spec:** `Error.prototype.cause` standardised in ES2022; Node has supported it since v16.9.
- **Node-level usage:** `fetch` wrappers and `AbortError` propagation frequently set `cause` to the underlying network or DNS error, which is exactly where SSRF target IPs, plaintext credentials, and file paths tend to appear.

#### Desired behaviour

The sanitiser walks the `cause` chain up to a fixed depth cap (e.g. 5), extracting `.message` from each `Error` in the chain, concatenating them with a separator (`" | caused by: "`), and running the **combined** string through the existing redaction patterns. The depth cap prevents infinite recursion on pathological self-referential `cause` graphs. `error.stack` is deliberately excluded.

#### Proposed fix

**File:** `src/error-sanitiser.ts`

```ts
const MAX_CAUSE_DEPTH = 5;

function extractFullMessage(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current != null && depth < MAX_CAUSE_DEPTH && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else if (typeof current === "string") {
      parts.push(current);
      break;
    } else if (
      typeof current === "object" &&
      "message" in (current as object) &&
      typeof (current as { message: unknown }).message === "string"
    ) {
      parts.push((current as { message: string }).message);
      break;
    } else {
      parts.push(String(current));
      break;
    }
    depth++;
  }

  return parts.join(" | caused by: ");
}

export function sanitiseErrorForLLM(error: unknown): string {
  let message = extractFullMessage(error);
  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    message = message.replace(pattern, replacement);
  }
  message = message.replace(/\n{3,}/g, "\n\n").trim();
  return message.length === 0 ? GENERIC_MESSAGE : message;
}
```

#### Acceptance criteria

1. A two-level cause chain produces a sanitised output containing both messages joined by `" | caused by: "`, with redactions applied across the combined string.
2. A cycle (`a.cause = b; b.cause = a`) terminates cleanly without infinite recursion, via the `seen` set.
3. A chain deeper than `MAX_CAUSE_DEPTH` truncates at the cap without error.
4. Secrets in a nested cause (e.g. an IPv4 address, an email, a `sk_live_` key) are redacted in the final output.
5. `error.stack` is NOT included in the output. This is documented in a comment above the function.
6. A non-`Error` `cause` (e.g. a plain string thrown via `throw "x"`) is handled without crashing.
7. `cause: undefined` terminates the walk cleanly.

#### Test requirements

| # | Test name | Type | Description |
|---|---|---|---|
| 1 | walks single-level cause chain | unit | `new Error("a", { cause: new Error("b") })` → both appear |
| 2 | redacts secrets in nested cause | unit | Nested cause contains `sk_live_...`; output redacts it |
| 3 | redacts IPv4 in nested cause | unit | Nested cause contains `10.0.0.5`; output redacts it |
| 4 | depth cap prevents runaway | unit | 10-deep chain truncates at 5 |
| 5 | cycle detection | unit | `a.cause = b; b.cause = a` terminates |
| 6 | string cause handled | unit | `new Error("x", { cause: "raw string" })` doesn't crash |
| 7 | undefined cause terminates | unit | Top-level error with no cause behaves exactly as before (regression) |
| 8 | stack is not included | unit | Output does not contain any `at Something (file:line:col)` lines even when stack has them |
| 9 | non-Error cause with message field | unit | Plain object with `message` property is extracted |

Target number of new tests: 9

#### Edge cases to handle

- Self-referential `cause` (`err.cause = err`) — the `seen` set catches this on the first loop iteration.
- Mixed-type chain (Error → object → string) — the type checks must handle each step independently.
- `cause` is a `Proxy` — `seen.has` still works on proxy references; no extra handling needed.
- Deep chains where intermediate messages are empty strings should still join cleanly (filter empty parts before the join, or accept the resulting `" | caused by:  | caused by: "` noise — recommend filtering).

#### Backward compatibility

Callers that throw single-level errors see identical output (the cause walk short-circuits on `cause === undefined`). Callers that throw chained errors will now see richer messages — strictly more information, all passed through the same redaction pipeline. No call-site contract breakage.

One subtle change: the output for a chained error becomes longer. Any downstream consumer that depended on a maximum length or exact string match will need updating — but a grep of the codebase for consumers of `sanitiseErrorForLLM` output should confirm there are none that depend on exact length.

#### Dependencies on other requirements

- Independent of M2, M3, M23, M26, order_by enums.
- Should land in the same release as any other sanitiser work (coordinate with the CHANGELOG entry for the sanitiser section).

#### Estimated effort

- **New lines of code:** ~35
- **Modified lines of code:** ~10
- **New test cases:** 9
- **Affected existing tests:** 2 (existing sanitiser tests may need touch-ups if they assert exact message shape on single-level errors — should still pass, but verify)
- **Risk level:** low
- **Rough time estimate:** S-M
---

## Section 5 — LOW

Low-severity items that are cosmetic, defensive, or minor schema tightenings. Each is a small diff and can be batched together in a single "polish" commit. No full requirement entries — a single table is sufficient.

| # | File:line | Issue | Suggested fix | Effort |
|---|---|---|---|---|
| L1 | `src/client.ts` (`search()` method) | Silently returns `[]` for unexpected response shapes. Schema drift by Gorgias or a transient 5xx that happens to return HTML would be invisible. | Throw `GorgiasApiError` when neither the raw-array nor the `{data: [...]}` shape matches. | 5 lines + 2 tests |
| L2 | `src/tools/tickets.ts:84, 87` | `assignee_user.id` and `assignee_team.id` allow `.min(0)` on create. On create, there is nothing to unassign, so `id=0` is nonsensical — `null` already handles "don't assign". | Use `.min(1)` on create specifically. Keep `.min(0)` on update where `0`/`null` are the documented unassign sentinels. | 2 lines + 2 tests |
| L3 | `src/tools/tickets.ts:21-25` | `gorgias_list_tickets` filter parameters use `.min(1)` without `.int()`, so floats like `1.5` pass validation and are sent as query strings. | Chain `.int()` onto the existing `.min(1)` calls. | 5 lines |
| L4 | `src/error-sanitiser.ts:50` | The `^\s*at\s+.+$` stack-trace stripping is overbroad. Any line that starts with `at ` (e.g. a prose sentence beginning "At most 5 retries allowed") is wiped to `[REDACTED]`. | Tighten to `/^\s*at\s+\S+\s+\(.+?:\d+:\d+\)\s*$/gm` — require the `(file:line:col)` suffix that real stack traces always have. | 1 line + 2 tests (positive + negative) |
| L5 | All list tools (~20 sites) | `cursor: z.string().optional()` has no `.max()` bound. A confused or malicious LLM could send an arbitrarily long cursor that explodes into the URL query string. Client-library concern only; Gorgias enforces body/URL size server-side. | Define `cursorSchema = z.string().max(512)` in a shared helper and replace across all list tools. Cosmetic hardening. | ~20 lines mechanical |
| L6 | `src/tools/tags.ts:61` | `gorgias_update_tag.description` is `z.string().max(1024).nullable().optional()`. Gorgias docs describe `description` on the update body as a plain `string` (not explicitly nullable). Low confidence — readme.io docs often omit the null marker, so this could be a docs gap rather than a real mismatch. | Either drop `.nullable()` and accept the small regression risk, OR leave as-is and add a comment. Low priority. | 1 line or comment |
| L7 | `src/tools/macros.ts:15-22` (`gorgias_list_macros.order_by` enum) | The current enum lists directional forms (`name:asc`, etc.) but not the deprecated bare forms (`name`, `created_datetime`, `usage`, `relevance`, `language`) that the Gorgias API still accepts. Low impact — bare forms are discouraged anyway. | Either add the bare values to the enum for compatibility, or add a docstring note pointing users at the directional forms. | 6 lines |
| L8 | `src/tools/integrations.ts:50-51` (`http.headers`, `http.form`) | Both are `Record<string, string>` / `Record<string, string>` on create and update. Docs mark `http.form` as nullable (can be `null`). `http.headers` nullability is uncertain. | Apply `.nullable().optional()` to `http.form` at minimum — covered in H14; this row only exists to note the `headers` nullability as a lower-priority unknown. | Covered by H14 |

**Total estimated effort for Section 5:** ~40 lines of production code + ~15 small test cases. Can be landed as a single commit titled "Low-priority polish: search throws, ID bounds, regex tightening, cursor caps".

---

## Section 6 — DEFERRED (require live-tenant verification)

The five items below were independently validated as TRUE by the skeptic-mode pass — i.e. the source of the bug is real and the proposed direction is correct — but each one needs a single live API probe against a real Gorgias tenant before it can be safely shipped. The Gorgias documentation portal is a JavaScript-rendered SPA, and the rendered surface for these specific endpoints either omits the field, returns conflicting forms across pages, or has no public schema entry at all. In each case, the *current* implementation is wrong; the question deferred is *which* of two plausible-correct fixes to apply.

These items are NOT marked LOW. They sit at HIGH/CRITICAL severity but are gated on a 5-minute API probe per item. They should be batched into one "live-tenant verification" branch by whoever has tenant access, the probes run, and then the fixes shipped under whatever severity label the probe outcomes confirm.

### Probe protocol

Each item below states the **single probe call** required to disambiguate. The standard procedure for every item is:

1. Use a sandbox or staging Gorgias tenant — never a production tenant. If only a production tenant is available, scope the probe to read-only endpoints first.
2. Make the documented call directly via `curl` or Postman against the live API (bypass the MCP server).
3. Capture the full request + full response body in a sealed gist (private; NOT this public repo).
4. Compare the live response shape against the two candidate schemas described in each item. The one that matches is the fix.
5. Apply the fix in a small commit that cites the probe gist URL (not the contents) for traceability.
6. Add a wire-format test that pins the new shape so any future doc-vs-implementation drift is caught.

---

### C4/C5: `update_ticket_field` / `update_customer_field_value` body format

**Severity (provisional):** CRITICAL — silent write failure or 400 errors on every update call
**Files:** `src/tools/custom-fields.ts` (the `gorgias_update_ticket_field_value` and `gorgias_update_customer_field_value` handlers)
**Validated by:** Skeptic-mode validator — confirmed the *implementation does not match documentation*, but the documentation itself is internally inconsistent across the field-update pages.

#### Problem

The two custom-field-value update tools currently send the new value as `{ value: <new_value> }` in the PUT body. The Gorgias documentation has been observed in two different forms across the rendered help pages:

- **Form A:** `PUT /api/tickets/{id}/custom-fields/{custom_field_id}` with body `{ value: <new_value> }` — matches the current implementation.
- **Form B:** `PUT /api/tickets/{id}/custom-fields/{custom_field_id}` with body `{ custom_field: { value: <new_value> } }` — wraps the value in a `custom_field` object.

The skeptic validator could not determine which form is canonical because the rendered docs site shipped both shapes on different pages with no version marker. This is the kind of case where shipping the wrong shape causes a silent 400 from the API and the user sees "the field was not updated" with no clear cause — exactly the failure mode that motivated this whole follow-up document.

#### Probe

```bash
# Probe 1: ticket custom field
curl -X PUT \
  "https://<sandbox>.gorgias.com/api/tickets/<test-ticket-id>/custom-fields/<test-cf-id>" \
  -u "<email>:<api-key>" \
  -H "Content-Type: application/json" \
  -d '{"value": "probe-A"}'

# If the above returns 400 or "field unchanged", retry with the wrapped form:
curl -X PUT \
  "https://<sandbox>.gorgias.com/api/tickets/<test-ticket-id>/custom-fields/<test-cf-id>" \
  -u "<email>:<api-key>" \
  -H "Content-Type: application/json" \
  -d '{"custom_field": {"value": "probe-B"}}'

# Probe 2: customer custom field
curl -X PUT \
  "https://<sandbox>.gorgias.com/api/customers/<test-customer-id>/custom-fields/<test-cf-id>" \
  -u "<email>:<api-key>" \
  -H "Content-Type: application/json" \
  -d '{"value": "probe-A"}'
```

After each call, GET the same custom-field record and verify the value actually changed. A 200 response is necessary but not sufficient — a successful API call with no value change is the exact silent-failure mode this item is about.

#### Decision tree

- **Form A succeeds and the value changes** → no fix needed; add a wire-format test pinning the current shape and close this item.
- **Form B succeeds and the value changes** → swap the body shape in both `update_ticket_field` and `update_customer_field_value` handlers, add wire-format tests, ship.
- **Both succeed** → ship Form A (the simpler shape) and add a tolerant client that accepts either; document the alternative.
- **Both fail** → escalate. The endpoints may have been renamed or moved under `/api/tickets/{id}/custom_fields/<cf_id>` with an underscore (the validator noted this third candidate but had no evidence to support it).

#### Effort once unblocked

~10 LOC + 4 wire-format tests + 1 small commit. Trivial post-probe.

---

### C12: User `role.name` full enum

**Severity (provisional):** HIGH — schema rejects valid input from real Gorgias accounts
**File:** `src/tools/users.ts` (the `gorgias_create_user.role.name` and `gorgias_update_user.role.name` enum)
**Validated by:** Skeptic-mode validator — confirmed the current enum is incomplete; could not confirm the canonical complete list.

#### Problem

The current `role.name` Zod enum on `gorgias_create_user` and `gorgias_update_user` lists three values: `"admin" | "agent" | "lite-agent"`. The first-pass audit and the skeptic validator both identified additional roles that the live API accepts but the schema rejects:

- `"superuser"` — Gorgias staff/owner role
- `"observer"` — read-only role for stakeholders (mentioned in newer Gorgias plans)
- `"developer"` — API/integration role (mentioned in some docs pages)

These roles cannot be assigned via the MCP server today — Zod rejects them at the input boundary before the call leaves the client. The skeptic validator was able to confirm `"superuser"` is real but could not pin down whether `"observer"` and `"developer"` are real, plan-gated, or doc artifacts.

#### Probe

The cleanest probe is a list call against the user-roles meta endpoint, if it exists:

```bash
# Probe 1: explicit roles enumeration (if endpoint exists)
curl -u "<email>:<api-key>" \
  "https://<sandbox>.gorgias.com/api/users/roles"

# If that 404s, fall back to listing existing users and inspecting their role.name values:
curl -u "<email>:<api-key>" \
  "https://<sandbox>.gorgias.com/api/users?limit=100" \
  | jq -r '.data[].role.name' | sort -u
```

The set of distinct `role.name` values across the user list is the floor — the live enum has at least these values. A second probe creates a user with each candidate role and observes the response:

```bash
for role in admin agent lite-agent superuser observer developer; do
  curl -X POST \
    "https://<sandbox>.gorgias.com/api/users" \
    -u "<email>:<api-key>" \
    -H "Content-Type: application/json" \
    -d "{\"name\":\"probe-$role\",\"email\":\"probe-$role@example.invalid\",\"role\":{\"name\":\"$role\"}}"
done
```

Roles that return 201 are real. Roles that return 400 with "invalid role" are not.

#### Decision tree

- Add every confirmed role to the enum on both create and update.
- Plan-gated roles (returns 403 "not available on your plan") should still be in the enum — Zod is a schema check, not a billing check, and the API is the right place for the plan error.
- Add a comment next to the enum naming the probe gist for future maintainers.

#### Effort once unblocked

2 LOC + 1 enum widen test + 1 small commit. Trivial post-probe.

---

### C15: `statistics.ts` legacy endpoint — rewrite or remove

**Severity (provisional):** HIGH — entire tool may be calling a deprecated endpoint
**File:** `src/tools/statistics.ts` (the `gorgias_retrieve_statistic` and `gorgias_list_statistics` handlers)
**Validated by:** Skeptic-mode validator — confirmed the file targets an endpoint not present in the current rendered Gorgias documentation. Could not determine whether the endpoint is silently deprecated, was renamed to `/api/reporting/stats`, or is still supported under a non-public path.

#### Problem

`src/tools/statistics.ts` registers two tools that target `/api/statistics` and `/api/statistics/{id}`. The current Gorgias documentation portal does not list these endpoints — the only reporting endpoints documented are `/api/reporting/stats` (the modern POST-with-query endpoint that `smart_stats` and `gorgias_retrieve_reporting_statistic` already cover) and `/api/reporting/views`.

Three possibilities:

1. `/api/statistics` is a deprecated endpoint that still works but is undocumented and at risk of silent removal. Tool should be marked deprecated and eventually removed.
2. `/api/statistics` was renamed to `/api/reporting/stats` and the tool is sending requests to a 404 path. Every call fails. Tool should be removed and callers redirected to `gorgias_retrieve_reporting_statistic`.
3. `/api/statistics` is an internal-only Gorgias endpoint that some accounts can hit. Tool should be removed because this MCP server is not the right place to expose internal-only API surfaces.

The skeptic validator could not eliminate any of the three without a live probe.

#### Probe

```bash
# Probe 1: list call
curl -u "<email>:<api-key>" \
  "https://<sandbox>.gorgias.com/api/statistics"

# Probe 2: retrieve a known stat ID (use one from the list response if probe 1 succeeded)
curl -u "<email>:<api-key>" \
  "https://<sandbox>.gorgias.com/api/statistics/1"
```

#### Decision tree

- **404 on both** → remove `src/tools/statistics.ts` entirely, drop the two tools from the count, update the tool count in the README (currently 113 — would become 111), add a CHANGELOG note pointing callers at `gorgias_retrieve_reporting_statistic`. **Recommended** outcome — even if the endpoint exists, removing duplicates of `/api/reporting/stats` keeps the tool surface clean.
- **200 on both** → leave the file in place but add a `Deprecated:` prefix to both tool descriptions and a CHANGELOG entry recommending the reporting tools.
- **200 with empty body or non-standard shape** → indicates the endpoint is half-broken; remove.

#### Effort once unblocked

- **Remove path:** delete `src/tools/statistics.ts`, remove its registration from `src/server.ts`, decrement the tool count in `README.md` and `CHANGELOG.md`. ~30 LOC removed, 1 commit, 0 new tests.
- **Deprecate path:** ~10 LOC of description prefix changes, 1 commit, 0 new tests.

---

### H21: `ticket-sla` reporting-scope filter member

**Severity (provisional):** HIGH — incorrect filter member name causes 400 errors on every ticket-SLA query
**File:** `src/reporting-scopes.ts` (or wherever the per-scope filter member allowlist lives — see `src/tools/smart-stats.ts` for the lookup)
**Validated by:** Skeptic-mode validator — confirmed the current filter member list for `ticket-sla` includes a name (`sla_id`) that is not present in the rendered Gorgias docs for that scope. Could not confirm the canonical name (`ticket_sla_id` was the validator's best guess; `slaId` is also possible).

#### Problem

`smart_stats` validates filter members against a per-scope allowlist before sending the query upstream. The `ticket-sla` reporting scope is one of the more recently-added scopes in Gorgias, and the validator confirmed that the current allowlist for this scope includes at least one filter name that is not in the documented schema. The most likely culprit is `sla_id`, which the validator believes should be `ticket_sla_id`, but a third candidate (`slaId` — camelCase) appeared in one of the rendered docs pages.

The user-visible symptom: any `smart_stats` call against `scope: "ticket-sla"` with a filter on the SLA ID returns a 400 from upstream with a generic "invalid filter member" message that the LLM cannot easily debug.

#### Probe

```bash
# Probe 1: introspect the live scope schema (if Gorgias exposes one)
curl -u "<email>:<api-key>" \
  "https://<sandbox>.gorgias.com/api/reporting/scopes/ticket-sla"

# Probe 2: try a minimal smart_stats query with each candidate filter name
for name in sla_id ticket_sla_id slaId; do
  curl -X POST -u "<email>:<api-key>" \
    "https://<sandbox>.gorgias.com/api/reporting/stats" \
    -H "Content-Type: application/json" \
    -d "{
      \"query\": {
        \"scope\": \"ticket-sla\",
        \"filters\": [{\"member\": \"$name\", \"operator\": \"equals\", \"values\": [1]}],
        \"measures\": [\"count\"],
        \"dimensions\": [],
        \"granularity\": \"none\"
      }
    }"
done
```

The candidate that returns 200 (or returns a "no rows" 200 rather than a 400) is the correct member name.

#### Decision tree

- **`ticket_sla_id` succeeds** → update the allowlist, add a wire-format test that asserts the corrected name is allowed and the old name is rejected.
- **`slaId` succeeds** → ditto with the camelCase form (and double-check whether this is the only camelCase member in the entire scope allowlist — if so, file an upstream-docs bug).
- **None succeed** → broaden the probe to inspect all member names returned by the `/api/reporting/scopes/ticket-sla` endpoint and rebuild the allowlist from the live response.

#### Effort once unblocked

~3 LOC of allowlist edit + 2 tests (positive + negative) + 1 commit.

---

### M5: `tags` reporting scope time dimension and default measure

**Severity (provisional):** MEDIUM — incorrect default measure and time-dimension behaviour produces empty or nonsensical results for `scope: "tags"`
**File:** `src/reporting-scopes.ts` (tag-scope entry) and `src/tools/smart-stats.ts` (the default-measure resolution logic)
**Validated by:** Skeptic-mode validator — confirmed the default measure for the `tags` scope in the current implementation is wrong (`tag_count`), but could not confirm the canonical default name from rendered docs.

#### Problem

The `tags` reporting scope has two related issues:

1. **Default measure.** When a caller passes `scope: "tags"` with no explicit `measures`, the smart-stats helper auto-fills a default. The current default is `tag_count` (or possibly `count`, depending on the resolution path), which the skeptic validator confirmed produces zero rows on a real query — i.e. it is not a recognised measure for the `tags` scope. The canonical default appears to be `tag_usage` based on a single rendered docs page, but the validator could not corroborate this against a second source.
2. **Time dimension.** The `tags` scope does not appear to support a `granularity` other than `none` — it is a static enumeration of tags and their usage counts, not a time-series. The current schema accepts arbitrary granularities for this scope, and the API silently returns empty time buckets when an unsupported granularity is requested.

#### Probe

```bash
# Probe 1: minimal call with no measures, no dimensions, granularity "none"
curl -X POST -u "<email>:<api-key>" \
  "https://<sandbox>.gorgias.com/api/reporting/stats" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "scope": "tags",
      "filters": [],
      "dimensions": [],
      "granularity": "none"
    }
  }'

# Probe 2: explicit candidate measures
for measure in count tag_count tag_usage tag_uses usage; do
  curl -X POST -u "<email>:<api-key>" \
    "https://<sandbox>.gorgias.com/api/reporting/stats" \
    -H "Content-Type: application/json" \
    -d "{
      \"query\": {
        \"scope\": \"tags\",
        \"filters\": [],
        \"measures\": [\"$measure\"],
        \"dimensions\": [\"tag_name\"],
        \"granularity\": \"none\"
      }
    }"
done

# Probe 3: time granularity behaviour
curl -X POST -u "<email>:<api-key>" \
  "https://<sandbox>.gorgias.com/api/reporting/stats" \
  -H "Content-Type: application/json" \
  -d '{
    "query": {
      "scope": "tags",
      "filters": [],
      "measures": ["tag_usage"],
      "dimensions": [],
      "granularity": "day"
    }
  }'
```

#### Decision tree

- **Probe 1 returns rows with a default measure name in the response columns** → adopt that name as the default in `smart-stats.ts`.
- **Probe 2 confirms a specific measure name** → adopt that name as the default and add it to the allowed-measures list for the `tags` scope.
- **Probe 3 returns 200 with sensible day buckets** → time dimension is supported, leave the schema permissive.
- **Probe 3 returns 200 with empty buckets or 400** → tighten the `tags` scope schema to accept only `granularity: "none"`, with an explicit error message naming the constraint.

#### Effort once unblocked

~5 LOC of scope-config edits + 1 default-measure resolution fix + 3 tests (default measure, valid granularity, rejected granularity) + 1 commit.

---

### Summary table

| ID | File | Probe count | Severity once shipped | Effort post-probe |
|---|---|---|---|---|
| C4/C5 | `src/tools/custom-fields.ts` | 2 PUT calls | CRITICAL | ~10 LOC + 4 tests |
| C12 | `src/tools/users.ts` | 1 list + N create probes | HIGH | 2 LOC + 1 test |
| C15 | `src/tools/statistics.ts` | 2 GET calls | HIGH (remove or deprecate) | 30 LOC removed OR 10 LOC modified |
| H21 | `src/reporting-scopes.ts` | 1 introspect + 3 query probes | HIGH | 3 LOC + 2 tests |
| M5 | `src/reporting-scopes.ts` + `src/tools/smart-stats.ts` | 3 query probes | MEDIUM | 5 LOC + 3 tests |
| **Totals** | — | ~11 probe calls | — | ~50 LOC + 13 tests |

All five items can be probed in a single 30-minute live-tenant session and shipped as one consolidated "deferred items resolved" PR.

---

## Section 7 — Proposed implementation sequencing

This section is the implementation playbook. The 24 non-deferred items are grouped into seven natural batches, each landing as a single commit on the working branch (`claude/follow-up-requirements-doc` or whichever branch picks up the work). Batches are ordered to minimise conflicts, front-load the highest-impact fixes, and let later batches build on the helpers introduced earlier.

### Sequencing principles

1. **Critical bugs first.** Both CRITICAL items are silent data loss in user-visible smart tools. Land them in the first two batches so the maintainer's release notes can lead with them.
2. **Helpers before consumers.** H19 introduces a shared `idSchema` helper, M3 introduces a shared period-validation helper, and L5 introduces a shared `cursorSchema`. These ship before the consumer batches that depend on them.
3. **Schema-only batches are independent.** H14 (integration update), H16 (survey update), the widget literal, M23 (language enum), and M26 (timezone nullable) are independent schema diffs. They can ship in any order; they're grouped here for review-cohesion, not technical dependency.
4. **One commit, one theme.** Reviewers should be able to read a single commit message and understand the entire change. No "fix N unrelated bugs" mega-commits.
5. **Tests in the same commit as the fix.** Every batch ships its tests in the same commit that introduces the fix — no "tests in a follow-up" deferrals.
6. **Lint + typecheck + full test suite must pass at every commit boundary.** No commits that knowingly break `npm run test` or `npm run lint`. CI green is the merge gate.

### Batch table

| Batch | Theme | Items | LOC (prod / test) | Risk | Time | Depends on |
|---|---|---|---|---|---|---|
| **B1** | `smart_stats` pagination + aggregate mode | C1, M2, M3 | ~120 / ~400 | M | M | — |
| **B2** | `smart_get_ticket` pagination | C3 | ~80 / ~250 | M | M | — |
| **B3** | Shared schema helpers | H19 (`idSchema`), L5 (`cursorSchema`), L3 (`.int()` on filters) | ~80 / ~80 | L | S | — |
| **B4** | Security hardening | H18 (SSRF allowlist), M13 (buildBaseUrl edge cases), L4 (sanitiser regex), sanitiser `error.cause` walking | ~60 / ~150 | M | S | — |
| **B5** | Schema correctness — write paths | H14 (integration update), H16 (survey update required), widget `template.type` literal, M26 (timezone nullable), L2 (assignee min on create), L6 (tag description nullable) | ~50 / ~100 | L | S | B3 (helpers) |
| **B6** | Schema correctness — read/list paths | H20 (smart_search ordering + view filter), M10 (client-filter warning, covered by H20), M23 (user language enum), order_by enum corrections (tags/rules/integrations), L7 (macros order_by) | ~70 / ~120 | L | S | B3 (helpers) |
| **B7** | Polish | L1 (search() shape error), L8 (integration headers nullability note) | ~10 / ~20 | L | XS | — |

**Totals across all 7 batches:** ~470 production LOC, ~1120 test LOC, 24 items, ~7 commits.

### Why these specific batches

#### B1 — `smart_stats` pagination + aggregate mode

The C1 fix, the M2 `granularity: "none"` aggregate mode, and the M3 366-day pre-flight check all touch `src/tools/smart-stats.ts` and they reinforce each other. C1 introduces auto-pagination; M2 gives users a way to *avoid* hitting the pagination limit by collapsing the time axis; M3 prevents wasted API calls on malformed queries. Landing all three in one commit means the tool's input schema, error paths, and `_hint` text are coherent — instead of three commits each adjusting the same hint string in a different way.

The single risk in this batch is the interaction between the pagination loop and PR #2's null-row preservation logic (C2). The fix order matters: pagination loop runs first, accumulates raw rows, then the null filter runs against the full accumulated set. The C1 entry's "Edge cases" section spells this out; the test matrix in C1 has a dedicated case for it.

#### B2 — `smart_get_ticket` pagination

C3 stands alone — it touches `src/tools/smart-ticket-detail.ts` and exports a new helper from `src/cache.ts`. There is no schema correctness or security overlap, so it's its own commit. The risk is the cache helper refactor (currently `fetchAllPages` is module-private; this batch makes it public and adds a `maxItems` option). The compatibility shim (`fetchAllPagesFlat`) keeps the existing internal callers stable.

B1 and B2 are independent and can be landed in parallel by two reviewers if the project has the bandwidth.

#### B3 — Shared schema helpers

This batch is the load-bearing pre-requisite for B5 and B6. H19 introduces `idSchema = z.coerce.number().int().min(1)` and `idOrZeroSchema` (for the documented unassign sentinels), L5 introduces `cursorSchema = z.string().max(512)`, and L3 chains `.int()` onto the existing `.min(1)` calls on `gorgias_list_tickets` filters. All three are mechanical edits that establish the shared `src/tools/_id.ts` (or `_schemas.ts`) module that subsequent batches import from.

Landing this first means B5 and B6 don't have to introduce the helper *and* use it in the same commit, which keeps each subsequent diff small and review-able.

The test coverage for B3 itself is small (the helpers are tiny), but the consumer test surface is large — every existing test that hits a numeric ID tool path implicitly exercises the new coercion. The B3 commit needs a dedicated unit test for `idSchema` (positive: `"123"`, negative: `"abc"`, edge: `"0"`, edge: `"123.45"`) and one for `cursorSchema` (positive: short string, negative: 600-char string).

#### B4 — Security hardening

The SSRF allowlist (H18) is the highest-priority security item in the document. It blocks the easiest abuse vector: a confused or malicious LLM coercing the MCP server into making outbound requests to `localhost`, `169.254.169.254` (cloud metadata), or arbitrary attacker-controlled hostnames. M13 (`buildBaseUrl` edge cases) lives in the same file and the same logical scope, so they ship together.

L4 (the `at-line` regex tightening) and the sanitiser `error.cause` walking are both in `src/error-sanitiser.ts` and both affect the redaction surface. Grouping all four into one batch keeps the security review concentrated in one commit.

The batch's risk is medium because the SSRF allowlist is a behaviour change that *could* break a self-hosted Gorgias deployment running on a non-`.gorgias.com` hostname. The H18 entry in Section 2 spells out the env-var escape hatch for this case.

#### B5 — Schema correctness, write paths

Five independent schema diffs on five different write tools. These ship together because they're all "the validator caught a real bug in a write-path schema" and they all want the same kind of testing (wire-format positive case + wire-format negative case + Zod boundary test). Grouping them lets the reviewer process the same review pattern five times in a row, which is faster than five disjoint reviews on separate commits.

B5 depends on B3 only because two of the items use the new `idSchema` helper. If B3 hasn't landed, B5's items can still ship using inline `z.coerce.number().int().min(1)` — but the helper is cleaner.

#### B6 — Schema correctness, read/list paths

Same pattern as B5 but for read/list endpoints. H20 is the largest item in this batch — it adds `search_type: "view"` to the smart-search strategy ordering and surfaces the client-filter silent-data-loss warning that M10 also calls out (the two items are deduped here because they describe the same fix from two angles). The order_by enum corrections (tags, rules, integrations) and the macros order_by enum widening are all small mechanical changes batched together.

#### B7 — Polish

The final two truly cosmetic items: L1 (`search()` should throw on unexpected shapes instead of silently returning `[]`) and L8 (a comment-only note about the `integration.http.headers` nullability uncertainty). One commit, ~10 LOC, ~20 LOC of tests. This commit is the natural "cleanup" landing before the branch is merged.

### Pre-flight checklist for each batch

Before opening a PR for any batch above, the implementer must confirm:

- [ ] `npm run build` succeeds with no TypeScript errors
- [ ] `npm run lint` succeeds with no warnings
- [ ] `npm run test` passes — full unit suite green
- [ ] Every new test added in this batch references the requirement ID (C1, H18, etc.) in its `it("...")` description so future maintainers can trace back to this document
- [ ] The CHANGELOG.md `Unreleased` section has a new entry for this batch with the requirement ID(s) and a one-line user-facing summary
- [ ] The commit message subject line names the batch (e.g. `B1: smart_stats pagination + aggregate mode (C1, M2, M3)`)
- [ ] No commit body mentions internal staff names, customer identifiers, or real API keys (this is a public repo)
- [ ] No new file introduces a sample value that triggers GitHub secret scanning push protection (use `DOCSEXAMPLE`-style low-entropy fixtures — see PR #2's sanitiser test fixtures for the established pattern)

### Sequencing for the deferred section

The five items in Section 6 (DEFERRED) are NOT in the seven-batch sequencing above. They share a single batch:

| Batch | Theme | Items | Prerequisite |
|---|---|---|---|
| **B-Deferred** | Live-tenant verification | C4/C5, C12, C15, H21, M5 | A 30-minute probe session against a sandbox Gorgias tenant, recorded in a private gist, before any code change. |

B-Deferred should land last (or in parallel with B7), after all the no-probe-required batches are merged. The ordering inside B-Deferred follows the probe outcomes — items that come back as "current implementation is correct" close immediately with just a wire-format test; items that come back as "swap to candidate B" ship the swap.

### Total work envelope

| Metric | Value |
|---|---|
| Items in this document | 29 (24 ships-now + 5 deferred) |
| Items shipping in batches B1–B7 | 24 |
| Items in B-Deferred | 5 |
| Production LOC across B1–B7 | ~470 |
| Test LOC across B1–B7 | ~1120 |
| Commits across B1–B7 | 7 |
| Estimated batches that can be parallelised | B1 ⫽ B2 ⫽ B4 (independent), B3 → (B5 ⫽ B6), B7 last |
| Files touched (rough) | ~25 |

### Closing note

Every requirement entry in this document ends with an explicit acceptance criteria list and a test-case table. **Do not mark a batch complete without satisfying every acceptance criterion in every item it contains.** If a probe (Deferred section) or a live test reveals that one of the proposed fixes is wrong, that's a signal to pause and revisit the requirement, not to ship a half-fix. The validator pass that produced this document has a 15% false-positive rate; if a fix turns out to be incorrect during implementation, that's expected — record the discovery in the commit message and ship the corrected version.

The goal of this document is not to enumerate every possible improvement to the codebase. It is to specify, with enough rigor that an implementer can pick it up cold and ship the work, the exact set of validated bugs that PR #2 ran out of rounds to fix. A future audit can produce a future document.
