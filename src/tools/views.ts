import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerViewTools(server: McpServer, client: GorgiasClient) {

  // --- List Views ---
  server.registerTool("gorgias_list_views", {
    title: "List Views",
    description: "GET /api/views — List all views with cursor-based pagination. Template variables in filters are resolved to the authenticated user's values.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor from a previous response (meta.next_cursor or meta.prev_cursor)"),
      limit: z.number().min(1).max(100).optional().describe("Maximum number of views to return per page (default: 30, max: 100)"),
      order_by: z.enum(["created_datetime:asc", "created_datetime:desc"]).optional().describe("Ordering of views in the response (default: 'created_datetime:desc')"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/views", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get View ---
  server.registerTool("gorgias_get_view", {
    title: "Get View",
    description: "GET /api/views/{id} — Retrieve a single view by its unique ID.",
    inputSchema: {
      id: z.number().describe("The unique ID of the view to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/views/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create View ---
  server.registerTool("gorgias_create_view", {
    title: "Create View",
    description: "POST /api/views — Create a new view with filters, sorting, and visibility settings.",
    inputSchema: {
      name: z.string().optional().describe("Display name of the view (default: empty string)"),
      type: z.enum(["ticket-list"]).optional().describe("Type of objects the view applies to. Only 'ticket-list' is supported (default: 'ticket-list')"),
      visibility: z.enum(["public", "shared", "private"]).optional().describe("Access level: 'public' (all users), 'shared' (specific users/teams plus admins), 'private' (single user). Default: 'public'"),
      decoration: z.object({
        emoji: z.string().nullable().optional().describe("Emoji character displayed before the view name in the UI"),
      }).optional().describe("Display configuration for the view"),
      fields: z.array(z.enum([
        "id", "details", "tags", "customer", "last_message", "name", "email",
        "created", "updated", "assignee", "assignee_team", "channel", "closed",
        "language", "last_received_message", "integrations", "snooze", "status",
        "subject", "priority",
      ])).optional().describe("Ticket attribute names to display as UI columns"),
      filters: z.string().optional().describe("JavaScript-style filter expression. Supports template variables e.g. eq(ticket.assignee_user.id, '{{current_user.id}}') && eq(ticket.status, 'open')"),
      order_by: z.string().optional().describe("Ticket attribute used to sort view items (default: 'updated_datetime')"),
      order_dir: z.enum(["asc", "desc"]).optional().describe("Sort direction for view items (default: 'desc')"),
      search: z.string().nullable().optional().describe("Free-text search query to filter matching items"),
      shared_with_teams: z.array(z.number()).max(100).optional().describe("IDs of teams to share the view with. Used when visibility is 'shared'. Max 100 items."),
      shared_with_users: z.array(z.number()).max(100).optional().describe("IDs of users to share the view with. Used when visibility is 'shared' or 'private'. Max 100 items."),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/views", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update View ---
  server.registerTool("gorgias_update_view", {
    title: "Update View",
    description: "PUT /api/views/{id} — Update an existing view by ID. Only include fields to modify.",
    inputSchema: {
      id: z.number().describe("The unique ID of the view to update"),
      name: z.string().optional().describe("Display name of the view"),
      type: z.enum(["ticket-list"]).optional().describe("Type of objects the view applies to. Only 'ticket-list' is supported."),
      visibility: z.enum(["public", "shared", "private"]).optional().describe("Access level: 'public' (all users), 'shared' (specific users/teams plus admins), 'private' (single user)"),
      decoration: z.object({
        emoji: z.string().nullable().optional().describe("Emoji character displayed before the view name in the UI"),
      }).optional().describe("Display configuration for the view"),
      fields: z.array(z.enum([
        "id", "details", "tags", "customer", "last_message", "name", "email",
        "created", "updated", "assignee", "assignee_team", "channel", "closed",
        "language", "last_received_message", "integrations", "snooze", "status",
        "subject", "priority",
      ])).optional().describe("Ticket attribute names to display as UI columns"),
      filters: z.string().optional().describe("JavaScript-style filter expression. Supports template variables e.g. eq(ticket.assignee_user.id, '{{current_user.id}}') && eq(ticket.status, 'open')"),
      order_by: z.string().optional().describe("Ticket attribute used to sort view items"),
      order_dir: z.enum(["asc", "desc"]).optional().describe("Sort direction for view items"),
      shared_with_teams: z.array(z.number()).max(100).optional().describe("IDs of teams to share the view with. Max 100 items."),
      shared_with_users: z.array(z.number()).max(100).optional().describe("IDs of users to share the view with. Max 100 items."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/views/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete View ---
  server.registerTool("gorgias_delete_view", {
    title: "Delete View",
    description: "DELETE /api/views/{id} — Permanently delete a view by ID. System views (Trash, Spam) cannot be deleted.",
    inputSchema: {
      id: z.number().describe("The unique ID of the view to delete"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/views/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- List View Items ---
  server.registerTool("gorgias_list_view_items", {
    title: "List View Items",
    description: "GET /api/views/{view_id}/items — List the tickets belonging to a view with cursor-based pagination.",
    inputSchema: {
      view_id: z.number().describe("The ID of the view to list items from"),
      cursor: z.string().optional().describe("Pagination cursor indicating current position in the list. Omit for the first page."),
      direction: z.enum(["prev", "next"]).nullable().optional().describe("Pagination direction: 'next' returns items after the cursor, 'prev' returns items before"),
      ignored_item: z.number().optional().describe("ID of a ticket to exclude from results (useful when items shift between pages due to real-time updates)"),
      limit: z.number().min(1).max(100).optional().describe("Maximum number of items to return per page (default: 30, max: 100)"),
      order_by: z.enum([
        "created_datetime:asc", "created_datetime:desc",
        "updated_datetime:asc", "updated_datetime:desc",
        "last_message_datetime:asc", "last_message_datetime:desc",
        "last_received_message_datetime:asc", "last_received_message_datetime:desc",
        "closed_datetime:asc", "closed_datetime:desc",
        "snooze_datetime:asc", "snooze_datetime:desc",
        "priority:asc", "priority:desc",
      ]).optional().describe("Attribute used to order view items. Overrides the view's default ordering if specified."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ view_id, ...query }) => {
    const result = await client.get(`/api/views/${view_id}/items`, query);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Search View Items ---
  server.registerTool("gorgias_search_view_items", {
    title: "Search View Items",
    description: "PUT /api/views/{view_id}/items — Search tickets using inline view configuration. Pass view_id=0 to query dynamically without referencing a saved view.",
    inputSchema: {
      view_id: z.number().describe("The ID of the view. Use 0 to dynamically query tickets without referencing a saved view."),
      cursor: z.string().optional().describe("Pagination cursor indicating current position. Omit for the first page."),
      direction: z.enum(["prev", "next"]).nullable().optional().describe("Pagination direction: 'next' returns items after the cursor, 'prev' returns items before"),
      ignored_item: z.number().optional().describe("ID of a ticket to exclude from results"),
      limit: z.number().min(1).max(100).optional().describe("Maximum number of items to return per page (default: 30, max: 100)"),
      order_by: z.enum([
        "created_datetime:asc", "created_datetime:desc",
        "updated_datetime:asc", "updated_datetime:desc",
        "last_message_datetime:asc", "last_message_datetime:desc",
        "last_received_message_datetime:asc", "last_received_message_datetime:desc",
        "closed_datetime:asc", "closed_datetime:desc",
        "snooze_datetime:asc", "snooze_datetime:desc",
        "priority:asc", "priority:desc",
      ]).optional().describe("Attribute used to order view items. Overrides view.order_by if specified."),
      view: z.object({
        category: z.string().nullable().optional().describe("Internal view category. Use 'user' for user-created views."),
        fields: z.array(z.enum([
          "id", "details", "tags", "customer", "last_message", "name", "email",
          "created", "updated", "assignee", "assignee_team", "channel", "closed",
          "language", "last_received_message", "integrations", "snooze", "status",
          "subject", "priority",
        ])).optional().describe("Ticket attribute names to display as columns"),
        filters: z.string().optional().describe("JavaScript-style filter expression e.g. eq(ticket.assignee_user.id, '{{current_user.id}}') && eq(ticket.status, 'open')"),
        order_by: z.string().optional().describe("Ticket attribute used to sort items (default: 'updated_datetime')"),
        order_dir: z.enum(["asc", "desc"]).optional().describe("Sort direction (default: 'desc')"),
        search: z.string().nullable().optional().describe("Free-text search query to filter matching items"),
        type: z.enum(["ticket-list"]).optional().describe("Type of objects the view applies to (default: 'ticket-list')"),
      }).optional().describe("Inline view configuration specifying filters, ordering, and display fields"),
    },
    annotations: { readOnlyHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ view_id, cursor, direction, ignored_item, limit, order_by, view }) => {
    const query: Record<string, unknown> = {};
    if (cursor !== undefined) query.cursor = cursor;
    if (direction !== undefined) query.direction = direction;
    if (ignored_item !== undefined) query.ignored_item = ignored_item;
    if (limit !== undefined) query.limit = limit;
    if (order_by !== undefined) query.order_by = order_by;

    const body: Record<string, unknown> = {};
    if (view !== undefined) body.view = view;

    const result = await client.put(`/api/views/${view_id}/items`, body, query);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
