import { sanitiseErrorForLLM } from "./error-sanitiser.js";

type ToolResult = { content: { type: "text"; text: string }[]; isError?: boolean };

/**
 * Wraps a tool handler to catch errors and return sanitised error responses.
 * Ensures no raw API errors (which may contain credentials or internal details)
 * are exposed to the LLM consumer.
 */
export function safeHandler<T>(
  handler: (args: T) => Promise<ToolResult>,
): (args: T) => Promise<ToolResult> {
  return async (args: T): Promise<ToolResult> => {
    try {
      return await handler(args);
    } catch (err) {
      let safeError: string;
      try {
        safeError = sanitiseErrorForLLM(err);
      } catch {
        safeError = "An internal error occurred";
      }
      return {
        content: [{
          type: "text" as const,
          text: JSON.stringify({ error: safeError }, null, 2),
        }],
        isError: true,
      };
    }
  };
}
