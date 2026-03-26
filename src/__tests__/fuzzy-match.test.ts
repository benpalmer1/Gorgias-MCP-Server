import { describe, it, expect } from "vitest";
import { fuzzyMatchName, levenshteinDistance } from "../fuzzy-match.js";

const items = [
  { name: "John Smith" },
  { name: "Jane Doe" },
  { name: "Johnny Appleseed" },
  { name: "Alice Johnson" },
  { name: "Bob Builder" },
];

const getName = (item: { name: string }) => item.name;

describe("fuzzyMatchName", () => {
  it("returns exact match with score 100", () => {
    const results = fuzzyMatchName("John Smith", items, getName);
    expect(results[0].item.name).toBe("John Smith");
    expect(results[0].score).toBe(100);
  });

  it("matches case-insensitively", () => {
    const results = fuzzyMatchName("john smith", items, getName);
    expect(results[0].item.name).toBe("John Smith");
    expect(results[0].score).toBe(100);
  });

  it("matches starts-with", () => {
    const results = fuzzyMatchName("John", items, getName);
    const johnSmith = results.find(r => r.item.name === "John Smith");
    expect(johnSmith).toBeDefined();
    expect(johnSmith!.score).toBe(80);
  });

  it("filters below minScore", () => {
    const results = fuzzyMatchName("xyz", items, getName, 40);
    expect(results.length).toBe(0);
  });

  it("sorts by score descending", () => {
    const results = fuzzyMatchName("John", items, getName);
    for (let i = 1; i < results.length; i++) {
      expect(results[i].score).toBeLessThanOrEqual(results[i - 1].score);
    }
  });

  it("handles empty candidates", () => {
    const results = fuzzyMatchName("test", [], getName);
    expect(results).toEqual([]);
  });

  it("handles empty query", () => {
    const results = fuzzyMatchName("", items, getName);
    expect(results.length).toBe(0);
  });

  it("respects custom minScore", () => {
    const results65 = fuzzyMatchName("John", items, getName, 65);
    const results90 = fuzzyMatchName("John", items, getName, 90);
    expect(results65.length).toBeGreaterThanOrEqual(results90.length);
  });

  it("scores tier 3: all query words found in candidate", () => {
    const candidates = [{ name: "Jane Alice Doe" }];
    const results = fuzzyMatchName("Jane Doe", candidates, (c) => c.name, 0);
    // 2 query words, 3 candidate words => 65 + (2/3)*14 ≈ 74.33
    expect(results[0].score).toBeCloseTo(74.33, 0);
  });

  it("scores tier 4: all candidate words found in query", () => {
    const candidates = [{ name: "John Smith" }];
    const results = fuzzyMatchName("John Smith Builder", candidates, (c) => c.name, 0);
    // 2 candidate words, 3 query words => 50 + (2/3)*14 ≈ 59.33
    expect(results[0].score).toBeCloseTo(59.33, 0);
  });

  it("scores tier 5: partial word overlap", () => {
    const candidates = [{ name: "John Smith" }];
    const results = fuzzyMatchName("John Doe", candidates, (c) => c.name, 0);
    // 1 matching word, max(2,2)=2 => (1/2)*50 = 25
    expect(results[0].score).toBe(25);
  });

  it("returns score 0 for no match", () => {
    const candidates = [{ name: "Alice Bob" }];
    const results = fuzzyMatchName("xyz", candidates, (c) => c.name, 0);
    expect(results[0].score).toBe(0);
  });

  describe("edit distance matching", () => {
    it("matches 'Jhon' to 'John' (single char swap)", () => {
      const candidates = [{ name: "John" }];
      const results = fuzzyMatchName("Jhon", candidates, (c) => c.name, 0);
      expect(results[0].score).toBe(45);
    });

    it("matches 'Jonh Smith' to 'John Smith' (transposition in multi-word)", () => {
      const candidates = [{ name: "John Smith" }];
      const results = fuzzyMatchName("Jonh Smith", candidates, (c) => c.name, 0);
      expect(results[0].score).toBe(50);
    });

    it("matches 'Smth' to 'Smith' (missing char)", () => {
      const candidates = [{ name: "Smith" }];
      const results = fuzzyMatchName("Smth", candidates, (c) => c.name, 0);
      expect(results[0].score).toBe(45);
    });

    it("matches 'Aleksander' to 'Alexander' (common spelling variation)", () => {
      const candidates = [{ name: "Alexander" }];
      const results = fuzzyMatchName("Aleksander", candidates, (c) => c.name, 0);
      expect(results[0].score).toBe(40);
    });

    it("does not match wildly different strings", () => {
      const candidates = [{ name: "John Smith" }];
      const results = fuzzyMatchName("xyz", candidates, (c) => c.name, 0);
      expect(results[0].score).toBe(0);
    });
  });
});

describe("levenshteinDistance", () => {
  it("returns 0 for identical strings", () => {
    expect(levenshteinDistance("abc", "abc")).toBe(0);
  });

  it("returns the length of the other string when one is empty", () => {
    expect(levenshteinDistance("", "abc")).toBe(3);
    expect(levenshteinDistance("abc", "")).toBe(3);
  });

  it("computes single substitution distance", () => {
    expect(levenshteinDistance("cat", "bat")).toBe(1);
  });

  it("computes single insertion distance", () => {
    expect(levenshteinDistance("smth", "smith")).toBe(1);
  });

  it("computes transposition as distance 2", () => {
    expect(levenshteinDistance("jhon", "john")).toBe(2);
  });
});
