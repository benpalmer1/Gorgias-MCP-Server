import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerSearchTools(server: McpServer, client: GorgiasClient) {

  // --- Search ---
  server.registerTool("gorgias_search", {
    title: "Search",
    description: "POST /api/search — Low-level search for Gorgias resources by text query. For intelligent ticket search with auto-detection of emails, names, views, tags, and keywords, use gorgias_smart_search instead. The type parameter controls what is searched: 'customer' searches names and emails; 'customer_profile' searches names, emails, and all channel addresses (phones, emails, etc.); 'agent' searches agents; 'team' searches teams; 'tag' searches tags; 'integration' searches integrations; 'customer_channel' searches customer channel data; 'customer_channel_email' searches customer channel email addresses; 'customer_channel_phone' searches customer channel phone numbers; 'customers_by_phone' finds customers by phone number.",
    inputSchema: {
      type: z.enum([
        "agent",
        "customer",
        "customer_profile",
        "customer_channel",
        "customer_channel_email",
        "customer_channel_phone",
        "customers_by_phone",
        "integration",
        "team",
        "tag",
      ]).describe("The type of search to perform. Determines which resource category is searched and how results are matched."),
      query: z.string().default("").describe("Text query used to search for resources. Defaults to empty string which returns all/recent resources of the specified type."),
      size: z.number().min(1).max(50).optional().describe("Maximum number of results returned (default: 10, max: 50)."),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async (args) => {
    const results = await client.search(args);
    return { content: [{ type: "text" as const, text: JSON.stringify(results, null, 2) }] };
  }));
}
