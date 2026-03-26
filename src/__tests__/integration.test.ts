/**
 * Integration tests against a live Gorgias instance.
 *
 * These tests connect a real MCP Client to the Gorgias MCP Server in-process
 * using InMemoryTransport, then call tools against the live Gorgias API.
 *
 * ALL tests are READ-ONLY — no tickets, customers, or data are created,
 * updated, or deleted. The server runs at "readonly" access level so write
 * tools are not even registered.
 *
 * To run:
 *   GORGIAS_DOMAIN=mycompany GORGIAS_EMAIL=you@co.com GORGIAS_API_KEY=xxx \
 *     RUN_INTEGRATION=1 npm test -- src/__tests__/integration.test.ts
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { createGorgiasServer } from "../server.js";
import type { AccessLevel } from "../access-control.js";
import { AGENT_WRITE_TOOLS } from "../access-control.js";

// ---------------------------------------------------------------------------
// Gate: skip unless explicitly enabled with credentials
// ---------------------------------------------------------------------------

const HAS_CREDENTIALS = !!(
  process.env.GORGIAS_DOMAIN &&
  process.env.GORGIAS_EMAIL &&
  process.env.GORGIAS_API_KEY
);
const SKIP = !process.env.RUN_INTEGRATION || !HAS_CREDENTIALS;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function connectToServer(accessLevel: AccessLevel = "admin") {
  const server = createGorgiasServer({
    domain: process.env.GORGIAS_DOMAIN!,
    email: process.env.GORGIAS_EMAIL!,
    apiKey: process.env.GORGIAS_API_KEY!,
    accessLevel,
  });

  const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
  await server.connect(serverTransport);

  const client = new Client({ name: "integration-test", version: "1.0.0" });
  await client.connect(clientTransport);

  return {
    client,
    close: async () => {
      await client.close();
    },
  };
}

interface ToolCallResult {
  parsed: Record<string, unknown>;
  isError: boolean;
}

async function callTool(
  client: Client,
  name: string,
  args: Record<string, unknown> = {},
): Promise<ToolCallResult> {
  const result = await client.callTool({ name, arguments: args });
  const textContent = (result.content as Array<{ type: string; text?: string }>).find(
    (c) => c.type === "text",
  );
  if (!textContent?.text) {
    throw new Error(`No text content in ${name} response`);
  }
  return {
    parsed: JSON.parse(textContent.text),
    isError: result.isError === true,
  };
}

/** Assert that no tool response leaks the API key or base64 auth header. */
function assertNoCredentialLeak(result: ToolCallResult) {
  const apiKey = process.env.GORGIAS_API_KEY!;
  const email = process.env.GORGIAS_EMAIL!;
  const serialised = JSON.stringify(result.parsed);
  expect(serialised).not.toContain(apiKey);
  expect(serialised).not.toContain(Buffer.from(`${email}:${apiKey}`).toString("base64"));
}

/** Compute a date string N days ago in YYYY-MM-DD format. */
function daysAgo(n: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - n);
  return d.toISOString().slice(0, 10);
}

// =========================================================================
// Access Control — tool registration per level
// =========================================================================

