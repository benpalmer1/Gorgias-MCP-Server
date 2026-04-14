import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";
import { idSchema, cursorSchema } from "./_id.js";

export function registerTeamTools(server: McpServer, client: GorgiasClient) {

  // --- List Teams ---
  server.registerTool("gorgias_list_teams", {
    title: "List Teams",
    description: "GET /api/teams — List teams matching the given parameters, ordered. Returns a plain JSON array of Team objects (not a paginated wrapper with next_cursor).",
    inputSchema: {
      cursor: cursorSchema.optional().describe("Pagination cursor from a previous response to advance to the next page"),
      limit: z.number().min(1).max(100).optional().describe("Max results per page (default: 30)"),
      order_by: z.enum([
        "created_datetime:asc",
        "created_datetime:desc",
        "name:asc",
        "name:desc",
      ]).optional().describe("Attribute used to order teams (default: created_datetime:desc)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/teams", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Team ---
  server.registerTool("gorgias_get_team", {
    title: "Get Team",
    description: "GET /api/teams/{id} — Retrieve a single team by its unique ID. Returns name, description, decoration, members, and timestamps.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the team to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/teams/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Team ---
  server.registerTool("gorgias_create_team", {
    title: "Create Team",
    description: "POST /api/teams — Create a new team. Teams are used with the auto-assign tickets feature.",
    inputSchema: {
      name: z.string().min(1).describe("Name of the team"),
      description: z.string().nullable().optional().describe("Longer description of the team"),
      decoration: z.object({
        emoji: z.string().nullable().optional().describe("A single emoji character displayed before the team name in the UI"),
      }).nullable().optional().describe("Object describing how the team appears on the webpage"),
      members: z.array(z.object({
        id: idSchema.describe("The ID of the user to add to the team"),
        name: z.string().nullable().optional().describe("The full name of the user"),
        email: z.string().nullable().optional().describe("The email address of the user (max 320 chars)"),
        meta: z.record(z.string(), z.unknown()).nullable().optional().describe("User-defined JSON metadata field"),
      })).optional().describe("The list of users to include in the team"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/teams", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Team ---
  server.registerTool("gorgias_update_team", {
    title: "Update Team",
    description: "PUT /api/teams/{id} — Update an existing team by ID. All fields are optional; only provided fields are updated. The members field performs a full replacement when provided.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the team to update"),
      name: z.string().min(1).optional().describe("The display name of the team"),
      description: z.string().nullable().optional().describe("A longer description of the team's purpose. Pass null to clear."),
      decoration: z.object({
        emoji: z.string().nullable().optional().describe("A single emoji character displayed before the team name in the UI"),
      }).nullable().optional().describe("Visual display configuration for the team. Pass null to remove decoration."),
      members: z.array(z.object({
        id: idSchema.describe("The ID of the user"),
        name: z.string().nullable().optional().describe("The full name of the user"),
        email: z.string().nullable().optional().describe("The email address of the user (max 320 chars)"),
        meta: z.record(z.string(), z.unknown()).nullable().optional().describe("User-defined JSON metadata field"),
      })).optional().describe("The full list of users to assign to the team. Replaces the existing member list entirely when provided."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/teams/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Team ---
  server.registerTool("gorgias_delete_team", {
    title: "Delete Team",
    description: "DELETE /api/teams/{id} — Permanently delete a team by ID. Deletion is irreversible. Tickets previously assigned to the team will lose their team assignment.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the team to delete"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/teams/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
