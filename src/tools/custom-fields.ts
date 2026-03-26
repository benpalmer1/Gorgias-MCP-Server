import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerCustomFieldTools(server: McpServer, client: GorgiasClient) {

  // --- List Custom Fields ---
  server.registerTool("gorgias_list_custom_fields", {
    title: "List Custom Fields",
    description: "GET /api/custom-fields — Returns a paginated, ordered list of custom fields. Requires object_type to specify which entity's fields to list. Supports both offset-based and cursor-based pagination.",
    inputSchema: {
      object_type: z.enum(["Ticket", "Customer"]).describe("Type of entity to list custom fields for: 'Ticket' or 'Customer'"),
      limit: z.number().optional().describe("Maximum number of custom fields to return per page"),
      offset: z.number().optional().describe("Number of records to skip before starting to return results (offset-based pagination)"),
      cursor: z.string().optional().describe("Cursor token for cursor-based pagination. Use next_cursor or prev_cursor from a previous response"),
      order_by: z.enum([
        "created_datetime:asc", "created_datetime:desc",
        "updated_datetime:asc", "updated_datetime:desc",
      ]).optional().describe("Sort order for results"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/custom-fields", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Custom Field ---
  server.registerTool("gorgias_get_custom_field", {
    title: "Get Custom Field",
    description: "GET /api/custom-fields/{id} — Retrieve a single custom field by its unique ID. Returns the full CustomField object including definition, metadata, and configuration.",
    inputSchema: {
      id: z.number().describe("The unique ID of the custom field to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/custom-fields/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Custom Field ---
  server.registerTool("gorgias_create_custom_field", {
    title: "Create Custom Field",
    description: "POST /api/custom-fields — Create a new custom field for Ticket or Customer entities. The definition.data_type discriminator ('text', 'number', or 'boolean') determines which input_settings variant applies.",
    inputSchema: {
      object_type: z.enum(["Ticket", "Customer"]).describe("Type of entity this custom field applies to"),
      label: z.string().min(1).max(255).describe("The display name of the custom field (1–255 characters)"),
      definition: z.object({
        data_type: z.enum(["text", "number", "boolean"]).describe("The data type: 'text', 'number', or 'boolean'"),
        input_settings: z.record(z.string(), z.unknown()).describe("Input configuration. For text: {input_type: 'input', placeholder?} or {input_type: 'dropdown', choices: string[], default?}. For number: {input_type: 'input_number', min?, max?, placeholder?}. For boolean: {input_type: 'dropdown', choices?: boolean[], default?}"),
      }).describe("Defines the data type and input configuration for the field"),
      description: z.string().max(1024).nullable().optional().describe("A human-readable description of the custom field (max 1024 characters)"),
      external_id: z.string().nullable().optional().describe("ID of the custom field in a foreign system (e.g., Zendesk)"),
      priority: z.number().min(0).max(5000).nullable().optional().describe("Controls display order. Lower values appear first (0–5000)"),
      required: z.boolean().optional().describe("Whether this field must be filled in by agents (default: false)"),
      managed_type: z.enum([
        "contact_reason", "product", "resolution", "ai_intent", "ai_outcome",
        "ai_sales", "ai_discount", "ai_journey", "managed_sentiment", "call_status",
        "customer_type",
      ]).nullable().optional().describe("Managed field type classification. Leave null for standard custom fields"),
      deactivated_datetime: z.string().nullable().optional().describe("ISO 8601 datetime to deactivate the field at creation. Typically null"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/custom-fields", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Custom Field ---
  server.registerTool("gorgias_update_custom_field", {
    title: "Update Custom Field",
    description: "PUT /api/custom-fields/{id} — Update a single custom field by ID. The three required fields (object_type, label, definition) must always be included even if unchanged. To deactivate a field, set deactivated_datetime to a past ISO 8601 timestamp.",
    inputSchema: {
      id: z.number().describe("The unique ID of the custom field to update"),
      object_type: z.enum(["Ticket", "Customer"]).describe("Type of entity this custom field applies to (required even if unchanged)"),
      label: z.string().min(1).max(255).describe("The display name of the custom field (required even if unchanged)"),
      definition: z.object({
        data_type: z.enum(["text", "number", "boolean"]).describe("The data type: 'text', 'number', or 'boolean'"),
        input_settings: z.record(z.string(), z.unknown()).describe("Input configuration. For text: {input_type: 'input', placeholder?} or {input_type: 'dropdown', choices: string[], default?}. For number: {input_type: 'input_number', min?, max?, placeholder?}. For boolean: {input_type: 'dropdown', choices?: boolean[], default?}"),
      }).describe("The data type definition and input settings (required even if unchanged)"),
      description: z.string().max(1024).nullable().optional().describe("A human-readable description of the custom field (max 1024 characters)"),
      external_id: z.string().nullable().optional().describe("ID of the custom field in a foreign system (e.g., Zendesk)"),
      priority: z.number().min(0).max(5000).nullable().optional().describe("Controls display order. Lower values appear first (0–5000)"),
      required: z.boolean().optional().describe("Whether this field must be filled in by agents"),
      managed_type: z.enum([
        "contact_reason", "product", "resolution", "ai_intent", "ai_outcome",
        "ai_sales", "ai_discount", "ai_journey", "managed_sentiment", "call_status",
        "customer_type",
      ]).nullable().optional().describe("Managed field type classification. Null for standard custom fields"),
      deactivated_datetime: z.string().nullable().optional().describe("ISO 8601 datetime to deactivate the field. Set to null to reactivate"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/custom-fields/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Bulk Update Custom Fields ---
  server.registerTool("gorgias_bulk_update_custom_fields", {
    title: "Bulk Update Custom Fields",
    description: "PUT /api/custom-fields — Bulk update multiple custom fields in a single request. Send an array of update objects each containing an id and the fields to change. Only id is required per item; all other fields are optional.",
    inputSchema: {
      fields: z.array(z.object({
        id: z.number().describe("The ID of the custom field to update (required)"),
        label: z.string().min(1).max(255).optional().describe("The display name of the custom field"),
        object_type: z.enum(["Ticket", "Customer"]).optional().describe("Type of entity this custom field applies to"),
        definition: z.object({
          data_type: z.enum(["text", "number", "boolean"]).describe("The data type: 'text', 'number', or 'boolean'"),
          input_settings: z.record(z.string(), z.unknown()).describe("Input configuration matching the data_type"),
        }).optional().describe("The data type definition and input settings"),
        description: z.string().max(1024).nullable().optional().describe("A human-readable description (max 1024 characters)"),
        external_id: z.string().nullable().optional().describe("ID of the custom field in a foreign system"),
        priority: z.number().min(0).max(5000).optional().describe("Controls display order (0–5000)"),
        required: z.boolean().optional().describe("Whether this field must be filled in by agents"),
        managed_type: z.enum([
          "contact_reason", "product", "resolution", "ai_intent", "ai_outcome",
          "ai_sales", "ai_discount", "ai_journey", "managed_sentiment", "call_status",
          "customer_type",
        ]).nullable().optional().describe("Managed field type classification"),
        deactivated_datetime: z.string().nullable().optional().describe("ISO 8601 datetime to deactivate/reactivate the field"),
      })).min(1).describe("Array of custom field update objects. Each must include an id"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ fields }) => {
    const result = await client.put("/api/custom-fields", fields);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
