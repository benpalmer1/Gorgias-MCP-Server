import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";
import { idSchema, cursorSchema } from "./_id.js";

export function registerTicketMessageTools(server: McpServer, client: GorgiasClient) {

  // --- List Ticket Messages (deprecated endpoint, per-ticket) ---
  server.registerTool("gorgias_list_ticket_messages", {
    title: "List Ticket Messages",
    description: "GET /api/tickets/{ticket_id}/messages — List raw messages for a ticket. For a clean, projected conversation view with chronological sorting and internal note detection, use gorgias_smart_get_ticket instead. NOTE: This endpoint is deprecated; prefer gorgias_list_messages with ticket_id filter for pagination support.",
    inputSchema: {
      ticket_id: idSchema.describe("The unique ID of the ticket whose messages to list"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id }) => {
    const result = await client.get(`/api/tickets/${ticket_id}/messages`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- List Messages (cross-ticket, cursor-paginated) ---
  server.registerTool("gorgias_list_messages", {
    title: "List Messages",
    description: "GET /api/messages — List messages across all tickets with cursor-based pagination. Optionally filter to a specific ticket with ticket_id. Results ordered by created_datetime descending by default.",
    inputSchema: {
      cursor: cursorSchema.optional().describe("Pagination cursor from a previous response's meta.next_cursor or meta.prev_cursor. Omit to start from the first page."),
      limit: z.number().min(1).max(100).optional().describe("Maximum number of messages to return per page (default: 30, max: 100)"),
      order_by: z.enum(["created_datetime:asc", "created_datetime:desc"]).optional().describe("Sort order for messages (default: created_datetime:desc)"),
      ticket_id: idSchema.optional().describe("Filter messages to those belonging to a specific ticket ID"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/messages", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Message ---
  server.registerTool("gorgias_get_message", {
    title: "Get Message",
    description: "GET /api/tickets/{ticket_id}/messages/{id} — Retrieve a single message by its ID within a specific ticket. Returns the full TicketMessage object including content, sender/receiver details, attachments, timestamps, and metadata.",
    inputSchema: {
      ticket_id: idSchema.describe("The unique ID of the ticket that contains the message"),
      id: idSchema.describe("The unique ID of the message to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, id }) => {
    const result = await client.get(`/api/tickets/${ticket_id}/messages/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Message ---
  server.registerTool("gorgias_create_message", {
    title: "Create Message",
    description: "POST /api/tickets/{ticket_id}/messages — Create a new message on an existing ticket. Supports three use cases: (1) Send to customer — omit sent_datetime, Gorgias sends asynchronously; (2) Import already-sent message — provide sent_datetime; (3) Internal note — set channel to 'internal-note' and public to false.",
    inputSchema: {
      // Path parameter
      ticket_id: idSchema.describe("The ID of the ticket to add the message to"),
      // Query parameter
      action: z.enum(["force", "retry", "cancel"]).optional().describe("Controls behavior when an external send action fails: 'force' bypasses the failure, 'retry' retries it, 'cancel' cancels it"),
      // Required body fields
      channel: z.enum([
        "aircall", "api", "chat", "contact_form", "email",
        "facebook", "facebook-mention", "facebook-messenger", "facebook-recommendations",
        "help-center", "instagram-ad-comment", "instagram-comment", "instagram-direct-message",
        "instagram-mention", "internal-note", "phone", "sms", "twitter",
        "twitter-direct-message", "whatsapp", "yotpo-review",
      ]).describe("Channel used to send the message. Use 'internal-note' for agent-only notes."),
      from_agent: z.boolean().describe("true if sent by your company (agent), false if sent by a customer"),
      via: z.enum([
        "aircall", "api", "chat", "contact_form", "email",
        "facebook", "facebook-mention", "facebook-messenger", "facebook-recommendations",
        "form", "gorgias_chat", "help-center", "helpdesk", "instagram",
        "instagram-ad-comment", "instagram-comment", "instagram-direct-message",
        "instagram-mention", "internal-note", "offline_capture", "phone", "rule",
        "self_service", "shopify", "sms", "twilio", "twitter",
        "twitter-direct-message", "whatsapp", "yotpo", "yotpo-review", "zendesk",
      ]).describe("How the message was received or sent from Gorgias (e.g. 'api', 'email', 'helpdesk')"),
      // Optional body fields
      body_text: z.string().nullable().optional().describe("Plain-text message body"),
      body_html: z.string().nullable().optional().describe("HTML-formatted message body"),
      subject: z.string().nullable().optional().describe("Message subject line (primarily for email)"),
      public: z.boolean().optional().describe("Whether the message is visible to customers. Set to false for internal notes (default: true)"),
      message_id: z.string().nullable().optional().describe("ID of the message on the originating external service (e.g. email Message-ID header)"),
      external_id: z.string().nullable().optional().describe("ID of the message in a foreign system (max 255 chars). Not used by Gorgias."),
      integration_id: idSchema.nullable().optional().describe("ID of the integration used to send the message (must be > 0)"),
      sent_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the message was sent. If omitted, Gorgias will send it and populate this field. Providing a value imports the message as already-sent."),
      created_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the message was created"),
      deleted_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the message was deleted"),
      failed_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the send attempt failed"),
      opened_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the recipient viewed the message"),
      stripped_text: z.string().nullable().optional().describe("Plain-text body with signatures and prior replies removed"),
      stripped_html: z.string().nullable().optional().describe("HTML body with signatures and prior replies removed"),
      stripped_signature: z.string().nullable().optional().describe("Extracted signature portion of the message"),
      mention_ids: z.array(idSchema).nullable().optional().describe("List of User IDs to mention in an internal note. Only valid for internal-note messages."),
      source: z.record(z.string(), z.unknown()).nullable().optional().describe("Routing details for the message. Object with fields: type (TicketMessageSourceType string), from (object with address and name), to (array of address objects), cc (array), bcc (array), extra. Example: {\"type\": \"email\", \"from\": {\"address\": \"sender@example.com\", \"name\": \"Sender\"}, \"to\": [{\"address\": \"receiver@example.com\", \"name\": \"Receiver\"}]}"),
      sender: z.record(z.string(), z.unknown()).nullable().optional().describe("The message originator (user or customer). Object with optional fields: id (integer >= 0), email (string <= 320 chars), name, external_id, channels (array of {type, address}), language, timezone, meta, note. Example: {\"id\": 93, \"email\": \"agent@example.com\"}"),
      receiver: z.record(z.string(), z.unknown()).nullable().optional().describe("The primary message recipient (user or customer). Optional for internal notes. Same schema as sender: id, email, name, external_id, channels, language, timezone, meta, note. Example: {\"id\": 8, \"email\": \"customer@example.com\"}"),
      attachments: z.array(z.record(z.string(), z.unknown())).nullable().optional().describe("Files to attach. Each item: url (required URI), name (required), content_type (required MIME type), size (bytes), public (boolean, default true), extra."),
      headers: z.record(z.string(), z.unknown()).nullable().optional().describe("Message headers as key-value pairs (primarily for email). Example: {\"X-Custom-Header\": \"value\"}"),
      macros: z.array(z.record(z.string(), z.unknown())).nullable().optional().describe("Macros to apply. Each item must have an id field (integer > 0). Example: [{\"id\": 42}]"),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("Custom structured metadata. Reserved keys: current_page, relevant_content_indexes, is_quick_reply, campaigns, campaigns_id, self_service_flow."),
      last_sending_error: z.record(z.string(), z.unknown()).nullable().optional().describe("Details of a known sending error. Object with an 'error' string field describing the transmission error."),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, action, ...body }) => {
    const result = await client.post(
      `/api/tickets/${ticket_id}/messages`,
      body,
      action ? { action } : undefined
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Message ---
  server.registerTool("gorgias_update_message", {
    title: "Update Message",
    description: "PUT /api/tickets/{ticket_id}/messages/{id} — Update an existing ticket message. channel, from_agent, and via are required. Returns 202 Accepted with the full updated TicketMessage object. Use the action query param to handle recovery from failed external actions.",
    inputSchema: {
      // Path parameters
      ticket_id: idSchema.describe("The ID of the ticket associated with the message"),
      id: idSchema.describe("The ID of the message to update"),
      // Query parameter
      action: z.enum(["force", "retry", "cancel"]).optional().describe("Policy for failed external actions: 'force' bypasses and continues, 'retry' retries the failed action, 'cancel' deletes the message"),
      // Required body fields
      channel: z.enum([
        "aircall", "api", "chat", "contact_form", "email",
        "facebook", "facebook-mention", "facebook-messenger", "facebook-recommendations",
        "help-center", "instagram-ad-comment", "instagram-comment", "instagram-direct-message",
        "instagram-mention", "internal-note", "phone", "sms", "twitter",
        "twitter-direct-message", "whatsapp", "yotpo-review",
      ]).describe("The channel used to send the message"),
      from_agent: z.boolean().describe("true if the message was sent by your company (agent), false if sent by a customer"),
      via: z.enum([
        "aircall", "api", "chat", "contact_form", "email",
        "facebook", "facebook-mention", "facebook-messenger", "facebook-recommendations",
        "form", "gorgias_chat", "help-center", "helpdesk", "instagram",
        "instagram-ad-comment", "instagram-comment", "instagram-direct-message",
        "instagram-mention", "internal-note", "offline_capture", "phone", "rule",
        "self_service", "shopify", "sms", "twilio", "twitter",
        "twitter-direct-message", "whatsapp", "yotpo", "yotpo-review", "zendesk",
      ]).describe("How the message was received or sent from Gorgias"),
      // Optional body fields
      public: z.boolean().optional().describe("Whether the message is visible to customers. Set to false for internal notes."),
      body_html: z.string().nullable().optional().describe("The full HTML version of the message body"),
      body_text: z.string().nullable().optional().describe("The full plain-text version of the message body"),
      external_id: z.string().nullable().optional().describe("ID of the message in a foreign system (Aircall, Zendesk, etc.)"),
      integration_id: idSchema.nullable().optional().describe("ID of the integration used to send the message"),
      failed_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the message failed to be sent"),
      message_id: z.string().nullable().optional().describe("ID of the message on the originating service (email ID, Messenger message ID, etc.)"),
      receiver: z.record(z.string(), z.unknown()).nullable().optional().describe("The primary receiver of the message (user or customer). Optional for internal notes. Object with id (integer) and/or email (string). Example: {\"id\": 8} or {\"email\": \"john@example.com\"}"),
      sender: z.record(z.string(), z.unknown()).nullable().optional().describe("The person who sent the message (user or customer). Object with id (integer) and/or email (string). Example: {\"id\": 93}"),
      sent_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the message was sent. If omitted, Gorgias manages the send lifecycle."),
      source: z.record(z.string(), z.unknown()).nullable().optional().describe("Routing information for the message. Object with fields: type (string, e.g. 'email'), from ({address, name}), to ([{address, name}]), cc ([{address, name}]), bcc ([{address, name}]). Example: {\"type\": \"email\", \"from\": {\"address\": \"sender@example.com\", \"name\": \"Sender Doe\"}, \"to\": [{\"address\": \"receiver@example.com\", \"name\": \"Receiver Doe\"}]}"),
      subject: z.string().nullable().optional().describe("The subject line of the message"),
      mention_ids: z.array(idSchema).nullable().optional().describe("List of User IDs to mention in an internal note"),
      attachments: z.array(z.record(z.string(), z.unknown())).nullable().optional().describe("List of file attachments. Each item: url (required), content_type (required), name (required), size (integer|null), public (boolean), extra (object)."),
      headers: z.record(z.string(), z.unknown()).nullable().optional().describe("Message headers as key-value pairs (primarily for email)"),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("Custom structured metadata"),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, id, action, ...body }) => {
    const result = await client.put(
      `/api/tickets/${ticket_id}/messages/${id}`,
      body,
      action ? { action } : undefined
    );
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Message ---
  server.registerTool("gorgias_delete_message", {
    title: "Delete Message",
    description: "DELETE /api/tickets/{ticket_id}/messages/{id} — Permanently delete a specific message from a ticket. Deletion is irreversible. The parent ticket is not deleted. Returns 200 OK with an empty body on success.",
    inputSchema: {
      ticket_id: idSchema.describe("The unique ID of the ticket that contains the message to delete"),
      id: idSchema.describe("The unique ID of the message to delete"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ ticket_id, id }) => {
    const result = await client.delete(`/api/tickets/${ticket_id}/messages/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
