import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";
import { idSchema, cursorSchema } from "./_id.js";

export function registerSatisfactionSurveyTools(server: McpServer, client: GorgiasClient) {

  // --- List Satisfaction Surveys ---
  server.registerTool("gorgias_list_satisfaction_surveys", {
    title: "List Satisfaction Surveys",
    description: "GET /api/satisfaction-surveys — List all satisfaction surveys with cursor-based pagination.",
    inputSchema: {
      cursor: cursorSchema.optional().describe("Pagination cursor from a previous response (value of meta.next_cursor)"),
      limit: z.number().optional().describe("Max results per page (default: 30)"),
      order_by: z.string().optional().describe("Sort order, e.g. 'created_datetime:desc'"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/satisfaction-surveys", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Satisfaction Survey ---
  server.registerTool("gorgias_get_satisfaction_survey", {
    title: "Get Satisfaction Survey",
    description: "GET /api/satisfaction-surveys/{id} — Retrieve a single satisfaction survey by its unique ID.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the satisfaction survey to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/satisfaction-surveys/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Satisfaction Survey ---
  server.registerTool("gorgias_create_satisfaction_survey", {
    title: "Create Satisfaction Survey",
    description: "POST /api/satisfaction-surveys — Create a new satisfaction survey. Only one survey is allowed per ticket.",
    inputSchema: {
      customer_id: idSchema.describe("The ID of the customer who filled the survey"),
      ticket_id: idSchema.describe("The ID of the ticket the survey is associated with (only one survey per ticket allowed)"),
      body_text: z.string().max(1000).nullable().optional().describe("The comment sent by the customer (max 1000 characters)"),
      created_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the survey was created"),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("Custom key-value data to associate with the survey (not used by Gorgias)"),
      score: z.number().int().min(1).max(5).nullable().optional().describe("Satisfaction score, integer 1-5 (1 = worst, 5 = best). The Gorgias API accepts any integer in the inclusive range."),
      scored_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the survey was filled by the customer"),
      sent_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the survey was sent (null means not sent yet)"),
      should_send_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the survey should be sent. Set to null to prevent Gorgias from sending it automatically"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/satisfaction-surveys", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Satisfaction Survey ---
  server.registerTool("gorgias_update_satisfaction_survey", {
    title: "Update Satisfaction Survey",
    description: "PUT /api/satisfaction-surveys/{id} — Update an existing satisfaction survey by ID. This is a full-replacement PUT: customer_id and ticket_id must be re-sent to preserve the survey's linkage. Read the survey first via gorgias_get_satisfaction_survey to obtain the IDs.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the satisfaction survey to update"),
      customer_id: idSchema.describe("The ID of the customer who filled the survey. Required: PUT is a full-replacement operation."),
      ticket_id: idSchema.describe("The ID of the ticket the survey is associated with. Required: PUT is a full-replacement operation."),
      created_datetime: z.string().nullable().optional().describe("ISO 8601 datetime the survey was created. Include to preserve the original creation timestamp through a full-replacement PUT."),
      body_text: z.string().max(1000).nullable().optional().describe("The comment sent by the customer (max 1000 characters). Set to null to clear"),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("Custom key-value data for the survey. Set to null to clear"),
      score: z.number().int().min(1).max(5).nullable().optional().describe("Satisfaction score, integer 1-5 (1 = worst, 5 = best). The Gorgias API accepts any integer in the inclusive range."),
      scored_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the survey was filled by the customer. Set to null to clear"),
      sent_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the survey was sent. Set to null to clear"),
      should_send_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the survey should be sent. Set to null to prevent Gorgias from automatically sending it"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/satisfaction-surveys/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
