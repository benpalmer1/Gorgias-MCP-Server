import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import {
  SCOPE_TIME_DIMENSION,
  SCOPE_DEFAULT_MEASURES,
  SCOPE_VALID_DIMENSIONS,
  DIMENSION_ALIASES,
  BROKEN_SCOPES,
  SCOPE_REQUIRED_FILTERS,
  TIME_BASED_SCOPES,
  MAX_PERIOD_DAYS,
  periodLengthDays,
  kebabToCamelCase,
  humaniseKey,
  adjustEndDateForExclusive,
} from "../reporting-knowledge.js";
import { getCachedUsers } from "../cache.js";
import { sanitiseErrorForLLM } from "../error-sanitiser.js";
import { safeHandler } from "../tool-handler.js";

export function registerSmartStatsTools(server: McpServer, client: GorgiasClient): void {
  server.registerTool("gorgias_smart_stats", {
    title: "Smart Stats",
    description: `Retrieve Gorgias analytics with automatic defaults, validation, post-processing, and auto-pagination.

Scopes by category:
Volume: tickets-created, tickets-closed, tickets-open, tickets-replied, one-touch-tickets, zero-touch-tickets, workload-tickets
Performance: first-response-time, human-first-response-time, response-time, resolution-time, ticket-handle-time
Quality: satisfaction-surveys, auto-qa
Messages: messages-sent, messages-received, messages-per-ticket
Automation: automation-rate, automated-interactions
Breakdown: tags, ticket-fields
Voice: voice-calls, voice-agent-events, voice-calls-summary
Other: online-time, ticket-sla, knowledge-insights

Broken scopes (return API errors): automation-rate, online-time, voice-calls, voice-agent-events, voice-calls-summary.

Auto-pagination: fetches up to 'limit' rows (default 1000, max 10000) across multiple upstream pages. For queries producing many rows, use granularity: "none" (aggregate mode) to collapse the time axis. Date range is limited to 366 days per Gorgias API constraint. For manual page control, pass 'cursor' from a previous response's nextCursor field.

For raw API access, use gorgias_retrieve_reporting_statistic or gorgias_retrieve_statistic.`,
    inputSchema: {
      scope: z.string().describe("The statistic scope to query (e.g., 'tickets-created', 'first-response-time'). See tool description for full list by category."),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").describe("End date in YYYY-MM-DD format (inclusive — automatically adjusted for Gorgias exclusive filter)"),
      timezone: z.string().optional().describe("Timezone for the query (default: 'UTC'). Examples: 'America/New_York', 'Europe/London'"),
      granularity: z.enum(["hour", "day", "week", "month", "none"]).optional().describe(
        "Time grouping granularity (default: 'day'). Use 'none' for aggregate mode (no time bucketing) — " +
        "the primary workaround for queries that would produce too many rows when grouped by day.",
      ),
      dimensions: z.array(z.string()).optional().describe("Dimensions to group by. Common: 'agent' (or 'agentId'), 'channel', 'team' (or 'teamId'), 'tag' (or 'tagId'). Aliases are auto-resolved."),
      measures: z.array(z.string()).optional().describe("Specific measures to return. Defaults are auto-selected per scope if omitted."),
      filters: z.array(z.record(z.string(), z.unknown())).optional().describe("Additional filter objects [{member, operator, values}]"),
      limit: z.number().int().min(1).max(10000).optional().describe(
        "Maximum number of rows to return after auto-pagination (default: 1000, max: 10000). " +
        "The tool fetches upstream pages of up to 1000 rows each and accumulates results " +
        "until this limit is reached or the upstream runs out of data. For queries that " +
        "would produce far more than 1000 rows, prefer 'granularity: \"none\"' (aggregate " +
        "mode) over raising this limit.",
      ),
      cursor: z.string().optional().describe(
        "Advanced: opaque pagination cursor from a previous response's nextCursor field. " +
        "When supplied, the tool fetches a single page and returns its rows + the next cursor. " +
        "Auto-pagination is disabled in this mode — the caller drives the loop.",
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    try {
    const scope = args.scope;
    const tz = args.timezone ?? "UTC";
    const granularity = args.granularity ?? "day";

    // Check broken scope registry
    if (scope in BROKEN_SCOPES) {
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: BROKEN_SCOPES[scope],
            scope,
            _hint: `The '${scope}' scope is known to be broken in the Gorgias API. Try an alternative scope.`,
          }, null, 2),
        }],
        isError: true,
      };
    }

    // Check required filters
    if (scope in SCOPE_REQUIRED_FILTERS) {
      const req = SCOPE_REQUIRED_FILTERS[scope];
      const hasFilter = (args.filters ?? []).some(
        (f: any) => f.member === req.filterMember
      );
      if (!hasFilter) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: req.description,
              scope,
              requiredFilter: req.filterMember,
              _hint: `Add a filter with member '${req.filterMember}' to use the '${scope}' scope.`,
            }, null, 2),
          }],
          isError: true,
        };
      }
    }
      // M3: 366-day client-side validation
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

      // Resolve dimension aliases + kebab-to-camelCase normalisation
      const resolvedDimensions = (args.dimensions ?? []).map((d: string) => {
        const camel = kebabToCamelCase(d);
        if (camel in DIMENSION_ALIASES) {
          const alias = DIMENSION_ALIASES[camel];
          if (alias === null) return null; // invalid dimension
          return alias;
        }
        return camel;
      }).filter((d: string | null): d is string => d !== null);

      // Validate dimensions against valid set
      const validDims = SCOPE_VALID_DIMENSIONS[scope];
      const invalidDims: string[] = [];
      if (validDims) {
        for (const d of resolvedDimensions) {
          if (!validDims.includes(d)) invalidDims.push(d);
        }
      }
      if (invalidDims.length > 0) {
        return {
          content: [{
            type: "text" as const,
            text: JSON.stringify({
              error: `Invalid dimensions for scope '${scope}': ${invalidDims.join(", ")}`,
              validDimensions: validDims ?? [],
              _hint: `The '${scope}' scope supports these dimensions: ${(validDims ?? []).join(", ") || "none"}`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      // Default measures
      const measures = args.measures ?? SCOPE_DEFAULT_MEASURES[scope] ?? [];

      // Default time dimension
      const timeDimField = SCOPE_TIME_DIMENSION[scope] ?? "createdDatetime";

      // Adjust end date for exclusive filter
      const adjustedEndDate = adjustEndDateForExclusive(args.end_date);

      // Build date filters — the reporting API uses periodStart/periodEnd
      // as filter members, not the scope-specific time dimension names.
      const dateFilters = [
        { member: "periodStart", operator: "afterDate", values: [args.start_date] },
        { member: "periodEnd", operator: "beforeDate", values: [adjustedEndDate] },
      ];

      const allFilters = [...dateFilters, ...(args.filters ?? [])];

      // Build query — omit time_dimensions entirely when granularity is "none" (M2)
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

      // C1: Auto-pagination
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

      // rawRowCount reflects pre-trim, post-accumulation count across all pages
      const rawRowCount = rows.length;

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
                `available upstream. Either: (1) re-issue with 'cursor: "${nextCursor}"' to ` +
                `continue from where this call stopped, (2) coarsen 'granularity' (e.g. 'week' ` +
                `or 'month' instead of 'day'), (3) use 'granularity: "none"' for an aggregate ` +
                `query that collapses the time axis, or (4) shorten the date range.`,
            }, null, 2),
          }],
          isError: true,
        };
      }

      // Count (do NOT drop) rows where every requested measure is null/undefined.
      let nullMeasureRowCount = 0;
      if (measures.length > 0) {
        nullMeasureRowCount = rows.filter((row: any) =>
          measures.every((key: string) => row[key] === null || row[key] === undefined),
        ).length;
      }

      // Resolve agent IDs to names
      const hasAgentDimension = resolvedDimensions.includes("agentId");
      if (hasAgentDimension && rows.length > 0) {
        const users = await getCachedUsers(client);
        const userMap = new Map<number, string>();
        for (const u of users) {
          const user = u as any;
          if (user.id && user.name) userMap.set(user.id, String(user.name).trim());
        }
        for (const row of rows) {
          if (typeof row.agentId === "number") {
            row.agentName = userMap.get(row.agentId) ?? `Agent ${row.agentId}`;
          } else {
            row.agentName = null;
          }
        }
      }

      // Derive column metadata as the union of keys across ALL rows
      const columns: Record<string, string> = {};
      for (const row of rows) {
        for (const key of Object.keys(row)) {
          if (!(key in columns)) columns[key] = humaniseKey(key);
        }
      }

      // Build hint
      let hint = `Returned ${rows.length} row(s) for scope '${scope}' from ${args.start_date} to ${args.end_date}.`;
      if (rows.length >= requestedLimit) {
        hint += ` WARNING: Results were capped at ${requestedLimit} rows and may be truncated.` +
          ` To see more data: (1) shorten the date range; (2) coarsen the granularity;` +
          ` (3) use 'granularity: "none"' for an aggregate query; (4) REMOVE dimensions` +
          ` to reduce row cardinality; (5) raise the limit (max 10000); (6) use cursor-based` +
          ` pagination for manual page control.`;
      }
      if (nullMeasureRowCount > 0) {
        hint += ` ${nullMeasureRowCount} row(s) have all-null measure values (e.g. agents with zero activity in the period). They are preserved in the response so the LLM can decide how to present them.`;
      }
      hint += " Present data in a table format.";
      if (hasAgentDimension) {
        hint += " Agent names have been resolved from IDs.";
      }
      if (TIME_BASED_SCOPES.has(scope)) {
        hint += " Time values are in seconds.";
      }
      hint += " Bold metric names for readability.";

      const response = {
        scope,
        dateRange: { start: args.start_date, end: args.end_date },
        timezone: tz,
        granularity,
        columns,
        data: rows,
        totalRows: rows.length,
        rawRowCount,
        nullMeasureRowCount,
        pagesFetched,
        nextCursor: nextCursor ?? null,
        _hint: hint,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(response, null, 2) }],
      };

    } catch (err) {
      const safeError = sanitiseErrorForLLM(err);
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({
            error: safeError,
            scope: args.scope,
            _hint: `Stats query failed for scope '${args.scope}'. Check that the scope, date range, and dimensions are valid.`,
          }, null, 2),
        }],
        isError: true,
      };
    }
  }));
}
