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
import { registerSmartTicketDetailTools } from "../tools/smart-ticket-detail.js";
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
    // branch fires (default limit is 100).
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
    expect(hint).toMatch(/truncat|capped/i);
    expect(hint).not.toMatch(/add dimensions for more precise/i);
    // Should mention removing dimensions or coarsening granularity instead
    expect(hint.toLowerCase()).toMatch(/remove dimensions|coarsen|granularity/);
  });
});

// ---------------------------------------------------------------------------
// B1 — C1: smart_stats auto-pagination
// ---------------------------------------------------------------------------

describe("C1: smart_stats auto-pagination", () => {
  function makePaginatedClient(pages: Array<{ data: unknown[]; nextCursor?: string | null }>) {
    const calls: RecordedCall[] = [];
    let pageIdx = 0;
    const stub = {
      async get(path: string, query?: Record<string, unknown>) {
        calls.push({ method: "GET", path, query });
        return { data: [] };
      },
      async post(path: string, body?: unknown, query?: Record<string, unknown>) {
        calls.push({ method: "POST", path, body, query });
        const page = pages[pageIdx++];
        if (!page) return { data: [] };
        return {
          data: page.data,
          meta: { next_cursor: page.nextCursor ?? null },
        };
      },
      async put() { return {}; },
      async delete() { return {}; },
      async request() { throw new Error("not implemented"); },
      async search() { return []; },
    } as unknown as GorgiasClient;
    return { client: stub, calls };
  }

  it("C1.1: default limit returns single page when upstream has no cursor", async () => {
    const { server, tools } = makeStubServer();
    const rows = Array.from({ length: 50 }, (_, i) => ({ id: i, ticketCount: i }));
    const { client } = makePaginatedClient([{ data: rows, nextCursor: null }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
    });
    const json = await getResponseJson(result);
    expect((json.data as unknown[]).length).toBe(50);
    expect(json.pagesFetched).toBe(1);
    expect(json.nextCursor).toBeNull();
  });

  it("C1.2: default limit auto-paginates and trims to 100", async () => {
    const { server, tools } = makeStubServer();
    const page1 = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const page2 = Array.from({ length: 50 }, (_, i) => ({ id: 100 + i }));
    const { client } = makePaginatedClient([
      { data: page1, nextCursor: "abc" },
      { data: page2, nextCursor: null },
    ]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
    });
    const json = await getResponseJson(result);
    // Default limit 100, first page already has 100 rows → stops
    expect((json.data as unknown[]).length).toBe(100);
    expect(json.pagesFetched).toBe(1);
  });

  it("C1.3: explicit limit 5000 paginates five pages and returns all 5000", async () => {
    const { server, tools } = makeStubServer();
    const pages = Array.from({ length: 5 }, (_, i) => ({
      data: Array.from({ length: 1000 }, (_, j) => ({ id: i * 1000 + j })),
      nextCursor: i < 4 ? `cursor-${i + 1}` : null,
    }));
    const { client } = makePaginatedClient(pages);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      limit: 5000,
    });
    const json = await getResponseJson(result);
    expect((json.data as unknown[]).length).toBe(5000);
    expect(json.pagesFetched).toBe(5);
    expect(json.nextCursor).toBeNull();
  });

  it("C1.4: explicit limit 5000 stops at 5000 even if more available", async () => {
    const { server, tools } = makeStubServer();
    const pages = Array.from({ length: 6 }, (_, i) => ({
      data: Array.from({ length: 1000 }, (_, j) => ({ id: i * 1000 + j })),
      nextCursor: `cursor-${i + 1}`,
    }));
    const { client } = makePaginatedClient(pages);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      limit: 5000,
    });
    const json = await getResponseJson(result);
    expect((json.data as unknown[]).length).toBe(5000);
    expect(json.pagesFetched).toBe(5);
    expect(json.nextCursor).toBe("cursor-5");
  });

  it("C1.5: safety cap returns isError after 10 pages", async () => {
    const { server, tools } = makeStubServer();
    // Use 500-row pages so limit 10000 is never reached, but 10 page fetches happen
    const pages = Array.from({ length: 11 }, (_, i) => ({
      data: Array.from({ length: 500 }, (_, j) => ({ id: i * 500 + j })),
      nextCursor: `cursor-${i + 1}`,
    }));
    const { client } = makePaginatedClient(pages);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      limit: 10000,
    });
    const r = result as { content: Array<{ text: string }>; isError?: boolean };
    expect(r.isError).toBe(true);
    const json = JSON.parse(r.content[0].text);
    expect(json.pagesFetched).toBe(10);
    expect(json.nextCursor).toBeDefined();
    expect(json._hint).toMatch(/cursor/i);
  });

  it("C1.6: cursor mode fetches exactly one page", async () => {
    const { server, tools } = makeStubServer();
    const rows = Array.from({ length: 100 }, (_, i) => ({ id: i }));
    const { client } = makePaginatedClient([{ data: rows, nextCursor: "next-page" }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      cursor: "start-cursor",
    });
    const json = await getResponseJson(result);
    expect((json.data as unknown[]).length).toBe(100);
    expect(json.pagesFetched).toBe(1);
    expect(json.nextCursor).toBe("next-page");
  });

  it("C1.7: cursor mode does not auto-paginate", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makePaginatedClient([
      { data: [{ id: 1 }], nextCursor: "page2" },
      { data: [{ id: 2 }], nextCursor: null },
    ]);
    registerSmartStatsTools(server as never, client);

    await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      cursor: "start",
    });
    // Only one POST call should have been made (the stats query)
    const postCalls = calls.filter(c => c.method === "POST");
    expect(postCalls.length).toBe(1);
  });

  it("C1.8: cursor passed to upstream as query param", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makePaginatedClient([{ data: [{ id: 1 }], nextCursor: null }]);
    registerSmartStatsTools(server as never, client);

    await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      cursor: "my-cursor",
    });
    const postCall = calls.find(c => c.method === "POST")!;
    expect(postCall.query).toHaveProperty("cursor", "my-cursor");
  });

  it("C1.9: null filter still works across paginated pages", async () => {
    const { server, tools } = makeStubServer();
    const page1 = [
      { agentId: 1, ticketCount: 5 },
      { agentId: 2, ticketCount: null },
    ];
    const page2 = [
      { agentId: 3, ticketCount: null },
      { agentId: 4, ticketCount: 10 },
    ];
    const { client } = makePaginatedClient([
      { data: page1, nextCursor: "p2" },
      { data: page2, nextCursor: null },
    ]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      limit: 5000,
    });
    const json = await getResponseJson(result);
    expect((json.data as unknown[]).length).toBe(4);
    expect(json.nullMeasureRowCount).toBe(2);
  });

  it("C1.10: rawRowCount reflects pre-trim count", async () => {
    const { server, tools } = makeStubServer();
    // Use limit=500 with one page of 600 rows so the trim fires
    const page1 = Array.from({ length: 600 }, (_, i) => ({ id: i }));
    const { client } = makePaginatedClient([
      { data: page1, nextCursor: null },
    ]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      limit: 500,
    });
    const json = await getResponseJson(result);
    // data is trimmed to 500 but rawRowCount reflects pre-trim 600
    expect((json.data as unknown[]).length).toBe(500);
    expect(json.rawRowCount).toBe(600);
  });

  it("C1.11: _hint never contains 'add dimensions' (regression guard)", async () => {
    const { server, tools } = makeStubServer();
    const fakeRows = Array.from({ length: 100 }, (_, i) => ({ id: i, ticketCount: i }));
    const { client } = makePaginatedClient([{ data: fakeRows, nextCursor: null }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
    });
    const json = await getResponseJson(result);
    expect(String(json._hint)).not.toMatch(/add dimensions/i);
  });

  it("C1.12: _hint mentions granularity: none when limit is reached", async () => {
    const { server, tools } = makeStubServer();
    const fakeRows = Array.from({ length: 100 }, (_, i) => ({ id: i, ticketCount: i }));
    const { client } = makePaginatedClient([{ data: fakeRows, nextCursor: "more" }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
    });
    const json = await getResponseJson(result);
    expect(String(json._hint)).toMatch(/granularity.*none|aggregate/i);
  });

  it("C1.13: tool input schema exposes limit and cursor", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerSmartStatsTools(server as never, client);

    const shape = tools.get("gorgias_smart_stats")!.config.inputSchema!;
    expect(shape.limit).toBeDefined();
    expect(shape.cursor).toBeDefined();
  });

  it("C1.14: limit > 10000 rejected at schema layer", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerSmartStatsTools(server as never, client);

    const shape = tools.get("gorgias_smart_stats")!.config.inputSchema!;
    expect((shape.limit as z.ZodTypeAny).safeParse(10001).success).toBe(false);
  });

  it("C1.15: limit < 1 rejected at schema layer", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerSmartStatsTools(server as never, client);

    const shape = tools.get("gorgias_smart_stats")!.config.inputSchema!;
    expect((shape.limit as z.ZodTypeAny).safeParse(0).success).toBe(false);
    expect((shape.limit as z.ZodTypeAny).safeParse(-1).success).toBe(false);
  });

  it("C1.16: legacy callers (no limit) still get up to 100 rows, but auto-paginate", async () => {
    const { server, tools } = makeStubServer();
    const fakeRows = Array.from({ length: 80 }, (_, i) => ({ id: i, ticketCount: i }));
    const { client } = makePaginatedClient([{ data: fakeRows, nextCursor: null }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
    });
    const json = await getResponseJson(result);
    // 80 rows returned in full — default cap is 100, auto-pagination available
    expect((json.data as unknown[]).length).toBe(80);
  });
});

