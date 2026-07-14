import { describe, it, expect } from "vitest";
import {
  toMarkdown,
  extractMain,
  stripBoilerplate,
  sniffCharset,
  decode,
} from "../src/bpm-pull.js";

// bpm-pull is our own zero-dep fetch->extract->markdown, vendored to replace the external
// pullmd Docker service. These cover the pure transform pipeline (no network).

describe("bpm-pull: HTML -> markdown", () => {
  it("converts headings, paragraphs, and links", () => {
    const md = toMarkdown(
      `<h1>Title</h1><p>Hello <a href="https://x.com">world</a> and <strong>bold</strong>.</p>`,
    );
    expect(md).toContain("# Title");
    expect(md).toContain("[world](https://x.com)");
    expect(md).toContain("**bold**");
  });

  it("converts lists (ordered + unordered)", () => {
    expect(toMarkdown(`<ul><li>a</li><li>b</li></ul>`)).toContain("- a");
    const ol = toMarkdown(`<ol><li>first</li><li>second</li></ol>`);
    expect(ol).toContain("1. first");
    expect(ol).toContain("2. second");
  });

  it("decodes HTML entities", () => {
    expect(decode("a &amp; b &mdash; c &#39;q&#39;")).toBe("a & b — c 'q'");
  });
});

describe("bpm-pull: boilerplate strip + main-content extraction", () => {
  it("strips scripts, styles, nav, and footer", () => {
    const out = stripBoilerplate(
      `<nav>menu</nav><script>evil()</script><article>keep me</article><footer>c</footer>`,
    );
    expect(out).not.toContain("evil()");
    expect(out).not.toContain("menu");
    expect(out).not.toContain("<footer>");
    expect(out).toContain("keep me");
  });

  it("extracts the densest article block over chrome", () => {
    const html = `<div>short nav</div><article><p>${"Real article content that is long enough to score. ".repeat(10)}</p></article>`;
    const main = extractMain(stripBoilerplate(html));
    expect(main).toContain("Real article content");
    expect(main).not.toContain("short nav");
  });
});

describe("bpm-pull: charset sniff", () => {
  it("prefers the HTTP Content-Type header", () => {
    expect(sniffCharset(Buffer.from(""), "text/html; charset=ISO-8859-1")).toBe(
      "iso-8859-1",
    );
  });
  it("falls back to <meta charset>, then utf-8", () => {
    expect(sniffCharset(Buffer.from(`<meta charset="Windows-1252">`))).toBe(
      "windows-1252",
    );
    expect(sniffCharset(Buffer.from("<html><body>hi"))).toBe("utf-8");
  });
});
