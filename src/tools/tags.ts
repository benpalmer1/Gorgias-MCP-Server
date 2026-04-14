import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";
import { idSchema, cursorSchema } from "./_id.js";

export function registerTagTools(server: McpServer, client: GorgiasClient) {

  // --- List Tags ---
  server.registerTool("gorgias_list_tags", {
    title: "List Tags",
    description: "GET /api/tags — List all tags with optional filtering and cursor-based pagination.",
    inputSchema: {
      cursor: cursorSchema.optional().describe("Pagination cursor from a previous response"),
      limit: z.number().min(1).max(100).optional().describe("Max results per page (default: 30)"),
      order_by: z.enum([
        "created_datetime:asc", "created_datetime:desc",
        "name:asc", "name:desc",
        "usage:asc", "usage:desc",
      ]).optional().describe("Sort order. Default: created_datetime:desc."),
      search: z.string().optional().describe("Case-insensitive search on tag names"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/tags", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Tag ---
  server.registerTool("gorgias_get_tag", {
    title: "Get Tag",
    description: "GET /api/tags/{id} — Retrieve a single tag by its unique ID. Returns name, description, decoration, usage count, and timestamps.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the tag to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/tags/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Tag ---
  server.registerTool("gorgias_create_tag", {
    title: "Create Tag",
    description: "POST /api/tags — Create a new tag. Tag names are case-sensitive.",
    inputSchema: {
      name: z.string().min(1).max(256).describe("Name of the tag (case-sensitive)"),
      description: z.string().max(1024).optional().describe("Short description of the tag"),
      decoration: z.object({
        color: z.string().describe("Hex color code, e.g. '#F58D86'"),
      }).optional().describe("Visual styling for the tag"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/tags", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Tag ---
  server.registerTool("gorgias_update_tag", {
    title: "Update Tag",
    description: "PUT /api/tags/{id} — Update an existing tag by ID.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the tag to update"),
      name: z.string().min(1).max(256).optional().describe("New name for the tag"),
      description: z.string().max(1024).nullable().optional().describe("New description"),
      decoration: z.object({
        color: z.string().describe("Hex color code"),
      }).optional().describe("Visual styling for the tag"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/tags/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Tag ---
  server.registerTool("gorgias_delete_tag", {
    title: "Delete Tag",
    description: "DELETE /api/tags/{id} — Permanently delete a single tag. Views using this tag will be deactivated. Tags used in macros/rules cannot be deleted.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the tag to delete"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/tags/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Tags (Bulk) ---
  server.registerTool("gorgias_delete_tags", {
    title: "Delete Tags (Bulk)",
    description: "DELETE /api/tags — Bulk delete multiple tags by ID. Views using deleted tags will be deactivated. Tags used in macros/rules cannot be deleted.",
    inputSchema: {
      ids: z.array(idSchema).min(1).describe("Array of tag IDs to delete"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.delete("/api/tags", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Merge Tags ---
  server.registerTool("gorgias_merge_tags", {
    title: "Merge Tags",
    description: "PUT /api/tags/{destination_tag_id}/merge — Merge one or more source tags into a destination tag. Source tags are deleted after merge.",
    inputSchema: {
      destination_tag_id: idSchema.describe("The ID of the tag to merge into (destination)"),
      source_tags_ids: z.array(idSchema).min(1).describe("Array of source tag IDs to merge into the destination"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ destination_tag_id, ...body }) => {
    const result = await client.put(`/api/tags/${destination_tag_id}/merge`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
