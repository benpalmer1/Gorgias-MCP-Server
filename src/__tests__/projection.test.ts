import { describe, it, expect } from "vitest";
import { projectTicket, projectMessage, sortMessagesChronologically } from "../projection.js";

describe("projectTicket", () => {
  const rawTicket = {
    id: 123,
    subject: "Help with order",
    excerpt: "I need help...",
    status: "open",
    priority: "normal",
    channel: "email",
    customer: { email: "alice@example.com", name: "Alice" },
    assignee_user: { name: "Agent Bob" },
    assignee_team: { name: "Support" },
    tags: [{ name: "urgent" }, { name: "shipping" }],
    messages_count: 5,
    created_datetime: "2026-01-01T00:00:00Z",
    last_message_datetime: "2026-01-02T00:00:00Z",
    closed_datetime: null,
    // Noise fields that should be stripped
    uri: "/api/tickets/123",
    external_id: "ext-123",
    via: "email",
    from_agent: false,
    spam: false,
    integrations: [],
    meta: { foo: "bar" },
  };

  it("projects to clean DTO", () => {
    const result = projectTicket(rawTicket);
    expect(result.id).toBe(123);
    expect(result.subject).toBe("Help with order");
    expect(result.status).toBe("open");
    expect(result.customerEmail).toBe("alice@example.com");
    expect(result.customerName).toBe("Alice");
    expect(result.assigneeName).toBe("Agent Bob");
    expect(result.assigneeTeam).toBe("Support");
    expect(result.tags).toEqual(["urgent", "shipping"]);
    expect(result.messagesCount).toBe(5);
  });

  it("strips noise fields", () => {
    const result = projectTicket(rawTicket);
    expect("uri" in result).toBe(false);
    expect("external_id" in result).toBe(false);
    expect("via" in result).toBe(false);
    expect("from_agent" in result).toBe(false);
    expect("spam" in result).toBe(false);
    expect("integrations" in result).toBe(false);
    expect("meta" in result).toBe(false);
  });

  it("uses actualMessageCount when provided (stale count fix)", () => {
    const result = projectTicket(rawTicket, 8);
    expect(result.messagesCount).toBe(8);
  });

  it("handles null customer", () => {
    const result = projectTicket({ ...rawTicket, customer: null });
    expect(result.customerEmail).toBeNull();
    expect(result.customerName).toBeNull();
  });

  it("handles null assignees", () => {
    const result = projectTicket({ ...rawTicket, assignee_user: null, assignee_team: null });
    expect(result.assigneeName).toBeNull();
    expect(result.assigneeTeam).toBeNull();
  });

  it("trims trailing whitespace from customer name", () => {
    const result = projectTicket({ ...rawTicket, customer: { email: "a@b.com", name: "Henry " } });
    expect(result.customerName).toBe("Henry");
  });

  it("trims trailing whitespace from assignee name", () => {
    const result = projectTicket({ ...rawTicket, assignee_user: { name: "Sarah " } });
    expect(result.assigneeName).toBe("Sarah");
  });

  it("trims trailing whitespace from assignee team name", () => {
    const result = projectTicket({ ...rawTicket, assignee_team: { name: "  Support Team  " } });
    expect(result.assigneeTeam).toBe("Support Team");
  });

  it("trims whitespace from tag names", () => {
    const result = projectTicket({ ...rawTicket, tags: [{ name: " urgent " }, { name: "shipping " }] });
    expect(result.tags).toEqual(["urgent", "shipping"]);
  });

  it("defaults tags to empty array when tags property is missing", () => {
    const ticketWithoutTags = {
      id: 900,
      subject: "No tags ticket",
      status: "open",
      priority: "low",
      created_datetime: "2026-02-01T00:00:00Z",
    };
    const result = projectTicket(ticketWithoutTags);
    expect(result.tags).toEqual([]);
  });

  it("falls back messagesCount to 0 when both actualMessageCount and messages_count are missing", () => {
    const ticketWithoutCount = {
      id: 901,
      subject: "No count ticket",
      status: "open",
      priority: "normal",
      created_datetime: "2026-02-02T00:00:00Z",
    };
    const result = projectTicket(ticketWithoutCount);
    expect(result.messagesCount).toBe(0);
  });
});

