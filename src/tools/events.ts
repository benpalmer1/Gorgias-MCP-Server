import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerEventTools(server: McpServer, client: GorgiasClient) {

  // --- List Events ---
  server.registerTool("gorgias_list_events", {
    title: "List Events",
    description: "GET /api/events — List events, cursor-paginated and ordered by creation date (most recent first). Supports filtering by object, user, event type, and creation datetime range.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor. Pass the value of next_cursor from a previous response to retrieve the next page"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of events to return per page (1-100, default 30)"),
      order_by: z.enum([
        "created_datetime",
        "created_datetime:asc",
        "created_datetime:desc",
      ]).optional().describe("Sort order (default: 'created_datetime:desc')"),
      object_id: z.number().int().optional().describe("Filter events by the ID of the associated object (e.g., ticket ID, customer ID)"),
      object_type: z.enum([
        "Account", "Macro", "Tag", "Customer", "Team", "View",
        "Widget", "User", "Message", "Ticket", "TicketRule", "Integration",
        "SatisfactionSurvey",
      ]).optional().describe("Filter events by the type of the associated object"),
      user_ids: z.array(z.number().int()).optional().describe("Filter events by the IDs of the users who triggered them. The Gorgias API expects an array of integers."),
      types: z.array(z.string()).optional().describe("Filter events by event type names. The Gorgias API expects an array of strings. Common values include 'ticket-created', 'ticket-updated', 'ticket-deleted', 'ticket-message-created', 'customer-created', etc. — there are 100+ possible values; see the Gorgias Event Object documentation for the full list."),
      created_datetime: z.object({
        gt: z.string().optional().describe("Strictly after this ISO 8601 datetime."),
        gte: z.string().optional().describe("On or after this ISO 8601 datetime."),
        lt: z.string().optional().describe("Strictly before this ISO 8601 datetime."),
        lte: z.string().optional().describe("On or before this ISO 8601 datetime."),
      }).optional().describe("Filter events by creation datetime. Object of comparator -> ISO 8601 datetime, e.g. { gte: '2026-01-01T00:00:00Z', lt: '2026-02-01T00:00:00Z' }."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/events", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Event ---
  server.registerTool("gorgias_get_event", {
    title: "Get Event",
    description: "GET /api/events/{id} — Retrieve a single event by its unique ID. Events are read-only records generated automatically by the Gorgias system.",
    inputSchema: {
      id: z.number().describe("The unique ID of the event to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/events/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
