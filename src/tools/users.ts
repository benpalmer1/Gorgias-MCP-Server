import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerUserTools(server: McpServer, client: GorgiasClient) {

  // --- List Users ---
  server.registerTool("gorgias_list_users", {
    title: "List Users",
    description: "GET /api/users — List all users, ordered alphabetically by name, with cursor-based pagination.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor from a previous response (meta.next_cursor or meta.prev_cursor)"),
      limit: z.number().optional().describe("Maximum number of users to return per page"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/users", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get User ---
  server.registerTool("gorgias_get_user", {
    title: "Get User",
    description: "GET /api/users/{id} — Retrieve a single user by ID. Use id=0 to retrieve the currently authenticated user.",
    inputSchema: {
      id: z.number().describe("The unique ID of the user to retrieve. Use 0 to retrieve the currently authenticated user."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/users/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create User ---
  server.registerTool("gorgias_create_user", {
    title: "Create User",
    description: "POST /api/users — Create a new user (agent or administrator) in the Gorgias helpdesk.",
    inputSchema: {
      email: z.string().email().describe("Email address for the new user's Gorgias account. Used for login and notifications."),
      firstname: z.string().optional().describe("First name of the user"),
      lastname: z.string().optional().describe("Last name of the user"),
      name: z.string().describe("Full name of the user. If not provided, may be derived from firstname and lastname."),
      active: z.boolean().optional().describe("Whether the user can log in. Defaults to true if not specified."),
      bio: z.string().optional().describe("Short biography of the user"),
      country: z.string().optional().describe("Country of the user as ISO 3166-1 alpha-2 code (e.g. 'FR', 'US')"),
      external_id: z.string().optional().describe("ID of the user in a foreign system (e.g. Stripe, Aircall). Not used by Gorgias."),
      language: z.string().optional().describe("Preferred language for the user's Gorgias interface as ISO 639-1 code (e.g. 'en', 'fr')"),
      meta: z.record(z.string(), z.unknown()).optional().describe("Arbitrary key-value data to associate with the user. Not used by Gorgias internally."),
      role: z.object({
        name: z.string().describe("Role name to assign. Known values: 'admin', 'agent'"),
      }).describe("The role to assign to the user"),
      timezone: z.string().optional().describe("Preferred timezone as IANA timezone name (e.g. 'US/Pacific', 'Europe/Paris')"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/users", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update User ---
  server.registerTool("gorgias_update_user", {
    title: "Update User",
    description: "PUT /api/users/{id} — Update an existing user by ID. Only include fields to modify. Use id=0 to update the currently authenticated user.",
    inputSchema: {
      id: z.number().describe("The unique ID of the user to update. Use 0 to update the currently authenticated user."),
      bio: z.string().nullable().optional().describe("Short biography of the user. Pass null to clear."),
      country: z.string().nullable().optional().describe("Country of the user as ISO 3166-1 alpha-2 code. Pass null to clear."),
      email: z.string().email().optional().describe("Email address of the user. Requires password_confirmation when changing."),
      external_id: z.string().optional().describe("ID of the user in a foreign system. Not used by Gorgias."),
      language: z.string().nullable().optional().describe("Preferred language as ISO 639-1 code (e.g. 'en', 'fr'). Pass null to clear."),
      meta: z.record(z.string(), z.unknown()).optional().describe("Arbitrary key-value data. Replaces existing meta entirely when provided."),
      name: z.string().optional().describe("Full name of the user"),
      new_password: z.string().optional().describe("New password for the user. Requires old_password to also be provided."),
      old_password: z.string().optional().describe("Current password of the user. Required when changing the password."),
      password_confirmation: z.string().optional().describe("Current password of the user. Required when changing the email address."),
      role: z.object({
        name: z.string().describe("Role name to assign. Known values: 'admin', 'agent'"),
      }).optional().describe("The role to assign to the user"),
      firstname: z.string().nullable().optional().describe("First name of the user."),
      lastname: z.string().nullable().optional().describe("Last name of the user."),
      active: z.boolean().optional().describe("Whether the user can log in."),
      timezone: z.string().optional().describe("Preferred timezone as IANA timezone name (e.g. 'US/Pacific', 'Europe/Paris')"),
      two_fa_code: z.string().nullable().optional().describe("Two-factor authentication code, if applicable"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/users/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete User ---
  server.registerTool("gorgias_delete_user", {
    title: "Delete User",
    description: "DELETE /api/users/{id} — Permanently delete a single user by ID. Deletion is irreversible.",
    inputSchema: {
      id: z.number().describe("The unique ID of the user to delete"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/users/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // NOTE: There is intentionally no `gorgias_delete_users` (bulk) tool.
  // The Gorgias REST API does not expose a bulk DELETE on /api/users — only
  // the single-id form DELETE /api/users/{id} is documented. Although the
  // parallel /api/customers endpoint does support bulk deletion, /api/users
  // does not. Users must be deleted one at a time via gorgias_delete_user.
}
