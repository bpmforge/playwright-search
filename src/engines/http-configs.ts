import type { HttpEngineConfig } from "./http.js";
import type { SearchResult } from "../types.js";

type Item = Omit<SearchResult, "engine" | "fetchedAt">;

function decodeDdg(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : href;
  } catch {
    return href;
  }
}

function decodeBing(href: string): string {
  try {
    const u = new URL(href);
    if (!u.hostname.endsWith("bing.com") || !u.pathname.startsWith("/ck/"))
      return href;
    const enc = u.searchParams.get("u");
    if (!enc || enc.length <= 2) return href;
    const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return /^https?:\/\//i.test(decoded) ? decoded : href;
  } catch {
    return href;
  }
}

export const ddgHttp: HttpEngineConfig = {
  id: "ddg",
  buildUrl: (q) =>
    `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
  detectBlocked: (html) =>
    /error getting results/i.test(html) ? "html endpoint blocked" : null,
  parse(doc, top) {
    const out: Item[] = [];
    const els = Array.from(doc.querySelectorAll(".result, .web-result"));
    let rank = 0;
    for (const el of els) {
      if (out.length >= top) break;
      const a = el.querySelector(
        ".result__title a, h2 a",
      ) as HTMLAnchorElement | null;
      if (!a) continue;
      const snip = el.querySelector(".result__snippet") as HTMLElement | null;
      const href = a.getAttribute("href") ?? "";
      rank++;
      out.push({
        rank,
        title: (a.textContent ?? "").trim(),
        url: decodeDdg(href),
        snippet: (snip?.textContent ?? "").trim(),
      });
    }
    return out;
  },
};

export const bingHttp: HttpEngineConfig = {
  id: "bing",
  buildUrl: (q) =>
    `https://www.bing.com/search?q=${encodeURIComponent(q)}&form=QBLH&sp=-1&pq=${encodeURIComponent(q)}&cc=US&setlang=en-US`,
  detectBlocked: (html) => {
    if (/<title>[^<]*verify[^<]*<\/title>/i.test(html))
      return "verification challenge";
    if (/captcha/i.test(html.slice(0, 5000))) return "captcha challenge";
    return null;
  },
  parse(doc, top) {
    const out: Item[] = [];
    const lis = Array.from(doc.querySelectorAll("#b_results > li.b_algo"));
    let rank = 0;
    for (const li of lis) {
      if (out.length >= top) break;
      const a = li.querySelector("h2 a") as HTMLAnchorElement | null;
      if (!a) continue;
      const href = a.getAttribute("href") ?? "";
      const snipEl =
        (li.querySelector(".b_caption p") as HTMLElement | null) ??
        (li.querySelector(".b_dList") as HTMLElement | null) ??
        (li.querySelector(
          ".b_lineclamp2, .b_lineclamp3, .b_lineclamp4",
        ) as HTMLElement | null);
      rank++;
      out.push({
        rank,
        title: (a.textContent ?? "").trim(),
        url: decodeBing(href),
        snippet: (snipEl?.textContent ?? "").trim(),
      });
    }
    return out;
  },
};

export const braveHttp: HttpEngineConfig = {
  id: "brave",
  buildUrl: (q) =>
    `https://search.brave.com/search?q=${encodeURIComponent(q)}&source=web`,
  detectBlocked: (html) => {
    if (
      /proof of work|confirm you'?re a human|are you a human/i.test(
        html.slice(0, 8000),
      )
    )
      return "proof-of-work / human-check";
    return null;
  },
  parse(doc, top) {
    const out: Item[] = [];
    const cards = Array.from(
      doc.querySelectorAll(
        "#results .snippet[data-type='web'], #results > div.snippet, [data-type='web'], .snippet",
      ),
    );
    let rank = 0;
    for (const c of cards) {
      if (out.length >= top) break;
      const a =
        (c.querySelector("a.l1[href^='http']") as HTMLAnchorElement | null) ??
        (c.querySelector("a[href^='http']") as HTMLAnchorElement | null);
      if (!a) continue;
      const titleEl =
        (c.querySelector(
          ".title.search-snippet-title",
        ) as HTMLElement | null) ??
        (c.querySelector(".snippet-title") as HTMLElement | null) ??
        (c.querySelector(".title") as HTMLElement | null);
      const snipEl =
        (c.querySelector(".snippet-description") as HTMLElement | null) ??
        (c.querySelector(".generic-snippet .content") as HTMLElement | null) ??
        (c.querySelector(
          ".snippet-content .description",
        ) as HTMLElement | null) ??
        (c.querySelector(".snippet-content") as HTMLElement | null);
      const title = (titleEl?.textContent ?? "").trim();
      if (!title) continue;
      rank++;
      out.push({
        rank,
        title,
        url: a.href,
        snippet: (snipEl?.textContent ?? "").trim(),
      });
    }
    return out;
  },
};

export const googleHttp: HttpEngineConfig = {
  id: "google",
  buildUrl: (q) =>
    `https://www.google.com/search?q=${encodeURIComponent(q)}&hl=en&gl=us&pws=0`,
  detectBlocked: (html) => {
    if (/sorry\/index|unusual traffic|recaptcha/i.test(html.slice(0, 5000)))
      return "google sorry / unusual-traffic page";
    return null;
  },
  parse(doc, top) {
    const out: Item[] = [];
    const seen = new Set<string>();
    const blocks = Array.from(
      doc.querySelectorAll(
        "div.MjjYud, div.g, div[data-snc], div[data-hveid][data-ved]",
      ),
    );
    let rank = 0;
    for (const b of blocks) {
      if (out.length >= top) break;
      const h3 = b.querySelector("h3") as HTMLElement | null;
      if (!h3) continue;
      const a =
        (h3.closest("a") as HTMLAnchorElement | null) ??
        (b.querySelector("a[href^='http']") as HTMLAnchorElement | null);
      if (!a || !a.href) continue;
      if (a.href.includes("google.com/search") || a.href.startsWith("/search"))
        continue;
      if (seen.has(a.href)) continue;
      seen.add(a.href);
      let snippet = "";
      for (const sel of [
        '[data-sncf="1"]',
        '[data-sncf="2"]',
        ".VwiC3b",
        ".lEBKkf",
      ]) {
        const el = b.querySelector(sel) as HTMLElement | null;
        if (el?.textContent?.trim()) {
          snippet = el.textContent.trim();
          break;
        }
      }
      rank++;
      out.push({
        rank,
        title: (h3.textContent ?? "").trim(),
        url: a.href,
        snippet,
      });
    }
    return out;
  },
};
