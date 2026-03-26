import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerTicketTools(server: McpServer, client: GorgiasClient) {

  // --- List Tickets ---
  server.registerTool("gorgias_list_tickets", {
    title: "List Tickets",
    description: "GET /api/tickets — Returns a paginated list of raw ticket data. For intelligent search with auto-detection of emails, names, views, and keywords, use gorgias_smart_search instead. Supports filtering by customer, external ID, view, rule, specific ticket IDs, and whether to include trashed tickets. Uses cursor-based pagination.",
    inputSchema: {
      order_by: z.enum([
        "created_datetime:asc",
        "created_datetime:desc",
        "updated_datetime:asc",
        "updated_datetime:desc",
      ]).optional().describe("Attribute used to order tickets. Default: 'created_datetime:desc'"),
      cursor: z.string().optional().describe("Pagination cursor from a previous response to retrieve the next or previous page"),
      limit: z.number().min(1).max(100).optional().describe("Maximum number of tickets to return per page (default: 30, max: 100)"),
      customer_id: z.number().min(1).optional().describe("ID of a customer — returns only that customer's tickets"),
      external_id: z.string().optional().describe("ID of the ticket in a foreign system — returns tickets matching this external ID"),
      view_id: z.number().min(1).optional().describe("ID of a view — returns tickets matching the filters of that view"),
      rule_id: z.number().min(1).optional().describe("ID of a rule — returns tickets matching the filters of that rule"),
      ticket_ids: z.array(z.number().min(1)).min(1).max(100).optional().describe("Array of specific ticket IDs to retrieve (max 100)"),
      trashed: z.boolean().optional().describe("Whether to include trashed tickets in the response (default: false)"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/tickets", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Ticket ---
  server.registerTool("gorgias_get_ticket", {
    title: "Get Ticket",
    description: "GET /api/tickets/{id} — Retrieve a single ticket's raw API response. For a clean, LLM-optimised view with projected messages sorted chronologically, use gorgias_smart_get_ticket instead. Returns the full Ticket object including customer, messages, tags, custom fields, assignees, satisfaction survey, and metadata.",
    inputSchema: {
      id: z.number().describe("The unique ID of the ticket to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/tickets/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Ticket ---
  server.registerTool("gorgias_create_ticket", {
    title: "Create Ticket",
    description: `POST /api/tickets — Create a new support ticket. Requires 'via' and at least one message in the 'messages' array.

Each message in the 'messages' array must include:
- channel (string, required): e.g. 'email', 'chat', 'sms', 'api', etc.
- from_agent (boolean, required): true if sent by an agent, false if by a customer
- via (string, required): e.g. 'email', 'api', 'chat', 'sms', etc.
- body_text (string, optional): plain text body
- body_html (string, optional): HTML body
- public (boolean, optional, default true): false = internal note
- subject (string, optional): message subject
- sender (object, optional): { id, email, name, external_id, language, meta, note, timezone, channels }
- receiver (object, optional): { id, email, name, external_id, language, meta, note, timezone, channels }
- source (object, optional): { type, from: { address, name }, to: [{ address, name }], cc: [...], bcc: [...], extra }
- attachments (array, optional): [{ url, name, content_type, size, public, extra }]
- integration_id (integer, optional): ID of the integration used
- message_id (string, optional): external message ID
- external_id (string, optional): foreign system ID (max 255 chars)
- created_datetime, sent_datetime, failed_datetime, deleted_datetime (ISO 8601, optional)
- mention_ids (array of integers, optional): user IDs to mention in internal notes
- headers (object, optional): key-value message headers
- meta (object, optional): message metadata`,
    inputSchema: {
      via: z.string().describe("How the first message was received or sent from Gorgias. Enum: 'aircall', 'api', 'chat', 'contact_form', 'email', 'facebook', 'facebook-mention', 'facebook-messenger', 'facebook-recommendations', 'form', 'gorgias_chat', 'help-center', 'helpdesk', 'instagram', 'instagram-ad-comment', 'instagram-comment', 'instagram-direct-message', 'instagram-mention', 'internal-note', 'offline_capture', 'phone', 'rule', 'self_service', 'shopify', 'sms', 'twilio', 'twitter', 'twitter-direct-message', 'whatsapp', 'yotpo', 'yotpo-review', 'zendesk'"),
      messages: z.array(z.record(z.string(), z.unknown())).min(1).max(500).describe("Array of message objects composing the ticket (1–500). Each message requires: channel (string), from_agent (boolean), via (string). Optional: body_text, body_html, public, subject, sender, receiver, source, attachments, integration_id, message_id, external_id, created_datetime, sent_datetime, headers, meta, mention_ids."),
      channel: z.string().optional().describe("Channel used to initiate the conversation. Enum: 'aircall', 'api', 'chat', 'contact_form', 'email', 'facebook', 'facebook-mention', 'facebook-messenger', 'facebook-recommendations', 'help-center', 'instagram-ad-comment', 'instagram-comment', 'instagram-direct-message', 'instagram-mention', 'internal-note', 'phone', 'sms', 'twitter', 'twitter-direct-message', 'whatsapp', 'yotpo-review'"),
      subject: z.string().max(998).nullable().optional().describe("Subject of the ticket (max 998 characters)"),
      status: z.enum(["open", "closed"]).optional().describe("Status of the ticket. Default: 'open'"),
      priority: z.enum(["critical", "high", "normal", "low"]).optional().describe("Priority of the ticket. Default: 'normal'"),
      customer: z.object({
        id: z.number().nullable().optional().describe("ID of the customer"),
        email: z.string().max(320).nullable().optional().describe("Primary email of the customer (max 320 chars)"),
        name: z.string().nullable().optional().describe("Name of the customer"),
      }).nullable().optional().describe("Customer associated with the ticket"),
      assignee_user: z.object({
        id: z.number().min(0).nullable().optional().describe("ID of the user to assign (null to unassign)"),
      }).nullable().optional().describe("User assigned to the ticket"),
      assignee_team: z.object({
        id: z.number().min(0).nullable().optional().describe("ID of the team to assign (null to unassign)"),
      }).nullable().optional().describe("Team assigned to the ticket"),
      tags: z.array(z.object({
        name: z.string().min(1).max(256).describe("Name of the tag"),
        decoration: z.object({
          color: z.string().nullable().optional().describe("Hex color code, e.g. '#F58D86'"),
        }).nullable().optional().describe("Visual styling for the tag"),
      })).nullable().optional().describe("Tags associated with the ticket"),
      custom_fields: z.array(z.object({
        id: z.number().describe("ID of the custom field definition"),
        value: z.any().describe("Value of the custom field (type depends on field's data_type: string, number, boolean, or null)"),
      })).nullable().optional().describe("Custom fields associated with the ticket"),
      external_id: z.string().max(255).nullable().optional().describe("ID of the ticket in a foreign system (max 255 chars, not used by Gorgias)"),
      from_agent: z.boolean().nullable().optional().describe("Whether the first message was sent by your company (true) or by a customer (false)"),
      language: z.string().nullable().optional().describe("Language primarily used in the ticket (ISO 639-1). Auto-detected if not set."),
      spam: z.boolean().nullable().optional().describe("Whether the ticket is considered spam. Default: false"),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("Metadata associated with the ticket (arbitrary key-value pairs)"),
      created_datetime: z.string().nullable().optional().describe("When the ticket was created (ISO 8601)"),
      opened_datetime: z.string().nullable().optional().describe("When the ticket was first opened by a user (ISO 8601)"),
      closed_datetime: z.string().nullable().optional().describe("When the ticket was closed (ISO 8601)"),
      trashed_datetime: z.string().nullable().optional().describe("When the ticket was moved to the trash (ISO 8601)"),
      snooze_datetime: z.string().nullable().optional().describe("When the ticket will be re-opened automatically (ISO 8601)"),
      updated_datetime: z.string().nullable().optional().describe("When the ticket was last updated (ISO 8601)"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/tickets", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Ticket ---
  server.registerTool("gorgias_update_ticket", {
    title: "Update Ticket",
    description: "PUT /api/tickets/{id} — Update an existing ticket. Only the fields provided will be updated; omitted fields retain their current values. NOTE: Sending 'tags' replaces ALL existing tags. To modify individual tags use the dedicated tag endpoints. Similarly, 'custom_fields' replaces all existing custom field values.",
    inputSchema: {
      id: z.number().describe("The unique ID of the ticket to update"),
      status: z.enum(["open", "closed"]).optional().describe("Status of the ticket: 'open' or 'closed'"),
      priority: z.enum(["critical", "high", "normal", "low"]).optional().describe("Priority of the ticket: 'critical', 'high', 'normal', or 'low'"),
      subject: z.string().max(998).nullable().optional().describe("Subject line of the ticket (max 998 characters)"),
      channel: z.string().optional().describe("Channel used to initiate the conversation. Enum: 'aircall', 'api', 'chat', 'contact_form', 'email', 'facebook', 'facebook-mention', 'facebook-messenger', 'facebook-recommendations', 'help-center', 'instagram-ad-comment', 'instagram-comment', 'instagram-direct-message', 'instagram-mention', 'internal-note', 'phone', 'sms', 'twitter', 'twitter-direct-message', 'whatsapp', 'yotpo-review'"),
      via: z.string().optional().describe("How the first message was received or sent. Enum: 'aircall', 'api', 'chat', 'contact_form', 'email', 'facebook', 'facebook-mention', 'facebook-messenger', 'facebook-recommendations', 'form', 'gorgias_chat', 'help-center', 'helpdesk', 'instagram', 'instagram-ad-comment', 'instagram-comment', 'instagram-direct-message', 'instagram-mention', 'internal-note', 'offline_capture', 'phone', 'rule', 'self_service', 'shopify', 'sms', 'twilio', 'twitter', 'twitter-direct-message', 'whatsapp', 'yotpo', 'yotpo-review', 'zendesk'"),
      assignee_user: z.object({
        id: z.number().nullable().optional().describe("ID of the user to assign. Set to null to unassign."),
      }).nullable().optional().describe("User assigned to the ticket. Send {id: null} to unassign."),
      assignee_team: z.object({
        id: z.number().nullable().optional().describe("ID of the team to assign. Set to null to unassign."),
      }).nullable().optional().describe("Team assigned to the ticket. Send {id: null} to unassign."),
      customer: z.object({
        id: z.number().nullable().optional().describe("ID of the customer"),
        email: z.string().max(320).nullable().optional().describe("Primary email of the customer (max 320 chars)"),
        name: z.string().nullable().optional().describe("Name of the customer"),
      }).nullable().optional().describe("Customer linked to the ticket"),
      tags: z.array(z.object({
        name: z.string().max(256).describe("Name of the tag"),
        decoration: z.object({
          color: z.string().nullable().optional().describe("Hex color code for the tag"),
        }).nullable().optional().describe("Visual decoration for the tag"),
      })).nullable().optional().describe("Tags to associate with the ticket. WARNING: This REPLACES all existing tags. Use dedicated tag endpoints to add/remove individual tags."),
      custom_fields: z.array(z.object({
        id: z.number().describe("ID of the custom field definition"),
        value: z.any().describe("Value of the custom field (string, number, boolean, or null to clear)"),
      })).nullable().optional().describe("Custom field values. WARNING: This replaces existing custom field values."),
      spam: z.boolean().optional().describe("Whether the ticket is considered spam"),
      from_agent: z.boolean().nullable().optional().describe("Whether the first message was sent by your company (true) or a customer (false)"),
      language: z.string().nullable().optional().describe("Language primarily used in the ticket (e.g. 'en', 'fr')"),
      external_id: z.string().max(255).nullable().optional().describe("ID of the ticket in a foreign system (max 255 chars)"),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("Structured metadata about the ticket (key-value pairs)"),
      snooze_datetime: z.string().nullable().optional().describe("When the ticket will auto-reopen (ISO 8601). Set to null to cancel snooze."),
      closed_datetime: z.string().nullable().optional().describe("When the ticket was closed (ISO 8601). Setting this closes the ticket."),
      trashed_datetime: z.string().nullable().optional().describe("When the ticket was trashed (ISO 8601). Set to null to restore from trash."),
      opened_datetime: z.string().nullable().optional().describe("When the ticket was first opened (ISO 8601)"),
      created_datetime: z.string().nullable().optional().describe("When the ticket was created — can be used to backdate (ISO 8601)"),
      updated_datetime: z.string().nullable().optional().describe("When the ticket was last updated (ISO 8601)"),
      last_message_datetime: z.string().nullable().optional().describe("When the last message was sent (ISO 8601)"),
      last_received_message_datetime: z.string().nullable().optional().describe("When the last customer message was sent (ISO 8601)"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/tickets/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Ticket ---
  server.registerTool("gorgias_delete_ticket", {
    title: "Delete Ticket",
    description: "DELETE /api/tickets/{id} — Permanently delete a ticket by ID. This is irreversible and also removes all associated messages, tags, and custom field values. Consider using trashed_datetime via Update Ticket for a soft-delete instead.",
    inputSchema: {
      id: z.number().describe("The unique ID of the ticket to permanently delete"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/tickets/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- List Ticket Tags ---
  server.registerTool("gorgias_list_ticket_tags", {
    title: "List Ticket Tags",
    description: "GET /api/tickets/{ticket_id}/tags — List all tags currently associated with a specific ticket. Returns a direct JSON array (not paginated). Each tag includes id, name, description, decoration, usage count, uri, and timestamps.",
    inputSchema: {
      ticket_id: z.number().describe("The unique ID of the ticket whose tags to list"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id }) => {
    const result = await client.get(`/api/tickets/${ticket_id}/tags`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Add Ticket Tags ---
  server.registerTool("gorgias_add_ticket_tags", {
    title: "Add Ticket Tags",
    description: "POST /api/tickets/{ticket_id}/tags — Add one or more tags to a ticket. This is additive — existing tags are preserved. Tags can be specified by IDs, names, or both. At least one of 'ids' or 'names' must be provided. Returns 201 with empty body on success.",
    inputSchema: z.object({
      ticket_id: z.number().describe("The unique ID of the ticket to add tags to"),
      ids: z.array(z.number()).optional().describe("Array of tag IDs to add to the ticket"),
      names: z.array(z.string()).optional().describe("Array of tag names to add to the ticket (case-sensitive)"),
    }).refine(
      (data) => (data.ids && data.ids.length > 0) || (data.names && data.names.length > 0),
      { message: "At least one of 'ids' or 'names' must be provided" }
    ),
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, ...body }) => {
    const result = await client.post(`/api/tickets/${ticket_id}/tags`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Set Ticket Tags ---
  server.registerTool("gorgias_set_ticket_tags", {
    title: "Set Ticket Tags",
    description: "PUT /api/tickets/{ticket_id}/tags — Replace the complete list of tags on a ticket. This is destructive — all existing tags not included in the request are removed. To clear all tags, send an empty body {}. Tags can be specified by IDs, names, or both. Returns 202 with empty body on success.",
    inputSchema: {
      ticket_id: z.number().describe("The unique ID of the ticket whose tags will be replaced"),
      ids: z.array(z.number()).optional().describe("Array of tag IDs that should be set on the ticket after this operation"),
      names: z.array(z.string()).optional().describe("Array of tag names that should be set on the ticket after this operation (case-sensitive)"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, ...body }) => {
    const result = await client.put(`/api/tickets/${ticket_id}/tags`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Remove Ticket Tags ---
  server.registerTool("gorgias_remove_ticket_tags", {
    title: "Remove Ticket Tags",
    description: "DELETE /api/tickets/{ticket_id}/tags — Remove specific tags from a ticket. Only the specified tags are removed; other tags remain. Tags can be specified by IDs, names, or both. At least one of 'ids' or 'names' must be provided. Returns 204 with empty body on success.",
    inputSchema: z.object({
      ticket_id: z.number().describe("The unique ID of the ticket to remove tags from"),
      ids: z.array(z.number()).optional().describe("Array of tag IDs to remove from the ticket"),
      names: z.array(z.string()).optional().describe("Array of tag names to remove from the ticket (case-sensitive)"),
    }).refine(
      (data) => (data.ids && data.ids.length > 0) || (data.names && data.names.length > 0),
      { message: "At least one of 'ids' or 'names' must be provided" }
    ),
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, ...body }) => {
    const result = await client.delete(`/api/tickets/${ticket_id}/tags`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- List Ticket Custom Field Values ---
  server.registerTool("gorgias_list_ticket_fields", {
    title: "List Ticket Custom Field Values",
    description: "GET /api/tickets/{ticket_id}/custom-fields — List all custom field values currently assigned to a specific ticket. Returns a direct JSON array. Each item has an 'id' (field value record ID, used for update/delete) and 'value'. For full field definitions (labels, types), use GET /api/custom-fields.",
    inputSchema: {
      ticket_id: z.number().describe("The unique ID of the ticket whose custom field values to list"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id }) => {
    const result = await client.get(`/api/tickets/${ticket_id}/custom-fields`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Single Ticket Custom Field Value ---
  server.registerTool("gorgias_update_ticket_field", {
    title: "Update Ticket Custom Field Value",
    description: "PUT /api/tickets/{ticket_id}/custom-fields/{id} — Update the value of a single custom field on a ticket. The path 'id' is the field VALUE RECORD ID (from GET /api/tickets/{id}/custom-fields). The body 'id' is the CUSTOM FIELD DEFINITION ID (from GET /api/custom-fields). Value type must match the field's data_type: string for 'text', number for 'number', boolean for 'boolean'. Pass null to clear the value.",
    inputSchema: {
      ticket_id: z.number().describe("The unique ID of the ticket containing the custom field value to update"),
      id: z.number().describe("The field value record ID on the ticket (obtained from GET /api/tickets/{ticket_id}/custom-fields)"),
      definition_id: z.number().describe("The custom field DEFINITION ID (from GET /api/custom-fields). This is sent as 'id' in the request body."),
      value: z.any().describe("The new value to assign. Type must match field's data_type: string (text), number (number), boolean (boolean). Pass null to clear."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, id, definition_id, value }) => {
    const result = await client.put(`/api/tickets/${ticket_id}/custom-fields/${id}`, {
      id: definition_id,
      value,
    });
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Bulk Update Ticket Custom Field Values ---
  server.registerTool("gorgias_update_ticket_fields", {
    title: "Update Ticket Custom Field Values (Bulk)",
    description: "PUT /api/tickets/{ticket_id}/custom-fields — Update multiple custom field values on a ticket in a single request. Each item in the 'fields' array requires 'id' (the CUSTOM FIELD DEFINITION ID from GET /api/custom-fields) and 'value'. Fields not included are left unchanged. Returns array of updated field value objects (each with value-record 'id' and 'value').",
    inputSchema: {
      ticket_id: z.number().describe("The unique ID of the ticket whose custom field values are being updated"),
      fields: z.array(z.object({
        id: z.number().describe("The custom field DEFINITION ID (from GET /api/custom-fields)"),
        value: z.any().describe("The new value. Type must match field's data_type: string (text), number (number), boolean (boolean). Pass null to clear."),
      })).min(1).describe("Array of custom field updates. Each item needs 'id' (definition ID) and 'value'. The request body sent to the API is this array directly."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, fields }) => {
    const result = await client.put(`/api/tickets/${ticket_id}/custom-fields`, fields);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Ticket Custom Field Value ---
  server.registerTool("gorgias_delete_ticket_field", {
    title: "Delete Ticket Custom Field Value",
    description: "DELETE /api/tickets/{ticket_id}/custom-fields/{id} — Remove a custom field value from a ticket. This removes the value assignment on the ticket — it does NOT delete the custom field definition. The path 'id' is the field VALUE RECORD ID (from GET /api/tickets/{ticket_id}/custom-fields), not the definition ID. Returns 204 No Content on success.",
    inputSchema: {
      ticket_id: z.number().describe("The unique ID of the ticket whose custom field value to delete"),
      id: z.number().describe("The field value record ID on the ticket (obtained from GET /api/tickets/{ticket_id}/custom-fields)"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, id }) => {
    const result = await client.delete(`/api/tickets/${ticket_id}/custom-fields/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
