import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { GorgiasClient } from "../client.js";
import type { ProjectedTicket } from "../projection.js";
import { projectTicket } from "../projection.js";
import { getReferenceData } from "../cache.js";
import { fuzzyMatchName } from "../fuzzy-match.js";
import { sanitiseErrorForLLM } from "../error-sanitiser.js";
import { safeHandler } from "../tool-handler.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TICKET_ID_PATTERN = /^#(\d+)$|^(\d{4,})$|^ticket\s*#?\s*(\d+)$/i;

// Order / reference number detection.
//
// Matches codes that look like ecommerce order numbers rather than Gorgias
// ticket IDs (which are always pure numeric). Handles common formats:
//   #ORD5356, ORD-5356, WC-1234, ORD12345, 2024-ORD-5356
//   "order #ORD5356", "order ORD5356"
//
// The key heuristic: it contains BOTH letters AND digits (possibly with
// hyphens/underscores as separators). Pure-numeric references are already
// handled by TICKET_ID_PATTERN above.
function extractOrderRef(query: string): string | null {
  const trimmed = query.trim();
  // Strip leading "order" prefix if present
  const stripped = trimmed.replace(/^order\s*#?\s*/i, "");
  // Strip leading # if present
  const ref = stripped.replace(/^#/, "");

  // Must have at least one letter AND at least one digit → order number, not a name
  if (/[a-z]/i.test(ref) && /\d/.test(ref) && ref.length >= 3) {
    return ref;
  }
  // Also match if prefixed with # and has letters (e.g. #ORD-RETURN)
  if (trimmed.startsWith("#") && /[a-z]/i.test(ref) && ref.length >= 3) {
    return ref;
  }
  return null;
}

const GENERIC_QUERIES = new Set([
  "tickets", "ticket", "support", "all", "recent", "latest",
  "show", "find", "list", "get", "help", "issues",
]);

// ---------------------------------------------------------------------------
// Topic keyword matching
// ---------------------------------------------------------------------------

/**
 * Normalise a token for keyword matching.  Handles the common
 * inconsistencies LLMs and humans introduce:
 *
 *  - Strips trailing/leading punctuation  ("shipping?" → "shipping")
 *  - Lowercases                           ("AusPost"  → "auspost")
 *  - Collapses hyphens & spaces           ("aus-post" → "auspost",
 *                                           "star track" → "startrack")
 *  - Strips possessives                   ("customer's" → "customers")
 */
function normaliseToken(raw: string): string {
  return raw
    .toLowerCase()
    .replace(/[''`]/g, "")          // strip apostrophes / smart quotes
    .replace(/[^a-z0-9]/g, "")     // strip all non-alphanumeric (hyphens, dots, commas, etc.)
}

/**
 * Check whether a query string contains any topic keyword.
 *
 * Strategy:
 *  1. Split query on whitespace and normalise each token → check singles.
 *  2. Also check adjacent-pair bigrams ("gift card" → "giftcard",
 *     "apple pay" → "applepay", "aus post" → "auspost") so that
 *     compound terms match regardless of spacing/hyphenation.
 */
function queryMatchesTopicKeyword(query: string): boolean {
  const raw = query.toLowerCase().split(/\s+/);
  const tokens = raw.map(normaliseToken).filter(Boolean);

  // Single-token matches
  if (tokens.some((t) => TOPIC_KEYWORDS.has(t))) return true;

  // Bigram matches (adjacent pairs collapsed)
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = tokens[i] + tokens[i + 1];
    if (TOPIC_KEYWORDS.has(bigram)) return true;
  }

  return false;
}

// ---------------------------------------------------------------------------
// Ecommerce topic keywords — optimised for AU, US & UK terminology.
// These trigger keyword search (Strategy 4) instead of customer-name search.
// If you use Gorgias outside ecommerce, customise this set for your industry.
//
// All entries must be lowercase, alphanumeric only (no hyphens/spaces).
// Multi-word terms are stored collapsed (e.g. "giftcard", "applepay")
// and matched via the bigram strategy in queryMatchesTopicKeyword().
// ---------------------------------------------------------------------------
const TOPIC_KEYWORDS = new Set([
  // ── Shipping & delivery ──────────────────────────────────────────────
  // Core terms
  "shipping", "ship", "shipped", "delivery", "deliver", "delivered",
  "dispatch", "despatched", "despatch", "dispatched",
  "freight", "courier", "express", "overnight", "standard",
  "tracking", "tracked", "transit", "customs", "duty", "import",
  // AU/UK: "post", "postage", "parcel"; US: "package"
  "post", "postage", "postal", "parcel", "package",
  // Delivery specifics
  "signature", "signed", "redelivery", "redirect",
  "depot", "warehouse", "fulfillment", "fulfilment",
  // AU carriers
  "auspost", "startrack", "sendle", "aramex",
  "expresspost", "safedrop", "atl",
  // UK carriers
  "evri", "hermes", "dpd", "yodel", "parcelforce",
  "freepost", "collectplus",
  // US carriers
  "usps", "ups", "fedex", "dhl",
  "priority", "ground",
  // Click & collect / pickup
  "pickup", "collect", "collection", "curbside", "bopis",

  // ── Where Is My Order (WISMO) — the #1 ecommerce enquiry ────────────
  "wismo", "eta", "delay", "delayed", "late", "lost", "missing",
  "stolen", "status", "overdue",

  // ── Returns, refunds & exchanges ────────────────────────────────────
  "refund", "refunded", "refundable", "return", "returned", "returns",
  "exchange", "exchanged", "rma", "replacement",
  "warranty", "guarantee", "restocking", "label",
  "prepaid", "creditnote",
  // AU: "layby"; UK: "cooling off", "reject"
  "layby", "cooling", "reject", "rejection",

  // ── Order lifecycle ─────────────────────────────────────────────────
  "order", "orders", "reorder",
  "cancel", "cancellation", "cancelled", "canceled",
  "backorder", "backordered", "preorder",
  "confirmation", "confirmed",

  // ── Product issues ──────────────────────────────────────────────────
  "damaged", "broken", "defective", "faulty", "cracked",
  "wrong", "incorrect", "expired", "recalled",
  "sizing", "size", "fit", "colour", "color", "quality",
  "stock", "restock", "inventory",
  // AU/UK slang for defective/poor quality
  "dodgy", "rubbish", "knackered",

  // ── Payment & billing ───────────────────────────────────────────────
  "billing", "payment", "invoice", "receipt",
  "charge", "charged", "overcharged", "chargeback",
  "discount", "coupon", "promo", "promotion", "code", "sale",
  "giftcard", "voucher",
  "installment", "installments", "surcharge",
  "debit", "credit",
  // AU BNPL & payment: Afterpay, Zip, Humm, LatitudePay, BPAY, EFTPOS
  "afterpay", "zip", "humm", "latitudepay", "bpay", "eftpos", "openpay",
  // UK BNPL & payment: Clearpay, Klarna, Laybuy, BACS
  "clearpay", "klarna", "laybuy", "bacs",
  // US BNPL & payment: Affirm, Sezzle, Shop Pay, Apple Pay, Venmo
  "affirm", "sezzle", "shoppay", "applepay", "venmo", "cashapp",
  // Universal
  "paypal",
  // Tax (AU: GST/ABN; UK: VAT; US: sales tax)
  "tax", "gst", "vat", "abn", "taxexempt",

  // ── Account & subscription ──────────────────────────────────────────
  "subscription", "unsubscribe", "account", "login", "password",
  "hacked", "hack",

  // ── Complaint & escalation ──────────────────────────────────────────
  "complaint", "escalate", "escalation", "urgent", "feedback",
  "compensation", "goodwill", "manager", "supervisor",
  // AU escalation bodies
  "accc", "acl",
  // UK escalation bodies & consumer law
  "ombudsman", "statutory",
  // US escalation bodies
  "bbb", "ftc",
  // AU & UK: "fair trading" / "trading standards" — single words match
  "trading",

  // ── Fraud & disputes ────────────────────────────────────────────────
  "fraud", "fraudulent", "scam", "dispute",
  "unauthorised", "unauthorized", "authorised",

  // ── Promotions & loyalty ────────────────────────────────────────────
  "bogo", "clearance", "rewards", "reward", "loyalty", "referral",

  // ── Address ─────────────────────────────────────────────────────────
  "address",

  // ── UK consumer law keywords ────────────────────────────────────────
  "satisfactory",

  // ── Bigram compounds ──────────────────────────────────────────────
  // These match when two adjacent words are collapsed by the bigram
  // strategy, e.g. "gift card" → "giftcard", "free shipping" → "freeshipping".
  "storecredit", "freeshipping", "returnlabel", "returnshipping",
  "pricematch", "priceadjustment", "flashsale", "blackfriday", "cybermonday",
  "royalmail", "firstclass", "secondclass", "specialdelivery",
  "safeplace", "clickandcollect", "clickcollect",
  "outofstock", "zipay", "zippay",
  "coolingoff", "consumerrights", "fitforpurpose",
  "tradingstandards", "fairtrading", "section75",
  "salestax", "pobox",
  "identitytheft", "creditcard", "debitcard",
  "australiapost",
]);

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SearchArgs {
  query: string;
  search_type?: "auto" | "order_number" | "ticket_id" | "email" | "customer_name" | "keyword" | "view";
  status?: "open" | "closed";
  start_date?: string;
  end_date?: string;
  limit?: number;
}

interface SearchResult {
  [key: string]: unknown;
  content: Array<{ type: "text"; text: string }>;
}

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

interface FilterResult {
  tickets: any[];
  preFilterCount: number;
  postFilterCount: number;
  droppedCount: number;
  apiWindowExhausted: boolean;
}

function applyClientFilters(tickets: any[], args: SearchArgs, requestedLimit: number): FilterResult {
  const pre = tickets.length;
  let filtered = tickets;

  if (args.status) {
    filtered = filtered.filter((t: any) => t.status === args.status);
  }

  if (args.start_date) {
    const startMs = new Date(args.start_date).getTime();
    filtered = filtered.filter((t: any) => new Date(t.created_datetime).getTime() >= startMs);
  }

  if (args.end_date) {
    const endMs = new Date(args.end_date + "T23:59:59.999Z").getTime();
    filtered = filtered.filter((t: any) => new Date(t.created_datetime).getTime() <= endMs);
  }

  return {
    tickets: filtered,
    preFilterCount: pre,
    postFilterCount: filtered.length,
    droppedCount: pre - filtered.length,
    apiWindowExhausted: pre >= requestedLimit,
  };
}

function hasClientFilters(args: SearchArgs): boolean {
  return !!(args.status || args.start_date || args.end_date);
}

function buildResponse(
  tickets: ProjectedTicket[],
  searchStrategy: string,
  hint: string,
  filterResult?: FilterResult,
): SearchResult {
  let finalHint = hint;
  if (filterResult && filterResult.droppedCount > 0) {
    finalHint += ` Note: ${filterResult.droppedCount} of ${filterResult.preFilterCount} rows were dropped by client-side filters (status/date).`;
    if (filterResult.apiWindowExhausted) {
      finalHint += " The API window was at the requested limit, so more matching tickets may exist beyond this page — narrow the query or raise the limit.";
    }
  }
  const payload: Record<string, unknown> = {
    tickets,
    totalFound: tickets.length,
    searchStrategy,
    _hint: finalHint,
  };
  if (filterResult) {
    payload.preFilterCount = filterResult.preFilterCount;
    payload.postFilterCount = filterResult.postFilterCount;
  }
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
  };
}

// ---------------------------------------------------------------------------
// Strategy helpers
// ---------------------------------------------------------------------------

async function searchByEmail(
  client: GorgiasClient,
  email: string,
  args: SearchArgs,
  limit: number,
): Promise<SearchResult> {
  const customersResponse = (await client.get("/api/customers", {
    email,
    limit: 1,
  })) as { data: any[] };

  const customer = customersResponse.data[0];
  if (!customer) {
    return buildResponse([], "email", "No customer found with this email.");
  }

  const ticketsResponse = (await client.get("/api/tickets", {
    customer_id: customer.id,
    limit,
  })) as { data: any[] };

  const filterResult = applyClientFilters(ticketsResponse.data, args, limit);
  const projected = filterResult.tickets.map((t: any) => projectTicket(t));

  return buildResponse(
    projected,
    "email",
    `Found ${projected.length} ticket(s) for customer ${email}. Use gorgias_smart_get_ticket to see full conversation details.`,
    hasClientFilters(args) ? filterResult : undefined,
  );
}

/**
 * Server-side full-text search using the Gorgias view search endpoint.
 * PUT /api/views/0/items with view.search — this is the same search that
 * powers the Gorgias helpdesk UI search bar. It searches across ticket
 * subjects, message bodies, customer names, and metadata.
 */
async function viewSearch(
  client: GorgiasClient,
  searchTerm: string,
  limit: number,
): Promise<any[]> {
  const response = (await client.put("/api/views/0/items", {
    view: { search: searchTerm, type: "ticket-list" },
    limit,
  })) as { data?: any[] } | any[];

  if (Array.isArray(response)) return response;
  return (response as any)?.data ?? [];
}

async function searchByOrderNumber(
  client: GorgiasClient,
  orderRef: string,
  originalQuery: string,
  args: SearchArgs,
  limit: number,
): Promise<SearchResult> {
  // Use Gorgias server-side full-text search — searches subjects, messages,
  // customer data, etc. This finds the order number even in old tickets.
  const tickets = await viewSearch(client, originalQuery, limit);

  const filterResult = applyClientFilters(tickets, args, limit);
  const projected = filterResult.tickets.slice(0, limit).map((t: any) => projectTicket(t));

  return buildResponse(
    projected,
    "order_number",
    projected.length > 0
      ? `Found ${projected.length} ticket(s) matching order reference '${orderRef}'. Use gorgias_smart_get_ticket to see full conversation details.`
      : `No tickets found matching order reference '${orderRef}'. The order number may not appear in any ticket subjects or messages. Try searching by the customer's email instead.`,
    hasClientFilters(args) ? filterResult : undefined,
  );
}

async function getTicketById(
  client: GorgiasClient,
  ticketId: number,
): Promise<SearchResult> {
  const ticket = await client.get(`/api/tickets/${ticketId}`);
  const projected = projectTicket(ticket);

  return buildResponse(
    [projected],
    "ticket_id",
    `Retrieved ticket #${ticketId}. Use gorgias_smart_get_ticket for full conversation including messages.`,
  );
}

async function fetchRecentTickets(
  client: GorgiasClient,
  args: SearchArgs,
  limit: number,
): Promise<SearchResult> {
  const response = (await client.get("/api/tickets", {
    limit,
    order_by: "created_datetime:desc",
  })) as { data: any[] };

  const filterResult = applyClientFilters(response.data, args, limit);
  const projected = filterResult.tickets.map((t: any) => projectTicket(t));

  return buildResponse(
    projected,
    "recent",
    `Showing ${projected.length} most recent tickets. Use status, start_date, end_date to filter. Use gorgias_smart_get_ticket for full details.`,
    hasClientFilters(args) ? filterResult : undefined,
  );
}

async function searchByView(
  client: GorgiasClient,
  query: string,
  args: SearchArgs,
  limit: number,
): Promise<SearchResult | null> {
  const refData = await getReferenceData(client);
  const matches = fuzzyMatchName(
    query,
    refData.views,
    (v: any) => v.name ?? "",
    65,
  );

  if (matches.length === 0) return null;

  const match = matches[0];
  const viewName: string = (match.item as any).name ?? "unknown";
  const viewId: number = (match.item as any).id;

  const response = (await client.get(`/api/views/${viewId}/items`, {
    limit,
  })) as { data: any[] };

  const filterResult = applyClientFilters(response.data, args, limit);
  const projected = filterResult.tickets.map((t: any) => projectTicket(t));

  return buildResponse(
    projected,
    "view",
    `Showing tickets from view '${viewName}'. Use gorgias_smart_get_ticket for details.`,
    hasClientFilters(args) ? filterResult : undefined,
  );
}

async function searchByCustomerName(
  client: GorgiasClient,
  query: string,
  args: SearchArgs,
  limit: number,
): Promise<SearchResult | null> {
  const customers = await client.search({ type: "customer", query, size: 10 });
  const matches = fuzzyMatchName(
    query,
    customers,
    (c: any) => c.name ?? c.email ?? "",
    40,
  );

  if (matches.length === 0) return null;

  const best = matches[0];
  const customerId: number = (best.item as any).id;
  const customerLabel: string =
    (best.item as any).name ?? (best.item as any).email ?? "unknown";

  const ticketsResponse = (await client.get("/api/tickets", {
    customer_id: customerId,
    limit,
  })) as { data: any[] };

  const filterResult = applyClientFilters(ticketsResponse.data, args, limit);
  const projected = filterResult.tickets.map((t: any) => projectTicket(t));

  return buildResponse(
    projected,
    "customer_name",
    `Found ${projected.length} ticket(s) for customer '${customerLabel}'. Use gorgias_smart_get_ticket to see full conversation details.`,
    hasClientFilters(args) ? filterResult : undefined,
  );
}

async function searchByKeyword(
  client: GorgiasClient,
  query: string,
  args: SearchArgs,
  limit: number,
): Promise<SearchResult> {
  // Use server-side full-text search (same approach as searchByOrderNumber)
  const tickets = await viewSearch(client, query, limit);

  const filterResult = applyClientFilters(tickets, args, limit);
  const projected = filterResult.tickets.slice(0, limit).map((t: any) => projectTicket(t));

  return buildResponse(
    projected,
    "keyword",
    projected.length > 0
      ? `Found ${projected.length} ticket(s) matching '${query}'. Use gorgias_smart_get_ticket to see full conversation details.`
      : `No tickets found matching '${query}'. Try different keywords or search by customer email.`,
    hasClientFilters(args) ? filterResult : undefined,
  );
}

// ---------------------------------------------------------------------------
// Tool registration
// ---------------------------------------------------------------------------

export function registerSmartSearchTools(
  server: McpServer,
  client: GorgiasClient,
): void {
  server.registerTool(
    "gorgias_smart_search",
    {
      title: "Smart Search",
      description:
        "Intelligent search across tickets, customers, and views. Use the search_type parameter when intent is clear from context (especially for order numbers vs ticket IDs). Auto-detection handles emails, topic keywords, view names, and customer names well, but ambiguous numeric queries (e.g. '23151' could be a Gorgias ticket ID or a Shopify order number) need search_type to disambiguate. Order number search uses Gorgias server-side full-text search across ticket subjects, messages, and metadata. Use gorgias_smart_get_ticket to view full conversation details for any ticket found.",
      inputSchema: {
        query: z
          .string()
          .describe(
            "The search query. What this means depends on search_type: for 'order_number' pass the order/reference number (e.g. '23151', 'ORD5356', '#ORD-5356'), for 'ticket_id' pass the Gorgias ticket ID, for 'email' pass the customer email, for 'auto' (default) pass any query and the tool will detect intent.",
          ),
        search_type: z
          .enum(["auto", "order_number", "ticket_id", "email", "customer_name", "keyword", "view"])
          .optional()
          .describe(
            "Explicitly set the search strategy. 'order_number' — search by order/reference number. 'ticket_id' — fetch by Gorgias ticket ID. 'email' — find by customer email. 'customer_name' — fuzzy search by customer name. 'keyword' — search ticket subjects/excerpts. 'view' — find tickets in a named view. 'auto' (default) — auto-detect intent from query format.",
          ),
        status: z
          .enum(["open", "closed"])
          .optional()
          .describe("Filter results by ticket status (applied client-side)"),
        start_date: z
          .string()
          .optional()
          .describe(
            "ISO date (YYYY-MM-DD) — only return tickets created on or after this date",
          ),
        end_date: z
          .string()
          .optional()
          .describe(
            "ISO date (YYYY-MM-DD) — only return tickets created on or before this date",
          ),
        limit: z
          .number()
          .min(1)
          .max(100)
          .optional()
          .describe("Max tickets to return (default: 30)"),
      },
      annotations: { readOnlyHint: true, openWorldHint: true },
    },
    safeHandler(async (args) => {
      const query = args.query.trim();
      const limit = args.limit ?? 30;
      const searchType = args.search_type ?? "auto";

      try {
        // -----------------------------------------------------------------
        // Explicit search type — skip auto-detection when intent is known
        // -----------------------------------------------------------------
        if (searchType === "order_number") {
          const ref = query.replace(/^#/, "");
          return await searchByOrderNumber(client, ref, query, args, limit);
        }

        if (searchType === "ticket_id") {
          const id = parseInt(query.replace(/^#/, ""), 10);
          if (isNaN(id)) {
            return buildResponse([], "ticket_id", `'${query}' is not a valid Gorgias ticket ID.`);
          }
          return await getTicketById(client, id);
        }

        if (searchType === "email") {
          return await searchByEmail(client, query, args, limit);
        }

        if (searchType === "customer_name") {
          const result = await searchByCustomerName(client, query, args, limit);
          return result ?? buildResponse([], "customer_name", `No customer found matching '${query}'.`);
        }

        if (searchType === "keyword") {
          return await searchByKeyword(client, query, args, limit);
        }

        if (searchType === "view") {
          const result = await searchByView(client, query, args, limit);
          return result ?? buildResponse([], "view", `No view found matching '${query}'.`);
        }

        // -----------------------------------------------------------------
        // Auto-detection — progressively try strategies
        // -----------------------------------------------------------------

        // Strategy 1: Email detection
        if (EMAIL_PATTERN.test(query)) {
          return await searchByEmail(client, query, args, limit);
        }

        // Strategy 2: Ticket ID detection (pure numeric — Gorgias IDs)
        // Skip ticket ID detection when date filters are present — the user
        // is searching a date range, not looking up a specific ticket.
        const hasDateFilter = args.start_date || args.end_date;
        const ticketIdMatch = query.match(TICKET_ID_PATTERN);
        if (ticketIdMatch && !hasDateFilter) {
          const ticketId = parseInt(ticketIdMatch[1] || ticketIdMatch[2] || ticketIdMatch[3], 10);
          return await getTicketById(client, ticketId);
        }

        // Strategy 3: Order / reference number detection
        // Catches codes that are clearly order numbers (mix of letters + digits).
        // Pure-numeric order numbers can't be auto-detected — use search_type
        // "order_number" for those.
        const orderRef = extractOrderRef(query);
        if (orderRef) {
          return await searchByOrderNumber(client, orderRef, query, args, limit);
        }

        // Strategy 4: Generic query -> recent tickets
        if (GENERIC_QUERIES.has(query.toLowerCase())) {
          return await fetchRecentTickets(client, args, limit);
        }

        // Strategy 5: Try view match (before topic keywords — H20)
        const viewResult = await searchByView(client, query, args, limit);
        if (viewResult) return viewResult;

        // Strategy 6: Try customer name search (before topic keywords — H20)
        const customerResult = await searchByCustomerName(
          client,
          query,
          args,
          limit,
        );
        if (customerResult) return customerResult;

        // Strategy 7: Topic keyword -> keyword search on subjects
        if (queryMatchesTopicKeyword(query)) {
          return await searchByKeyword(client, query, args, limit);
        }

        // Strategy 8: Fallback to keyword search
        return await searchByKeyword(client, query, args, limit);
      } catch (err) {
        const safeError = sanitiseErrorForLLM(err);
        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  error: safeError,
                  _hint: "Search failed. Try a more specific query or use the direct API tools.",
                },
                null,
                2,
              ),
            },
          ],
          isError: true,
        };
      }
    }),
  );
}
