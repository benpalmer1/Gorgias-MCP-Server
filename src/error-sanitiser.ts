/**
 * Sanitises error messages before they reach an LLM consumer,
 * stripping credentials, tokens, internal paths, and other sensitive data.
 */

const GENERIC_MESSAGE = "An internal error occurred";

/**
 * Ordered list of patterns to redact.  Each regex is applied globally
 * against the message string and every match is replaced with [REDACTED].
 *
 * Order matters where patterns overlap — more specific patterns come first
 * so that, e.g., a JWT inside a Bearer header is caught by the Bearer rule
 * rather than leaving a partial token behind.
 */
const REDACTION_PATTERNS: { pattern: RegExp; replacement: string }[] = [
  // Bearer tokens  (must precede the standalone JWT rule)
  { pattern: /Bearer\s+\S+/gi, replacement: "[REDACTED]" },

  // Basic Auth headers
  { pattern: /Basic\s+[A-Za-z0-9+/=]{8,}/gi, replacement: "[REDACTED]" },

  // JWT tokens  (three base64url segments separated by dots)
  { pattern: /eyJ[A-Za-z0-9_-]+\.eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+/g, replacement: "[REDACTED]" },

  // Connection strings  (postgres://, mysql://, mongodb://, redis://)
  { pattern: /(?:postgres|mysql|mongodb|redis):\/\/\S+/gi, replacement: "[REDACTED]" },

  // API key parameters  (key=…, apiKey=…, api_key=…, password=…, token=…, secret=…, client_secret=…)
  { pattern: /(?:api[_-]?key|api[_-]?secret|access[_-]?key|password|token|secret|client[_-]?secret)\s*=\s*[^&\s;]+/gi, replacement: "[REDACTED]" },

  // SQL statements  (SELECT … | INSERT … | UPDATE … | DELETE … FROM)
  { pattern: /\bSELECT\b.+?(?:;|$)/gim, replacement: "[REDACTED]" },
  { pattern: /\bINSERT\b.+?(?:;|$)/gim, replacement: "[REDACTED]" },
  { pattern: /\bUPDATE\b.+?(?:;|$)/gim, replacement: "[REDACTED]" },
  { pattern: /\bDELETE\b.+?\bFROM\b.+?(?:;|$)/gim, replacement: "[REDACTED]" },

  // Windows file paths  (C:\…)
  { pattern: /[A-Z]:\\[\w\\. -]+/g, replacement: "[REDACTED]" },

  // Unix file paths under sensitive roots (preserve leading whitespace via $1)
  { pattern: /(^|\s)(\/(?:Users|home|var|tmp)\/\S+)/gm, replacement: "$1[REDACTED]" },

  // Internal / private IPv4 addresses
  { pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED]" },
  { pattern: /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED]" },
  { pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED]" },

  // Node.js stack-trace lines  (    at Something (file:line:col))
  { pattern: /^\s*at\s+.+$/gm, replacement: "[REDACTED]" },
];

/**
 * Accept any thrown value, extract its message, strip sensitive content,
 * and return a string safe to surface to an LLM.
 */
export function sanitiseErrorForLLM(error: unknown): string {
  let message: string;

  if (error instanceof Error) {
    message = error.message;
  } else if (typeof error === "string") {
    message = error;
  } else if (
    typeof error === "object" &&
    error !== null &&
    "message" in error &&
    typeof (error as Record<string, unknown>).message === "string"
  ) {
    message = (error as Record<string, unknown>).message as string;
  } else {
    message = String(error);
  }

  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    // Reset lastIndex for stateful (global / multiline) regexes
    pattern.lastIndex = 0;
    message = message.replace(pattern, replacement);
  }

  // Collapse runs of whitespace that redactions may leave behind
  message = message.replace(/\n{3,}/g, "\n\n").trim();

  if (message.length === 0) {
    return GENERIC_MESSAGE;
  }

  return message;
}
