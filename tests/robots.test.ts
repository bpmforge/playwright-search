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
});