// ---------------------------------------------------------------------------
// B1 — M2: smart_stats granularity "none" aggregate mode
// ---------------------------------------------------------------------------

describe("M2: smart_stats granularity none aggregate mode", () => {
  function makePaginatedClient(pages: Array<{ data: unknown[]; nextCursor?: string | null }>) {
    const calls: RecordedCall[] = [];
    let pageIdx = 0;
    const stub = {
      async get(path: string, query?: Record<string, unknown>) {
        calls.push({ method: "GET", path, query });
        return { data: [] };
      },
      async post(path: string, body?: unknown, query?: Record<string, unknown>) {
        calls.push({ method: "POST", path, body, query });
        const page = pages[pageIdx++];
        if (!page) return { data: [] };
        return { data: page.data, meta: { next_cursor: page.nextCursor ?? null } };
      },
      async put() { return {}; },
      async delete() { return {}; },
      async request() { throw new Error("not implemented"); },
      async search() { return []; },
    } as unknown as GorgiasClient;
    return { client: stub, calls };
  }

  it("M2.1: granularity none omits time_dimensions from POST body", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makePaginatedClient([{ data: [{ ticketCount: 42 }] }]);
    registerSmartStatsTools(server as never, client);

    await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      granularity: "none",
    });
    const postCall = calls.find(c => c.method === "POST")!;
    const body = postCall.body as { query: Record<string, unknown> };
    expect(body.query).not.toHaveProperty("time_dimensions");
  });

  it("M2.2: granularity day still includes time_dimensions (regression)", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makePaginatedClient([{ data: [{ ticketCount: 42 }] }]);
    registerSmartStatsTools(server as never, client);

    await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      granularity: "day",
    });
    const postCall = calls.find(c => c.method === "POST")!;
    const body = postCall.body as { query: Record<string, unknown> };
    expect(body.query).toHaveProperty("time_dimensions");
    expect((body.query.time_dimensions as unknown[])[0]).toEqual({
      dimension: "createdDatetime", granularity: "day",
    });
  });

  it("M2.3: response echoes granularity none", async () => {
    const { server, tools } = makeStubServer();
    const { client } = makePaginatedClient([{ data: [{ ticketCount: 42 }] }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      granularity: "none",
    });
    const json = await getResponseJson(result);
    expect(json.granularity).toBe("none");
  });

  it("M2.4: rejects unknown granularity", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerSmartStatsTools(server as never, client);

    const shape = tools.get("gorgias_smart_stats")!.config.inputSchema!;
    expect((shape.granularity as z.ZodTypeAny).safeParse("yearly").success).toBe(false);
  });

  it("M2.5: granularity none with zero dimensions returns single aggregated row", async () => {
    const { server, tools } = makeStubServer();
    const { client } = makePaginatedClient([{ data: [{ ticketCount: 999 }] }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2026-01-01", end_date: "2026-01-31",
      granularity: "none", dimensions: [],
    });
    const json = await getResponseJson(result);
    expect((json.data as unknown[]).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// B1 — M3: smart_stats 366-day client-side validation
// ---------------------------------------------------------------------------

import { MAX_PERIOD_DAYS, periodLengthDays } from "../reporting-knowledge.js";

describe("M3: smart_stats 366-day client-side validation", () => {
  function makePaginatedClient(pages: Array<{ data: unknown[]; nextCursor?: string | null }>) {
    const calls: RecordedCall[] = [];
    let pageIdx = 0;
    const stub = {
      async get(path: string, query?: Record<string, unknown>) {
        calls.push({ method: "GET", path, query });
        return { data: [] };
      },
      async post(path: string, body?: unknown, query?: Record<string, unknown>) {
        calls.push({ method: "POST", path, body, query });
        const page = pages[pageIdx++];
        if (!page) return { data: [] };
        return { data: page.data, meta: { next_cursor: page.nextCursor ?? null } };
      },
      async put() { return {}; },
      async delete() { return {}; },
      async request() { throw new Error("not implemented"); },
      async search() { return []; },
    } as unknown as GorgiasClient;
    return { client: stub, calls };
  }

  it("M3.1: periodLengthDays inclusive boundary — same date = 1, one day gap = 2", () => {
    expect(periodLengthDays("2026-01-01", "2026-01-01")).toBe(1);
    expect(periodLengthDays("2026-01-01", "2026-01-02")).toBe(2);
  });

  it("M3.2: periodLengthDays leap-year handling — 2024 full year = 366", () => {
    expect(periodLengthDays("2024-01-01", "2024-12-31")).toBe(366);
  });

  it("M3.3: accepts 366 day span", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makePaginatedClient([{ data: [{ ticketCount: 1 }] }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2024-01-01", end_date: "2024-12-31",
    });
    const r = result as { isError?: boolean };
    expect(r.isError).toBeUndefined();
    // Verify the API call was actually made
    const postCalls = calls.filter(c => c.method === "POST");
    expect(postCalls.length).toBeGreaterThan(0);
  });

  it("M3.4: rejects 367 day span with zero API calls", async () => {
    const { server, tools } = makeStubServer();
    const { client, calls } = makePaginatedClient([{ data: [] }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2024-01-01", end_date: "2025-01-01",
    });
    const r = result as { content: Array<{ text: string }>; isError?: boolean };
    expect(r.isError).toBe(true);
    const json = JSON.parse(r.content[0].text);
    expect(json.requestedDays).toBe(367);
    expect(json.maxDays).toBe(366);
    // No API calls should have been made
    const postCalls = calls.filter(c => c.method === "POST");
    expect(postCalls.length).toBe(0);
  });

  it("M3.5: error payload hint mentions split", async () => {
    const { server, tools } = makeStubServer();
    const { client } = makePaginatedClient([{ data: [] }]);
    registerSmartStatsTools(server as never, client);

    const result = await tools.get("gorgias_smart_stats")!.handler({
      scope: "tickets-created", start_date: "2024-01-01", end_date: "2025-06-01",
    });
    const r = result as { content: Array<{ text: string }> };
    const json = JSON.parse(r.content[0].text);
    expect(json._hint).toMatch(/split/i);
  });

  it("M3.6: MAX_PERIOD_DAYS is exported and equals 366", () => {
    expect(MAX_PERIOD_DAYS).toBe(366);
  });
});

// ---------------------------------------------------------------------------
// B2 — C3: smart_get_ticket message auto-pagination
// ---------------------------------------------------------------------------

describe("C3: smart_get_ticket message auto-pagination", () => {
  function makeMessage(id: number) {
    return {
      id,
      body_html: `<p>Message ${id}</p>`,
      body_text: `Message ${id}`,
      sender: { type: "agent", name: `Agent ${id}` },
      channel: "email",
      via: "helpdesk",
      created_datetime: `2026-01-${String(id).padStart(2, "0")}T00:00:00Z`,
      source: { type: "email" },
    };
  }

  function makeTicketDetailClient(
    ticket: unknown,
    messagePages: Array<{ data: unknown[]; nextCursor?: string | null }>,
  ) {
    const calls: RecordedCall[] = [];
    let messagePageIdx = 0;
    const stub = {
      async get(path: string, query?: Record<string, unknown>) {
        calls.push({ method: "GET", path, query });
        if (path.endsWith("/messages")) {
          const page = messagePages[messagePageIdx++];
          if (!page) return { data: [] };
          return { data: page.data, meta: { next_cursor: page.nextCursor ?? null } };
        }
        return ticket;
      },
      async post() { return {}; },
      async put() { return {}; },
      async delete() { return {}; },
      async request() { throw new Error("not implemented"); },
      async search() { return []; },
    } as unknown as GorgiasClient;
    return { client: stub, calls };
  }

  const baseTicket = {
    id: 1, subject: "Test", status: "open", priority: "normal",
    customer: { id: 1, name: "Customer" }, channel: "email",
    created_datetime: "2026-01-01T00:00:00Z",
    updated_datetime: "2026-01-01T00:00:00Z",
    opened_datetime: "2026-01-01T00:00:00Z",
    assignee_user: null, assignee_team: null,
    tags: [], messages_count: 0,
  };

  it("C3.8: ticket with 31 messages returns all 31", async () => {
    const { server, tools } = makeStubServer();
    const msgs = Array.from({ length: 31 }, (_, i) => makeMessage(i + 1));
    const { client } = makeTicketDetailClient(baseTicket, [
      { data: msgs.slice(0, 30), nextCursor: "p2" },
      { data: msgs.slice(30), nextCursor: null },
    ]);
    registerSmartTicketDetailTools(server as never, client);

    const result = await tools.get("gorgias_smart_get_ticket")!.handler({ id: 1 });
    const json = await getResponseJson(result);
    expect((json.messages as unknown[]).length).toBe(31);
    expect(json.truncated).toBeUndefined();
  });

  it("C3.9: ticket with 305 messages returns all 305 (default cap 1000)", async () => {
    const { server, tools } = makeStubServer();
    const msgs = Array.from({ length: 305 }, (_, i) => makeMessage(i + 1));
    const pages = [];
    for (let i = 0; i < msgs.length; i += 100) {
      const slice = msgs.slice(i, i + 100);
      pages.push({
        data: slice,
        nextCursor: i + 100 < msgs.length ? `p${Math.floor(i / 100) + 2}` : null,
      });
    }
    const { client } = makeTicketDetailClient(baseTicket, pages);
    registerSmartTicketDetailTools(server as never, client);

    const result = await tools.get("gorgias_smart_get_ticket")!.handler({ id: 1 });
    const json = await getResponseJson(result);
    expect((json.messages as unknown[]).length).toBe(305);
    expect(json.truncated).toBeUndefined();
  });

  it("C3.10: max_messages=50 returns 50, truncated=true", async () => {
    const { server, tools } = makeStubServer();
    const msgs = Array.from({ length: 305 }, (_, i) => makeMessage(i + 1));
    const { client } = makeTicketDetailClient(baseTicket, [
      { data: msgs.slice(0, 100), nextCursor: "p2" },
    ]);
    registerSmartTicketDetailTools(server as never, client);

    const result = await tools.get("gorgias_smart_get_ticket")!.handler({ id: 1, max_messages: 50 });
    const json = await getResponseJson(result);
    expect((json.messages as unknown[]).length).toBe(50);
    expect(json.truncated).toBe(true);
    expect(json.truncatedReason).toMatch(/max_messages cap of 50/);
    expect(json.pagesFetched).toBe(1);
  });

  it("C3.11: max_messages=250 returns 250, truncated=true, pagesFetched=3", async () => {
    const { server, tools } = makeStubServer();
    const msgs = Array.from({ length: 305 }, (_, i) => makeMessage(i + 1));
    const pages = [];
    for (let i = 0; i < msgs.length; i += 100) {
      const slice = msgs.slice(i, i + 100);
      pages.push({
        data: slice,
        nextCursor: i + 100 < msgs.length ? `p${Math.floor(i / 100) + 2}` : null,
      });
    }
    const { client } = makeTicketDetailClient(baseTicket, pages);
    registerSmartTicketDetailTools(server as never, client);

    const result = await tools.get("gorgias_smart_get_ticket")!.handler({ id: 1, max_messages: 250 });
    const json = await getResponseJson(result);
    expect((json.messages as unknown[]).length).toBe(250);
    expect(json.truncated).toBe(true);
    expect(json.pagesFetched).toBe(3);
  });

  it("C3.12: truncated _hint leads with PARTIAL CONVERSATION", async () => {
    const { server, tools } = makeStubServer();
    const msgs = Array.from({ length: 100 }, (_, i) => makeMessage(i + 1));
    const { client } = makeTicketDetailClient(baseTicket, [
      { data: msgs, nextCursor: "more" },
    ]);
    registerSmartTicketDetailTools(server as never, client);

    const result = await tools.get("gorgias_smart_get_ticket")!.handler({ id: 1, max_messages: 50 });
    const json = await getResponseJson(result);
    expect(String(json._hint)).toMatch(/PARTIAL CONVERSATION/);
  });

  it("C3.13: max_messages=6000 rejected by Zod (hard cap 5000)", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerSmartTicketDetailTools(server as never, client);

    const shape = tools.get("gorgias_smart_get_ticket")!.config.inputSchema!;
    expect((shape.max_messages as z.ZodTypeAny).safeParse(6000).success).toBe(false);
  });

  it("C3.14: max_messages=0 rejected by Zod", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerSmartTicketDetailTools(server as never, client);

    const shape = tools.get("gorgias_smart_get_ticket")!.config.inputSchema!;
    expect((shape.max_messages as z.ZodTypeAny).safeParse(0).success).toBe(false);
  });

  it("C3.15: wire format: limit=100 on every messages page", async () => {
    const { server, tools } = makeStubServer();
    const msgs = Array.from({ length: 31 }, (_, i) => makeMessage(i + 1));
    const { client, calls } = makeTicketDetailClient(baseTicket, [
      { data: msgs.slice(0, 30), nextCursor: "p2" },
      { data: msgs.slice(30), nextCursor: null },
    ]);
    registerSmartTicketDetailTools(server as never, client);

    await tools.get("gorgias_smart_get_ticket")!.handler({ id: 1 });
    const msgCalls = calls.filter(c => c.path.includes("/messages"));
    expect(msgCalls.length).toBe(2);
    expect(msgCalls[0].query).toEqual({ limit: 100 });
    expect(msgCalls[1].query).toEqual({ limit: 100, cursor: "p2" });
  });

  it("C3.16: default max_messages is 1000", () => {
    const { server, tools } = makeStubServer();
    const { client } = makeStubClient();
    registerSmartTicketDetailTools(server as never, client);

    const shape = tools.get("gorgias_smart_get_ticket")!.config.inputSchema!;
    // max_messages is optional, meaning omission uses default 1000
    expect(shape.max_messages).toBeDefined();
    expect((shape.max_messages as z.ZodTypeAny).safeParse(undefined).success).toBe(true);
  });
});
