import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerEventTools(server: McpServer, client: GorgiasClient) {

  // --- List Events ---
  server.registerTool("gorgias_list_events", {
    title: "List Events",
    description: "GET /api/events — List events, paginated and ordered by creation date (most recent first). Supports filtering by object, user, and event type.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor. Pass the value of next_cursor from a previous response to retrieve the next page"),
      limit: z.number().optional().describe("Maximum number of events to return per page"),
      order_by: z.string().optional().describe("Field and direction to sort by. Acceptable values: 'created_datetime', 'created_datetime:asc', 'created_datetime:desc' (default: 'created_datetime:desc')"),
      object_id: z.number().optional().describe("Filter events by the ID of the associated object (e.g., ticket ID, customer ID)"),
      object_type: z.enum([
        "Account", "Macro", "Tag", "Customer", "Team", "View",
        "Widget", "User", "TicketMessage", "Ticket", "Rule", "Integration",
      ]).optional().describe("Filter events by the type of the associated object"),
      user_ids: z.number().optional().describe("Filter events by the ID of the user who triggered them"),
      types: z.string().optional().describe("Filter events by event type. Common values: 'ticket-created', 'ticket-updated', 'ticket-deleted', 'ticket-message-created', 'ticket-message-updated', 'customer-created', 'customer-updated', 'user-created', 'user-updated', 'tag-created', 'tag-updated', 'macro-created', 'macro-updated', 'rule-created', 'rule-updated', 'integration-created', 'integration-updated'. There are 100+ possible values; see the Gorgias Event Object documentation for the full list."),
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