describe.skipIf(SKIP)("Access Control — tool registration", () => {
  it("readonly registers only read tools", async () => {
    const { client, close } = await connectToServer("readonly");
    try {
      const { tools } = await client.listTools();
      const names = new Set(tools.map((t) => t.name));

      // Read tools present
      expect(names.has("gorgias_list_tickets")).toBe(true);
      expect(names.has("gorgias_smart_search")).toBe(true);
      expect(names.has("gorgias_smart_get_ticket")).toBe(true);
      expect(names.has("gorgias_smart_stats")).toBe(true);
      expect(names.has("gorgias_retrieve_account")).toBe(true);
      expect(names.has("gorgias_search")).toBe(true);

      // Write tools absent
      expect(names.has("gorgias_create_ticket")).toBe(false);
      expect(names.has("gorgias_update_ticket")).toBe(false);
      expect(names.has("gorgias_delete_ticket")).toBe(false);
      expect(names.has("gorgias_create_message")).toBe(false);
      expect(names.has("gorgias_create_rule")).toBe(false);
      expect(names.has("gorgias_delete_customer")).toBe(false);

      // Every registered tool should have readOnlyHint
      for (const tool of tools) {
        const annotations = tool.annotations as Record<string, unknown> | undefined;
        expect(annotations?.readOnlyHint).toBe(true);
      }
    } finally {
      await close();
    }
  }, 30_000);

  it("agent registers read + agent-write tools but not admin tools", async () => {
    const { client, close } = await connectToServer("agent");
    try {
      const { tools } = await client.listTools();
      const names = new Set(tools.map((t) => t.name));

      // Read tools present
      expect(names.has("gorgias_list_tickets")).toBe(true);
      expect(names.has("gorgias_smart_search")).toBe(true);

      // Agent write tools present
      for (const tool of AGENT_WRITE_TOOLS) {
        expect(names.has(tool)).toBe(true);
      }

      // Admin-only tools absent
      expect(names.has("gorgias_delete_ticket")).toBe(false);
      expect(names.has("gorgias_delete_customer")).toBe(false);
      expect(names.has("gorgias_create_rule")).toBe(false);
      expect(names.has("gorgias_update_macro")).toBe(false);
      expect(names.has("gorgias_create_user")).toBe(false);
      expect(names.has("gorgias_create_integration")).toBe(false);
    } finally {
      await close();
    }
  }, 30_000);

  it("admin registers all tools", async () => {
    const { client, close } = await connectToServer("admin");
    try {
      const { tools } = await client.listTools();
      const names = new Set(tools.map((t) => t.name));

      // Spot-check destructive/admin tools are present
      expect(names.has("gorgias_delete_ticket")).toBe(true);
      expect(names.has("gorgias_create_rule")).toBe(true);
      expect(names.has("gorgias_create_user")).toBe(true);
      expect(names.has("gorgias_create_integration")).toBe(true);

      // Should have the most tools of any tier
      expect(tools.length).toBeGreaterThanOrEqual(100);
    } finally {
      await close();
    }
  }, 30_000);

  it("readonly < agent < admin tool count", async () => {
    const counts: Record<string, number> = {};
    for (const level of ["readonly", "agent", "admin"] as const) {
      const { client, close } = await connectToServer(level);
      const { tools } = await client.listTools();
      counts[level] = tools.length;
      await close();
    }

    expect(counts.readonly).toBeLessThan(counts.agent);
    expect(counts.agent).toBeLessThan(counts.admin);
  }, 60_000);
});

// =========================================================================
// Live API Tests — readonly connection
// =========================================================================

