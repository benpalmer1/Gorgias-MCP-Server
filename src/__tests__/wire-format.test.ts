/**
 * Wire-format unit tests for tool handlers.
 *
 * These tests verify that each tool handler issues the correct HTTP request
 * shape (path, method, body, query) against a stub GorgiasClient. They run
 * fully offline and exercise:
 *   - Critical body/query placement bugs (merge_customers, rules priorities,
 *     etc.)
 *   - Schema validation correctness (score range, required fields)
 *   - Phantom-field removals (delete_users, voice-calls phantom params)
 *   - Documentation correctness (trashed default text, smart_stats hint)
 *
 * The strategy is to:
 *   1. Provide a stub `server` whose `registerTool` records the handler.
 *   2. Provide a stub `GorgiasClient` whose HTTP methods record every call.
 *   3. Invoke the captured handler and assert the recorded call shape.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { z } from "zod";

import { registerCustomerTools } from "../tools/customers.js";
import { registerRuleTools } from "../tools/rules.js";
import { registerMacroTools } from "../tools/macros.js";
import { registerJobTools } from "../tools/jobs.js";
import { registerSatisfactionSurveyTools } from "../tools/satisfaction-surveys.js";
import { registerTicketTools } from "../tools/tickets.js";
import { registerSmartStatsTools } from "../tools/smart-stats.js";
import { registerUserTools } from "../tools/users.js";
import { registerVoiceCallTools } from "../tools/voice-calls.js";
import { registerEventTools } from "../tools/events.js";
import { registerCustomFieldTools } from "../tools/custom-fields.js";
import type { GorgiasClient } from "../client.js";

// ---------------------------------------------------------------------------
// Test harness
// ---------------------------------------------------------------------------

interface RecordedCall {
  method: "GET" | "POST" | "PUT" | "DELETE";
  path: string;
  body?: unknown;
  query?: Record<string, unknown>;
}

interface RegisteredTool {
  name: string;
  config: { inputSchema?: Record<string, z.ZodTypeAny>; description?: string };
  handler: (args: Record<string, unknown>) => Promise<unknown>;
}

function makeStubClient(responses: unknown[] = []): {
  client: GorgiasClient;
  calls: RecordedCall[];
} {
  const calls: RecordedCall[] = [];
  let responseIdx = 0;

  const stub = {
    async get(path: string, query?: Record<string, unknown>) {
      calls.push({ method: "GET", path, query });
      return responses[responseIdx++] ?? { data: [] };
    },
    async post(path: string, body?: unknown, query?: Record<string, unknown>) {
      calls.push({ method: "POST", path, body, query });
      return responses[responseIdx++] ?? { data: [] };
    },
    async put(path: string, body?: unknown, query?: Record<string, unknown>) {
      calls.push({ method: "PUT", path, body, query });
      return responses[responseIdx++] ?? { data: [] };
    },
    async delete(path: string, body?: unknown, query?: Record<string, unknown>) {
      calls.push({ method: "DELETE", path, body, query });
      return responses[responseIdx++] ?? { data: [] };
    },
    async request() {
      throw new Error("not implemented");
    },
    async search() {
      return [];
    },
  } as unknown as GorgiasClient;

  return { client: stub, calls };
}

function makeStubServer(): {
  server: { registerTool: (name: string, config: unknown, handler: unknown) => void };
  tools: Map<string, RegisteredTool>;
} {
  const tools = new Map<string, RegisteredTool>();
  const server = {
    registerTool(name: string, config: unknown, handler: unknown) {
      tools.set(name, {
        name,
        config: config as RegisteredTool["config"],
        handler: handler as RegisteredTool["handler"],
      });
    },
  };
  return { server, tools };
}

async function getResponseJson(result: unknown): Promise<Record<string, unknown>> {
  const r = result as { content: Array<{ type: string; text: string }>; isError?: boolean };
  const text = r.content[0].text;
  return JSON.parse(text);
}

// ---------------------------------------------------------------------------
// C6 — gorgias_merge_customers must send source_id/target_id as QUERY params
// ---------------------------------------------------------------------------

describe("gorgias_merge_customers wire format", () => {
  let tools: Map<string, RegisteredTool>;
  let calls: RecordedCall[];

  beforeEach(() => {
    const { server, tools: t } = makeStubServer();
    const { client, calls: c } = makeStubClient();
    registerCustomerTools(server as never, client);
    tools = t;
    calls = c;
  });

  it("sends source_id and target_id in the query string, NOT the body", async () => {
    const tool = tools.get("gorgias_merge_customers");
    expect(tool).toBeDefined();
    await tool!.handler({
      source_id: 111,
      target_id: 222,
      name: "Updated Name",
      email: "updated@example.com",
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("PUT");
    expect(call.path).toBe("/api/customers/merge");
    expect(call.query).toEqual({ source_id: 111, target_id: 222 });
    // Body must NOT contain source_id/target_id
    const body = call.body as Record<string, unknown>;
    expect(body).not.toHaveProperty("source_id");
    expect(body).not.toHaveProperty("target_id");
    // Body should still contain target update fields
    expect(body.name).toBe("Updated Name");
    expect(body.email).toBe("updated@example.com");
  });
});

// ---------------------------------------------------------------------------
// C7 — gorgias_update_rules_priorities must wrap the array in {priorities:[...]}
// ---------------------------------------------------------------------------

describe("gorgias_update_rules_priorities wire format", () => {
  it("wraps the priorities array in a {priorities: [...]} body object", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makeStubClient();
    registerRuleTools(server as never, client);

    const tool = tools.get("gorgias_update_rules_priorities");
    expect(tool).toBeDefined();
    await tool!.handler({
      priorities: [
        { id: 10, priority: 100 },
        { id: 20, priority: 50 },
      ],
    });

    expect(calls).toHaveLength(1);
    const call = calls[0];
    expect(call.method).toBe("POST");
    expect(call.path).toBe("/api/rules/priorities");
    // Body must be the wrapper object, NOT a bare array.
    expect(Array.isArray(call.body)).toBe(false);
    expect(call.body).toEqual({
      priorities: [
        { id: 10, priority: 100 },
        { id: 20, priority: 50 },
      ],
    });
  });
});

// ---------------------------------------------------------------------------
// C13 — satisfaction survey score accepts the full 1-5 integer range
// ---------------------------------------------------------------------------

describe("satisfaction survey score validation", () => {
  let tools: Map<string, RegisteredTool>;

  beforeEach(() => {
    const { server, tools: t } = makeStubServer();
    const { client } = makeStubClient();
    registerSatisfactionSurveyTools(server as never, client);
    tools = t;
  });

  function scoreSchema(toolName: string): z.ZodTypeAny {
    const tool = tools.get(toolName);
    expect(tool).toBeDefined();
    const shape = tool!.config.inputSchema!;
    return shape.score;
  }

  it("create accepts every integer from 1 to 5", () => {
    const schema = scoreSchema("gorgias_create_satisfaction_survey");
    for (const v of [1, 2, 3, 4, 5]) {
      expect(schema.safeParse(v).success).toBe(true);
    }
  });

  it("create accepts null", () => {
    const schema = scoreSchema("gorgias_create_satisfaction_survey");
    expect(schema.safeParse(null).success).toBe(true);
  });

  it("create rejects 0 and 6", () => {
    const schema = scoreSchema("gorgias_create_satisfaction_survey");
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(6).success).toBe(false);
  });

  it("create rejects floats", () => {
    const schema = scoreSchema("gorgias_create_satisfaction_survey");
    expect(schema.safeParse(3.5).success).toBe(false);
  });

  it("update accepts every integer from 1 to 5 (and 2/3/4 specifically — regression for the binary-only bug)", () => {
    const schema = scoreSchema("gorgias_update_satisfaction_survey");
    for (const v of [1, 2, 3, 4, 5]) {
      expect(schema.safeParse(v).success).toBe(true);
    }
  });

  it("update rejects values outside 1-5", () => {
    const schema = scoreSchema("gorgias_update_satisfaction_survey");
    expect(schema.safeParse(0).success).toBe(false);
    expect(schema.safeParse(6).success).toBe(false);
    expect(schema.safeParse(-1).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// C14 — gorgias_create_job.params is required (no .optional())
// ---------------------------------------------------------------------------

describe("gorgias_create_job params requirement", () => {
  it("rejects payloads missing params", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerJobTools(server as never, client);

    const tool = tools.get("gorgias_create_job");
    expect(tool).toBeDefined();
    const schema = z.object(tool!.config.inputSchema!);

    const result = schema.safeParse({ type: "applyMacro" });
    expect(result.success).toBe(false);
  });

  it("accepts payloads with params", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerJobTools(server as never, client);

    const tool = tools.get("gorgias_create_job");
    const schema = z.object(tool!.config.inputSchema!);

    const result = schema.safeParse({
      type: "applyMacro",
      params: { macro_id: 1, ticket_ids: [1, 2] },
    });
    expect(result.success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C8 — gorgias_update_ticket no longer exposes created_datetime
// ---------------------------------------------------------------------------

describe("gorgias_update_ticket schema", () => {
  it("does NOT expose created_datetime (immutable post-create per Gorgias spec)", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerTicketTools(server as never, client);

    const tool = tools.get("gorgias_update_ticket");
    expect(tool).toBeDefined();
    const shape = tool!.config.inputSchema!;
    expect(shape.created_datetime).toBeUndefined();
  });

  it("still exposes opened_datetime, updated_datetime, last_message_datetime (legitimate update fields)", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerTicketTools(server as never, client);

    const shape = tools.get("gorgias_update_ticket")!.config.inputSchema!;
    expect(shape.opened_datetime).toBeDefined();
    expect(shape.updated_datetime).toBeDefined();
    expect(shape.last_message_datetime).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// H2 — gorgias_list_tickets `trashed` description states the API default is true
// ---------------------------------------------------------------------------

describe("gorgias_list_tickets trashed parameter docs", () => {
  it("description for trashed says default is true (matches Gorgias API)", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerTicketTools(server as never, client);

    const shape = tools.get("gorgias_list_tickets")!.config.inputSchema!;
    const trashed = shape.trashed as z.ZodTypeAny;
    // Pull the description out via Zod's _def
    const desc = (trashed._def as { description?: string }).description ??
      ((trashed as unknown) as { description: string }).description;
    expect(desc).toMatch(/default is true/i);
    expect(desc).not.toMatch(/default:\s*false/i);
  });
});

// ---------------------------------------------------------------------------
// C9 — gorgias_delete_users (bulk) is NOT registered (endpoint does not exist)
// ---------------------------------------------------------------------------

describe("users tool registration (no bulk delete)", () => {
  it("does NOT register gorgias_delete_users — the bulk DELETE /api/users endpoint does not exist in the Gorgias API", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerUserTools(server as never, client);

    expect(tools.has("gorgias_delete_users")).toBe(false);
    // Single-user delete still works
    expect(tools.has("gorgias_delete_user")).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C16 — voice-calls list tools no longer expose phantom params
// ---------------------------------------------------------------------------

describe("voice-calls list tools — phantom param removal", () => {
  let tools: Map<string, RegisteredTool>;

  beforeEach(() => {
    const { server, tools: t } = makeStubServer();
    const { client } = makeStubClient();
    registerVoiceCallTools(server as never, client);
    tools = t;
  });

  it("gorgias_list_voice_calls only exposes cursor, limit, ticket_id (per Gorgias spec)", () => {
    const shape = tools.get("gorgias_list_voice_calls")!.config.inputSchema!;
    expect(Object.keys(shape).sort()).toEqual(["cursor", "limit", "ticket_id"]);
  });

  it("gorgias_list_voice_calls does NOT expose offset/order_by/direction/status/customer_id/queue_id/phone_number_id/integration_id", () => {
    const shape = tools.get("gorgias_list_voice_calls")!.config.inputSchema!;
    for (const phantom of [
      "offset",
      "order_by",
      "direction",
      "status",
      "customer_id",
      "queue_id",
      "phone_number_id",
      "integration_id",
    ]) {
      expect(shape[phantom]).toBeUndefined();
    }
  });

  it("gorgias_list_voice_call_events only exposes cursor, limit, call_id", () => {
    const shape = tools.get("gorgias_list_voice_call_events")!.config.inputSchema!;
    expect(Object.keys(shape).sort()).toEqual(["call_id", "cursor", "limit"]);
    expect(shape.account_id).toBeUndefined();
    expect(shape.order_by).toBeUndefined();
  });

  it("gorgias_list_voice_call_recordings only exposes cursor, limit, call_id", () => {
    const shape = tools.get("gorgias_list_voice_call_recordings")!.config.inputSchema!;
    expect(Object.keys(shape).sort()).toEqual(["call_id", "cursor", "limit"]);
    expect(shape.order_by).toBeUndefined();
  });

  it("gorgias_delete_voice_call_recording description states 204 No Content (not 'returns deleted object')", () => {
    const desc = tools.get("gorgias_delete_voice_call_recording")!.config.description ?? "";
    expect(desc).toMatch(/204 No Content/i);
    expect(desc).not.toMatch(/returns the deleted recording object/i);
  });
});

// ---------------------------------------------------------------------------
// M4 — smart_stats truncation hint no longer suggests "add dimensions"
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// H10/H12 — update_macro and update_rule support partial updates
// ---------------------------------------------------------------------------

describe("partial-update schemas (H10/H12)", () => {
  it("gorgias_update_macro accepts partial payloads (no required fields beyond id)", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerMacroTools(server as never, client);

    const tool = tools.get("gorgias_update_macro")!;
    const schema = z.object(tool.config.inputSchema!);

    // Just changing intent should be valid; previously this required name+actions.
    expect(schema.safeParse({ id: 7, intent: "refund/request" }).success).toBe(true);
    expect(schema.safeParse({ id: 7, language: "en" }).success).toBe(true);
    expect(schema.safeParse({ id: 7 }).success).toBe(true);
  });

  it("gorgias_update_macro still accepts a full payload with name+actions", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerMacroTools(server as never, client);

    const tool = tools.get("gorgias_update_macro")!;
    const schema = z.object(tool.config.inputSchema!);
    expect(
      schema.safeParse({
        id: 7,
        name: "renamed",
        actions: [{ name: "set-status", title: "Close", arguments: { status: "closed" } }],
      }).success,
    ).toBe(true);
  });

  it("gorgias_update_rule accepts partial payloads (no required fields beyond id)", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerRuleTools(server as never, client);

    const tool = tools.get("gorgias_update_rule")!;
    const schema = z.object(tool.config.inputSchema!);
    expect(schema.safeParse({ id: 5, deactivated_datetime: null }).success).toBe(true);
    expect(schema.safeParse({ id: 5, priority: 200 }).success).toBe(true);
    expect(schema.safeParse({ id: 5 }).success).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// C2/M1 — smart_stats preserves null-measure rows and unions all column keys
// ---------------------------------------------------------------------------

describe("smart_stats null-measure preservation and column union", () => {
  it("does NOT drop rows where every measure is null — surfaces nullMeasureRowCount instead", async () => {
    const { server, tools } = makeStubServer();
    // Three rows: two have non-null ticketCount, one is all-null.
    const fakeRows = [
      { agentId: 1, ticketCount: 5 },
      { agentId: 2, ticketCount: null },
      { agentId: 3, ticketCount: 7 },
    ];
    const { client } = makeStubClient([{ data: fakeRows }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
    });
    const json = await getResponseJson(result);

    // All 3 rows preserved
    expect((json.data as unknown[]).length).toBe(3);
    expect(json.totalRows).toBe(3);
    expect(json.rawRowCount).toBe(3);
    expect(json.nullMeasureRowCount).toBe(1);
    // Hint mentions the null rows
    expect(String(json._hint)).toMatch(/all-null measure values/i);
  });

  it("column metadata is the union of keys across ALL rows, not just rows[0]", async () => {
    const { server, tools } = makeStubServer();
    // First row only has 'a'; second row has 'a' and 'b'.
    const fakeRows = [
      { a: 1 },
      { a: 2, b: "extra" },
    ];
    const { client } = makeStubClient([{ data: fakeRows }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
      measures: [], // disable null filter so both rows survive
    });
    const json = await getResponseJson(result);
    const columns = json.columns as Record<string, string>;
    expect(columns).toHaveProperty("a");
    expect(columns).toHaveProperty("b");
  });
});

// ---------------------------------------------------------------------------
// H3 — gorgias_get_ticket exposes the relationships query parameter
// ---------------------------------------------------------------------------

describe("gorgias_get_ticket relationships", () => {
  it("exposes a relationships query parameter and forwards it as a query arg", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makeStubClient([{ id: 42 }]);
    registerTicketTools(server as never, client);

    const tool = tools.get("gorgias_get_ticket")!;
    const shape = tool.config.inputSchema!;
    expect(shape.relationships).toBeDefined();

    await tool.handler({ id: 42, relationships: ["custom_fields"] });

    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe("GET");
    expect(calls[0].path).toBe("/api/tickets/42");
    expect(calls[0].query).toEqual({ relationships: ["custom_fields"] });
  });

  it("does not include relationships in the query when omitted", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makeStubClient([{ id: 42 }]);
    registerTicketTools(server as never, client);

    await tools.get("gorgias_get_ticket")!.handler({ id: 42 });
    expect(calls[0].query).toEqual({});
  });
});

// ---------------------------------------------------------------------------
// H4 — gorgias_list_customers exposes view_id, channel_type, channel_address
// ---------------------------------------------------------------------------

describe("gorgias_list_customers added params", () => {
  it("exposes view_id, channel_type, channel_address per Gorgias docs", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerCustomerTools(server as never, client);

    const shape = tools.get("gorgias_list_customers")!.config.inputSchema!;
    expect(shape.view_id).toBeDefined();
    expect(shape.channel_type).toBeDefined();
    expect(shape.channel_address).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// H5 — gorgias_list_users exposes the missing 6 documented filters
// ---------------------------------------------------------------------------

describe("gorgias_list_users added params", () => {
  it("exposes email, external_id, search, available_first, roles, order_by", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerUserTools(server as never, client);

    const shape = tools.get("gorgias_list_users")!.config.inputSchema!;
    for (const key of [
      "email",
      "external_id",
      "search",
      "available_first",
      "roles",
      "order_by",
    ]) {
      expect(shape[key]).toBeDefined();
    }
  });
});

// ---------------------------------------------------------------------------
// H6 — gorgias_list_custom_fields fixes phantom offset and wrong order_by enum
// ---------------------------------------------------------------------------

describe("gorgias_list_custom_fields schema correction", () => {
  let tools: Map<string, RegisteredTool>;
  beforeEach(() => {
    const { server, tools: t } = makeStubServer();
    const { client } = makeStubClient();
    registerCustomFieldTools(server as never, client);
    tools = t;
  });

  it("does NOT expose offset (cursor-only endpoint)", () => {
    const shape = tools.get("gorgias_list_custom_fields")!.config.inputSchema!;
    expect(shape.offset).toBeUndefined();
  });

  it("order_by enum is priority:asc/desc, not created_datetime/updated_datetime", () => {
    const shape = tools.get("gorgias_list_custom_fields")!.config.inputSchema!;
    const orderBy = shape.order_by as z.ZodTypeAny;
    expect(orderBy.safeParse("priority:asc").success).toBe(true);
    expect(orderBy.safeParse("priority:desc").success).toBe(true);
    expect(orderBy.safeParse("created_datetime:asc").success).toBe(false);
    expect(orderBy.safeParse("updated_datetime:desc").success).toBe(false);
  });

  it("exposes search and archived filters", () => {
    const shape = tools.get("gorgias_list_custom_fields")!.config.inputSchema!;
    expect(shape.search).toBeDefined();
    expect(shape.archived).toBeDefined();
  });
});

// ---------------------------------------------------------------------------
// H7 — gorgias_list_events array types and corrected enum
// ---------------------------------------------------------------------------

describe("gorgias_list_events array params and corrected enum", () => {
  let tools: Map<string, RegisteredTool>;
  beforeEach(() => {
    const { server, tools: t } = makeStubServer();
    const { client } = makeStubClient();
    registerEventTools(server as never, client);
    tools = t;
  });

  it("user_ids accepts an array of integers (not a single integer)", () => {
    const shape = tools.get("gorgias_list_events")!.config.inputSchema!;
    const userIds = shape.user_ids as z.ZodTypeAny;
    expect(userIds.safeParse([1, 2, 3]).success).toBe(true);
    expect(userIds.safeParse(1).success).toBe(false);
  });

  it("types accepts an array of strings (not a single string)", () => {
    const shape = tools.get("gorgias_list_events")!.config.inputSchema!;
    const types = shape.types as z.ZodTypeAny;
    expect(types.safeParse(["ticket-created", "ticket-updated"]).success).toBe(true);
    expect(types.safeParse("ticket-created").success).toBe(false);
  });

  it("object_type enum uses Message and TicketRule (corrected from TicketMessage and Rule) and includes SatisfactionSurvey", () => {
    const shape = tools.get("gorgias_list_events")!.config.inputSchema!;
    const objectType = shape.object_type as z.ZodTypeAny;
    expect(objectType.safeParse("Message").success).toBe(true);
    expect(objectType.safeParse("TicketRule").success).toBe(true);
    expect(objectType.safeParse("SatisfactionSurvey").success).toBe(true);
    // Old wrong values should now be rejected
    expect(objectType.safeParse("TicketMessage").success).toBe(false);
    expect(objectType.safeParse("Rule").success).toBe(false);
  });

  it("exposes the created_datetime comparator filter", () => {
    const shape = tools.get("gorgias_list_events")!.config.inputSchema!;
    const cd = shape.created_datetime as z.ZodTypeAny;
    expect(cd).toBeDefined();
    expect(cd.safeParse({ gte: "2026-01-01T00:00:00Z" }).success).toBe(true);
    expect(cd.safeParse({ lt: "2026-02-01T00:00:00Z" }).success).toBe(true);
    expect(cd.safeParse({ gt: "2026-01-01T00:00:00Z", lte: "2026-12-31T23:59:59Z" }).success).toBe(true);
    // Empty object is valid (means no filter)
    expect(cd.safeParse({}).success).toBe(true);
    // Wrong value type
    expect(cd.safeParse({ gte: 12345 }).success).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// M28 — managed_type enum no longer includes the phantom 'customer_type' value
// ---------------------------------------------------------------------------

describe("custom_fields managed_type enum", () => {
  it("does NOT accept 'customer_type' (phantom value not in Gorgias docs)", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerCustomFieldTools(server as never, client);

    const tool = tools.get("gorgias_create_custom_field")!;
    const schema = z.object(tool.config.inputSchema!);
    const result = schema.safeParse({
      object_type: "Customer",
      label: "test",
      definition: { data_type: "text", input_settings: { input_type: "input" } },
      managed_type: "customer_type",
    });
    expect(result.success).toBe(false);
  });

  it("still accepts the documented managed_type values", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerCustomFieldTools(server as never, client);

    const tool = tools.get("gorgias_create_custom_field")!;
    const schema = z.object(tool.config.inputSchema!);
    for (const v of [
      "contact_reason",
      "product",
      "resolution",
      "ai_intent",
      "ai_outcome",
      "ai_sales",
      "ai_discount",
      "ai_journey",
      "managed_sentiment",
      "call_status",
    ]) {
      const result = schema.safeParse({
        object_type: "Ticket",
        label: "test",
        definition: { data_type: "text", input_settings: { input_type: "input" } },
        managed_type: v,
      });
      expect(result.success).toBe(true);
    }
  });
});

describe("smart_stats truncation hint", () => {
  it("does NOT recommend 'add dimensions' (which would make truncation worse)", async () => {
    const { server, tools } = makeStubServer();
    // Build a fake API response with exactly 100 rows so the truncation
    // branch fires.
    const fakeRows = Array.from({ length: 100 }, (_, i) => ({
      agentId: i + 1,
      ticketCount: i + 1,
    }));
    const { client } = makeStubClient([{ data: fakeRows }]);
    registerSmartStatsTools(server as never, client);

    const tool = tools.get("gorgias_smart_stats")!;
    const result = await tool.handler({
      scope: "tickets-created",
      start_date: "2026-01-01",
      end_date: "2026-01-31",
    });
    const json = await getResponseJson(result);
    const hint = String(json._hint ?? "");
    expect(hint).toMatch(/truncat/i);
    expect(hint).not.toMatch(/add dimensions for more precise/i);
    // Should mention removing dimensions or coarsening granularity instead
    expect(hint.toLowerCase()).toMatch(/remove dimensions|coarsen|narrower/);
  });
});
