import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerIntegrationTools(server: McpServer, client: GorgiasClient) {

  // --- List Integrations ---
  server.registerTool("gorgias_list_integrations", {
    title: "List Integrations",
    description: "GET /api/integrations — List integrations matching the given parameters, paginated. Returns a cursor-based paginated list of Integration objects for the account.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor from a previous response (value of meta.next_cursor or meta.prev_cursor)"),
      limit: z.number().int().optional().describe("Maximum number of integrations to return per page (default: 30)"),
      order_by: z.string().optional().describe("Field and direction to sort results by, e.g. 'created_datetime:desc'"),
      type: z.string().optional().describe("Filter integrations by type (e.g. 'http')"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/integrations", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Integration ---
  server.registerTool("gorgias_get_integration", {
    title: "Get Integration",
    description: "GET /api/integrations/{id} — Retrieve a single integration by its ID. Returns the full Integration object including HTTP configuration details for HTTP-type integrations.",
    inputSchema: {
      id: z.number().int().describe("The ID of the integration to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/integrations/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Integration ---
  server.registerTool("gorgias_create_integration", {
    title: "Create Integration",
    description: "POST /api/integrations — Creates a new integration within the Gorgias helpdesk system. The primary supported type via the REST API is the HTTP integration, which calls an external URL when specific ticket events occur.",
    inputSchema: {
      name: z.string().describe("Name of the integration (e.g. 'My HTTP integration')"),
      type: z.string().describe("Type of integration being created. Use 'http' for custom HTTP integrations"),
      description: z.string().nullable().optional().describe("Human-readable description of the integration's purpose"),
      http: z.object({
        url: z.string().describe("Target endpoint URL to call when a trigger fires. Supports Gorgias template variables (e.g. 'https://company.com/api?email={{ticket.customer.email}}')"),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).describe("HTTP verb for the outbound request"),
        request_content_type: z.string().describe("MIME type of the outbound request body (e.g. 'application/json')"),
        response_content_type: z.string().describe("Expected MIME type of the response from the external service (e.g. 'application/json')"),
        form: z.record(z.string(), z.string()).optional().describe("Key-value pairs sent as the request body or query parameters. Values support Gorgias template variables"),
        headers: z.record(z.string(), z.string()).optional().describe("Custom HTTP headers sent with the outbound request as key-value pairs"),
        hmac_secret: z.string().optional().describe("HMAC secret used to sign HTTP calls to the external service (write-only)"),
        triggers: z.object({
          "ticket-created": z.boolean().optional().describe("Fires when a new ticket is created"),
          "ticket-updated": z.boolean().optional().describe("Fires when a ticket is updated"),
          "ticket-message-created": z.boolean().optional().describe("Fires when a new message is added to a ticket"),
          "ticket-self-unsnoozed": z.boolean().optional().describe("Fires when a snoozed ticket's snooze timer expires"),
          "ticket-message-failed": z.boolean().optional().describe("Fires when a ticket message fails to send"),
          "ticket-assignment-updated": z.boolean().optional().describe("Fires when the assignee of a ticket changes"),
          "ticket-status-updated": z.boolean().optional().describe("Fires when the status of a ticket changes"),
          "ticket-handed-over": z.boolean().optional().describe("Fires when a ticket is handed over"),
        }).optional().describe("Maps event type names to boolean flags controlling which ticket events trigger the integration"),
      }).optional().describe("HTTP configuration object. Required when type is 'http'"),
      business_hours_id: z.number().int().nullable().optional().describe("ID of the business hours configuration to associate with this integration. Relevant for phone integrations only. When null, the account's default business hours are used"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/integrations", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Integration ---
  server.registerTool("gorgias_update_integration", {
    title: "Update Integration",
    description: "PUT /api/integrations/{id} — Update an existing integration by its ID. The request body must include name at minimum. Returns the updated Integration object on success.",
    inputSchema: {
      id: z.number().int().describe("The ID of the integration to update"),
      name: z.string().describe("Name of the integration (required)"),
      description: z.string().nullable().optional().describe("Human-readable description of the integration"),
      deactivated_datetime: z.string().nullable().optional().describe("When the integration was deactivated (ISO 8601 format). Set to null to reactivate"),
      http: z.object({
        url: z.string().describe("Target endpoint URL to call when a trigger fires. Supports Gorgias template variables (e.g. 'https://company.com/api?email={{ticket.customer.email}}')"),
        method: z.enum(["GET", "POST", "PUT", "PATCH", "DELETE", "HEAD"]).describe("HTTP verb for the outbound request"),
        request_content_type: z.string().describe("MIME type of the outbound request body (e.g. 'application/json')"),
        response_content_type: z.string().describe("Expected MIME type of the response from the external service (e.g. 'application/json')"),
        form: z.record(z.string(), z.string()).optional().describe("Key-value pairs sent as the request body or query parameters. Values support Gorgias template variables"),
        headers: z.record(z.string(), z.string()).optional().describe("Custom HTTP headers sent with the outbound request as key-value pairs (e.g. {'x-api-key': 'your-key-here'})"),
        hmac_secret: z.string().optional().describe("The HMAC secret used to sign HTTP calls to the external service (write-only)"),
        triggers: z.object({
          "ticket-created": z.boolean().optional().describe("Fires when a new ticket is created"),
          "ticket-updated": z.boolean().optional().describe("Fires when a ticket is updated"),
          "ticket-message-created": z.boolean().optional().describe("Fires when a new message is added to a ticket"),
          "ticket-self-unsnoozed": z.boolean().optional().describe("Fires when a snoozed ticket's snooze timer expires"),
          "ticket-message-failed": z.boolean().optional().describe("Fires when a ticket message fails to send"),
          "ticket-assignment-updated": z.boolean().optional().describe("Fires when the assignee of a ticket changes"),
          "ticket-status-updated": z.boolean().optional().describe("Fires when the status of a ticket changes"),
          "ticket-handed-over": z.boolean().optional().describe("Fires when a ticket is handed over"),
        }).optional().describe("Maps event type names to boolean flags controlling which ticket events trigger the integration"),
      }).optional().describe("HTTP configuration object. Only relevant for integrations of type 'http'"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/integrations/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Integration ---
  server.registerTool("gorgias_delete_integration", {
    title: "Delete Integration",
    description: "DELETE /api/integrations/{id} — Delete an integration. Any views that use this integration will be deactivated. Integrations currently used in rules and/or other integrations cannot be deleted.",
    inputSchema: {
      id: z.number().int().describe("The ID of the integration to delete"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/integrations/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
