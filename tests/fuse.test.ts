import { describe, it, expect } from "vitest";
import { fuseRuns, normalizeUrl } from "../src/fuse.js";
import type { EngineId, SearchResult } from "../src/types.js";

function res(
  engine: EngineId,
  rank: number,
  url: string,
  extra: Partial<SearchResult> = {},
): SearchResult {
  return {
    engine,
    rank,
    title: extra.title ?? `${engine} #${rank}`,
    url,
    snippet: extra.snippet ?? "",
    fetchedAt: "2026-01-01T00:00:00.000Z",
  };
}

function run(engine: EngineId, results: SearchResult[], ok = true) {
  return { engine, ok, results };
}

describe("normalizeUrl", () => {
  it("strips tracking params, hash, and one trailing slash", () => {
    expect(
      normalizeUrl("https://a.com/x/?utm_source=n&gclid=1&keep=2#frag"),
    ).toBe("https://a.com/x?keep=2");
  });

  it("preserves path case (the old copies lowercased it and false-merged)", () => {
    expect(normalizeUrl("https://a.com/CaseSensitive")).toBe(
      "https://a.com/CaseSensitive",
    );
    expect(normalizeUrl("https://a.com/CaseSensitive")).not.toBe(
      normalizeUrl("https://a.com/casesensitive"),
    );
  });

  it("lowercases host but not path", () => {
    expect(normalizeUrl("https://EXAMPLE.com/Path")).toBe(
      "https://example.com/Path",
    );
  });

  it("returns the input unchanged when it is not a URL", () => {
    expect(normalizeUrl("not a url")).toBe("not a url");
  });
});

describe("fuseRuns", () => {
  it("regression: a single-engine #1 beats another engine's #10", () => {
    // The old dedupe never read r.rank — it tie-broke on insertion order, so
    // whichever engine was queried first won outright.
    const fused = fuseRuns([
      run("ddg", [res("ddg", 10, "https://a.com/deep")]),
      run("brave", [res("brave", 1, "https://b.com/top")]),
    ]);
    expect(fused.map((f) => f.url)).toEqual([
      "https://b.com/top",
      "https://a.com/deep",
    ]);
  });

  it("agreement across engines outranks a single engine's #1", () => {
    const fused = fuseRuns([
      run("ddg", [res("ddg", 5, "https://agree.com")]),
      run("brave", [res("brave", 5, "https://agree.com")]),
      run("bing", [res("bing", 1, "https://solo.com")]),
    ]);
    expect(fused[0]!.url).toBe("https://agree.com");
    expect(fused[0]!.engines).toEqual(["ddg", "brave"]);
  });

  it("merges duplicates across engines and keeps the longest snippet", () => {
    const fused = fuseRuns([
      run("ddg", [res("ddg", 1, "https://a.com", { snippet: "short" })]),
      run("brave", [
        res("brave", 2, "https://a.com/#x", {
          snippet: "a much longer snippet",
        }),
      ]),
    ]);
    expect(fused).toHaveLength(1);
    expect(fused[0]!.snippet).toBe("a much longer snippet");
    expect(fused[0]!.engines).toEqual(["ddg", "brave"]);
  });

  it("skips failed runs entirely", () => {
    const fused = fuseRuns([
      run("ddg", [res("ddg", 1, "https://ok.com")]),
      run("brave", [res("brave", 1, "https://ignored.com")], false),
    ]);
    expect(fused.map((f) => f.url)).toEqual(["https://ok.com"]);
  });

  it("assigns contiguous 1-based ranks after slicing to limit", () => {
    const fused = fuseRuns(
      [
        run("ddg", [
          res("ddg", 1, "https://a.com"),
          res("ddg", 2, "https://b.com"),
          res("ddg", 3, "https://c.com"),
        ]),
      ],
      2,
    );
    expect(fused.map((f) => f.rank)).toEqual([1, 2]);
    expect(fused.map((f) => f.url)).toEqual(["https://a.com", "https://b.com"]);
  });

  it("treats a missing/zero rank as a #1 contribution rather than dividing by K alone", () => {
    const fused = fuseRuns([run("ddg", [res("ddg", 0, "https://a.com")])]);
    expect(fused[0]!.score).toBeCloseTo(1 / 61, 10);
  });

  it("returns an empty list when every engine failed", () => {
    expect(fuseRuns([run("ddg", [], false)])).toEqual([]);
  });
});
