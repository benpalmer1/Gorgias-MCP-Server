import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";
import { cursorSchema } from "./_id.js";

export function registerReportingTools(server: McpServer, client: GorgiasClient) {

  // --- Retrieve Reporting Statistic ---
  server.registerTool("gorgias_retrieve_reporting_statistic", {
    title: "Retrieve Reporting Statistic",
    description: "POST /api/reporting/stats — Low-level reporting API. For easier stats with automatic scope defaults, dimension validation, agent name resolution, and date handling, use gorgias_smart_stats instead. Retrieve analytics reporting statistics data. The request body contains a query object whose structure is determined by the scope field. Supports filtering, grouping by dimensions, selecting measures, time-based analysis, and custom sorting. Available scopes (27 total): tickets-closed (closed ticket stats), tickets-created (created ticket stats), tickets-open (open ticket stats), tickets-replied (replied ticket stats), one-touch-tickets (resolved with one interaction), zero-touch-tickets (resolved without agent interaction), satisfaction-surveys (customer satisfaction survey data), resolution-time (time to resolve tickets), messages-sent (agent messages sent count), first-response-time (time to first agent response including automated), human-first-response-time (time to first human agent response), response-time (overall response time stats), messages-per-ticket (messages per ticket count), ticket-handle-time (agent time handling tickets), online-time (agent online time stats), tags (stats grouped by ticket tags), auto-qa (automated quality assurance scores), messages-received (messages received count), automation-rate (rate of automated interactions), workload-tickets (ticket workload distribution), automated-interactions (automated interaction events), ticket-fields (stats by custom ticket field values), voice-calls (individual voice call records), voice-agent-events (voice call events per agent), ticket-sla (ticket SLA compliance data), knowledge-insights (knowledge base usage insights), voice-calls-summary (aggregated voice call summary stats). Supports cursor-based pagination via query parameters.",
    inputSchema: {
      cursor: cursorSchema.optional().describe("Pagination cursor from a previous response to continue retrieving results."),
      limit: z.number().min(1).max(10000).optional().describe("Maximum number of analytics results to return (default: 30, max: 10000)."),
      query: z.object({
        scope: z.enum([
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
        ]).describe("The name of the statistic to retrieve. Determines the available dimensions, measures, filters, and time dimensions."),
        filters: z.array(z.record(z.string(), z.unknown())).describe("Array of filter objects to narrow the data. Each standard filter has member (string), operator (one-of|not-one-of|all-of|afterDate|beforeDate|set|inDateRange|contains), and values (array). Special filter members 'customFields' and 'tags' have nested values arrays with their own structure."),
        timezone: z.string().describe("Timezone to use for the query (e.g. 'UTC', 'America/New_York')."),
        dimensions: z.array(z.string()).optional().describe("List of dimensions to group the results by. Available values depend on scope (e.g. agentId, ticketId, channel, integrationId, storeId, tagId, eventType, customFieldValue, etc.)."),
        measures: z.array(z.string()).optional().describe("List of measures (metrics) to return. Available values depend on scope (e.g. ticketCount, messagesCount, averageSurveyScore, medianResolutionTime, automationRate, voiceCallsCount, etc.)."),
        time_dimensions: z.array(z.object({
          dimension: z.enum([
            "closedDatetime",
            "createdDatetime",
            "sentDatetime",
            "updatedDatetime",
            "firstAgentMessageDatetime",
            "timestamp",
            "anchorDatetime",
          ]).describe("The time dimension field to group by."),
          granularity: z.enum(["hour", "day", "week", "month"]).describe("Time window granularity."),
        })).optional().describe("Time-based dimensions for grouping data over time. Each item requires a dimension and granularity. Not all time dimensions are available for every scope."),
        order: z.array(z.tuple([z.string(), z.enum(["asc", "desc"])])).optional().describe("Sorting specification. Each element is a [field, direction] pair. Available order fields depend on scope."),
      }).describe("The statistics query object. Its structure depends on the scope value."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ cursor, limit, query }) => {
    const queryParams: Record<string, unknown> = {};
    if (cursor !== undefined) queryParams.cursor = cursor;
    if (limit !== undefined) queryParams.limit = limit;

    const result = await client.post("/api/reporting/stats", { query }, queryParams);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
