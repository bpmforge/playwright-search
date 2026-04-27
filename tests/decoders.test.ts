import { describe, it, expect } from "vitest";
import { decodeBingRedirect, decodeDdgUddg } from "../src/decoders.js";

describe("decodeBingRedirect", () => {
  it("decodes a base64url-wrapped Bing /ck/a redirect", () => {
    const real = "https://example.com/path?x=1";
    const b64 = Buffer.from(real, "utf8")
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    const wrapped = `https://www.bing.com/ck/a?!&&p=abc&u=a1${b64}&ntb=1`;
    expect(decodeBingRedirect(wrapped)).toBe(real);
  });

  it("decodes a real-world Bing redirect (pypi.org/project/playwright-stealth)", () => {
    const wrapped =
      "https://www.bing.com/ck/a?!&&p=55f3dabfb75393c43622570fd08c2968cd6df9f428cf1b03c9bdd35ead87e3eaJmltdHM9MTc3NzI0ODAwMA&ptn=3&ver=2&hsh=4&fclid=0117558a-4383-644d-039d-42c2428e6525&u=a1aHR0cHM6Ly9weXBpLm9yZy9wcm9qZWN0L3BsYXl3cmlnaHQtc3RlYWx0aC8&ntb=1";
    expect(decodeBingRedirect(wrapped)).toBe(
      "https://pypi.org/project/playwright-stealth/",
    );
  });

  it("returns the input unchanged for non-Bing URLs", () => {
    const direct = "https://github.com/microsoft/playwright";
    expect(decodeBingRedirect(direct)).toBe(direct);
  });

  it("returns the input unchanged when the u= param is missing", () => {
    const odd = "https://www.bing.com/ck/a?p=abc&ntb=1";
    expect(decodeBingRedirect(odd)).toBe(odd);
  });

  it("returns the input unchanged when decoded is not a URL", () => {
    const garbage = Buffer.from("not a url at all", "utf8").toString("base64");
    const wrapped = `https://www.bing.com/ck/a?u=a1${garbage}&ntb=1`;
    expect(decodeBingRedirect(wrapped)).toBe(wrapped);
  });

  it("does not throw on malformed input", () => {
    expect(decodeBingRedirect("not even a url")).toBe("not even a url");
  });
});

describe("decodeDdgUddg", () => {
  it("decodes the uddg param from a DDG html-endpoint redirect", () => {
    const real = "https://tokio.rs/tokio/tutorial/async";
    const wrapped = `//duckduckgo.com/l/?uddg=${encodeURIComponent(real)}&rut=abc`;
    expect(decodeDdgUddg(wrapped)).toBe(real);
  });

  it("returns the input unchanged when uddg is absent", () => {
    const direct = "https://docs.rs/tokio";
    expect(decodeDdgUddg(direct)).toBe(direct);
  });

  it("does not throw on malformed input", () => {
    expect(decodeDdgUddg("@@@not-a-url@@@")).toBe("@@@not-a-url@@@");
  });
});
