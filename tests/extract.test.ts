import { describe, it, expect } from "vitest";
import { extract } from "../src/extract/readability.js";

const article = `<!doctype html>
<html>
<head><title>Test Article — Example Site</title><meta name="author" content="Jane Doe"></head>
<body>
  <header>nav nav nav</header>
  <article>
    <h1>The Real Title</h1>
    <p>This is the first paragraph of the article. It contains substantial content that Readability should detect as the main article body.</p>
    <p>This is the second paragraph. ${"More content. ".repeat(40)}</p>
    <p>And a third for good measure. ${"Filler content. ".repeat(40)}</p>
  </article>
  <footer>copyright</footer>
</body>
</html>`;

describe("extract", () => {
  it("returns null for empty/tiny html", () => {
    expect(extract("", "https://x.com/")).toBeNull();
    expect(extract("<html></html>", "https://x.com/")).toBeNull();
  });

  it("pulls title and main content out of an article page", () => {
    const r = extract(article, "https://example.com/post");
    expect(r).not.toBeNull();
    expect(r!.title.length).toBeGreaterThan(0);
    expect(r!.textContent).toContain("first paragraph of the article");
    expect(r!.textContent).toContain("third for good measure");
    expect(r!.textLength).toBeGreaterThan(200);
    expect(r!.paywalled).toBe(false);
  });

  it("does not crash on malformed html", () => {
    expect(() =>
      extract("<html><body><p>not closed", "https://x.com/"),
    ).not.toThrow();
  });
});
