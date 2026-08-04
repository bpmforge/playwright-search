import { describe, it, expect } from "vitest";
import { findAdapter, SOURCE_ADAPTERS } from "../src/sources/index.js";

describe("adapter routing", () => {
  const cases: [string, string | null][] = [
    ["https://en.wikipedia.org/wiki/Okapi_BM25", "wikipedia"],
    ["https://de.wikipedia.org/wiki/Katze", "wikipedia"],
    ["https://en.m.wikipedia.org/wiki/Cat", "wikipedia"],
    ["https://en.wiktionary.org/wiki/cat", "wikipedia"],
    ["https://arxiv.org/abs/2005.11401", "arxiv"],
    ["https://arxiv.org/pdf/2005.11401v2", "arxiv"],
    [
      "https://stackoverflow.com/questions/11227809/why-is-it-fast",
      "stackexchange",
    ],
    ["https://unix.stackexchange.com/questions/1/x", "stackexchange"],
    ["https://github.com/smol-rs/smol", "github"],
    ["https://www.npmjs.com/package/react", "npm"],
    ["https://www.npmjs.com/package/@types/node", "npm"],

    // Must NOT be claimed by an adapter.
    ["https://example.com/article", null],
    ["https://en.wikipedia.org/", null],
    ["https://github.com/smol-rs/smol/issues/42", null],
    ["https://stackoverflow.com/users/1234", null],
    ["ftp://arxiv.org/abs/1", null],
    ["not a url", null],
  ];

  for (const [url, expected] of cases) {
    it(`${expected ?? "no adapter"} <- ${url}`, () => {
      expect(findAdapter(url)?.id ?? null).toBe(expected);
    });
  }

  it("every adapter has a unique id", () => {
    const ids = SOURCE_ADAPTERS.map((a) => a.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("match() never throws on odd input", () => {
    for (const u of [
      "https://x",
      "https://a.b.c/%%%",
      "https://孤.org/wiki/x",
    ]) {
      expect(() => findAdapter(u)).not.toThrow();
    }
  });
});
