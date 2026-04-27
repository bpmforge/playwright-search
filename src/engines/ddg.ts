import type { Page, BrowserContext } from "playwright";
import type { EngineAdapter, SearchResult } from "../types.js";
import { launchContext } from "../browser.js";
import { humanType, humanScroll, jitter, humanMoveMouse } from "../human.js";
import { waitForSlot } from "../rateLimit.js";

async function dismissConsent(page: Page): Promise<void> {
  const btns = [
    "button:has-text('I Agree')",
    "button:has-text('Accept')",
    "[id*=onetrust] button",
  ];
  for (const sel of btns) {
    const b = page.locator(sel).first();
    if (await b.isVisible().catch(() => false)) {
      await b.click().catch(() => {});
      await jitter(300, 700);
      return;
    }
  }
}

function isBlocked(url: string): boolean {
  return (
    url.includes("/static-pages/") ||
    url.includes("/418") ||
    url.includes("anomaly")
  );
}

async function extractReact(page: Page, top: number) {
  await page
    .waitForSelector("article[data-testid='result']", { timeout: 15000 })
    .catch(() => {});
  return page.evaluate((max) => {
    const out: { rank: number; title: string; url: string; snippet: string }[] =
      [];
    const articles = Array.from(
      document.querySelectorAll("article[data-testid='result']"),
    );
    let rank = 0;
    for (const a of articles) {
      if (out.length >= max) break;
      const titleEl = a.querySelector(
        "[data-testid='result-title-a'], h2 a",
      ) as HTMLAnchorElement | null;
      const snipEl = a.querySelector(
        "[data-result='snippet'], [data-testid='result-snippet']",
      ) as HTMLElement | null;
      if (!titleEl) continue;
      rank++;
      out.push({
        rank,
        title: (titleEl.textContent ?? "").trim(),
        url: titleEl.href,
        snippet: (snipEl?.textContent ?? "").trim(),
      });
    }
    return out;
  }, top);
}

async function extractHtmlEndpoint(
  ctx: BrowserContext,
  page: Page,
  query: string,
  top: number,
) {
  const url = `https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`;
  const res = await ctx.request.get(url, {
    headers: {
      Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
      "Accept-Language": "en-US,en;q=0.9",
      "Cache-Control": "no-cache",
    },
    timeout: 20000,
  });
  if (!res.ok()) throw new Error(`html.duckduckgo.com: HTTP ${res.status()}`);
  const html = await res.text();
  if (html.length < 500 || /error getting results/i.test(html)) {
    throw new Error("html.duckduckgo.com: blocked or empty response");
  }
  await page.setContent(html, { waitUntil: "domcontentloaded" });
  return page.evaluate((max) => {
    const out: { rank: number; title: string; url: string; snippet: string }[] =
      [];
    const els = Array.from(document.querySelectorAll(".result, .web-result"));
    let rank = 0;
    for (const el of els) {
      if (out.length >= max) break;
      const a = el.querySelector(
        ".result__title a, h2 a",
      ) as HTMLAnchorElement | null;
      if (!a) continue;
      const snip = el.querySelector(".result__snippet") as HTMLElement | null;
      const href = a.getAttribute("href") ?? "";
      let finalUrl = href;
      try {
        const u = new URL(href, "https://duckduckgo.com");
        const uddg = u.searchParams.get("uddg");
        if (uddg) finalUrl = decodeURIComponent(uddg);
      } catch {}
      rank++;
      out.push({
        rank,
        title: (a.textContent ?? "").trim(),
        url: finalUrl,
        snippet: (snip?.textContent ?? "").trim(),
      });
    }
    return out;
  }, top);
}

import { httpSearch } from "./http.js";
import { ddgHttp } from "./http-configs.js";

export const ddgAdapter: EngineAdapter = {
  id: "ddg",
  async search(query, opts) {
    await waitForSlot("ddg");
    const fetchedAt = new Date().toISOString();

    // Path A: pure HTTP (fast — no browser launch). DDG html endpoint is reliable.
    try {
      const items = await httpSearch(query, opts.top, ddgHttp);
      return items.map((i) => ({ ...i, engine: "ddg" as const, fetchedAt }));
    } catch {
      // fall through to browser
    }

    // Path B: browser navigation (slow but bypasses things HTTP can't)
    const ctx = await launchContext({
      headless: opts.headless,
      profileDir: "ddg",
    });
    const page = await ctx.newPage();
    try {
      let items: {
        rank: number;
        title: string;
        url: string;
        snippet: string;
      }[] = [];
      try {
        await page.goto("https://duckduckgo.com/", {
          waitUntil: "domcontentloaded",
          timeout: 20000,
        });
        await jitter(800, 1800);
        if (!isBlocked(page.url())) {
          await dismissConsent(page);
          await humanMoveMouse(page);
          await humanType(
            page,
            "input[name='q'], #search_form_input_homepage",
            query,
          );
          await jitter(400, 1100);
          await page.keyboard.press("Enter");
          await page.waitForLoadState("domcontentloaded");
          await jitter(900, 1700);
          if (!isBlocked(page.url())) {
            await humanScroll(page);
            items = await extractReact(page, opts.top);
          }
        }
      } catch {}
      if (items.length === 0) {
        items = await extractHtmlEndpoint(ctx, page, query, opts.top);
      }
      return items.map((i) => ({ ...i, engine: "ddg" as const, fetchedAt }));
    } finally {
      await ctx.close();
    }
  },
};
