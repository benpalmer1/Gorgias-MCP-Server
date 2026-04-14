import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

/**
 * Access level tiers for the Gorgias MCP Server.
 *
 * - "readonly": Only read/search/list tools are registered. Safe for any bot.
 * - "agent": Readonly + tools needed for support agent workflows (reply, close, tag, reassign).
 * - "admin": All tools registered (default, full API access).
 */
export type AccessLevel = "readonly" | "agent" | "admin";

export const VALID_ACCESS_LEVELS: ReadonlySet<string> = new Set(["readonly", "agent", "admin"]);

/**
 * Write tools allowed in "agent" mode. These cover the typical support
 * chatbot workflow: reply to customers, update ticket state, manage tags
 * and custom fields on tickets. No deletions, no account/rule/macro changes.
 */
export const AGENT_WRITE_TOOLS: ReadonlySet<string> = new Set([
  // Ticket lifecycle
  "gorgias_create_ticket",
  "gorgias_update_ticket",

  // Messaging (reply to customers, create internal notes)
  "gorgias_create_message",
  "gorgias_update_message",

  // Ticket tagging
  "gorgias_add_ticket_tags",
  "gorgias_remove_ticket_tags",
  "gorgias_set_ticket_tags",

  // Ticket custom fields
  "gorgias_update_ticket_field",
  "gorgias_update_ticket_fields",

  // Customer field values (agents often update these during triage)
  "gorgias_update_customer_field_value",
  "gorgias_update_customer_fields",
]);

/**
 * Determines whether a tool should be registered at a given access level.
 *
 * - "admin" allows everything.
 * - "readonly" allows only tools with readOnlyHint=true.
 * - "agent" allows readonly tools + the AGENT_WRITE_TOOLS allowlist.
 */
export function isToolAllowed(
  name: string,
  annotations: { readOnlyHint?: boolean },
  level: AccessLevel,
): boolean {
  if (level === "admin") return true;
  if (annotations.readOnlyHint === true) return true;
  if (level === "agent") return AGENT_WRITE_TOOLS.has(name);
  return false;
}

/**
 * Statistics for tools registered (vs filtered out) by withAccessFilter.
 * The stats live alongside the underlying McpServer in a module-level
 * WeakMap so they remain readable after `withAccessFilter` returns,
 * regardless of whether the consumer has the proxy or the raw server.
 */
export interface AccessFilterStats {
  registeredCount: number;
  skippedCount: number;
}

const accessFilterStatsByServer = new WeakMap<McpServer, AccessFilterStats>();

/**
 * Read the access-filter statistics for a server returned by
 * `createGorgiasServer` (or the underlying server passed to
 * `withAccessFilter`). Returns `undefined` if the server has no
 * recorded stats yet.
 */
export function getAccessFilterStats(server: McpServer): AccessFilterStats | undefined {
  return accessFilterStatsByServer.get(server);
}

/**
 * Returns a proxied McpServer that filters registerTool calls based on
 * the access level. Tools that don't pass the check are silently skipped —
 * they never exist from the LLM's perspective.
 *
 * The proxy only intercepts `registerTool`; all other server methods
 * (connect, close, etc.) pass through unchanged. After registration the
 * caller may safely use either the proxy or the underlying raw server;
 * tool registrations are mutated onto the raw server in either case.
 *
 * Stats (registeredCount + skippedCount) are also stored against the
 * raw server in a module-level WeakMap so callers that hold only the
 * raw server (e.g. createGorgiasServer's return value) can still read
 * them via `getAccessFilterStats`.
 */
export function withAccessFilter(server: McpServer, level: AccessLevel): McpServer {
  // Initialise stats and stash against the raw server for both branches
  // (admin and filtered) so the same `getAccessFilterStats` API works
  // uniformly. Admin mode wraps registerTool too — the wrapper just
  // counts every registration without filtering — so the startup log
  // can show "N tools registered" in admin mode as well.
  const stats: AccessFilterStats = { registeredCount: 0, skippedCount: 0 };
  accessFilterStatsByServer.set(server, stats);

  if (level === "admin") {
    const originalRegisterTool = server.registerTool.bind(server);
    (server as unknown as { registerTool: unknown }).registerTool = (
      ...args: unknown[]
    ) => {
      stats.registeredCount++;
      return (originalRegisterTool as (...a: unknown[]) => unknown)(...args);
    };
    return server;
  }

  const proxy = new Proxy(server, {
    get(target, prop, receiver) {
      if (prop === "registerTool") {
        return function registerToolFiltered(
          name: string,
          config: Record<string, unknown>,
          handler: unknown,
        ) {
          const annotations = (config.annotations ?? {}) as { readOnlyHint?: boolean };

          if (isToolAllowed(name, annotations, level)) {
            stats.registeredCount++;
            return (target.registerTool as (...args: unknown[]) => unknown).call(target, name, config, handler);
          }

          stats.skippedCount++;
        };
      }

      return Reflect.get(target, prop, receiver);
    },
  });

  return proxy as McpServer;
}

/**
 * Reads and validates the GORGIAS_ACCESS_LEVEL environment variable.
 * Defaults to "admin" for backwards compatibility.
 */
export function getAccessLevel(): AccessLevel {
  const raw = process.env.GORGIAS_ACCESS_LEVEL?.toLowerCase().trim();
  if (!raw) return "admin";
  if (VALID_ACCESS_LEVELS.has(raw)) return raw as AccessLevel;

  const valid = [...VALID_ACCESS_LEVELS].join(", ");
  throw new Error(
    `Invalid GORGIAS_ACCESS_LEVEL="${raw}". Valid values: ${valid}`,
  );
}
