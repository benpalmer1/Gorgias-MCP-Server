import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";
import { idSchema, cursorSchema } from "./_id.js";

export function registerJobTools(server: McpServer, client: GorgiasClient) {

  // --- List Jobs ---
  server.registerTool("gorgias_list_jobs", {
    title: "List Jobs",
    description: "GET /api/jobs — List all jobs with optional filtering by status/type and cursor-based pagination. Results are ordered by created_datetime descending.",
    inputSchema: {
      cursor: cursorSchema.optional().describe("Pagination cursor from a previous response (opaque Base64 token)"),
      limit: z.number().optional().describe("Max number of job records to return per page (default: 30)"),
      order_by: z.enum(["created_datetime:asc", "created_datetime:desc"]).optional().describe("Sort order for results."),
      status: z.enum(["pending", "scheduled", "running", "done", "cancel_requested", "canceled", "errored", "fatal_errored"]).optional().describe("Filter jobs by status"),
      type: z.enum(["applyMacro", "deleteTicket", "exportTicket", "exportMacro", "importMacro", "updateTicket", "exportTicketDrilldown", "exportConvertCampaignSalesDrilldown"]).optional().describe("Filter jobs by type"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.get("/api/jobs", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Get Job ---
  server.registerTool("gorgias_get_job", {
    title: "Get Job",
    description: "GET /api/jobs/{id} — Retrieve a single job by its unique ID. Returns full Job object including status, type, params, info (progress), and all timestamps.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the job to retrieve"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.get(`/api/jobs/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Create Job ---
  server.registerTool("gorgias_create_job", {
    title: "Create Job",
    description: "POST /api/jobs — Create a new asynchronous job. Jobs run in the background for long-running tasks such as bulk ticket updates, macro application, exports, and imports.",
    inputSchema: {
      type: z.enum(["applyMacro", "deleteTicket", "exportTicket", "exportMacro", "importMacro", "updateTicket", "exportTicketDrilldown", "exportConvertCampaignSalesDrilldown"]).describe("The type of job to create"),
      scheduled_datetime: z.string().nullable().optional().describe("ISO 8601 datetime to schedule the job (max 60 minutes in the future). If omitted or null, queued for immediate execution."),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("Arbitrary key-value metadata to attach to the job (not used by Gorgias). Pass null to clear."),
      params: z.object({
        apply_and_close: z.boolean().optional().describe("If true, applies the macro and closes the ticket simultaneously. Used with applyMacro type."),
        macro_id: idSchema.optional().describe("ID of the macro to apply. Used with applyMacro type."),
        ticket_ids: z.array(idSchema).optional().describe("List of specific ticket IDs to operate on."),
        view_id: idSchema.optional().describe("ID of an existing saved view to use for ticket selection."),
        view: z.object({
          filters: z.string().describe("Filter expression string, e.g. 'eq(ticket.status, \"open\")'"),
        }).optional().describe("Inline view definition used to select tickets."),
        updates: z.record(z.string(), z.unknown()).optional().describe("Key-value map of ticket fields to update. Used with updateTicket type. Example: {\"status\": \"open\"}."),
        start_datetime: z.string().nullable().optional().describe("ISO 8601 start of datetime range for ticket selection."),
        end_datetime: z.string().nullable().optional().describe("ISO 8601 end of datetime range for ticket selection."),
        url: z.string().optional().describe("URL pointing to an external file (e.g. CSV) to import. Used with importMacro type."),
        context: z.object({
          channel_connection_external_ids: z.array(z.string()).optional().describe("List of channel connection external IDs to scope the job."),
        }).optional().describe("Additional context for the job."),
      }).describe("Job-type-specific configuration parameters. REQUIRED. Structure depends on the type field — e.g. applyMacro needs macro_id + ticket_ids, updateTicket needs updates, importMacro needs url."),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (args) => {
    const result = await client.post("/api/jobs", args);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Update Job ---
  server.registerTool("gorgias_update_job", {
    title: "Update Job",
    description: "PUT /api/jobs/{id} — Update a job by ID. Allows modification of meta, params, scheduled_datetime, and status. Only fields included in the request body are updated.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the job to update"),
      meta: z.record(z.string(), z.unknown()).nullable().optional().describe("Metadata associated with the job. Free-form key-value data not used by Gorgias."),
      params: z.object({
        apply_and_close: z.boolean().optional().describe("Whether to close the ticket once the macro is applied. Only applies to applyMacro jobs."),
        macro_id: idSchema.optional().describe("The ID of the macro to apply on the selected tickets. Only applies to applyMacro jobs."),
        ticket_ids: z.array(idSchema).optional().describe("A list of ticket IDs to be processed by the job."),
        view_id: idSchema.optional().describe("The ID of an existing saved view to use for ticket selection."),
        view: z.object({
          filters: z.string().describe("Filter expression string, e.g. 'eq(ticket.status, \"open\")'"),
        }).optional().describe("A view-like object used to select the tickets to be processed."),
        updates: z.record(z.string(), z.unknown()).optional().describe("Key-value map of ticket field changes to apply. Only applies to updateTicket jobs."),
        start_datetime: z.string().nullable().optional().describe("ISO 8601 start of datetime range for ticket selection."),
        end_datetime: z.string().nullable().optional().describe("ISO 8601 end of datetime range for ticket selection."),
        url: z.string().optional().describe("The path to the file to import."),
        context: z.object({
          channel_connection_external_ids: z.array(z.string()).optional(),
        }).optional().describe("Additional context for the job."),
      }).optional().describe("The parameters of the job. Sub-fields available depend on the job type."),
      scheduled_datetime: z.string().nullable().optional().describe("ISO 8601 datetime when the job is scheduled to start (max 60 minutes in the future). Set to null to queue for immediate execution."),
      status: z.enum(["cancel_requested", "canceled", "done", "errored", "fatal_errored", "pending", "running", "scheduled"]).optional().describe("The status of the job. Setting this field allows transitioning the job's state."),
    },
    annotations: { readOnlyHint: false, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id, ...body }) => {
    const result = await client.put(`/api/jobs/${id}`, body);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));

  // --- Cancel Job ---
  server.registerTool("gorgias_cancel_job", {
    title: "Cancel Job",
    description: "DELETE /api/jobs/{id} — Cancel a job by ID. Jobs can be canceled at any time, but changes already applied will not be reverted. Returns 204 No Content on success.",
    inputSchema: {
      id: idSchema.describe("The unique ID of the job to cancel"),
    },
    annotations: { readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: true },
  }, safeHandler(async ({ id }) => {
    const result = await client.delete(`/api/jobs/${id}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
