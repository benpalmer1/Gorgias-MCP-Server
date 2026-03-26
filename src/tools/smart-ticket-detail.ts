import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { projectTicket, projectMessage, sortMessagesChronologically } from "../projection.js";
import { sanitiseErrorForLLM } from "../error-sanitiser.js";
import { GorgiasApiError } from "../errors.js";
import { safeHandler } from "../tool-handler.js";

export function registerSmartTicketDetailTools(server: McpServer, client: GorgiasClient) {
  server.registerTool("gorgias_smart_get_ticket", {
    title: "Smart Get Ticket",
    description:
      "Retrieve a ticket with its full conversation thread, projected to a clean format optimised for LLM consumption. Fetches ticket and messages in parallel. Messages are sorted chronologically and stripped to essential fields. Use gorgias_smart_search to find tickets first. For raw API data, use gorgias_get_ticket instead.",
    inputSchema: {
      id: z.number().int().min(1).describe("The unique ID of the ticket to retrieve with its full conversation"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    try {
      // Parallel fetch ticket + messages
      const [ticketRaw, messagesRaw] = await Promise.all([
        client.get(`/api/tickets/${id}`),
        client.get(`/api/tickets/${id}/messages`),
      ]);

      // Extract messages array — the messages endpoint returns { data: [...] } OR direct array
      let messages: any[];
      if (Array.isArray(messagesRaw)) {
        messages = messagesRaw;
      } else if (messagesRaw && typeof messagesRaw === "object" && "data" in messagesRaw) {
        messages = (messagesRaw as any).data ?? [];
      } else {
        messages = [];
      }

      // Sort messages chronologically (oldest first)
      const sorted = sortMessagesChronologically(messages);

      // Project messages
      const projectedMessages = sorted.map(projectMessage);

      // Use actual fetched count, not potentially stale ticket.messages_count
      const ticket = projectTicket(ticketRaw, projectedMessages.length);

      // Build _hint
      const noteCount = projectedMessages.filter(m => m.isInternalNote).length;
      let hint = `Ticket #${ticket.id}: "${ticket.subject ?? "(no subject)"}". `;
      hint += `${projectedMessages.length} message(s) shown chronologically (oldest first). `;
      hint += `Present as a threaded conversation — show sender name, whether agent or customer, and message text. `;
      if (noteCount > 0) {
        hint += `${noteCount} message(s) are internal notes (isInternalNote=true) — these are agent-to-agent and were not seen by the customer. `;
      }
      hint += `Status: ${ticket.status}, Priority: ${ticket.priority}.`;

      const result = {
        ticket,
        messages: projectedMessages,
        _hint: hint,
      };

      return {
        content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }],
      };
    } catch (err) {
      const safeError = sanitiseErrorForLLM(err);
      let hint = "Failed to retrieve ticket details. Verify the ticket ID is correct.";
      if (err instanceof GorgiasApiError) {
        if (err.statusCode === 404) {
          hint = `Ticket #${id} does not exist. Verify the ticket ID is correct.`;
        } else if (err.statusCode === 429) {
          hint = `Rate limited by Gorgias API. ${err.retryAfter ? `Retry after ${err.retryAfter} seconds.` : "Please wait before retrying."}`;
        }
      }
      return {
        content: [{ type: "text" as const, text: JSON.stringify({ error: safeError, _hint: hint }, null, 2) }],
        isError: true,
      };
    }
  }));
}
