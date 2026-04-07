# Gorgias MCP Server

An MCP server that exposes the full Gorgias helpdesk API to AI assistants.

---

## What is this?

Gorgias MCP Server is a [Model Context Protocol](https://modelcontextprotocol.io/) server that gives AI assistants -- Claude, and any other MCP-compatible client -- complete access to the Gorgias helpdesk platform. It ships with **114 tools**: 3 high-level "smart" tools that handle the most common workflows, plus 111 raw API tools covering every Gorgias REST endpoint.

Connect it to Claude Desktop (or any MCP client) and you can search tickets, read conversations, pull analytics, manage customers, and operate your entire helpdesk through natural language.

---

## Example Usage

> **You:** How many tickets did we get last week?
>
> *Claude uses `gorgias_smart_stats`*
>
> You received 142 tickets last week, down 12% from the prior week.
> Top channels: email (89), chat (31), phone (22).
>
> **You:** Show me the open ones about refunds
>
> *Claude uses `gorgias_smart_search`*
>
> Found 8 open tickets matching "refund":
> - #4521 — "Refund not received" (Alice Johnson, 2 days ago)
> - #4518 — "Wrong item, want refund" (Bob Smith, 3 days ago)
> - ...
>
> **You:** What's the conversation in ticket #4521?
>
> *Claude uses `gorgias_smart_get_ticket`*
>
> Ticket #4521 — "Refund not received" (Open, Normal priority)
> Customer Alice Johnson (alice@example.com), assigned to Sarah
>
> - **Mar 24, Alice (customer):** "Hi, I returned my order 2 weeks ago but haven't received my refund yet..."
> - **Mar 24, Sarah (agent):** "I can see your return was received. Let me check the refund status..."
> - **Mar 25, Alice (customer):** "Any update?"

---

## Smart Tools

The three smart tools are the primary interface. They compose multiple API calls, cache reference data, and project responses into clean LLM-friendly formats.

| Tool | Description |
|------|-------------|
| `gorgias_smart_search` | Multi-strategy ticket search. Auto-detects emails, ticket IDs (`#12345`), customer names, view names, and topic keywords. Falls back through progressively broader search strategies to maximise result quality. |
| `gorgias_smart_get_ticket` | Retrieves a ticket with its full conversation thread. Fetches ticket and messages in parallel, sorts chronologically, and projects to a compact format stripped to essential fields. |
| `gorgias_smart_stats` | Analytics with automatic defaults, input validation, dimension resolution, and agent name-to-ID resolution. Covers volume, performance, quality, automation, voice, and breakdown scopes. |

These handle the common 80% of use cases. The 111 raw tools provide direct API access for everything else -- bulk operations, custom field management, rule configuration, and more.

---

## Installation

Requires Node.js 18 or later.

```bash
npm install -g gorgias-mcp-server
```

Or run directly with npx:

```bash
npx gorgias-mcp-server
```

---

## Configuration

Three environment variables are required:

| Variable | Description | Example |
|----------|-------------|---------|
| `GORGIAS_DOMAIN` | Your Gorgias subdomain or full URL | `mycompany` or `mycompany.gorgias.com` |
| `GORGIAS_EMAIL` | Email address of the API user | `admin@mycompany.com` |
| `GORGIAS_API_KEY` | REST API key | `a1b2c3d4e5f6...` |

### Getting your API key

1. Log in to your Gorgias helpdesk
2. Go to **Settings** > **REST API**
3. Click **Add a REST API key**
4. Copy the generated key

The server accepts flexible domain formats: `mycompany`, `mycompany.gorgias.com`, or `https://mycompany.gorgias.com` all work.

### Access levels

Control which tools are exposed to the AI with `GORGIAS_ACCESS_LEVEL`:

| Level | Tools | Use Case |
|-------|-------|----------|
| `readonly` | 52 tools (all read/search/list/smart tools) | Analytics bots, dashboards, monitoring |
| `agent` | 62 tools (readonly + reply, close, tag, reassign) | Customer-facing support chatbots |
| `admin` | All 114 tools (default) | Internal admin tools, full API access |

```bash
GORGIAS_ACCESS_LEVEL=readonly   # Only read operations exposed
GORGIAS_ACCESS_LEVEL=agent      # Read + support agent workflow
GORGIAS_ACCESS_LEVEL=admin      # Full access (default if not set)
```

The **agent** tier allows the chatbot to: create tickets, reply to customers, update messages, update ticket status/priority/assignee, manage ticket tags and custom fields, and update customer field values. It blocks: deletions, account settings, rules, macros, integrations, user management, and team management.

Tools that aren't registered at a given access level are completely invisible to the AI — it cannot see or call them.

---

## MCP Client Setup

### Claude Desktop

Add the following to your `claude_desktop_config.json`:

```json
{
  "mcpServers": {
    "gorgias": {
      "command": "npx",
      "args": ["gorgias-mcp-server"],
      "env": {
        "GORGIAS_DOMAIN": "mycompany",
        "GORGIAS_EMAIL": "admin@mycompany.com",
        "GORGIAS_API_KEY": "your-api-key-here",
        "GORGIAS_ACCESS_LEVEL": "agent"
      }
    }
  }
}
```

The config file is located at:
- **macOS**: `~/Library/Application Support/Claude/claude_desktop_config.json`
- **Linux**: `~/.config/Claude/claude_desktop_config.json`
- **Windows**: `%APPDATA%\Claude\claude_desktop_config.json`

### Claude Code (CLI)

Add the server to your project using `claude mcp add-json`:

```bash
claude mcp add-json gorgias '{
  "command": "npx",
  "args": ["gorgias-mcp-server"],
  "env": {
    "GORGIAS_DOMAIN": "mycompany",
    "GORGIAS_EMAIL": "admin@mycompany.com",
    "GORGIAS_API_KEY": "your-api-key-here",
    "GORGIAS_ACCESS_LEVEL": "readonly"
  }
}' -s project
```

This creates a `.mcp.json` file in the project root. You can also add it at user scope with `-s user`.

Alternatively, create `.mcp.json` manually in your project root:

```json
{
  "mcpServers": {
    "gorgias": {
      "command": "npx",
      "args": ["gorgias-mcp-server"],
      "env": {
        "GORGIAS_DOMAIN": "mycompany",
        "GORGIAS_EMAIL": "admin@mycompany.com",
        "GORGIAS_API_KEY": "your-api-key-here",
        "GORGIAS_ACCESS_LEVEL": "readonly"
      }
    }
  }
}
```

> **Note:** When using `claude mcp add` with `-e KEY=VALUE` flags, place them **before** the `--` separator (e.g., `claude mcp add gorgias -e GORGIAS_DOMAIN=mycompany -- npx gorgias-mcp-server`). Flags after `--` are passed as command arguments, not environment variables. For multiple env vars, `claude mcp add-json` (shown above) is the easiest approach.

> **Note:** If you add the MCP server mid-session, you may need to restart Claude Code (`/quit` and relaunch) for the tools to appear. Verify connection with `claude mcp list`.

### Programmatic Usage (Web Apps & Chatbots)

The package exports a `createGorgiasServer()` factory for embedding in your own application. This is how you integrate Gorgias MCP into a web application chatbot backend.

```bash
npm install gorgias-mcp-server @modelcontextprotocol/sdk
```

#### Express / Node.js

```typescript
import express from "express";
import { randomUUID } from "node:crypto";
import { createGorgiasServer } from "gorgias-mcp-server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

const app = express();
app.use(express.json());

// Create a transport and server per session
const sessions = new Map<string, StreamableHTTPServerTransport>();

// Production: add authentication, CORS, and rate limiting to this endpoint.
app.post("/mcp", async (req, res) => {
  const sessionId = req.headers["mcp-session-id"] as string | undefined;

  if (sessionId && sessions.has(sessionId)) {
    // Existing session — route to its transport
    await sessions.get(sessionId)!.handleRequest(req, res, req.body);
    return;
  }

  // New session — create a server locked to the "agent" tier
  const server = createGorgiasServer({
    domain: process.env.GORGIAS_DOMAIN!,
    email: process.env.GORGIAS_EMAIL!,
    apiKey: process.env.GORGIAS_API_KEY!,
    accessLevel: "agent",
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
  });

  transport.onclose = () => {
    if (transport.sessionId) sessions.delete(transport.sessionId);
  };

  await server.connect(transport);
  if (transport.sessionId) sessions.set(transport.sessionId, transport);
  await transport.handleRequest(req, res, req.body);
});

app.listen(3000);
```

#### Stateless (Serverless / Edge)

For serverless environments where you cannot maintain in-memory sessions:

```typescript
import { createGorgiasServer } from "gorgias-mcp-server";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";

// Conceptual pattern — adapt to your framework's handler signature.
// Maps to: Vercel (req, res), Netlify/AWS Lambda (event, context), Cloudflare Workers (request).
export async function handler(req, res) {
  const server = createGorgiasServer({
    domain: process.env.GORGIAS_DOMAIN!,
    email: process.env.GORGIAS_EMAIL!,
    apiKey: process.env.GORGIAS_API_KEY!,
    accessLevel: "readonly",
  });

  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless mode
  });

  await server.connect(transport);
  await transport.handleRequest(req, res, req.body);
}
```

#### Exported API

```typescript
import {
  createGorgiasServer,  // Factory — returns a configured McpServer
  type GorgiasServerConfig,
  type AccessLevel,       // "readonly" | "agent" | "admin"
  type GorgiasClientConfig,
  isToolAllowed,          // Check if a tool passes an access level
  AGENT_WRITE_TOOLS,      // Set of tool names allowed in agent tier
} from "gorgias-mcp-server";
```

---

## Available Tools

114 tools organised by category:

| Category | Count | Description |
|----------|------:|-------------|
| **Smart Tools** | 3 | Intelligent search, ticket detail, and analytics |
| **Tickets** | 13 | List, get, create, update, delete tickets; manage tags and custom fields on tickets |
| **Customers** | 11 | List, get, create, update, delete customers; merge customers; manage data and field values |
| **Messages** | 6 | List messages by ticket, list all messages, get, create, update, delete |
| **Tags** | 7 | Full CRUD, bulk delete, and tag merging |
| **Views** | 7 | Full CRUD; list and search view items |
| **Statistics & Reporting** | 3 | Retrieve statistics, download statistics, retrieve reporting data |
| **Users** | 6 | User management and lookup |
| **Teams** | 5 | Team management |
| **Rules** | 6 | Automation rule CRUD and management |
| **Macros** | 7 | Macro template CRUD and management |
| **Integrations** | 5 | Integration configuration and management |
| **Custom Fields** | 5 | Custom field definition CRUD |
| **Satisfaction Surveys** | 4 | Survey configuration and results |
| **Jobs** | 5 | Background job tracking and management |
| **Events** | 2 | Event retrieval |
| **Voice Calls** | 7 | Voice call management and logging |
| **Widgets** | 5 | Chat widget configuration |
| **Search** | 1 | Raw full-text search |
| **Account** | 4 | Account settings and configuration |
| **Files** | 2 | File upload and management |

---

## Terminology & Industry Optimisation

The smart tools use topic keyword detection to route queries to the right search strategy. The default keyword set is optimised for ecommerce customer support in Australia, the US, and the UK, covering carriers, regional spelling, payment providers, tax terms, consumer law bodies, and 150+ common ecommerce terms.

To customise for other industries (e.g. SaaS, healthcare, finance), edit the `TOPIC_KEYWORDS` set in `src/tools/smart-search.ts`. The keywords should reflect the vocabulary your customers actually use when contacting support.

---

## Security

- The error sanitiser strips credentials, tokens, and internal URLs from all error messages before they reach the LLM.
- Access levels (`readonly`, `agent`, `admin`) control which tools are exposed. Start with `readonly` unless write access is needed.
- In `agent` mode, the AI **can** send customer-facing messages and modify tickets. Make sure this is intentional before enabling it.
- Customer data (ticket messages, names, email addresses) is passed to the LLM as part of normal MCP operation. If you handle sensitive data, factor this into your compliance review.

---

## Architecture

- **Smart tool composition** -- Smart tools orchestrate multiple API calls with caching, response projection, and fuzzy matching to deliver concise, relevant results.
- **Error sanitisation** -- All errors are stripped of sensitive data (credentials, internal URLs) before being surfaced to the LLM.
- **In-memory TTL cache** -- Reference data (users, tags, views) is cached for 10 minutes to reduce API calls during multi-step workflows.
- **Rate limit handling** -- Respects the Gorgias leaky-bucket rate limiter. Returns clear retry-after information on 429 responses.

---

## Development

### Prerequisites

- Node.js >= 18.0.0

### Scripts

```bash
npm run build        # Compile TypeScript
npm run dev          # Compile in watch mode
npm run lint         # Run ESLint
npm run test         # Run tests once
npm run test:watch   # Run tests in watch mode
```

### Project Structure

```
src/
  server.ts          # Library entry point — createGorgiasServer() factory
  index.ts           # CLI entry point (bin) — reads env vars, connects stdio
  client.ts          # Gorgias API HTTP client
  access-control.ts  # Access level gating (readonly/agent/admin)
  tool-handler.ts    # Shared error wrapper for all tool handlers
  errors.ts          # Custom error types (GorgiasError, GorgiasApiError)
  reporting-knowledge.ts  # Statistics scope/dimension/measure knowledge base
  cache.ts           # In-memory TTL cache for reference data
  projection.ts      # Response projection for LLM-friendly output
  error-sanitiser.ts # Strips sensitive data from errors
  fuzzy-match.ts     # Fuzzy name matching for smart tools
  tools/             # One module per API category + smart tools
```

---

## Acknowledgments

Originally inspired by [mattcoatsworth/Gorgias-MCP-Server](https://github.com/mattcoatsworth/Gorgias-MCP-Server).

---

## Disclaimer

This is an unofficial, community-built project and is not affiliated with, endorsed by, or supported by Gorgias Inc.

---

## License

MIT
