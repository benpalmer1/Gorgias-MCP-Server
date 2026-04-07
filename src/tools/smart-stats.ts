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
    description: `Retrieve Gorgias analytics with automatic defaults, validation, and post-processing. Scopes by category:

Volume: tickets-created, tickets-closed, tickets-open, tickets-replied, one-touch-tickets, zero-touch-tickets, workload-tickets
Performance: first-response-time, human-first-response-time, response-time, resolution-time, ticket-handle-time
Quality: satisfaction-surveys, auto-qa
Messages: messages-sent, messages-received, messages-per-ticket
Automation: automation-rate, automated-interactions
Breakdown: tags, ticket-fields
Voice: voice-calls, voice-agent-events, voice-calls-summary
Other: online-time, ticket-sla, knowledge-insights

Broken scopes (return API errors): automation-rate, online-time, voice-calls, voice-agent-events, voice-calls-summary.

For raw API access, use gorgias_retrieve_reporting_statistic or gorgias_retrieve_statistic.`,
    inputSchema: {
      scope: z.string().describe("The statistic scope to query (e.g., 'tickets-created', 'first-response-time'). See tool description for full list by category."),
      start_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").describe("Start date in YYYY-MM-DD format"),
      end_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Date must be in YYYY-MM-DD format").describe("End date in YYYY-MM-DD format (inclusive — automatically adjusted for Gorgias exclusive filter)"),
      timezone: z.string().optional().describe("Timezone for the query (default: 'UTC'). Examples: 'America/New_York', 'Europe/London'"),
      granularity: z.enum(["hour", "day", "week", "month"]).optional().describe("Time grouping granularity (default: 'day')"),
      dimensions: z.array(z.string()).optional().describe("Dimensions to group by. Common: 'agent' (or 'agentId'), 'channel', 'team' (or 'teamId'), 'tag' (or 'tagId'). Aliases are auto-resolved."),
      measures: z.array(z.string()).optional().describe("Specific measures to return. Defaults are auto-selected per scope if omitted."),
      filters: z.array(z.record(z.string(), z.unknown())).optional().describe("Additional filter objects [{member, operator, values}]"),
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

      // Build query
      const query = {
        scope,
        filters: allFilters,
        timezone: tz,
        dimensions: resolvedDimensions.length > 0 ? resolvedDimensions : undefined,
        measures,
        time_dimensions: [{
          dimension: timeDimField,
          granularity,
        }],
      };

      const result = await client.post("/api/reporting/stats", { query }, { limit: 100 }) as any;

      // Extract data rows
      let rows: any[] = result?.data ?? result ?? [];
      if (!Array.isArray(rows)) rows = [];

      // Filter null rows
      if (measures.length > 0) {
        rows = rows.filter((row: any) => {
          return measures.some((key: string) => row[key] !== null && row[key] !== undefined);
        });
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
          }
        }
      }

      // Derive column metadata
      const columns: Record<string, string> = {};
      if (rows.length > 0) {
        for (const key of Object.keys(rows[0])) {
          columns[key] = humaniseKey(key);
        }
      }

      // Truncation warning
      let hint = `Returned ${rows.length} row(s) for scope '${scope}' from ${args.start_date} to ${args.end_date}.`;
      if (rows.length >= 100) {
        hint += " WARNING: Results may be truncated at 100 rows. Narrow the date range or add dimensions for more precise data.";
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
