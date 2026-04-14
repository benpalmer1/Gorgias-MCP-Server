import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import { safeHandler } from "../tool-handler.js";

export function registerFileTools(server: McpServer, client: GorgiasClient) {

  // --- Upload File ---
  server.registerTool("gorgias_upload_file", {
    title: "Upload File",
    description: "POST /api/upload — NOT FUNCTIONAL: This tool cannot upload files because the Gorgias upload endpoint requires multipart/form-data, which this MCP server's JSON-only client does not support. Use the Gorgias web interface or a multipart-capable HTTP client (e.g., curl with -F) to upload files directly via the Gorgias API.",
    inputSchema: {
      name: z.string().describe("The filename/label for the uploaded file (e.g., 'package-damaged.png'). This becomes the file's label on Gorgias's servers"),
      url: z.string().url().describe("The URL of the file to reference. The actual binary upload must be done via multipart/form-data outside of this MCP tool"),
    },
    annotations: { readOnlyHint: false, openWorldHint: true },
  }, safeHandler(async (_args) => {
    return {
        content: [{
            type: "text" as const,
            text: JSON.stringify({
                error: "File upload requires multipart/form-data which is not supported by this MCP server's JSON-only client. Use the Gorgias web interface or a multipart-capable HTTP client for file uploads.",
                _hint: "This endpoint cannot be used through the MCP server. Upload files through the Gorgias UI or API directly.",
            }, null, 2),
        }],
        isError: true,
    };
  }));

  // --- Download File ---
  server.registerTool("gorgias_download_file", {
    title: "Download File",
    description: "GET /api/{file_type}/download/{domain_hash}/{resource_name} — Download a private file hosted on Gorgias's servers. The path parameters are derived from a file's attachment URL: strip the scheme and domain (e.g., 'https://gorgias.io') from the URL and the remaining path segments map to file_type, domain_hash, and resource_name. For example, 'https://gorgias.io/attachments/abc123/file.png' maps to file_type='attachments', domain_hash='abc123', resource_name='file.png'.",
    inputSchema: {
      file_type: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Must contain only alphanumeric characters, hyphens, and underscores").describe("The type/category classification of the file, derived from the attachment URL path (e.g., 'attachments')"),
      domain_hash: z.string().regex(/^[a-zA-Z0-9_-]+$/, "Must contain only alphanumeric characters, hyphens, and underscores").describe("A hashed identifier for the Gorgias account domain, derived from the attachment URL path"),
      resource_name: z.string()
        .regex(/^[a-zA-Z0-9._-]+$/, "Must contain only alphanumeric characters, dots, hyphens, and underscores")
        .refine(v => /[a-zA-Z0-9]/.test(v), "Must contain at least one alphanumeric character")
        .refine(v => !/\.\./.test(v), "Must not contain consecutive dots (path traversal)")
        .describe("The name/identifier of the specific file resource, derived from the attachment URL path (e.g., 'package-damaged.png')"),
    },
    annotations: { readOnlyHint: true, openWorldHint: true },
  }, safeHandler(async ({ file_type, domain_hash, resource_name }) => {
    const result = await client.get(`/api/${file_type}/download/${domain_hash}/${resource_name}`);
    return { content: [{ type: "text" as const, text: JSON.stringify(result, null, 2) }] };
  }));
}
