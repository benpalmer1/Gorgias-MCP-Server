import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";
import { idSchema } from "./_id.js";

export function registerAccountTools(server: McpServer, client: GorgiasClient) {

  // --- Retrieve Account ---
  server.registerTool("gorgias_retrieve_account", {
    title: "Retrieve Account",
    description: "GET /api/account — Retrieve your account information including metadata and account-wide settings. No parameters required; the account is determined by authentication credentials.",
    inputSchema: {},
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (_args) => {
    const result = await client.get("/api/account");
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- List Account Settings ---
  server.registerTool("gorgias_list_account_settings", {
    title: "List Account Settings",
    description: "GET /api/account/settings — List account settings for the current account. Returns an array of AccountSetting objects. This endpoint does not support pagination — all settings are returned in a single response. Supports filtering by type.",
    inputSchema: {
      type: z.string().optional().describe("Filter settings by type. Only returns settings matching this type identifier (e.g. 'business-hours')"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/account/settings", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Account Setting ---
  server.registerTool("gorgias_create_account_setting", {
    title: "Create Account Setting",
    description: "POST /api/account/settings — Create a setting for the current account. Account settings are helpdesk-wide configuration objects such as business hours and satisfaction surveys.",
    inputSchema: {
      type: z.string().describe("The type/category identifier of the setting (e.g. 'business-hours')"),
      name: z.string().optional().describe("Human-readable name for this setting"),
      data: z.record(z.string(), z.unknown()).optional().describe("Configuration data specific to the setting type. For 'business-hours': { timezone: string, business_hours: { days: string, from_time: string, to_time: string } }"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/account/settings", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Account Setting ---
  server.registerTool("gorgias_update_account_setting", {
    title: "Update Account Setting",
    description: "PUT /api/account/settings/{id} — Update a setting for the current account. Replaces the existing configuration of the AccountSetting identified by its ID.",
    inputSchema: {
      id: idSchema.describe("The ID of the setting to update"),
      type: z.string().describe("The type/category of the setting. Should match the existing setting's type (e.g. 'business-hours')"),
      name: z.string().optional().describe("Human-readable name for this setting"),
      data: z.record(z.string(), z.unknown()).optional().describe("The new configuration data for the setting. Replaces the existing data entirely. For 'business-hours': { timezone: string, business_hours: { days: string, from_time: string, to_time: string } }"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/account/settings/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
