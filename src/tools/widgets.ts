import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerWidgetTools(server: McpServer, client: GorgiasClient) {

  // --- List Widgets ---
  server.registerTool("gorgias_list_widgets", {
    title: "List Widgets",
    description: "GET /api/widgets — List all widgets for the account, ordered.",
    inputSchema: {
      cursor: z.string().optional().describe("Cursor value for cursor-based pagination (use value from a previous response)"),
      limit: z.number().min(1).max(100).optional().describe("Maximum number of widgets to return per page (default: 30)"),
      order_by: z.enum(["created_datetime:asc", "created_datetime:desc", "order:asc", "order:desc"]).optional().describe("Attribute used to order widgets (default: 'created_datetime:desc')"),
      integration_id: z.number().nullable().optional().describe("The ID of the integration to filter the widgets list by"),
      app_id: z.string().nullable().optional().describe("The ID of the 3rd party app to filter the widgets list by"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/widgets", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Widget ---
  server.registerTool("gorgias_get_widget", {
    title: "Get Widget",
    description: "GET /api/widgets/{id} — Retrieve a single widget by its unique ID.",
    inputSchema: {
      id: z.number().describe("The ID of the widget to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/widgets/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Widget ---
  server.registerTool("gorgias_create_widget", {
    title: "Create Widget",
    description: "POST /api/widgets — Create a new widget to display customized data from integrations in the Gorgias ticket or customer sidebar.",
    inputSchema: {
      template: z.object({
        type: z.string().describe("Must be 'wrapper' at the root level"),
        widgets: z.array(z.object({
          path: z.string().describe("Dot-notation path to the data field from the integration response"),
          type: z.string().describe("Component type: 'card', 'text', etc."),
          title: z.string().describe("Display label for this widget component"),
          widgets: z.array(z.any()).optional().describe("Optional nested child components (for 'card' type)"),
        })).describe("Array of nested widget component definitions"),
      }).describe("Template to render the data of the widget"),
      type: z.enum(["bigcommerce", "custom", "customer_external_data", "http", "magento2", "recharge", "shopify", "smile", "standalone", "yotpo", "klaviyo", "stripe", "woocommerce"]).describe("Type of data the widget is attached to"),
      context: z.enum(["ticket", "customer", "user"]).optional().describe("The UI context where this widget is displayed (default: 'ticket'). Note: 'user' is deprecated, use 'customer'"),
      order: z.number().min(0).optional().describe("Order of precedence; widgets with lower order appear first (default: 0)"),
      integration_id: z.number().min(0).nullable().optional().describe("ID of the HTTP integration this widget is attached to. Only for type 'http' widgets"),
      app_id: z.string().nullable().optional().describe("ID of the 3rd party app. Used for type 'customer_external_data' widgets"),
      deactivated_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the widget was deactivated. Set to deactivate on creation"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/widgets", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Widget ---
  server.registerTool("gorgias_update_widget", {
    title: "Update Widget",
    description: "PUT /api/widgets/{id} — Update an existing widget by ID. This is a full-replacement operation. Include all fields you want to retain.",
    inputSchema: {
      id: z.number().describe("The ID of the widget to update"),
      context: z.enum(["ticket", "customer", "user"]).optional().describe("The UI context where this widget is displayed. Note: 'user' is deprecated, use 'customer'"),
      deactivated_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the widget was deactivated. Set to null to reactivate"),
      integration_id: z.number().min(0).nullable().optional().describe("ID of the HTTP integration this widget is attached to. Only for type 'http' widgets"),
      app_id: z.string().nullable().optional().describe("ID of the 3rd party app. Used for type 'customer_external_data' widgets"),
      order: z.number().min(0).optional().describe("Order of precedence; widgets with lower order appear first (default: 0)"),
      template: z.object({
        type: z.string().describe("Must be 'wrapper' at the root level"),
        widgets: z.array(z.object({
          path: z.string().describe("Dot-notation path to the data field from the integration response"),
          type: z.string().describe("Component type: 'card', 'text', etc."),
          title: z.string().describe("Display label for this widget component"),
          widgets: z.array(z.any()).optional().describe("Optional nested child components (for 'card' type)"),
        })).describe("Array of nested widget component definitions"),
      }).optional().describe("Template to render the data of the widget. Replaces the entire template on update"),
      type: z.enum(["bigcommerce", "custom", "customer_external_data", "http", "magento2", "recharge", "shopify", "smile", "standalone", "yotpo", "klaviyo", "stripe", "woocommerce"]).optional().describe("Type of data the widget is attached to"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/widgets/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Widget ---
  server.registerTool("gorgias_delete_widget", {
    title: "Delete Widget",
    description: "DELETE /api/widgets/{id} — Permanently delete a widget. This operation is irreversible. Returns 204 No Content on success.",
    inputSchema: {
      id: z.number().describe("The ID of the widget to delete"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/widgets/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