describe("projectMessage", () => {
  const rawMessage = {
    id: 456,
    from_agent: true,
    public: true,
    sender: { name: "Agent Bob", email: "bob@company.com" },
    stripped_text: "Here is the clean text",
    body_text: "Here is the clean text\n\n> quoted stuff\n\n-- signature",
    channel: "email",
    created_datetime: "2026-01-01T12:00:00Z",
    intents: [{ name: "shipping_inquiry" }, { name: "status_check" }],
  };

  it("projects to clean DTO", () => {
    const result = projectMessage(rawMessage);
    expect(result.id).toBe(456);
    expect(result.fromAgent).toBe(true);
    expect(result.isInternalNote).toBe(false);
    expect(result.senderName).toBe("Agent Bob");
    expect(result.senderEmail).toBe("bob@company.com");
    expect(result.channel).toBe("email");
    expect(result.intents).toEqual(["shipping_inquiry", "status_check"]);
  });

  it("prefers stripped_text over body_text", () => {
    const result = projectMessage(rawMessage);
    expect(result.text).toBe("Here is the clean text");
  });

  it("falls back to body_text when stripped_text missing", () => {
    const result = projectMessage({ ...rawMessage, stripped_text: null });
    expect(result.text).toContain("quoted stuff");
  });

  it("detects internal notes from public=false", () => {
    const result = projectMessage({ ...rawMessage, public: false });
    expect(result.isInternalNote).toBe(true);
  });

  it("handles null sender", () => {
    const result = projectMessage({ ...rawMessage, sender: null });
    expect(result.senderName).toBeNull();
    expect(result.senderEmail).toBeNull();
  });

  it("trims trailing whitespace from sender name", () => {
    const result = projectMessage({ ...rawMessage, sender: { name: "Henry ", email: "h@co.com" } });
    expect(result.senderName).toBe("Henry");
  });

  it("trims whitespace from intent names", () => {
    const result = projectMessage({ ...rawMessage, intents: [{ name: " shipping_inquiry " }] });
    expect(result.intents).toEqual(["shipping_inquiry"]);
  });

  it("handles null/undefined intents", () => {
    expect(projectMessage({ ...rawMessage, intents: null }).intents).toEqual([]);
    expect(projectMessage({ ...rawMessage, intents: undefined }).intents).toEqual([]);
  });

  it("defaults fromAgent to false when from_agent is missing", () => {
    const messageWithoutFromAgent = {
      id: 800,
      created_datetime: "2026-02-01T12:00:00Z",
      sender: { name: "Customer", email: "customer@example.com" },
    };
    const result = projectMessage(messageWithoutFromAgent);
    expect(result.fromAgent).toBe(false);
  });
});

describe("sortMessagesChronologically", () => {
  it("sorts by created_datetime ascending", () => {
    const messages = [
      { id: 3, created_datetime: "2026-01-03T00:00:00Z" },
      { id: 1, created_datetime: "2026-01-01T00:00:00Z" },
      { id: 2, created_datetime: "2026-01-02T00:00:00Z" },
    ];
    const sorted = sortMessagesChronologically(messages);
    expect(sorted.map((m: any) => m.id)).toEqual([1, 2, 3]);
  });

  it("returns new array (not mutating input)", () => {
    const messages = [
      { id: 2, created_datetime: "2026-01-02T00:00:00Z" },
      { id: 1, created_datetime: "2026-01-01T00:00:00Z" },
    ];
    const sorted = sortMessagesChronologically(messages);
    expect(sorted).not.toBe(messages);
    expect(messages[0].id).toBe(2); // original unchanged
  });

  it("handles empty array", () => {
    expect(sortMessagesChronologically([])).toEqual([]);
  });
});
