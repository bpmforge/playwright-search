import type { Page } from "playwright";
import type { EngineAdapter, SearchResult } from "../types.js";
import { launchContext } from "../browser.js";
import { humanType, humanScroll, jitter, humanMoveMouse } from "../human.js";
import { waitForSlot } from "../rateLimit.js";
import { httpSearch } from "./http.js";
import { bingHttp } from "./http-configs.js";

async function dismissConsent(page: Page): Promise<void> {
  const btns = [
    "#bnp_btn_accept",
    "button:has-text('Accept')",
    "button:has-text('Agree')",
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

async function extract(
  page: Page,
  top: number,
): Promise<Omit<SearchResult, "engine" | "fetchedAt">[]> {
  await page
    .waitForSelector("#b_results > li.b_algo, #b_results", { timeout: 20000 })
    .catch(() => {});
  const items = await page.evaluate((max) => {
    const out: { rank: number; title: string; url: string; snippet: string }[] =
      [];
    const lis = Array.from(document.querySelectorAll("#b_results > li.b_algo"));
    let rank = 0;
    for (const li of lis) {
      if (out.length >= max) break;
      const a = li.querySelector("h2 a") as HTMLAnchorElement | null;
      if (!a) continue;
      const snipEl =
        (li.querySelector(".b_caption p") as HTMLElement | null) ??
        (li.querySelector(".b_dList") as HTMLElement | null) ??
        (li.querySelector(
          ".b_lineclamp2, .b_lineclamp3, .b_lineclamp4",
        ) as HTMLElement | null);

      let finalUrl = a.href;
      try {
        const u = new URL(a.href);
        if (u.hostname.endsWith("bing.com") && u.pathname.startsWith("/ck/")) {
          const enc = u.searchParams.get("u");
          if (enc && enc.length > 2) {
            const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
            const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
            const decoded = atob(padded);
            if (/^https?:\/\//i.test(decoded)) finalUrl = decoded;
          }
        }
      } catch {}

      rank++;
      out.push({
        rank,
        title: (a.textContent ?? "").trim(),
        url: finalUrl,
        snippet: (snipEl?.textContent ?? "").trim(),
      });
    }
    return out;
  }, top);
  return items;
}

export const bingAdapter: EngineAdapter = {
  id: "bing",
  async search(query, opts) {
    await waitForSlot("bing");
    const fetchedAt = new Date().toISOString();

    try {
      const items = await httpSearch(query, opts.top, bingHttp);
      return items.map((i) => ({ ...i, engine: "bing" as const, fetchedAt }));
    } catch {}

    const ctx = await launchContext({
      headless: opts.headless,
      profileDir: "bing",
    });
    const page = await ctx.newPage();
    try {
      await page.goto("https://www.bing.com/", {
        waitUntil: "domcontentloaded",
      });
      await jitter(800, 1700);
      await dismissConsent(page);
      await humanMoveMouse(page);
      await humanType(page, "input[name='q'], #sb_form_q", query);
      await jitter(400, 1100);
      await page.keyboard.press("Enter");
      await page.waitForLoadState("domcontentloaded");
      await jitter(900, 1800);
      await humanScroll(page);
      const items = await extract(page, opts.top);
      return items.map((i) => ({ ...i, engine: "bing" as const, fetchedAt }));
    } finally {
      await ctx.close();
    }
  },
};
