import { describe, it, expect } from "vitest";
import { detectPaywall } from "../src/extract/paywall.js";

describe("detectPaywall", () => {
  it("flags 'subscribe to continue reading' wall text", () => {
    expect(
      detectPaywall({
        textContent:
          "First paragraph teaser... Subscribe to continue reading the full story.",
        contentHtml: "<p>...</p>",
        fullHtml: "<html><body>...</body></html>",
        textLength: 80,
      }),
    ).toBe(true);
  });

  it("flags 'create a free account' walls", () => {
    expect(
      detectPaywall({
        textContent: "Teaser. Create a free account to continue reading.",
        contentHtml: "",
        fullHtml: "",
        textLength: 60,
      }),
    ).toBe(true);
  });

  it("flags pages with class='paywall' in HTML", () => {
    expect(
      detectPaywall({
        textContent: "Some short content",
        contentHtml: "",
        fullHtml: '<html><div class="paywall-overlay">Pay up</div></html>',
        textLength: 18,
      }),
    ).toBe(true);
  });

  it("does not flag a normal article with full content", () => {
    const longText = "This is a regular article. ".repeat(200);
    expect(
      detectPaywall({
        textContent: longText,
        contentHtml: longText,
        fullHtml: longText,
        textLength: longText.length,
      }),
    ).toBe(false);
  });

  it("flags suspiciously short content with sign-in cta at end", () => {
    expect(
      detectPaywall({
        textContent: "Lead paragraph here. ... sign in to read more.",
        contentHtml: "<p>...</p>",
        fullHtml: "<html>...</html>",
        textLength: 60,
      }),
    ).toBe(true);
  });
});
