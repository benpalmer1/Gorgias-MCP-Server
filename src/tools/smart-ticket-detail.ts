import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { projectTicket, projectMessage, sortMessagesChronologically } from "../projection.js";
import { sanitiseErrorForLLM } from "../error-sanitiser.js";
import { GorgiasApiError } from "../errors.js";
import { safeHandler } from "../tool-handler.js";
import { fetchAllPages } from "../cache.js";
import { idSchema } from "./_id.js";

const DEFAULT_MAX_MESSAGES = 1000;
const HARD_CAP_MAX_MESSAGES = 5000;

export function registerSmartTicketDetailTools(server: McpServer, client: GorgiasClient) {
  server.registerTool("gorgias_smart_get_ticket", {
    title: "Smart Get Ticket",
    description:
      "Retrieve a ticket with its full conversation thread, projected to a clean format optimised for LLM consumption. " +
      "Auto-paginates the messages endpoint up to max_messages (default 1000) so long conversations are returned in full. " +
      "If the ticket has more messages than max_messages, the response will include truncated=true. " +
      "Messages are sorted chronologically (oldest first). Use gorgias_smart_search to find tickets first. " +
      "For raw API data, use gorgias_get_ticket instead.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the ticket to retrieve with its full conversation"),
      max_messages: z.number().int().min(1).max(HARD_CAP_MAX_MESSAGES).optional().describe(
        `Maximum number of messages to fetch (default ${DEFAULT_MAX_MESSAGES}, hard cap ${HARD_CAP_MAX_MESSAGES}). ` +
        `Long-running tickets with more messages than this cap will return truncated=true. ` +
        `Lower this for cheap recall on tickets you only need a summary of; raise it for full audit history.`,
      ),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, max_messages }) => {
    const messageCap = max_messages ?? DEFAULT_MAX_MESSAGES;

    try {
      // Parallel fetch ticket + paginated messages
      const [ticketRaw, messagesResult] = await Promise.all([
        client.get(`/api/tickets/${id}`),
        fetchAllPages(client, `/api/tickets/${id}/messages`, { maxItems: messageCap }),
      ]);

      const messages = messagesResult.items as any[];
      const truncated = messagesResult.truncated;
      const pagesFetched = messagesResult.pagesFetched;

      // Sort messages chronologically (oldest first)
      const sorted = sortMessagesChronologically(messages);

      // Project messages
      const projectedMessages = sorted.map(projectMessage);

      // Use actual fetched count, not potentially stale ticket.messages_count
      const ticket = projectTicket(ticketRaw, projectedMessages.length);

      // Build _hint
      const noteCount = projectedMessages.filter(m => m.isInternalNote).length;
      let hint = `Ticket #${ticket.id}: "${ticket.subject ?? "(no subject)"}". `;
      if (truncated) {
        hint += `PARTIAL CONVERSATION — ${projectedMessages.length} message(s) shown (oldest first), but the ticket has more messages than the cap of ${messageCap}. `;
        hint += `If you need the full history, retry with a higher max_messages (up to ${HARD_CAP_MAX_MESSAGES}). `;
      } else {
        hint += `${projectedMessages.length} message(s) shown chronologically (oldest first). `;
      }
      hint += `Present as a threaded conversation — show sender name, whether agent or customer, and message text. `;
      if (noteCount > 0) {
        hint += `${noteCount} message(s) are internal notes (isInternalNote=true) — these are agent-to-agent and were not seen by the customer. `;
      }
      hint += `Status: ${ticket.status}, Priority: ${ticket.priority}.`;

      const result: Record<string, unknown> = {
        ticket,
        messages: projectedMessages,
        _hint: hint,
      };
      if (truncated) {
        result.truncated = true;
        result.truncatedReason = `max_messages cap of ${messageCap} reached`;
        result.pagesFetched = pagesFetched;
      }

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
