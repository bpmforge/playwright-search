import { describe, it, expect, beforeEach } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { read, write, setCacheRoot } from "../src/fetch/cache.js";

let tmp: string;

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), "pws-cache-"));
  setCacheRoot(tmp);
});

describe("cache", () => {
  it("returns null for a missing url", () => {
    expect(read("https://example.com/missing")).toBeNull();
  });

  it("round-trips fetch + extract", () => {
    const url = "https://example.com/a";
    write(url, {
      fetch: {
        url,
        finalUrl: url,
        status: 200,
        contentType: "text/html",
        html: "<html>hi</html>",
        fetchedAt: new Date().toISOString(),
      },
      extract: {
        title: "Hi",
        byline: "",
        siteName: "Example",
        excerpt: "hi",
        textContent: "hi",
        contentHtml: "<p>hi</p>",
        paywalled: false,
      },
    });
    const got = read(url);
    expect(got?.fetch.html).toBe("<html>hi</html>");
    expect(got?.extract?.title).toBe("Hi");
  });

  it("returns null after TTL expires", () => {
    const url = "https://example.com/b";
    write(
      url,
      {
        fetch: {
          url,
          finalUrl: url,
          status: 200,
          contentType: "text/html",
          html: "x",
          fetchedAt: new Date().toISOString(),
        },
        extract: null,
      },
      -1,
    );
    expect(read(url)).toBeNull();
  });

  it("cleanup", () => {
    rmSync(tmp, { recursive: true, force: true });
  });
});