describe.skipIf(SKIP)("Live API (readonly)", () => {
  let client: Client;
  let close: () => Promise<void>;

  // Discovered data (populated in beforeAll)
  let ticketId: number | null = null;
  let _ticketSubject: string | null = null;
  let customerId: number | null = null;
  let customerEmail: string | null = null;
  let customerName: string | null = null;

  beforeAll(async () => {
    const conn = await connectToServer("readonly");
    client = conn.client;
    close = conn.close;

    // Discover tickets
    const ticketResult = await callTool(client, "gorgias_list_tickets", { limit: 5 });
    const tickets = (ticketResult.parsed as any)?.data;
    if (Array.isArray(tickets) && tickets.length > 0) {
      ticketId = tickets[0].id;
      _ticketSubject = tickets[0].subject;
      if (tickets[0].customer?.email) {
        customerEmail = tickets[0].customer.email;
      }
      if (tickets[0].customer?.id) {
        customerId = tickets[0].customer.id;
      }
      if (tickets[0].customer?.name) {
        customerName = tickets[0].customer.name;
      }
    }

    // Discover customer if not found via ticket
    if (!customerEmail || !customerId) {
      const custResult = await callTool(client, "gorgias_list_customers", { limit: 1 });
      const customers = (custResult.parsed as any)?.data;
      if (Array.isArray(customers) && customers.length > 0) {
        customerId ??= customers[0].id;
        customerEmail ??= customers[0].email;
        customerName ??= customers[0].name;
      }
    }
  }, 60_000);

  afterAll(async () => {
    await close?.();
  });

  // -----------------------------------------------------------------------
  // Account
  // -----------------------------------------------------------------------

  describe("Account", () => {
    it("retrieves account info", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_retrieve_account");
      expect(isError).toBe(false);
      expect(parsed).toHaveProperty("domain");
      expect(parsed).toHaveProperty("status");
      assertNoCredentialLeak({ parsed, isError });
    }, 15_000);
  });

  // -----------------------------------------------------------------------
  // Raw list/get tools — verify response structure
  // -----------------------------------------------------------------------

  describe("Raw List & Get Tools", () => {
    it("lists tickets with pagination metadata", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_list_tickets", { limit: 2 });
      expect(isError).toBe(false);
      expect(parsed).toHaveProperty("data");
      expect(Array.isArray((parsed as any).data)).toBe(true);
      expect(parsed).toHaveProperty("meta");
    }, 15_000);

    it("gets a single ticket by ID", async () => {
      if (!ticketId) return;
      const { parsed, isError } = await callTool(client, "gorgias_get_ticket", { id: ticketId });
      expect(isError).toBe(false);
      expect((parsed as any).id).toBe(ticketId);
      expect(parsed).toHaveProperty("status");
      expect(parsed).toHaveProperty("subject");
    }, 15_000);

    it("lists customers", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_list_customers", { limit: 2 });
      expect(isError).toBe(false);
      expect(Array.isArray((parsed as any).data)).toBe(true);
    }, 15_000);

    it("gets a single customer by ID", async () => {
      if (!customerId) return;
      const { parsed, isError } = await callTool(client, "gorgias_get_customer", {
        id: customerId,
      });
      expect(isError).toBe(false);
      expect((parsed as any).id).toBe(customerId);
    }, 15_000);

    it("lists tags", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_list_tags", { limit: 5 });
      expect(isError).toBe(false);
      expect(parsed).toHaveProperty("data");
    }, 15_000);

    it("lists users", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_list_users", { limit: 5 });
      expect(isError).toBe(false);
      // Users endpoint returns { data: [...] } or plain array
      const data = (parsed as any).data ?? parsed;
      expect(Array.isArray(data) || typeof data === "object").toBe(true);
    }, 15_000);

    it("lists views", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_list_views", { limit: 5 });
      expect(isError).toBe(false);
      expect(parsed).toHaveProperty("data");
    }, 15_000);

    it("lists teams", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_list_teams", { limit: 5 });
      expect(isError).toBe(false);
      // Teams returns a plain array
      expect(
        Array.isArray(parsed) || (typeof parsed === "object" && parsed !== null),
      ).toBe(true);
    }, 15_000);

    it("lists messages (cross-ticket)", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_list_messages", { limit: 2 });
      expect(isError).toBe(false);
      expect(parsed).toHaveProperty("data");
    }, 15_000);

    it("lists ticket messages for a specific ticket", async () => {
      if (!ticketId) return;
      const { parsed, isError } = await callTool(client, "gorgias_list_ticket_messages", {
        ticket_id: ticketId,
      });
      expect(isError).toBe(false);
      // Returns { data: [...] } or plain array
      const data = (parsed as any).data ?? parsed;
      expect(Array.isArray(data) || typeof data === "object").toBe(true);
    }, 15_000);

    it("lists ticket tags for a specific ticket", async () => {
      if (!ticketId) return;
      const { parsed, isError } = await callTool(client, "gorgias_list_ticket_tags", {
        ticket_id: ticketId,
      });
      expect(isError).toBe(false);
      // Returns a direct array
      expect(Array.isArray(parsed) || typeof parsed === "object").toBe(true);
    }, 15_000);

    it("lists custom fields (Ticket)", async () => {
      const { isError } = await callTool(client, "gorgias_list_custom_fields", {
        object_type: "Ticket",
        limit: 5,
      });
      expect(isError).toBe(false);
    }, 15_000);

    it("lists custom fields (Customer)", async () => {
      const { isError } = await callTool(client, "gorgias_list_custom_fields", {
        object_type: "Customer",
        limit: 5,
      });
      expect(isError).toBe(false);
    }, 15_000);

    it("lists rules", async () => {
      const { isError } = await callTool(client, "gorgias_list_rules", { limit: 5 });
      expect(isError).toBe(false);
    }, 15_000);

    it("lists macros", async () => {
      const { isError } = await callTool(client, "gorgias_list_macros", { limit: 5 });
      expect(isError).toBe(false);
    }, 15_000);

    it("lists integrations", async () => {
      const { isError } = await callTool(client, "gorgias_list_integrations", { limit: 5 });
      expect(isError).toBe(false);
    }, 15_000);

    it("lists satisfaction surveys", async () => {
      const { isError } = await callTool(client, "gorgias_list_satisfaction_surveys", {
        limit: 5,
      });
      expect(isError).toBe(false);
    }, 15_000);

    it("lists jobs", async () => {
      const { isError } = await callTool(client, "gorgias_list_jobs", { limit: 5 });
      expect(isError).toBe(false);
    }, 15_000);

    it("lists events", async () => {
      const { isError } = await callTool(client, "gorgias_list_events", { limit: 5 });
      expect(isError).toBe(false);
    }, 15_000);

    it("lists widgets", async () => {
      const { isError } = await callTool(client, "gorgias_list_widgets", { limit: 5 });
      expect(isError).toBe(false);
    }, 15_000);
  });

  // -----------------------------------------------------------------------
  // Search (POST /api/search — read-only semantics)
  // -----------------------------------------------------------------------

  describe("Search", () => {
    it("searches for customers by name", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_search", {
        type: "customer",
        query: customerName ?? "",
        size: 5,
      });
      expect(isError).toBe(false);
      expect(Array.isArray(parsed)).toBe(true);
    }, 15_000);

    it("searches for tags", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_search", {
        type: "tag",
        query: "",
        size: 5,
      });
      expect(isError).toBe(false);
      expect(Array.isArray(parsed)).toBe(true);
    }, 15_000);

    it("searches for agents", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_search", {
        type: "agent",
        query: "",
        size: 5,
      });
      expect(isError).toBe(false);
      expect(Array.isArray(parsed)).toBe(true);
    }, 15_000);
  });

  // -----------------------------------------------------------------------
  // Smart Search
  // -----------------------------------------------------------------------

  describe("Smart Search", () => {
    it("auto-detects email and finds customer tickets", async () => {
      if (!customerEmail) return;
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: customerEmail,
      });
      expect(isError).toBe(false);
      expect((parsed as any).searchStrategy).toBe("email");
      expect(Array.isArray((parsed as any).tickets)).toBe(true);
      expect(parsed).toHaveProperty("totalFound");
      expect(parsed).toHaveProperty("_hint");
    }, 15_000);

    it("auto-detects ticket ID with # prefix", async () => {
      if (!ticketId) return;
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: `#${ticketId}`,
      });
      expect(isError).toBe(false);
      expect((parsed as any).searchStrategy).toBe("ticket_id");
      expect((parsed as any).tickets).toHaveLength(1);
      expect((parsed as any).tickets[0].id).toBe(ticketId);
    }, 15_000);

    it("auto-detects ticket ID with bare number (4+ digits)", async () => {
      if (!ticketId || ticketId < 1000) return;
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: String(ticketId),
      });
      expect(isError).toBe(false);
      expect((parsed as any).searchStrategy).toBe("ticket_id");
    }, 15_000);

    it("auto-detects generic query and returns recent tickets", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: "tickets",
      });
      expect(isError).toBe(false);
      expect((parsed as any).searchStrategy).toBe("recent");
      expect(Array.isArray((parsed as any).tickets)).toBe(true);
    }, 15_000);

    it("auto-detects topic keyword and runs keyword search", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: "refund",
      });
      expect(isError).toBe(false);
      expect((parsed as any).searchStrategy).toBe("keyword");
      expect(Array.isArray((parsed as any).tickets)).toBe(true);
    }, 15_000);

    it("explicit search_type=ticket_id routes correctly", async () => {
      if (!ticketId) return;
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: String(ticketId),
        search_type: "ticket_id",
      });
      expect(isError).toBe(false);
      expect((parsed as any).searchStrategy).toBe("ticket_id");
      expect((parsed as any).tickets[0].id).toBe(ticketId);
    }, 15_000);

    it("explicit search_type=keyword runs full-text search", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: "order",
        search_type: "keyword",
      });
      expect(isError).toBe(false);
      expect((parsed as any).searchStrategy).toBe("keyword");
    }, 15_000);

    it("explicit search_type=email searches by email", async () => {
      if (!customerEmail) return;
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: customerEmail,
        search_type: "email",
      });
      expect(isError).toBe(false);
      expect((parsed as any).searchStrategy).toBe("email");
    }, 15_000);

    it("applies status filter", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: "tickets",
        status: "open",
      });
      expect(isError).toBe(false);
      const tickets = (parsed as any).tickets as Array<{ status: string }>;
      for (const t of tickets) {
        expect(t.status).toBe("open");
      }
    }, 15_000);

    it("applies limit", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: "tickets",
        limit: 3,
      });
      expect(isError).toBe(false);
      expect((parsed as any).tickets.length).toBeLessThanOrEqual(3);
    }, 15_000);

    it("returns projected ticket fields, not raw API noise", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_search", {
        query: "tickets",
        limit: 1,
      });
      expect(isError).toBe(false);
      const tickets = (parsed as any).tickets;
      if (tickets.length > 0) {
        const t = tickets[0];
        // Projected fields present
        expect(t).toHaveProperty("id");
        expect(t).toHaveProperty("status");
        expect(t).toHaveProperty("priority");
        expect(t).toHaveProperty("tags");
        expect(t).toHaveProperty("messagesCount");
        // Raw API noise stripped
        expect(t).not.toHaveProperty("uri");
        expect(t).not.toHaveProperty("integrations");
        expect(t).not.toHaveProperty("spam");
        expect(t).not.toHaveProperty("via");
      }
    }, 15_000);

    it("no credentials in search results", async () => {
      const result = await callTool(client, "gorgias_smart_search", { query: "tickets" });
      assertNoCredentialLeak(result);
    }, 15_000);
  });

  // -----------------------------------------------------------------------
  // Smart Get Ticket
  // -----------------------------------------------------------------------

  describe("Smart Get Ticket", () => {
    it("returns projected ticket with messages", async () => {
      if (!ticketId) return;
      const { parsed, isError } = await callTool(client, "gorgias_smart_get_ticket", {
        id: ticketId,
      });
      expect(isError).toBe(false);

      // Ticket object
      const ticket = (parsed as any).ticket;
      expect(ticket).toBeDefined();
      expect(ticket.id).toBe(ticketId);
      expect(ticket).toHaveProperty("subject");
      expect(ticket).toHaveProperty("status");
      expect(ticket).toHaveProperty("priority");
      expect(ticket).toHaveProperty("customerEmail");
      expect(ticket).toHaveProperty("assigneeName");
      expect(ticket).toHaveProperty("tags");
      expect(ticket).toHaveProperty("messagesCount");

      // Messages array
      const messages = (parsed as any).messages;
      expect(Array.isArray(messages)).toBe(true);

      // Hint
      expect((parsed as any)._hint).toBeDefined();
      expect(typeof (parsed as any)._hint).toBe("string");
    }, 15_000);

    it("messages are sorted chronologically (oldest first)", async () => {
      if (!ticketId) return;
      const { parsed } = await callTool(client, "gorgias_smart_get_ticket", { id: ticketId });
      const messages = (parsed as any).messages as Array<{ createdAt: string | null }>;
      if (messages.length >= 2) {
        for (let i = 1; i < messages.length; i++) {
          if (messages[i].createdAt && messages[i - 1].createdAt) {
            expect(new Date(messages[i].createdAt!).getTime()).toBeGreaterThanOrEqual(
              new Date(messages[i - 1].createdAt!).getTime(),
            );
          }
        }
      }
    }, 15_000);

    it("messages have projected fields, not raw API fields", async () => {
      if (!ticketId) return;
      const { parsed } = await callTool(client, "gorgias_smart_get_ticket", { id: ticketId });
      const messages = (parsed as any).messages;
      if (messages.length > 0) {
        const m = messages[0];
        // Projected fields present
        expect(m).toHaveProperty("id");
        expect(m).toHaveProperty("fromAgent");
        expect(m).toHaveProperty("isInternalNote");
        expect(m).toHaveProperty("senderName");
        expect(m).toHaveProperty("text");
        expect(m).toHaveProperty("channel");
        expect(m).toHaveProperty("createdAt");
        // Raw noise stripped
        expect(m).not.toHaveProperty("body_html");
        expect(m).not.toHaveProperty("stripped_html");
        expect(m).not.toHaveProperty("uri");
        expect(m).not.toHaveProperty("actions");
      }
    }, 15_000);

    it("messagesCount matches actual fetched messages", async () => {
      if (!ticketId) return;
      const { parsed } = await callTool(client, "gorgias_smart_get_ticket", { id: ticketId });
      const ticket = (parsed as any).ticket;
      const messages = (parsed as any).messages;
      expect(ticket.messagesCount).toBe(messages.length);
    }, 15_000);

    it("returns clean error for non-existent ticket", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_get_ticket", {
        id: 999999999,
      });
      expect(isError).toBe(true);
      expect((parsed as any)._hint).toBeDefined();
      assertNoCredentialLeak({ parsed, isError });
    }, 15_000);

    it("no credentials in ticket detail", async () => {
      if (!ticketId) return;
      const result = await callTool(client, "gorgias_smart_get_ticket", { id: ticketId });
      assertNoCredentialLeak(result);
    }, 15_000);
  });

  // -----------------------------------------------------------------------
  // Smart Stats
  // -----------------------------------------------------------------------

  describe("Smart Stats", () => {
    const startDate = daysAgo(30);
    const endDate = daysAgo(1);

    it("tickets-created scope returns data with columns", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "tickets-created",
        start_date: startDate,
        end_date: endDate,
      });
      expect(isError).toBe(false);
      expect((parsed as any).scope).toBe("tickets-created");
      expect((parsed as any).dateRange).toEqual({ start: startDate, end: endDate });
      expect(Array.isArray((parsed as any).data)).toBe(true);
      expect(typeof (parsed as any).totalRows).toBe("number");
      expect((parsed as any)._hint).toBeDefined();
    }, 30_000);

    it("tickets-closed scope returns data", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "tickets-closed",
        start_date: startDate,
        end_date: endDate,
      });
      expect(isError).toBe(false);
      expect((parsed as any).scope).toBe("tickets-closed");
    }, 30_000);

    it("first-response-time scope returns data", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "first-response-time",
        start_date: startDate,
        end_date: endDate,
      });
      expect(isError).toBe(false);
      expect((parsed as any).scope).toBe("first-response-time");
    }, 30_000);

    it("dimension alias 'agent' resolves to agentId", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "tickets-created",
        start_date: startDate,
        end_date: endDate,
        dimensions: ["agent"],
      });
      expect(isError).toBe(false);
      // If there is data, rows should have agentId and resolved agentName
      const data = (parsed as any).data as Array<Record<string, unknown>>;
      if (data.length > 0) {
        expect(data[0]).toHaveProperty("agentId");
        expect(data[0]).toHaveProperty("agentName");
      }
      expect((parsed as any)._hint).toContain("Agent names have been resolved");
    }, 30_000);

    it("rejects broken scope with clear error", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "automation-rate",
        start_date: startDate,
        end_date: endDate,
      });
      expect(isError).toBe(true);
      expect((parsed as any)._hint).toContain("known to be broken");
      expect((parsed as any).scope).toBe("automation-rate");
    }, 15_000);

    it("rejects invalid dimension with valid alternatives", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "tickets-created",
        start_date: startDate,
        end_date: endDate,
        dimensions: ["totallyBogus"],
      });
      expect(isError).toBe(true);
      expect((parsed as any).error).toContain("Invalid dimensions");
      expect(Array.isArray((parsed as any).validDimensions)).toBe(true);
      expect((parsed as any).validDimensions.length).toBeGreaterThan(0);
    }, 15_000);

    it("rejects ticket-fields scope without required customFieldId filter", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "ticket-fields",
        start_date: startDate,
        end_date: endDate,
      });
      expect(isError).toBe(true);
      expect((parsed as any)._hint).toContain("customFieldId");
    }, 15_000);

    it("respects granularity parameter", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "tickets-created",
        start_date: startDate,
        end_date: endDate,
        granularity: "week",
      });
      expect(isError).toBe(false);
      expect((parsed as any).granularity).toBe("week");
    }, 30_000);

    it("respects timezone parameter", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_smart_stats", {
        scope: "tickets-created",
        start_date: startDate,
        end_date: endDate,
        timezone: "America/New_York",
      });
      expect(isError).toBe(false);
      expect((parsed as any).timezone).toBe("America/New_York");
    }, 30_000);

    it("no credentials in stats results", async () => {
      const result = await callTool(client, "gorgias_smart_stats", {
        scope: "tickets-created",
        start_date: startDate,
        end_date: endDate,
      });
      assertNoCredentialLeak(result);
    }, 15_000);
  });

  // -----------------------------------------------------------------------
  // Error Handling & Security
  // -----------------------------------------------------------------------

  describe("Error Handling & Security", () => {
    it("returns sanitised error for invalid ticket ID (raw tool)", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_get_ticket", {
        id: 999999999,
      });
      expect(isError).toBe(true);
      assertNoCredentialLeak({ parsed, isError });
    }, 15_000);

    it("returns sanitised error for invalid customer ID", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_get_customer", {
        id: 999999999,
      });
      expect(isError).toBe(true);
      assertNoCredentialLeak({ parsed, isError });
    }, 15_000);

    it("error from smart search does not leak credentials", async () => {
      // Search for a non-existent email should succeed with 0 results, not error.
      // But even if it errors internally, credentials must be stripped.
      const result = await callTool(client, "gorgias_smart_search", {
        query: "nonexistent_user_zzz999@fakeemail.example",
      });
      assertNoCredentialLeak(result);
    }, 15_000);

    it("every error response contains a JSON error field", async () => {
      const { parsed, isError } = await callTool(client, "gorgias_get_ticket", {
        id: 999999999,
      });
      if (isError) {
        expect(parsed).toHaveProperty("error");
        expect(typeof (parsed as any).error).toBe("string");
      }
    }, 15_000);
  });
});
