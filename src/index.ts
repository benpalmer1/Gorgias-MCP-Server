#!/usr/bin/env node

import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createGorgiasServer } from "./server.js";
import { getAccessLevel, getAccessFilterStats } from "./access-control.js";

async function main() {
  const domain = process.env.GORGIAS_DOMAIN;
  const email = process.env.GORGIAS_EMAIL;
  const apiKey = process.env.GORGIAS_API_KEY;

  if (!domain || !email || !apiKey) {
    const missing = [
      !domain && "GORGIAS_DOMAIN",
      !email && "GORGIAS_EMAIL",
      !apiKey && "GORGIAS_API_KEY",
    ].filter(Boolean).join(", ");
    console.error(`Missing required environment variables: ${missing}`);
    process.exit(1);
  }

  const accessLevel = getAccessLevel();

  if (!process.env.GORGIAS_ACCESS_LEVEL?.trim()) {
    console.error(
      `⚠️  GORGIAS_ACCESS_LEVEL not set — defaulting to "admin" (all tools including destructive operations).\n` +
      `Set GORGIAS_ACCESS_LEVEL=readonly or GORGIAS_ACCESS_LEVEL=agent for restricted access.`,
    );
  }

  const server = createGorgiasServer({
    domain,
    email,
    apiKey,
    accessLevel,
  });

  const stats = getAccessFilterStats(server);
  const toolCountInfo = stats
    ? ` — ${stats.registeredCount} tools registered${stats.skippedCount > 0 ? `, ${stats.skippedCount} skipped` : ""}`
    : "";
  console.error(`Gorgias MCP server started${toolCountInfo} (access level: ${accessLevel})`);

  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((error) => {
  const msg = error instanceof Error ? error.message : String(error);
  console.error("Fatal error:", msg);
  process.exit(1);
});
