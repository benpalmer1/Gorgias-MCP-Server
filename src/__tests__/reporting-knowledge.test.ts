import { describe, it, expect } from "vitest";
import {
  SCOPE_TIME_DIMENSION,
  SCOPE_DEFAULT_MEASURES,
  SCOPE_VALID_DIMENSIONS,
  DIMENSION_ALIASES,
  BROKEN_SCOPES,
  SCOPE_REQUIRED_FILTERS,
  kebabToCamelCase,
  humaniseKey,
  adjustEndDateForExclusive,
} from "../reporting-knowledge.js";

describe("SCOPE_TIME_DIMENSION", () => {
  it("has entry for all common scopes", () => {
    expect(SCOPE_TIME_DIMENSION["tickets-created"]).toBe("createdDatetime");
    expect(SCOPE_TIME_DIMENSION["first-response-time"]).toBe("firstAgentMessageDatetime");
    expect(SCOPE_TIME_DIMENSION["ticket-sla"]).toBe("anchorDatetime");
  });
});

describe("SCOPE_DEFAULT_MEASURES", () => {
  it("returns array of measures per scope", () => {
    expect(SCOPE_DEFAULT_MEASURES["tickets-created"]).toContain("ticketCount");
    expect(SCOPE_DEFAULT_MEASURES["satisfaction-surveys"]).toContain("averageSurveyScore");
  });
});

describe("SCOPE_VALID_DIMENSIONS", () => {
  it("validates known dimensions per scope", () => {
    expect(SCOPE_VALID_DIMENSIONS["tickets-created"]).toContain("agentId");
    expect(SCOPE_VALID_DIMENSIONS["tags"]).toContain("tagId");
  });
});

describe("DIMENSION_ALIASES", () => {
  it("maps friendly names to API names", () => {
    expect(DIMENSION_ALIASES["agent"]).toBe("agentId");
    expect(DIMENSION_ALIASES["team"]).toBe("teamId");
    expect(DIMENSION_ALIASES["tag"]).toBe("tagId");
  });
});

describe("BROKEN_SCOPES", () => {
  it("marks known broken scopes", () => {
    expect(BROKEN_SCOPES["automation-rate"]).toBeTruthy();
    expect(BROKEN_SCOPES["online-time"]).toBeTruthy();
    expect(BROKEN_SCOPES["tickets-created"]).toBeUndefined();
  });
});

describe("SCOPE_REQUIRED_FILTERS", () => {
  it("specifies required filter for ticket-fields", () => {
    expect(SCOPE_REQUIRED_FILTERS["ticket-fields"].filterMember).toBe("customFieldId");
  });
});

describe("kebabToCamelCase", () => {
  it("converts kebab to camelCase", () => {
    expect(kebabToCamelCase("agent-id")).toBe("agentId");
    expect(kebabToCamelCase("custom-field-value")).toBe("customFieldValue");
    expect(kebabToCamelCase("agentId")).toBe("agentId"); // already camel
    expect(kebabToCamelCase("channel")).toBe("channel"); // single word
  });
});

describe("humaniseKey", () => {
  it("converts camelCase keys to readable labels", () => {
    expect(humaniseKey("createdDatetime")).toBe("Created Datetime");
    expect(humaniseKey("agentId")).toBe("Agent Id");
  });

  it("handles dotted keys", () => {
    expect(humaniseKey("createdDatetime.day")).toBe("Created Datetime Day");
  });

  it("handles single-word key", () => {
    expect(humaniseKey("channel")).toBe("Channel");
  });
});

describe("adjustEndDateForExclusive", () => {
  it("adds one day to date", () => {
    expect(adjustEndDateForExclusive("2026-01-15")).toBe("2026-01-16");
  });

  it("handles month boundaries", () => {
    expect(adjustEndDateForExclusive("2026-01-31")).toBe("2026-02-01");
  });

  it("handles year boundaries", () => {
    expect(adjustEndDateForExclusive("2025-12-31")).toBe("2026-01-01");
  });

  it("handles leap year Feb 28", () => {
    expect(adjustEndDateForExclusive("2028-02-28")).toBe("2028-02-29");
  });

  it("handles leap year Feb 29", () => {
    expect(adjustEndDateForExclusive("2028-02-29")).toBe("2028-03-01");
  });

  it("handles non-leap year Feb 28", () => {
    expect(adjustEndDateForExclusive("2027-02-28")).toBe("2027-03-01");
  });
});
