import { describe, it, expect, afterEach } from "vitest";
import {
  isToolAllowed,
  AGENT_WRITE_TOOLS,
  getAccessLevel,
  getAccessFilterStats,
} from "../access-control.js";
import { createGorgiasServer } from "../server.js";

describe("isToolAllowed", () => {
  // --- admin ---
  it("admin allows any tool regardless of annotations", () => {
    expect(isToolAllowed("gorgias_delete_customer", { readOnlyHint: false }, "admin")).toBe(true);
    expect(isToolAllowed("gorgias_list_tickets", { readOnlyHint: true }, "admin")).toBe(true);
  });

  // --- readonly ---
  it("readonly allows tools with readOnlyHint=true", () => {
    expect(isToolAllowed("gorgias_list_tickets", { readOnlyHint: true }, "readonly")).toBe(true);
    expect(isToolAllowed("gorgias_smart_search", { readOnlyHint: true }, "readonly")).toBe(true);
  });

  it("readonly blocks tools without readOnlyHint=true", () => {
    expect(isToolAllowed("gorgias_delete_ticket", { readOnlyHint: false }, "readonly")).toBe(false);
    expect(isToolAllowed("gorgias_create_ticket", {}, "readonly")).toBe(false);
    expect(isToolAllowed("gorgias_update_ticket", { readOnlyHint: false }, "readonly")).toBe(false);
  });

  it("readonly blocks agent write tools", () => {
    expect(isToolAllowed("gorgias_create_message", { readOnlyHint: false }, "readonly")).toBe(false);
    expect(isToolAllowed("gorgias_update_ticket", { readOnlyHint: false }, "readonly")).toBe(false);
  });

  // --- agent ---
  it("agent allows read-only tools", () => {
    expect(isToolAllowed("gorgias_list_tickets", { readOnlyHint: true }, "agent")).toBe(true);
    expect(isToolAllowed("gorgias_smart_stats", { readOnlyHint: true }, "agent")).toBe(true);
  });

  it("agent allows tools in the AGENT_WRITE_TOOLS set", () => {
    for (const tool of AGENT_WRITE_TOOLS) {
      expect(isToolAllowed(tool, { readOnlyHint: false }, "agent")).toBe(true);
    }
  });

  it("agent blocks destructive tools not in the allowlist", () => {
    expect(isToolAllowed("gorgias_delete_ticket", { readOnlyHint: false }, "agent")).toBe(false);
    expect(isToolAllowed("gorgias_delete_customer", { readOnlyHint: false }, "agent")).toBe(false);
    expect(isToolAllowed("gorgias_merge_customers", { readOnlyHint: false }, "agent")).toBe(false);
    expect(isToolAllowed("gorgias_delete_user", { readOnlyHint: false }, "agent")).toBe(false);
    expect(isToolAllowed("gorgias_update_rule", { readOnlyHint: false }, "agent")).toBe(false);
    expect(isToolAllowed("gorgias_create_macro", { readOnlyHint: false }, "agent")).toBe(false);
  });

  it("agent blocks account/settings modification", () => {
    expect(isToolAllowed("gorgias_create_account_setting", { readOnlyHint: false }, "agent")).toBe(false);
    expect(isToolAllowed("gorgias_update_account_setting", { readOnlyHint: false }, "agent")).toBe(false);
  });
});

describe("AGENT_WRITE_TOOLS", () => {
  it("includes expected ticket lifecycle tools", () => {
    expect(AGENT_WRITE_TOOLS.has("gorgias_create_ticket")).toBe(true);
    expect(AGENT_WRITE_TOOLS.has("gorgias_update_ticket")).toBe(true);
  });

  it("includes messaging tools", () => {
    expect(AGENT_WRITE_TOOLS.has("gorgias_create_message")).toBe(true);
    expect(AGENT_WRITE_TOOLS.has("gorgias_update_message")).toBe(true);
  });

  it("includes tag management tools", () => {
    expect(AGENT_WRITE_TOOLS.has("gorgias_add_ticket_tags")).toBe(true);
    expect(AGENT_WRITE_TOOLS.has("gorgias_remove_ticket_tags")).toBe(true);
    expect(AGENT_WRITE_TOOLS.has("gorgias_set_ticket_tags")).toBe(true);
  });

  it("does NOT include delete tools", () => {
    expect(AGENT_WRITE_TOOLS.has("gorgias_delete_ticket")).toBe(false);
    expect(AGENT_WRITE_TOOLS.has("gorgias_delete_customer")).toBe(false);
    expect(AGENT_WRITE_TOOLS.has("gorgias_delete_message")).toBe(false);
  });

  it("does NOT include admin tools", () => {
    expect(AGENT_WRITE_TOOLS.has("gorgias_create_rule")).toBe(false);
    expect(AGENT_WRITE_TOOLS.has("gorgias_update_macro")).toBe(false);
    expect(AGENT_WRITE_TOOLS.has("gorgias_create_integration")).toBe(false);
    expect(AGENT_WRITE_TOOLS.has("gorgias_create_user")).toBe(false);
  });
});

