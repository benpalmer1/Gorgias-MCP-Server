# Contributing

## Getting started

```bash
git clone <repo-url> && cd Gorgias-MCP-Server
npm install
npm run build
npm test
```

Copy `.env.example` to `.env` and fill in your Gorgias credentials. Then run:

```bash
GORGIAS_DOMAIN=mycompany GORGIAS_EMAIL=you@example.com GORGIAS_API_KEY=xxx npm start
```

## Testing with MCP Inspector

The [MCP Inspector](https://github.com/modelcontextprotocol/inspector) lets you call tools interactively:

```bash
GORGIAS_DOMAIN=mycompany GORGIAS_EMAIL=you@example.com GORGIAS_API_KEY=xxx \
  npx @modelcontextprotocol/inspector node dist/index.js
```

## Project structure

| Path | Purpose |
|---|---|
| `src/index.ts` | Entry point -- reads env vars and connects the server to stdio transport |
| `src/server.ts` | Creates the MCP server, instantiates the API client, and registers all tool groups |
| `src/client.ts` | HTTP client wrapping the Gorgias REST API (auth, request helpers) |
| `src/tools/` | One file per API resource (tickets, customers, tags, etc.), each exporting a `registerXxxTools(server, client)` function |
| `src/access-control.ts` | Access level logic -- filters which tools are registered based on `GORGIAS_ACCESS_LEVEL` |
| `src/tool-handler.ts` | `safeHandler` wrapper that catches errors and returns sanitised responses |
| `src/error-sanitiser.ts` | Strips credentials and internal details from error messages before they reach the LLM |
| `src/cache.ts` | In-memory caching layer for frequently-read resources |
| `src/__tests__/` | Unit tests (vitest) |

## Adding a new tool

1. Create or edit a file in `src/tools/` (one file per API resource).
2. Define the input schema with Zod. Add `.describe()` to **every** parameter so the LLM knows what each field does.
3. Wrap the handler with `safeHandler` from `tool-handler.ts` to ensure errors are sanitised.
4. Set `readOnlyHint: true` in the tool's `annotations` for any read-only tool (GET requests).
5. If the tool should be available in `agent` mode, add its name to `AGENT_WRITE_TOOLS` in `access-control.ts`.
6. Import and call `registerXxxTools(server, client)` in `server.ts`.
7. Include the HTTP method and path in the tool description (e.g., `"List tickets (GET /api/tickets)"`).

## Access control

Three tiers controlled by the `GORGIAS_ACCESS_LEVEL` env var:

| Level | What gets registered |
|---|---|
| `readonly` | Only tools with `readOnlyHint: true` in their annotations |
| `agent` | All readonly tools + write tools listed in `AGENT_WRITE_TOOLS` (reply, update ticket, manage tags/custom fields) |
| `admin` | Every tool (default) |

The filtering happens via a `Proxy` in `withAccessFilter()`. Tools that don't pass the check are silently skipped -- they never exist from the LLM's perspective.

When adding a write tool, decide: is it safe for an autonomous support agent? If yes, add it to `AGENT_WRITE_TOOLS`. If it's destructive or admin-only (deleting rules, changing account settings), leave it out -- it will only be available in `admin` mode.

## Code style

- TypeScript strict mode.
- ESM imports with `.js` extensions (e.g., `import { foo } from "./bar.js"`).
- British spelling for function names: `sanitise`, `normalise`, etc.
- 2-space indentation throughout.
- No default exports.

## Tests

Tests live in `src/__tests__/` and use [vitest](https://vitest.dev/). Run them with:

```bash
npm test
```

Name test files `<module>.test.ts` to match the source file they cover.
