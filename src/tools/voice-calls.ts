import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerVoiceCallTools(server: McpServer, client: GorgiasClient) {

  // --- List Voice Calls ---
  server.registerTool("gorgias_list_voice_calls", {
    title: "List Voice Calls",
    description: "GET /api/phone/voice-calls — List voice calls matching the given parameters, paginated, and ordered.",
    inputSchema: {
      limit: z.number().optional().describe("Maximum number of voice call records to return per page"),
      offset: z.number().optional().describe("Number of records to skip before returning results (offset-based pagination)"),
      cursor: z.string().optional().describe("Cursor value for cursor-based pagination (use next_cursor or prev_cursor from a previous response)"),
      order_by: z.string().optional().describe("Field name to order results by"),
      direction: z.enum(["inbound", "outbound"]).optional().describe("Filter by call direction: 'inbound' or 'outbound'"),
      status: z.string().optional().describe("Filter by call status"),
      ticket_id: z.number().optional().describe("Filter voice calls belonging to a specific ticket"),
      customer_id: z.number().optional().describe("Filter voice calls associated with a specific customer"),
      queue_id: z.number().optional().describe("Filter voice calls managed by a specific voice queue"),
      phone_number_id: z.number().optional().describe("Filter voice calls associated with a specific phone number"),
      integration_id: z.number().optional().describe("Filter voice calls managed by a specific voice integration"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/phone/voice-calls", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Voice Call ---
  server.registerTool("gorgias_get_voice_call", {
    title: "Get Voice Call",
    description: "GET /api/phone/voice-calls/{id} — Retrieve a single voice call by its unique ID.",
    inputSchema: {
      id: z.number().describe("The ID of the voice call to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/phone/voice-calls/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- List Voice Call Events ---
  server.registerTool("gorgias_list_voice_call_events", {
    title: "List Voice Call Events",
    description: "GET /api/phone/voice-call-events — List voice call events matching the given parameters, paginated, and ordered. Events represent discrete occurrences during the lifecycle of voice calls.",
    inputSchema: {
      limit: z.number().optional().describe("Maximum number of records to return per page (default: 30)"),
      cursor: z.string().optional().describe("Pagination cursor for fetching the next or previous page"),
      order_by: z.string().optional().describe("Field and direction to sort results (e.g., '-created_datetime')"),
      call_id: z.number().optional().describe("Filter events to those belonging to a specific voice call"),
      account_id: z.number().optional().describe("Filter events to those belonging to a specific account"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/phone/voice-call-events", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Voice Call Event ---
  server.registerTool("gorgias_get_voice_call_event", {
    title: "Get Voice Call Event",
    description: "GET /api/phone/voice-call-events/{id} — Retrieve a single voice call event by its unique identifier.",
    inputSchema: {
      id: z.number().describe("The unique identifier of the voice call event to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/phone/voice-call-events/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- List Voice Call Recordings ---
  server.registerTool("gorgias_list_voice_call_recordings", {
    title: "List Voice Call Recordings",
    description: "GET /api/phone/voice-call-recordings — List voice call recordings (voicemails and call recordings) matching the given parameters, paginated, and ordered.",
    inputSchema: {
      limit: z.number().optional().describe("Maximum number of records to return per page (default: 30)"),
      cursor: z.string().optional().describe("Pagination cursor for fetching the next or previous page"),
      order_by: z.string().optional().describe("Field and direction to sort results (e.g., '-created_datetime')"),
      call_id: z.number().optional().describe("Filter recordings to those belonging to a specific voice call"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/phone/voice-call-recordings", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Voice Call Recording ---
  server.registerTool("gorgias_get_voice_call_recording", {
    title: "Get Voice Call Recording",
    description: "GET /api/phone/voice-call-recordings/{id} — Retrieve a single voice call recording or voicemail by its unique identifier.",
    inputSchema: {
      id: z.number().describe("The unique identifier of the voice call recording to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/phone/voice-call-recordings/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Delete Voice Call Recording ---
  server.registerTool("gorgias_delete_voice_call_recording", {
    title: "Delete Voice Call Recording",
    description: "DELETE /api/phone/voice-call-recordings/{id} — Permanently delete a voice call recording or voicemail. Returns the deleted recording object with deleted_datetime and deleted_by_user_id populated.",
    inputSchema: {
      id: z.number().describe("The unique identifier of the voice call recording to delete"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/phone/voice-call-recordings/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
