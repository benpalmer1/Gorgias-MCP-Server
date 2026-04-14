import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";
import { idSchema, cursorSchema } from "./_id.js";

export function registerCustomerTools(server: McpServer, client: GorgiasClient) {

  // --- List Customers ---
  server.registerTool("gorgias_list_customers", {
    title: "List Customers",
    description: "GET /api/customers — List customers, paginated and ordered by name. Supports filtering by email, external ID, name, language, timezone, view, channel type, and channel address.",
    inputSchema: {
      cursor: cursorSchema.optional().describe("Pagination cursor from a previous response. Omit to retrieve the first page."),
      email: z.string().nullable().optional().describe("Filter by the primary email address of the customer."),
      external_id: z.string().nullable().optional().describe("Filter by the customer's ID in a foreign system (Stripe, Aircall, etc.)."),
      language: z.string().nullable().optional().describe("Filter by the customer's preferred language (ISO 639-1 format, e.g. 'fr', 'en')."),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of customers to return per page (default: 30, max: 100)."),
      name: z.string().nullable().optional().describe("Filter by the full name of the customer."),
      order_by: z.enum(["created_datetime:asc", "created_datetime:desc", "updated_datetime:asc", "updated_datetime:desc"]).optional().describe("Attribute used to order customers (default: 'created_datetime:desc')."),
      timezone: z.string().nullable().optional().describe("Filter by the customer's preferred timezone (IANA timezone name, e.g. 'America/New_York')."),
      view_id: idSchema.optional().describe("Filter by saved view ID."),
      channel_type: z.string().optional().describe("Filter by customer channel type (e.g. 'email', 'phone', 'sms', 'chat', 'facebook')."),
      channel_address: z.string().max(320).optional().describe("Filter by exact channel address. Typically used together with channel_type."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/customers", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Customer ---
  server.registerTool("gorgias_get_customer", {
    title: "Get Customer",
    description: "GET /api/customers/{id} — Retrieve a single customer by ID, including channels, integration data, and optionally custom fields.",
    inputSchema: {
      id: idSchema.describe("The ID of the customer to retrieve."),
      relationships: z.array(z.enum(["custom_fields"])).optional().describe("Relations to include in the response. Pass ['custom_fields'] to include the customer's custom field values."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...query }) => {
    const result = await client.get(`/api/customers/${id}`, query);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Customer ---
  server.registerTool("gorgias_create_customer", {
    title: "Create Customer",
    description: "POST /api/customers — Create a new customer. All fields are optional.",
    inputSchema: {
      name: z.string().optional().describe("Full name of the customer."),
      firstname: z.string().optional().describe("First name of the customer."),
      lastname: z.string().optional().describe("Last name of the customer."),
      email: z.string().email().optional().describe("Primary email address of the customer (max 320 characters)."),
      external_id: z.string().optional().describe("ID of the customer in a foreign system (e.g., Stripe, Aircall, Shopify). Not used internally by Gorgias."),
      language: z.string().optional().describe("The customer's preferred language. Format: ISO 639-1 language code (e.g., 'en', 'fr', 'de')."),
      timezone: z.string().optional().describe("The customer's preferred timezone. Format: IANA timezone name (e.g., 'UTC', 'America/New_York')."),
      note: z.string().optional().describe("A note associated with the customer for internal use."),
      channels: z.array(z.object({
        type: z.string().describe("Type of the channel (e.g., 'email', 'phone', 'sms', 'facebook')."),
        address: z.string().describe("The channel address or identifier (email address, phone number, user ID, etc.)."),
        preferred: z.boolean().optional().describe("Whether this is the preferred (primary) channel for the customer. Defaults to false."),
      })).optional().describe("The customer's contact channels (email addresses, phone numbers, etc.)."),
      meta: z.record(z.string(), z.unknown()).optional().describe("Metadata associated with the customer. Arbitrary key-value pairs for storing additional information."),
      custom_fields: z.array(z.object({
        id: idSchema.describe("The ID of the custom field definition to set."),
        value: z.any().describe("The value to assign to the custom field. Type depends on the custom field definition."),
      })).optional().describe("Custom field values assigned to this customer."),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/customers", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Customer ---
  server.registerTool("gorgias_update_customer", {
    title: "Update Customer",
    description: "PUT /api/customers/{id} — Update an existing customer by ID. Only send the fields you want to modify (partial update semantics).",
    inputSchema: {
      id: idSchema.describe("The ID of the customer to update."),
      name: z.string().nullable().optional().describe("Full name of the customer."),
      email: z.string().email().nullable().optional().describe("Primary email address of the customer."),
      external_id: z.string().nullable().optional().describe("ID of the customer in a foreign system (Stripe, Aircall, etc.). Not used by Gorgias."),
      language: z.string().nullable().optional().describe("The customer's preferred language (ISO 639-1 two-letter code, e.g. 'fr')."),
      timezone: z.string().optional().describe("The customer's preferred timezone (IANA timezone name, e.g. 'America/New_York'). Default: 'UTC'."),
      channels: z.array(z.object({
        address: z.string().describe("Address of the customer channel (email, phone number, Facebook user ID, etc.)."),
        preferred: z.boolean().describe("Whether this is the preferred (primary) channel to contact this customer."),
        type: z.string().describe("Channel type: one of 'email', 'phone', 'chat', 'twitter', 'facebook', 'instagram', 'instagram-direct-message', 'whatsapp', or a custom channel slug."),
      })).optional().describe("The customer's contact channels. When included, REPLACES all existing channels."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/customers/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Customer ---
  server.registerTool("gorgias_delete_customer", {
    title: "Delete Customer",
    description: "DELETE /api/customers/{id} — Permanently delete a single customer by ID. This operation is irreversible.",
    inputSchema: {
      id: idSchema.describe("The ID of the customer to delete."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/customers/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Customers (Bulk) ---
  server.registerTool("gorgias_delete_customers", {
    title: "Delete Customers (Bulk)",
    description: "DELETE /api/customers — Bulk delete multiple customer records. Accepts a list of customer IDs and permanently deletes all specified customers.",
    inputSchema: {
      ids: z.array(idSchema).min(1).describe("A list of customer IDs to delete."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.delete("/api/customers", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Merge Customers ---
  server.registerTool("gorgias_merge_customers", {
    title: "Merge Customers",
    description: "PUT /api/customers/merge — Merge two customers. The source customer's data is merged into the target customer, then the source is deleted. Fails with 409 if both customers have data for the same integration.",
    inputSchema: {
      source_id: idSchema.describe("The ID of the customer to merge (the source). This customer will be deleted after the merge."),
      target_id: idSchema.describe("The ID of the target customer (which will still exist after the merge)."),
      name: z.string().nullable().optional().describe("Full name to set on the target customer during merge."),
      email: z.string().email().nullable().optional().describe("Primary email address to set on the target customer during merge."),
      external_id: z.string().nullable().optional().describe("External ID to set on the target customer during merge."),
      note: z.string().nullable().optional().describe("Note to set on the target customer during merge."),
      language: z.string().nullable().optional().describe("Preferred language (ISO 639-1) to set on the target customer during merge."),
      timezone: z.string().nullable().optional().describe("Timezone (IANA name) to set on the target customer during merge."),
      channels: z.array(z.object({
        address: z.string().describe("Address of the customer channel (email, phone number, Facebook user ID, etc.)."),
        type: z.string().describe("Channel type: e.g., 'email', 'phone', 'chat', 'twitter', 'facebook', 'instagram', 'whatsapp'."),
        preferred: z.boolean().optional().describe("Whether this is the preferred (primary) channel. Default: false."),
      })).optional().describe("Contact channels to set on the target customer during merge."),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("User-defined JSON metadata to set on the target customer during merge."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ source_id, target_id, ...body }) => {
    // source_id and target_id are query parameters, NOT body fields, per the
    // Gorgias REST API spec for PUT /api/customers/merge.
    const result = await client.put(`/api/customers/merge`, body, { source_id, target_id });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Set Customer Data ---
  server.registerTool("gorgias_set_customer_data", {
    title: "Set Customer Data",
    description: "PUT /api/customers/{customer_id}/data — Set a customer's data field. Replaces the stored customer data entirely. Supports optimistic concurrency via the version parameter.",
    inputSchema: {
      customer_id: idSchema.describe("The ID of the customer to update."),
      data: z.any().describe("The customer data. Free-form JSON field — any valid JSON value is accepted (object, array, string, number, boolean, or null)."),
      version: z.string().nullable().optional().describe("ISO 8601 datetime timestamp for optimistic concurrency control. If Gorgias already has a more recent version stored, the request will be silently ignored."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ customer_id, ...body }) => {
    const result = await client.put(`/api/customers/${customer_id}/data`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- List Customer Field Values ---
  server.registerTool("gorgias_list_customer_field_values", {
    title: "List Customer Field Values",
    description: "GET /api/customers/{customer_id}/custom-fields — List all custom field values set for a customer. Returns an array of field definitions with their current values.",
    inputSchema: {
      customer_id: idSchema.describe("The ID of the customer whose custom field values are to be listed."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ customer_id }) => {
    const result = await client.get(`/api/customers/${customer_id}/custom-fields`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Customer Field Value ---
  server.registerTool("gorgias_update_customer_field_value", {
    title: "Update Customer Field Value",
    description: "PUT /api/customers/{customer_id}/custom-fields/{id} — Update the value of a single custom field for a given customer. The value type must match the field's configured data type (text, number, or boolean).",
    inputSchema: {
      customer_id: idSchema.describe("The ID of the customer whose custom field value is to be updated."),
      id: idSchema.describe("The ID of the custom field to update the value for."),
      definition_id: idSchema.describe("The custom field DEFINITION ID (from gorgias_list_custom_fields). Sent as 'id' in the request body."),
      value: z.union([z.string(), z.number().int(), z.boolean()]).describe("The new value for the custom field. Must be a string for text fields, an integer for number fields, or a boolean for boolean fields."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ customer_id, id, definition_id, value }) => {
    const result = await client.put(`/api/customers/${customer_id}/custom-fields/${id}`, { id: definition_id, value });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Customer Field Value ---
  server.registerTool("gorgias_delete_customer_field_value", {
    title: "Delete Customer Field Value",
    description: "DELETE /api/customers/{customer_id}/custom-fields/{id} — Delete the value assigned to a specific custom field for a customer. The custom field definition itself is not affected.",
    inputSchema: {
      customer_id: idSchema.describe("The ID of the customer whose custom field value is to be deleted."),
      id: idSchema.describe("The ID of the custom field for which the value should be deleted."),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ customer_id, id }) => {
    const result = await client.delete(`/api/customers/${customer_id}/custom-fields/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
