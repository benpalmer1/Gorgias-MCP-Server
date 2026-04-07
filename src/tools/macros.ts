import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerMacroTools(server: McpServer, client: GorgiasClient) {

  // --- List Macros ---
  server.registerTool("gorgias_list_macros", {
    title: "List Macros",
    description: "GET /api/macros — List all macros with optional filtering by search query, tags, languages, archived status, and relevance to a ticket. Supports cursor-based pagination.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor from a previous response"),
      limit: z.number().min(1).max(100).optional().describe("Max number of macros to return per page (default: 30, max: 100)"),
      order_by: z.enum([
        "name:asc", "name:desc",
        "created_datetime:asc", "created_datetime:desc",
        "updated_datetime:asc", "updated_datetime:desc",
        "usage:asc", "usage:desc",
        "relevance:asc", "relevance:desc",
        "language:asc", "language:desc",
      ]).optional().describe("Sort order for macros. When using relevance sorting, ticket_id is required."),
      search: z.string().nullable().optional().describe("Filter macros containing the given search query"),
      tags: z.array(z.string()).nullable().optional().describe("Filter macros containing all tags in the given list"),
      languages: z.array(z.string()).nullable().optional().describe("Filter macros containing any language in the given list (ISO 639-1 codes)"),
      ticket_id: z.number().nullable().optional().describe("Order macros by the most relevant ones to reply to the given ticket. Required when order_by is 'relevance'."),
      message_id: z.number().nullable().optional().describe("Order macros by the most relevant ones to reply to the given message. Requires order_by='relevance' and ticket_id."),
      number_predictions: z.number().optional().describe("Number of relevant macros to return on top of the list (default: 0)"),
      archived: z.boolean().nullable().optional().describe("Filter by archived status. If true, only archived macros are returned. Defaults to false."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/macros", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Macro ---
  server.registerTool("gorgias_get_macro", {
    title: "Get Macro",
    description: "GET /api/macros/{id} — Retrieve a single macro by its unique ID. Returns the full Macro object including all actions, metadata, and timestamps.",
    inputSchema: {
      id: z.number().describe("The unique ID of the macro to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/macros/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Macro ---
  server.registerTool("gorgias_create_macro", {
    title: "Create Macro",
    description: "POST /api/macros — Create a new macro (canned response). A macro is a list of actions that can be applied to tickets to modify them and/or reply to them.",
    inputSchema: {
      name: z.string().describe("The name of the macro. Choose a name that can be easily searched."),
      actions: z.array(z.record(z.string(), z.unknown())).optional().describe("A list of actions to be applied on tickets. Each action object should have 'name', 'title', 'arguments', and optionally 'type' and 'description'."),
      external_id: z.string().nullable().optional().describe("External ID of the macro in a foreign system. Not used by Gorgias; set to any custom value."),
      intent: z.enum([
        "discount/request",
        "exchange/request",
        "exchange/status",
        "feedback",
        "order/damaged",
        "order/cancel",
        "order/change",
        "order/wrong",
        "other/no_reply",
        "other/question",
        "other/thanks",
        "product/recommendation",
        "product/question",
        "refund/request",
        "refund/status",
        "return/request",
        "return/status",
        "shipping/change",
        "shipping/delivery-issue",
        "shipping/policy",
        "shipping/status",
        "stock/request",
        "subscription/cancel",
        "subscription/change",
      ]).nullable().optional().describe("The intended use case of the macro."),
      language: z.string().nullable().optional().describe("The language of the macro in ISO 639-1 format (e.g. 'en', 'fr')."),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/macros", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Macro ---
  server.registerTool("gorgias_update_macro", {
    title: "Update Macro",
    description: "PUT /api/macros/{id} — Partial update of a macro by ID. All body fields are optional; only the fields you supply are modified. NOTE: if you include `actions`, the entire actions array is replaced — you cannot append individual actions.",
    inputSchema: {
      id: z.number().describe("The unique ID of the macro to update"),
      name: z.string().optional().describe("New name for the macro."),
      actions: z.array(z.record(z.string(), z.unknown())).optional().describe("If provided, replaces the entire actions list. Each action object should have 'name', 'title', 'arguments', and optionally 'type' and 'description'."),
      external_id: z.string().nullable().optional().describe("External ID of the macro in a foreign system. Not used by Gorgias; set to any custom value."),
      intent: z.enum([
        "discount/request",
        "exchange/request",
        "exchange/status",
        "feedback",
        "order/damaged",
        "order/cancel",
        "order/change",
        "order/wrong",
        "other/no_reply",
        "other/question",
        "other/thanks",
        "product/recommendation",
        "product/question",
        "refund/request",
        "refund/status",
        "return/request",
        "return/status",
        "shipping/change",
        "shipping/delivery-issue",
        "shipping/policy",
        "shipping/status",
        "stock/request",
        "subscription/cancel",
        "subscription/change",
      ]).nullable().optional().describe("The intended use case of the macro."),
      language: z.string().nullable().optional().describe("The language of the macro in ISO 639-1 format (e.g. 'en', 'fr')."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/macros/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Macro ---
  server.registerTool("gorgias_delete_macro", {
    title: "Delete Macro",
    description: "DELETE /api/macros/{id} — Permanently delete a macro by ID. This action cannot be undone. Macros in use by active rules cannot be deleted (returns 409 Conflict). Returns 204 No Content on success.",
    inputSchema: {
      id: z.number().describe("The unique ID of the macro to delete"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/macros/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Archive Macros (Bulk) ---
  server.registerTool("gorgias_archive_macros", {
    title: "Archive Macros (Bulk)",
    description: "PUT /api/macros/archive — Bulk archive multiple macros by ID. Archiving removes macros from the active list without permanently deleting them. Max 30 IDs per request. Returns per-ID results.",
    inputSchema: {
      ids: z.array(z.number()).min(1).max(30).describe("List of macro IDs to archive (min: 1, max: 30 per request)"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.put("/api/macros/archive", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Unarchive Macros (Bulk) ---
  server.registerTool("gorgias_unarchive_macros", {
    title: "Unarchive Macros (Bulk)",
    description: "PUT /api/macros/unarchive — Bulk unarchive multiple previously archived macros by ID. Restores macros to active status. Max 30 IDs per request. Returns per-ID results.",
    inputSchema: {
      ids: z.array(z.number()).min(1).max(30).describe("List of macro IDs to unarchive (min: 1, max: 30 per request)"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.put("/api/macros/unarchive", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
