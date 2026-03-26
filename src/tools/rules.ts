import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerRuleTools(server: McpServer, client: GorgiasClient) {

  // --- List Rules ---
  server.registerTool("gorgias_list_rules", {
    title: "List Rules",
    description: "GET /api/rules — List all rules with cursor-based pagination.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor from a previous response (value of meta.next_cursor)"),
      limit: z.number().min(1).max(100).optional().describe("Max results per page (default: 100, max: 100)"),
      order_by: z.string().optional().describe("Sort order, e.g. 'created_datetime:desc' or 'created_datetime:asc'"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/rules", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Rule ---
  server.registerTool("gorgias_get_rule", {
    title: "Get Rule",
    description: "GET /api/rules/{id} — Retrieve a single rule by its unique ID.",
    inputSchema: {
      id: z.number().describe("The unique ID of the rule to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/rules/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Rule ---
  server.registerTool("gorgias_create_rule", {
    title: "Create Rule",
    description: "POST /api/rules — Create a new automation rule with JavaScript logic and event triggers.",
    inputSchema: {
      name: z.string().describe("The name of the rule"),
      code: z.string().describe("The logic of the rule as JavaScript code"),
      code_ast: z.record(z.string(), z.unknown()).optional().describe("The logic of the rule as an ESTree AST representation (auto-generated from code if not specified)"),
      description: z.string().nullable().optional().describe("A human-readable description of the rule"),
      event_types: z.string().optional().describe("Comma-separated list of events that trigger this rule. Allowed values: ticket-created, ticket-updated, ticket-message-created, ticket-assigned, ticket-self-unsnoozed, satisfaction-survey-responded"),
      priority: z.number().int().optional().describe("Order of execution; rules with higher priority values are executed first"),
      deactivated_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the rule was deactivated. Set to null to create the rule as active"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/rules", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Rule ---
  server.registerTool("gorgias_update_rule", {
    title: "Update Rule",
    description: "PUT /api/rules/{id} — Full-replacement update of a rule by ID. This is a PUT endpoint, so all fields should be included; any omitted fields may be reset to defaults.",
    inputSchema: {
      id: z.number().describe("The unique ID of the rule to update"),
      name: z.string().describe("The name of the rule"),
      code: z.string().describe("The logic of the rule as JavaScript code"),
      code_ast: z.record(z.string(), z.unknown()).optional().describe("The logic of the rule as an ESTree AST representation (auto-generated from code if not specified)"),
      description: z.string().nullable().optional().describe("A human-readable description of the rule"),
      event_types: z.string().optional().describe("Comma-separated list of events that trigger this rule. Allowed values: ticket-created, ticket-updated, ticket-message-created, ticket-assigned, ticket-self-unsnoozed, satisfaction-survey-responded"),
      priority: z.number().int().optional().describe("Order of execution; rules with higher priority values are executed first"),
      deactivated_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the rule was deactivated. Set to null to reactivate the rule"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/rules/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Rule ---
  server.registerTool("gorgias_delete_rule", {
    title: "Delete Rule",
    description: "DELETE /api/rules/{id} — Permanently delete a rule by ID. This action is irreversible.",
    inputSchema: {
      id: z.number().describe("The unique ID of the rule to delete"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/rules/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Rules Priorities ---
  server.registerTool("gorgias_update_rules_priorities", {
    title: "Update Rules Priorities",
    description: "POST /api/rules/priorities — Batch update the execution priority of multiple rules in a single request.",
    inputSchema: {
      priorities: z.array(z.object({
        id: z.number().int().describe("The ID of the rule to update"),
        priority: z.number().int().describe("The new execution priority for the rule (higher values execute first)"),
      })).min(1).describe("Array of rule ID and priority pairs to update"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/rules/priorities", args.priorities);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
