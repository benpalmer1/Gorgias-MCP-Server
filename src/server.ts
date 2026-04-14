import { readFileSync } from "node:fs";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { GorgiasClient } from "./client.js";
import { withAccessFilter } from "./access-control.js";
import type { AccessLevel } from "./access-control.js";

// Read version from package.json at module load time.
// Using import.meta.url so this resolves correctly from both src/ and dist/.
const packageJson = JSON.parse(
  readFileSync(new URL("../package.json", import.meta.url), "utf-8"),
);
const VERSION: string = packageJson.version;

// Tool registration modules
import { registerAccountTools } from "./tools/account.js";
import { registerCustomerTools } from "./tools/customers.js";
import { registerCustomFieldTools } from "./tools/custom-fields.js";
import { registerEventTools } from "./tools/events.js";
import { registerFileTools } from "./tools/files.js";
import { registerIntegrationTools } from "./tools/integrations.js";
import { registerJobTools } from "./tools/jobs.js";
import { registerMacroTools } from "./tools/macros.js";
import { registerReportingTools } from "./tools/reporting.js";
import { registerRuleTools } from "./tools/rules.js";
import { registerSatisfactionSurveyTools } from "./tools/satisfaction-surveys.js";
import { registerSearchTools } from "./tools/search.js";
// C15: statistics.ts removed — /api/stats/{name} endpoints return 400 "does not exist"
// on the live API (verified 2026-04-14). Use gorgias_retrieve_reporting_statistic instead.
import { registerTagTools } from "./tools/tags.js";
import { registerTeamTools } from "./tools/teams.js";
import { registerTicketTools } from "./tools/tickets.js";
import { registerTicketMessageTools } from "./tools/ticket-messages.js";
import { registerUserTools } from "./tools/users.js";
import { registerViewTools } from "./tools/views.js";
import { registerVoiceCallTools } from "./tools/voice-calls.js";
import { registerWidgetTools } from "./tools/widgets.js";
import { registerSmartSearchTools } from "./tools/smart-search.js";
import { registerSmartTicketDetailTools } from "./tools/smart-ticket-detail.js";
import { registerSmartStatsTools } from "./tools/smart-stats.js";

export interface GorgiasServerConfig {
  /** Gorgias subdomain, full domain, or full URL. */
  domain: string;
  /** Email address of the API user. */
  email: string;
  /** Gorgias REST API key. */
  apiKey: string;
  /** Access level controlling which tools are registered. Default: "admin". */
  accessLevel?: AccessLevel;
}

/**
 * Creates a configured Gorgias MCP server ready to be connected to any transport.
 *
 * @example
 * ```typescript
 * import { createGorgiasServer } from "gorgias-mcp-server";
 * import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
 *
 * const server = createGorgiasServer({
 *   domain: "mycompany",
 *   email: "admin@mycompany.com",
 *   apiKey: "your-api-key",
 *   accessLevel: "agent",
 * });
 *
 * const transport = new StdioServerTransport();
 * await server.connect(transport);
 * ```
 */
export function createGorgiasServer(config: GorgiasServerConfig): McpServer {
  const accessLevel = config.accessLevel ?? "admin";

  const rawServer = new McpServer({
    name: "gorgias",
    version: VERSION,
  });

  const server = withAccessFilter(rawServer, accessLevel);
  const client = new GorgiasClient({
    domain: config.domain,
    email: config.email,
    apiKey: config.apiKey,
  });

  // Register all tool groups (filtered by access level)
  registerAccountTools(server, client);
  registerCustomerTools(server, client);
  registerCustomFieldTools(server, client);
  registerEventTools(server, client);
  registerFileTools(server, client);
  registerIntegrationTools(server, client);
  registerJobTools(server, client);
  registerMacroTools(server, client);
  registerReportingTools(server, client);
  registerRuleTools(server, client);
  registerSatisfactionSurveyTools(server, client);
  registerSearchTools(server, client);
  // C15: registerStatisticsTools removed — legacy /api/stats/ endpoints don't exist
  registerTagTools(server, client);
  registerTeamTools(server, client);
  registerTicketTools(server, client);
  registerTicketMessageTools(server, client);
  registerUserTools(server, client);
  registerViewTools(server, client);
  registerVoiceCallTools(server, client);
  registerWidgetTools(server, client);

  // Smart tools (enhanced tools with intelligence layer)
  registerSmartSearchTools(server, client);
  registerSmartTicketDetailTools(server, client);
  registerSmartStatsTools(server, client);

  // Return the raw server (not the proxy) because McpServer uses private
  // class fields that cannot be accessed through a Proxy. The proxy is only
  // used during tool registration to enforce access control; once tools are
  // registered, the raw server handles all MCP protocol operations.
  return rawServer;
}

// Re-export types consumers may need
export type { AccessLevel, AccessFilterStats } from "./access-control.js";
export type { GorgiasClientConfig } from "./client.js";
export {
  isToolAllowed,
  AGENT_WRITE_TOOLS,
  getAccessFilterStats,
} from "./access-control.js";
export { GorgiasError, GorgiasApiError } from "./errors.js";
