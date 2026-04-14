/**
 * Domain knowledge for the Gorgias reporting / statistics API.
 *
 * Encodes hard-won knowledge about which scopes support which time
 * dimensions, measures, dimensions, and which scopes are broken.
 * All mappings have been derived from real API responses and error messages.
 */

// ---------------------------------------------------------------------------
// Correct time dimension per scope
// ---------------------------------------------------------------------------

/** Map each statistics scope to its correct time dimension field name. */
export const SCOPE_TIME_DIMENSION: Record<string, string> = {
  "tickets-created": "createdDatetime",
  "tickets-closed": "closedDatetime",
  "tickets-open": "createdDatetime",
  "tickets-replied": "createdDatetime",
  "one-touch-tickets": "closedDatetime",
  "zero-touch-tickets": "closedDatetime",
  "satisfaction-surveys": "createdDatetime",
  "resolution-time": "createdDatetime",
  "messages-sent": "sentDatetime",
  "first-response-time": "firstAgentMessageDatetime",
  "human-first-response-time": "firstAgentMessageDatetime",
  "response-time": "createdDatetime",
  "messages-per-ticket": "createdDatetime",
  "ticket-handle-time": "createdDatetime",
  "online-time": "timestamp",
  "tags": "createdDatetime",
  "auto-qa": "closedDatetime",
  "messages-received": "sentDatetime",
  "automation-rate": "createdDatetime",
  "workload-tickets": "createdDatetime",
  "automated-interactions": "createdDatetime",
  "ticket-fields": "createdDatetime",
  "voice-calls": "createdDatetime",
  "voice-agent-events": "timestamp",
  "ticket-sla": "anchorDatetime",
  "knowledge-insights": "createdDatetime",
  "voice-calls-summary": "createdDatetime",
};

// ---------------------------------------------------------------------------
// Default measures per scope
// ---------------------------------------------------------------------------

/** Map each statistics scope to its default measure names. */
export const SCOPE_DEFAULT_MEASURES: Record<string, string[]> = {
  "tickets-created": ["ticketCount"],
  "tickets-closed": ["ticketCount"],
  "tickets-open": ["ticketCount"],
  "tickets-replied": ["ticketCount"],
  "one-touch-tickets": ["ticketCount"],
  "zero-touch-tickets": ["ticketCount"],
  "satisfaction-surveys": ["averageSurveyScore", "scoredSurveysCount", "responseRate"],
  "resolution-time": ["medianResolutionTime"],
  "messages-sent": ["messagesCount"],
  "first-response-time": ["medianFirstResponseTime"],
  "human-first-response-time": ["medianFirstResponseTime"],
  "response-time": ["medianResponseTime"],
  "messages-per-ticket": ["averageMessagesCount"],
  "ticket-handle-time": ["averageHandleTime"],
  "online-time": ["onlineTime"],
  "tags": ["ticketCount"],
  "auto-qa": ["averageRatingScore"],
  "messages-received": ["messagesCount"],
  "automation-rate": ["automationRate", "automatedTicketCount", "ticketCount"],
  "workload-tickets": ["ticketCount"],
  "automated-interactions": ["automatedInteractions"],
  "ticket-fields": ["ticketCount"],
  "voice-calls": ["voiceCallsCount"],
  "voice-agent-events": ["voiceAgentEventsCount"],
  "ticket-sla": ["ticketCount"],
  "knowledge-insights": ["viewsCount", "clicksCount"],
  "voice-calls-summary": ["voiceCallsCount", "totalDuration"],
};

// ---------------------------------------------------------------------------
// Valid dimensions per scope (from API error responses)
// ---------------------------------------------------------------------------

/** Map each statistics scope to its array of valid dimension names. */
export const SCOPE_VALID_DIMENSIONS: Record<string, string[]> = {
  "tickets-created": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "tickets-closed": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "tickets-open": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "tickets-replied": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "one-touch-tickets": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "zero-touch-tickets": ["channel", "integrationId", "storeId"],
  "satisfaction-surveys": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "resolution-time": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "messages-sent": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "first-response-time": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "human-first-response-time": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "response-time": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "messages-per-ticket": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "ticket-handle-time": ["agentId", "channel", "integrationId", "storeId", "teamId"],
  "online-time": ["agentId"],
  "tags": ["tagId"],
  "auto-qa": ["agentId", "channel", "integrationId", "storeId", "teamId", "categoryName"],
  "messages-received": ["channel", "integrationId", "storeId"],
  "automation-rate": ["channel", "integrationId", "storeId"],
  "workload-tickets": ["agentId", "teamId"],
  "automated-interactions": ["eventType", "channel", "integrationId", "storeId"],
  "ticket-fields": ["customFieldValue"],
  "voice-calls": ["agentId", "integrationId", "phoneNumberId", "queueId"],
  "voice-agent-events": ["agentId", "integrationId"],
  "ticket-sla": ["status"],
  "knowledge-insights": [],
  "voice-calls-summary": ["agentId", "integrationId", "phoneNumberId", "queueId"],
};

