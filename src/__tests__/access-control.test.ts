import { describe, it, expect, afterEach } from "vitest";
import { isToolAllowed, AGENT_WRITE_TOOLS, getAccessLevel } from "../access-control.js";

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
