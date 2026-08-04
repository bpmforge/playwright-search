import { describe, it, expect, beforeEach } from "vitest";
import { parseRobots, isAllowed, resetForTests } from "../src/fetch/robots.js";

beforeEach(() => resetForTests());

describe("parseRobots", () => {
  it("returns wildcard rules when no specific UA matches", () => {
    const r = parseRobots(
      `User-agent: *\nDisallow: /admin\nDisallow: /api/private\n`,
    );
    expect(r.disallow).toContain("/admin");
    expect(r.disallow).toContain("/api/private");
  });

  it("ignores comments and blank lines", () => {
    const r = parseRobots(
      `# top comment\n\nUser-agent: *\nDisallow: /private # inline\n# trailing\n`,
    );
    expect(r.disallow).toEqual(["/private"]);
  });

  it("handles empty Disallow as 'allow everything'", () => {
    const r = parseRobots(`User-agent: *\nDisallow:\n`);
    expect(r.disallow).toEqual([""]);
    expect(isAllowed(r, "/anything")).toBe(true);
  });

  it("regression: another crawler's blanket block does not apply to us", () => {
    // Wikipedia's shape: a hostile bot is blocked outright, everyone else is fine.
    // Treating every group as active blocked the whole site for us.
    const r = parseRobots(
      `User-agent: MJ12bot\nDisallow: /\n\nUser-agent: *\nDisallow: /w/\n`,
    );
    expect(r.disallow).toEqual(["/w/"]);
    expect(isAllowed(r, "/wiki/Okapi_BM25")).toBe(true);
    expect(isAllowed(r, "/w/index.php")).toBe(false);
  });

  it("a group naming us overrides the wildcard group", () => {
    const r = parseRobots(
      `User-agent: *\nDisallow: /\n\nUser-agent: quarry\nDisallow: /private\n`,
      "quarry",
    );
    expect(r.disallow).toEqual(["/private"]);
    expect(isAllowed(r, "/anything")).toBe(true);
    expect(isAllowed(r, "/private/x")).toBe(false);
  });

  it("consecutive User-agent lines share one rule group", () => {
    const r = parseRobots(
      `User-agent: badbot\nUser-agent: *\nDisallow: /shared\n`,
    );
    expect(r.disallow).toEqual(["/shared"]);
  });
});

describe("isAllowed", () => {
  it("allows paths that don't match any disallow rule", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /admin\n`);
    expect(isAllowed(r, "/articles/123")).toBe(true);
  });

  it("blocks paths matching a disallow prefix", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /admin\n`);
    expect(isAllowed(r, "/admin")).toBe(false);
    expect(isAllowed(r, "/admin/users")).toBe(false);
  });

  it("longest-match wins: more specific allow overrides disallow", () => {
    const r = parseRobots(
      `User-agent: *\nDisallow: /search\nAllow: /search/public\n`,
    );
    expect(isAllowed(r, "/search/secret")).toBe(false);
    expect(isAllowed(r, "/search/public/docs")).toBe(true);
  });

  it("handles wildcards", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /*.pdf\n`);
    expect(isAllowed(r, "/foo/bar.pdf")).toBe(false);
    expect(isAllowed(r, "/foo/bar.html")).toBe(true);
  });

  it("honours the end-of-path anchor", () => {
    const r = parseRobots(`User-agent: *\nDisallow: /*.pdf$\n`);
    expect(isAllowed(r, "/doc/a.pdf")).toBe(false);
    // Anchored rule must not match when the path continues past the suffix.
    expect(isAllowed(r, "/doc/a.pdf.html")).toBe(true);
  });
});
