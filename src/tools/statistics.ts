import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

const STATISTIC_SCOPES = [
  "tickets-closed",
  "tickets-created",
  "tickets-open",
  "tickets-replied",
  "one-touch-tickets",
  "zero-touch-tickets",
  "satisfaction-surveys",
  "resolution-time",
  "messages-sent",
  "first-response-time",
  "human-first-response-time",
  "response-time",
  "messages-per-ticket",
  "ticket-handle-time",
  "online-time",
  "tags",
  "auto-qa",
  "messages-received",
  "automation-rate",
  "workload-tickets",
  "automated-interactions",
  "ticket-fields",
  "voice-calls",
  "voice-agent-events",
  "ticket-sla",
  "knowledge-insights",
  "voice-calls-summary",
] as const;

const filterObjectSchema = z.object({
  member: z.string().describe("The field/dimension to filter on (scope-specific)."),
  operator: z.enum([
    "one-of",
    "not-one-of",
    "all-of",
    "afterDate",
    "beforeDate",
    "set",
    "inDateRange",
    "contains",
  ]).describe("The filter operator."),
  values: z.array(z.union([z.string(), z.number()])).describe("Array of values to apply with the operator."),
}).describe("A filter object specifying a member, operator, and values.");

const timeDimensionSchema = z.object({
  dimension: z.enum([
    "closedDatetime",
    "createdDatetime",
    "sentDatetime",
    "updatedDatetime",
    "firstAgentMessageDatetime",
    "timestamp",
    "anchorDatetime",
  ]).describe("The time field to group by."),
  granularity: z.enum(["day", "week", "month", "hour"]).describe("Time grouping granularity."),
}).describe("A time dimension object for time-based grouping.");

export function registerStatisticsTools(server: McpServer, client: GorgiasClient) {

  // --- Retrieve a Statistic ---
  server.registerTool("gorgias_retrieve_statistic", {
    title: "Retrieve Statistic",
    description: "POST /api/stats/{name} — Low-level statistics API. For easier stats with automatic defaults and validation, use gorgias_smart_stats instead. Retrieve analytics/statistics data from Gorgias. The name path parameter and scope body field must match and be one of the available scopes: tickets-closed, tickets-created, tickets-open, tickets-replied, one-touch-tickets, zero-touch-tickets, satisfaction-surveys, resolution-time, messages-sent, first-response-time, human-first-response-time, response-time, messages-per-ticket, ticket-handle-time, online-time, tags, auto-qa, messages-received, automation-rate, workload-tickets, automated-interactions, ticket-fields, voice-calls, voice-agent-events, ticket-sla, knowledge-insights, voice-calls-summary. Returns a list of result objects with dimensions and measures as keys.",
    inputSchema: {
      name: z.enum(STATISTIC_SCOPES).describe("The statistic name/scope to retrieve."),
      filters: z.array(filterObjectSchema).optional().describe("Array of filter objects to narrow the data. Each filter requires member, operator, and values."),
      timezone: z.string().optional().describe("Timezone (default: 'UTC')."),
      dimensions: z.array(z.string()).optional().describe("Array of dimension names to group the data by (scope-specific)."),
      measures: z.array(z.string()).optional().describe("Array of measure names (metrics) to include in the results (scope-specific)."),
      time_dimensions: z.array(timeDimensionSchema).optional().describe("Array of time dimension objects for time-based grouping. Each requires a dimension and granularity."),
      order: z.array(z.tuple([z.string(), z.enum(["asc", "desc"])])).optional().describe("Array of sort specifications. Each item is a [field, direction] tuple."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ name, ...body }) => {
    const result = await client.post(`/api/stats/${name}`, { ...body, scope: name, timezone: body.timezone ?? "UTC" });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Download a Statistic ---
  server.registerTool("gorgias_download_statistic", {
    title: "Download Statistic",
    description: "POST /api/stats/{name}/download — Low-level statistics download. For easier stats with automatic defaults, validation, and post-processing, use gorgias_smart_stats instead. Download CSV-formatted statistics data from Gorgias. Mirrors the retrieve statistic endpoint in request structure but returns data in CSV format. Useful for importing into spreadsheets or data analysis tools. Available scopes: tickets-closed, tickets-created, tickets-open, tickets-replied, one-touch-tickets, zero-touch-tickets, satisfaction-surveys, resolution-time, messages-sent, first-response-time, human-first-response-time, response-time, messages-per-ticket, ticket-handle-time, online-time, tags, auto-qa, messages-received, automation-rate, workload-tickets, automated-interactions, ticket-fields, voice-calls, voice-agent-events, ticket-sla, knowledge-insights, voice-calls-summary.",
    inputSchema: {
      name: z.enum(STATISTIC_SCOPES).describe("The statistic name/scope to download."),
      filters: z.array(filterObjectSchema).optional().describe("Array of filter objects to narrow the data. Each filter requires member, operator, and values."),
      timezone: z.string().optional().describe("Timezone (default: 'UTC')."),
      dimensions: z.array(z.string()).optional().describe("Array of dimension names to group the data by (scope-specific)."),
      measures: z.array(z.string()).optional().describe("Array of measure names (metrics) to include in the results (scope-specific)."),
      time_dimensions: z.array(timeDimensionSchema).optional().describe("Array of time dimension objects for time-based grouping. Each requires a dimension and granularity."),
      order: z.array(z.tuple([z.string(), z.enum(["asc", "desc"])])).optional().describe("Array of sort specifications. Each item is a [field, direction] tuple."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ name, ...body }) => {
    const result = await client.post(`/api/stats/${name}/download`, { ...body, scope: name, timezone: body.timezone ?? "UTC" });
    const csvText = (result && typeof result === "object" && "content" in result && typeof (result as any).content === "string")
      ? (result as any).content
      : JSON.stringify(result, null, 2);
    return { content: [{ type: "text" as const, text: csvText }] };
  }));
}
