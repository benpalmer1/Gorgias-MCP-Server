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

  // Vendor-specific API key prefixes that are uniquely identifiable.
  // These are caught even when they appear bare (without a key=value wrapper).
  { pattern: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bpk_(?:live|test)_[A-Za-z0-9]{16,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bwhsec_[A-Za-z0-9]{16,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bghp_[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bgho_[A-Za-z0-9]{20,}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bAKIA[0-9A-Z]{16}\b/g, replacement: "[REDACTED]" },
  { pattern: /\bAIza[0-9A-Za-z_-]{20,}\b/g, replacement: "[REDACTED]" },

  // Email addresses (customer PII).
  // Replace the email itself but keep the surrounding sentence structure.
  { pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g, replacement: "[REDACTED_EMAIL]" },

  // SQL statements — case-sensitive uppercase keywords AND a terminating
  // semicolon are required, to avoid false-positives on ordinary English
  // ("Please SELECT a ticket from the dropdown", "Failed to UPDATE the
  // ticket"). The previous patterns ate everything from the first
  // matching keyword to end of line, eating legitimate prose.
  //
  // Real SQL emitted by database driver error messages almost always
  // includes the trailing semicolon; English prose almost never does.
  // We accept the small false-negative risk (a SQL fragment without `;`
  // slipping through) in exchange for zero false-positives on prose.
  { pattern: /\bSELECT\s+[\w\s,*().`"]+\s+FROM\s+\w[\s\S]*?;/g, replacement: "[REDACTED]" },
  { pattern: /\bINSERT\s+INTO\s+\w[\s\S]*?;/g, replacement: "[REDACTED]" },
  { pattern: /\bUPDATE\s+\w+\s+SET\s+[\s\S]*?;/g, replacement: "[REDACTED]" },
  { pattern: /\bDELETE\s+FROM\s+\w[\s\S]*?;/g, replacement: "[REDACTED]" },

  // Windows file paths  (C:\… or c:\…) — case-insensitive drive letter
  { pattern: /[A-Za-z]:\\[\w\\. -]+/g, replacement: "[REDACTED]" },

  // UNC paths  (\\server\share\…)
  { pattern: /\\\\[A-Za-z0-9._-]+\\[^\s]+/g, replacement: "[REDACTED]" },

  // Unix file paths under sensitive roots (preserve leading whitespace via $1).
  // Coverage extended beyond the original {Users,home,var,tmp} set.
  { pattern: /(^|\s)(\/(?:Users|home|var|tmp|etc|root|proc|sys|opt|srv|mnt|private)\/\S+)/gm, replacement: "$1[REDACTED]" },

  // Internal / private IPv4 addresses
  { pattern: /\b10\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED]" },
  { pattern: /\b172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED]" },
  { pattern: /\b192\.168\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED]" },
  // Loopback IPv4
  { pattern: /\b127\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED]" },
  // Link-local IPv4
  { pattern: /\b169\.254\.\d{1,3}\.\d{1,3}\b/g, replacement: "[REDACTED]" },
  // IPv6 loopback and link-local / ULA. The patterns below are
  // intentionally narrow to avoid eating ordinary text containing colons.
  { pattern: /(?<![A-Za-z0-9:])::1(?![A-Za-z0-9:])/g, replacement: "[REDACTED]" },
  { pattern: /\bfe80::[0-9a-fA-F:]+\b/g, replacement: "[REDACTED]" },
  { pattern: /\bfc[0-9a-fA-F]{2}::[0-9a-fA-F:]+\b/g, replacement: "[REDACTED]" },
  { pattern: /\bfd[0-9a-fA-F]{2}::[0-9a-fA-F:]+\b/g, replacement: "[REDACTED]" },

  // Node.js stack-trace lines — require the (file:line:col) suffix to avoid
  // false-positives on prose beginning with "At " (L4).
  { pattern: /^\s*at\s+\S+\s+\(.+?:\d+:\d+\)\s*$/gm, replacement: "[REDACTED]" },
];

const MAX_CAUSE_DEPTH = 5;

/**
 * Walk the `.cause` chain of an error (up to MAX_CAUSE_DEPTH levels),
 * collecting each message. Cycle-safe via a `seen` set.
 * `error.stack` is deliberately excluded — high-noise, low-signal for LLMs.
 */
function extractFullMessage(error: unknown): string {
  const parts: string[] = [];
  const seen = new Set<unknown>();
  let current: unknown = error;
  let depth = 0;

  while (current != null && depth < MAX_CAUSE_DEPTH && !seen.has(current)) {
    seen.add(current);
    if (current instanceof Error) {
      parts.push(current.message);
      current = (current as Error & { cause?: unknown }).cause;
    } else if (typeof current === "string") {
      parts.push(current);
      break;
    } else if (
      typeof current === "object" &&
      "message" in (current as object) &&
      typeof (current as { message: unknown }).message === "string"
    ) {
      parts.push((current as { message: string }).message);
      break;
    } else {
      parts.push(String(current));
      break;
    }
    depth++;
  }

  return parts.filter(p => p.length > 0).join(" | caused by: ");
}

/**
 * Accept any thrown value, extract its message (including cause chain),
 * strip sensitive content, and return a string safe to surface to an LLM.
 */
export function sanitiseErrorForLLM(error: unknown): string {
  let message = extractFullMessage(error);

  for (const { pattern, replacement } of REDACTION_PATTERNS) {
    pattern.lastIndex = 0;
    message = message.replace(pattern, replacement);
  }

  message = message.replace(/\n{3,}/g, "\n\n").trim();

  if (message.length === 0) {
    return GENERIC_MESSAGE;
  }

  return message;
}
