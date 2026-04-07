import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerVoiceCallTools(server: McpServer, client: GorgiasClient) {

  // --- List Voice Calls ---
  server.registerTool("gorgias_list_voice_calls", {
    title: "List Voice Calls",
    description: "GET /api/phone/voice-calls — List voice calls, cursor-paginated. Per the Gorgias API spec, this endpoint accepts only cursor, limit, and ticket_id as query parameters.",
    inputSchema: {
      cursor: z.string().optional().describe("Cursor value for pagination (use next_cursor or prev_cursor from a previous response)"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of voice call records to return per page (1-100, default 30)"),
      ticket_id: z.number().int().optional().describe("Filter voice calls belonging to a specific ticket"),
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
    description: "GET /api/phone/voice-call-events — List voice call events, cursor-paginated. Events represent discrete occurrences during the lifecycle of voice calls. Per the Gorgias API spec, this endpoint accepts only cursor, limit, and call_id.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor for fetching the next or previous page"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of records to return per page (1-100, default 30)"),
      call_id: z.number().int().optional().describe("Filter events to those belonging to a specific voice call"),
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
    description: "GET /api/phone/voice-call-recordings — List voice call recordings (voicemails and call recordings), cursor-paginated. Per the Gorgias API spec, this endpoint accepts only cursor, limit, and call_id.",
    inputSchema: {
      cursor: z.string().optional().describe("Pagination cursor for fetching the next or previous page"),
      limit: z.number().int().min(1).max(100).optional().describe("Maximum number of records to return per page (1-100, default 30)"),
      call_id: z.number().int().optional().describe("Filter recordings to those belonging to a specific voice call"),
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
    description: "DELETE /api/phone/voice-call-recordings/{id} — Permanently delete a voice call recording or voicemail. Returns 204 No Content on success.",
    inputSchema: {
      id: z.number().describe("The unique identifier of the voice call recording to delete"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/phone/voice-call-recordings/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