// ---------------------------------------------------------------------------
// LLM-friendly dimension aliases → API dimension names
// ---------------------------------------------------------------------------

/** Map LLM-friendly dimension names to their API equivalents. */
export const DIMENSION_ALIASES: Record<string, string | null> = {
  "agent": "agentId",
  "team": "teamId",
  "tag": "tagId",
  "store": "storeId",
  "integration": "integrationId",
  "policy": null, // policyId is not a valid dimension for any current scope
  "phone": "phoneNumberId",
  "queue": "queueId",
  "category": "categoryName",
  "field": "customFieldValue",
  "event": "eventType",
};

// ---------------------------------------------------------------------------
// Scopes known to be broken (consistently return 500)
// ---------------------------------------------------------------------------

/** Scopes that consistently return server errors from the Gorgias API. */
export const BROKEN_SCOPES: Record<string, string> = {
  "automation-rate": "This scope consistently returns server errors from the Gorgias API",
  "online-time": "This scope consistently returns server errors from the Gorgias API",
  "voice-calls": "This scope consistently returns server errors from the Gorgias API",
  "voice-agent-events": "This scope consistently returns server errors from the Gorgias API",
  "voice-calls-summary": "This scope consistently returns server errors from the Gorgias API",
};

// ---------------------------------------------------------------------------
// Scopes that require mandatory filters
// ---------------------------------------------------------------------------

/** Scopes that need a mandatory filter to function. */
export const SCOPE_REQUIRED_FILTERS: Record<string, { filterMember: string; description: string }> = {
  "ticket-fields": {
    filterMember: "customFieldId",
    description: "The 'ticket-fields' scope requires a 'customFieldId' filter specifying which custom field to analyse",
  },
};

// ---------------------------------------------------------------------------
// Scopes whose measures return time values in seconds
// ---------------------------------------------------------------------------

/** Scopes where the primary measures represent durations in seconds. */
export const TIME_BASED_SCOPES = new Set([
  "first-response-time",
  "human-first-response-time",
  "response-time",
  "resolution-time",
  "ticket-handle-time",
]);

// ---------------------------------------------------------------------------
// Helper functions
// ---------------------------------------------------------------------------

/** Convert kebab-case to camelCase (e.g., "agent-id" -> "agentId"). */
export function kebabToCamelCase(s: string): string {
  const segments = s.split("-");
  return segments
    .map((segment, index) =>
      index === 0 ? segment : segment.charAt(0).toUpperCase() + segment.slice(1),
    )
    .join("");
}

/** Convert a camelCase key to human-readable form (e.g., "createdDatetime.day" -> "Created Datetime Day"). */
export function humaniseKey(key: string): string {
  return key
    .split(".")
    .map((segment) => {
      // Insert a space before each uppercase letter
      const spaced = segment.replace(/([A-Z])/g, " $1");
      // Capitalise the first letter of each word
      return spaced
        .split(" ")
        .filter((w) => w.length > 0)
        .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
        .join(" ");
    })
    .join(" ");
}

// ---------------------------------------------------------------------------
// Date range validation
// ---------------------------------------------------------------------------

/** Maximum number of days the Gorgias reporting API accepts in a single query. */
export const MAX_PERIOD_DAYS = 366;

/**
 * Compute the inclusive period length in whole days between two YYYY-MM-DD dates.
 * Same-date → 1; one-day gap → 2.
 */
export function periodLengthDays(startDate: string, endDate: string): number {
  const startMs = Date.parse(`${startDate}T00:00:00Z`);
  const endMs = Date.parse(`${endDate}T00:00:00Z`);
  return Math.floor((endMs - startMs) / 86_400_000) + 1;
}

/** Add 1 day to an ISO date string for exclusive end-date adjustment. */
export function adjustEndDateForExclusive(dateStr: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
    throw new Error(`Expected date in YYYY-MM-DD format, got: '${dateStr}'`);
  }
  const date = new Date(dateStr);
  if (isNaN(date.getTime())) {
    throw new Error(`Invalid date: '${dateStr}'`);
  }
  date.setUTCDate(date.getUTCDate() + 1);

  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  const day = String(date.getUTCDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}
