import type { Page } from "playwright";
import type { EngineAdapter, SearchResult } from "../types.js";
import { launchContext } from "../browser.js";
import { humanType, humanScroll, jitter, humanMoveMouse } from "../human.js";
import { waitForSlot } from "../rateLimit.js";
import { httpSearch } from "./http.js";
import { googleHttp } from "./http-configs.js";

async function dismissConsent(page: Page): Promise<void> {
  const btns = [
    "button:has-text('Accept all')",
    "button:has-text('I agree')",
    "button:has-text('Reject all')",
    "[aria-label='Accept all']",
    "#L2AGLb",
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

async function detectCaptcha(page: Page): Promise<boolean> {
  const url = page.url();
  if (url.includes("/sorry/") || url.includes("recaptcha")) return true;
  const captchaSel = "form#captcha-form, iframe[src*='recaptcha']";
  return await page
    .locator(captchaSel)
    .first()
    .isVisible()
    .catch(() => false);
}

async function extract(
  page: Page,
  top: number,
): Promise<Omit<SearchResult, "engine" | "fetchedAt">[]> {
  await page
    .waitForSelector("#search, #rso, #main", { timeout: 20000 })
    .catch(() => {});
  const items = await page.evaluate((max) => {
    const out: { rank: number; title: string; url: string; snippet: string }[] =
      [];
    const seen = new Set<string>();

    const blocks = Array.from(
      document.querySelectorAll(
        "div.MjjYud, div.g, div[data-snc], div[data-hveid][data-ved]",
      ),
    );

    let rank = 0;
    for (const b of blocks) {
      if (out.length >= max) break;
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
      const snipCandidates = [
        '[data-sncf="1"]',
        '[data-sncf="2"]',
        ".VwiC3b",
        ".lEBKkf",
        '[style*="webkit-line-clamp"]',
      ];
      for (const sel of snipCandidates) {
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
  }, top);
  return items;
}

export const googleAdapter: EngineAdapter = {
  id: "google",
  async search(query, opts) {
    await waitForSlot("google");
    const fetchedAt = new Date().toISOString();

    try {
      const items = await httpSearch(query, opts.top, googleHttp);
      return items.map((i) => ({ ...i, engine: "google" as const, fetchedAt }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/sorry|unusual-traffic|recaptcha/i.test(msg)) {
        throw new Error(
          `google: ${msg} (browser fallback skipped — same challenge applies headless)`,
        );
      }
    }

    const ctx = await launchContext({
      headless: opts.headless,
      profileDir: "google",
    });
    const page = await ctx.newPage();
    try {
      const directUrl = `https://www.google.com/search?q=${encodeURIComponent(query)}&hl=en&gl=us&pws=0`;
      await page.goto(directUrl, {
        waitUntil: "domcontentloaded",
        timeout: 25000,
      });
      await jitter(900, 1800);
      await dismissConsent(page);
      await jitter(500, 1100);

      if (await detectCaptcha(page)) {
        throw new Error(
          "google: captcha challenge presented (try headed mode: omit --headless)",
        );
      }

      await humanMoveMouse(page);
      await humanScroll(page);
      const items = await extract(page, opts.top);
      return items.map((i) => ({ ...i, engine: "google" as const, fetchedAt }));
    } finally {
      await ctx.close();
    }
  },
};