describe("getAccessLevel", () => {
  const originalEnv = process.env.GORGIAS_ACCESS_LEVEL;

  afterEach(() => {
    if (originalEnv === undefined) {
      delete process.env.GORGIAS_ACCESS_LEVEL;
    } else {
      process.env.GORGIAS_ACCESS_LEVEL = originalEnv;
    }
  });

  it("defaults to admin when env var is not set", () => {
    delete process.env.GORGIAS_ACCESS_LEVEL;
    expect(getAccessLevel()).toBe("admin");
  });

  it("returns readonly for GORGIAS_ACCESS_LEVEL=readonly", () => {
    process.env.GORGIAS_ACCESS_LEVEL = "readonly";
    expect(getAccessLevel()).toBe("readonly");
  });

  it("returns agent for GORGIAS_ACCESS_LEVEL=agent", () => {
    process.env.GORGIAS_ACCESS_LEVEL = "agent";
    expect(getAccessLevel()).toBe("agent");
  });

  it("is case-insensitive", () => {
    process.env.GORGIAS_ACCESS_LEVEL = "ReadOnly";
    expect(getAccessLevel()).toBe("readonly");
  });

  it("trims whitespace", () => {
    process.env.GORGIAS_ACCESS_LEVEL = "  agent  ";
    expect(getAccessLevel()).toBe("agent");
  });

  it("throws for invalid values", () => {
    process.env.GORGIAS_ACCESS_LEVEL = "superadmin";
    expect(() => getAccessLevel()).toThrow("Invalid GORGIAS_ACCESS_LEVEL");
  });
});

// ---------------------------------------------------------------------------
// H17 — getAccessFilterStats survives the rawServer return
// ---------------------------------------------------------------------------

describe("getAccessFilterStats", () => {
  const TEST_CONFIG = {
    domain: "testtenant",
    email: "test@example.com",
    apiKey: "test-key",
  };

  it("admin level: stats are populated and registeredCount > 0", () => {
    const server = createGorgiasServer({ ...TEST_CONFIG, accessLevel: "admin" });
    const stats = getAccessFilterStats(server);
    expect(stats).toBeDefined();
    expect(stats!.registeredCount).toBeGreaterThan(100);
    expect(stats!.skippedCount).toBe(0);
  });

  it("readonly level: stats include both registered and skipped counts", () => {
    const server = createGorgiasServer({ ...TEST_CONFIG, accessLevel: "readonly" });
    const stats = getAccessFilterStats(server);
    expect(stats).toBeDefined();
    expect(stats!.registeredCount).toBeGreaterThan(0);
    expect(stats!.skippedCount).toBeGreaterThan(0);
    // Sum should equal admin's total registration count
    const admin = createGorgiasServer({ ...TEST_CONFIG, accessLevel: "admin" });
    const adminStats = getAccessFilterStats(admin);
    expect(stats!.registeredCount + stats!.skippedCount).toBe(adminStats!.registeredCount);
  });

  it("agent level: registers more than readonly, fewer than admin", () => {
    const readonly = createGorgiasServer({ ...TEST_CONFIG, accessLevel: "readonly" });
    const agent = createGorgiasServer({ ...TEST_CONFIG, accessLevel: "agent" });
    const admin = createGorgiasServer({ ...TEST_CONFIG, accessLevel: "admin" });
    const r = getAccessFilterStats(readonly)!;
    const a = getAccessFilterStats(agent)!;
    const ad = getAccessFilterStats(admin)!;
    expect(a.registeredCount).toBeGreaterThan(r.registeredCount);
    expect(a.registeredCount).toBeLessThan(ad.registeredCount);
    // Agent registered count should equal readonly + AGENT_WRITE_TOOLS size
    expect(a.registeredCount).toBe(r.registeredCount + AGENT_WRITE_TOOLS.size);
  });

  it("readonly skip count includes every AGENT_WRITE_TOOLS entry", () => {
    const readonly = createGorgiasServer({ ...TEST_CONFIG, accessLevel: "readonly" });
    const stats = getAccessFilterStats(readonly)!;
    // skippedCount must be at least the size of AGENT_WRITE_TOOLS (which
    // are all writes that readonly excludes), plus all the other
    // admin-only writes/deletes.
    expect(stats.skippedCount).toBeGreaterThanOrEqual(AGENT_WRITE_TOOLS.size);
  });
});
