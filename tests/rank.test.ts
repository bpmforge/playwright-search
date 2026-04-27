import { describe, it, expect } from "vitest";
import {
  tokenizeQuery,
  splitParagraphs,
  scoreParagraphs,
  packTopParagraphs,
  rankByQuery,
} from "../src/extract/rank.js";

describe("tokenizeQuery", () => {
  it("lowercases, strips punctuation, drops stopwords", () => {
    expect(tokenizeQuery("How does Tokio compare to async-std?")).toEqual([
      "tokio",
      "compare",
      "async",
      "std",
    ]);
  });

  it("filters out 1-letter and stopword tokens", () => {
    expect(tokenizeQuery("a b c the and to")).toEqual([]);
  });

  it("handles empty / whitespace input", () => {
    expect(tokenizeQuery("")).toEqual([]);
    expect(tokenizeQuery("   ")).toEqual([]);
  });
});

describe("splitParagraphs", () => {
  it("splits on blank lines", () => {
    const text =
      "First paragraph here with enough content.\n\nSecond paragraph also has enough text to count.\n\nThird.";
    expect(splitParagraphs(text).length).toBe(2);
  });

  it("drops paragraphs shorter than 40 chars", () => {
    const text =
      "Long enough paragraph with substantial content for sure.\n\ntoo short\n\nAnother long paragraph also makes the cut here.";
    const out = splitParagraphs(text);
    expect(out.length).toBe(2);
    expect(out.every((p) => p.length >= 40)).toBe(true);
  });

  it("collapses internal whitespace to single spaces", () => {
    const text =
      "First    paragraph    with    extra    spaces    here    in    the    middle.";
    const out = splitParagraphs(text);
    expect(out[0]).not.toContain("    ");
  });
});

describe("scoreParagraphs", () => {
  it("ranks paragraphs with more distinct query terms higher", () => {
    const paras = [
      "This paragraph discusses general programming concepts and has nothing specific to mention.".repeat(
        2,
      ),
      "Rust is a systems language used widely for many things including embedded development.".repeat(
        2,
      ),
      "Tokio is the dominant async runtime for Rust applications and provides scheduling timers.".repeat(
        2,
      ),
    ];
    const scored = scoreParagraphs(paras, ["tokio", "async", "rust"]);
    const sorted = [...scored].sort((a, b) => b.score - a.score);
    expect(sorted[0]!.distinctTerms).toBeGreaterThan(sorted[1]!.distinctTerms);
    expect(sorted[1]!.distinctTerms).toBeGreaterThan(sorted[2]!.distinctTerms);
    expect(sorted[0]!.index).toBe(2);
    expect(sorted[2]!.index).toBe(0);
  });

  it("returns reasonable scores when query has no terms", () => {
    const paras = [
      "Some content here with words.".repeat(3),
      "More content here also has words.".repeat(3),
    ];
    const scored = scoreParagraphs(paras, []);
    expect(scored[0]!.score).toBeGreaterThan(scored[1]!.score);
  });

  it("counts only whole-word matches", () => {
    const paras = [
      "Discussion of antitokyo movements".repeat(2),
      "Tokio runtime is great".repeat(3),
    ];
    const scored = scoreParagraphs(paras, ["tokio"]);
    expect(scored[1]!.totalHits).toBeGreaterThan(0);
    expect(scored[0]!.totalHits).toBe(0);
  });
});

describe("packTopParagraphs", () => {
  it("packs highest-scored paragraphs into the budget, then restores original order", () => {
    const scored = [
      {
        index: 0,
        text: "low score early".repeat(5),
        score: 0.1,
        distinctTerms: 0,
        totalHits: 0,
      },
      {
        index: 1,
        text: "high score middle".repeat(5),
        score: 5.0,
        distinctTerms: 3,
        totalHits: 5,
      },
      {
        index: 2,
        text: "medium score later".repeat(5),
        score: 2.0,
        distinctTerms: 1,
        totalHits: 1,
      },
    ];
    const out = packTopParagraphs(scored, 200);
    expect(out.selectedCount).toBeGreaterThan(0);
    const indices = out.paragraphs.map((p) =>
      scored.findIndex((s) => s.text === p),
    );
    const sortedIndices = [...indices].sort((a, b) => a - b);
    expect(indices).toEqual(sortedIndices);
  });

  it("respects the maxChars budget", () => {
    const scored = Array.from({ length: 10 }, (_, i) => ({
      index: i,
      text: "x".repeat(100),
      score: 10 - i,
      distinctTerms: 0,
      totalHits: 0,
    }));
    const out = packTopParagraphs(scored, 250);
    expect(out.charsUsed).toBeLessThanOrEqual(250);
  });

  it("truncates a single oversize paragraph if it's the only one selected", () => {
    const scored = [
      {
        index: 0,
        text: "x".repeat(1000),
        score: 5,
        distinctTerms: 0,
        totalHits: 0,
      },
    ];
    const out = packTopParagraphs(scored, 200);
    expect(out.charsUsed).toBe(200);
    expect(out.paragraphs[0]!.length).toBe(198);
  });
});

describe("rankByQuery (integration)", () => {
  it("returns the most relevant paragraphs first when packed", () => {
    const text = `
This intro paragraph says nothing useful about the topic but uses many words.

We discuss Rust programming in general here, with no async-runtime specifics at all involved.

Tokio is the dominant async runtime for Rust applications. It provides scheduling, IO, and timers.

The async-std runtime offers a comparable surface for Rust async code with different tradeoffs.

Comparing Tokio vs async-std runtime choices for Rust async applications depends on your needs.
`.trim();
    const out = rankByQuery(text, "tokio async runtime", 400);
    const joined = out.paragraphs.join(" ");
    expect(joined).toContain("Tokio");
    expect(out.totalParagraphs).toBeGreaterThan(0);
    expect(out.charsUsed).toBeLessThanOrEqual(400);
  });

  it("falls back to truncation if there are no paragraphs", () => {
    const out = rankByQuery("just one tiny line", "anything", 10);
    expect(out.paragraphs.length).toBe(1);
    expect(out.charsUsed).toBeLessThanOrEqual(10);
  });
});
