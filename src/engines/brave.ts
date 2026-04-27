import type { Page } from "playwright";
import type { EngineAdapter, SearchResult } from "../types.js";
import { launchContext } from "../browser.js";
import { humanType, humanScroll, jitter, humanMoveMouse } from "../human.js";
import { waitForSlot } from "../rateLimit.js";
import { httpSearch } from "./http.js";
import { braveHttp } from "./http-configs.js";

async function dismissConsent(page: Page): Promise<void> {
  const btns = [
    "button:has-text('Accept')",
    "button:has-text('I agree')",
    "button:has-text('Got it')",
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

async function detectChallenge(page: Page): Promise<string | null> {
  const text = await page
    .evaluate(() => document.body?.innerText?.slice(0, 500) ?? "")
    .catch(() => "");
  if (
    /confirm you'?re a human|proof of work|i'm not a robot|are you a human/i.test(
      text,
    )
  ) {
    return "brave: bot challenge (Proof of Work / human-check) — back off and retry later";
  }
  return null;
}

async function extract(
  page: Page,
  top: number,
): Promise<Omit<SearchResult, "engine" | "fetchedAt">[]> {
  await page
    .waitForSelector("#results, [data-type='web'], .snippet", {
      timeout: 20000,
    })
    .catch(() => {});
  const items = await page.evaluate((max) => {
    const out: { rank: number; title: string; url: string; snippet: string }[] =
      [];
    const cards = Array.from(
      document.querySelectorAll(
        "#results .snippet[data-type='web'], #results > div.snippet, [data-type='web'], .snippet",
      ),
    );
    let rank = 0;
    for (const c of cards) {
      if (out.length >= max) break;
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
  }, top);
  return items;
}

export const braveAdapter: EngineAdapter = {
  id: "brave",
  async search(query, opts) {
    await waitForSlot("brave");
    const fetchedAt = new Date().toISOString();

    try {
      const items = await httpSearch(query, opts.top, braveHttp);
      return items.map((i) => ({ ...i, engine: "brave" as const, fetchedAt }));
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (/proof of work|human-check|captcha|0 results parsed/i.test(msg)) {
        throw new Error(
          `brave: ${msg} (browser fallback skipped — same challenge applies)`,
        );
      }
    }

    const ctx = await launchContext({
      headless: opts.headless,
      profileDir: "brave",
    });
    const page = await ctx.newPage();
    try {
      await page.goto("https://search.brave.com/", {
        waitUntil: "domcontentloaded",
      });
      await jitter(800, 1700);
      await dismissConsent(page);
      await humanMoveMouse(page);
      await humanType(page, "input[name='q'], #searchbox", query);
      await jitter(400, 1100);
      await page.keyboard.press("Enter");
      await page.waitForLoadState("domcontentloaded");
      await jitter(900, 1800);
      const challenge = await detectChallenge(page);
      if (challenge) throw new Error(challenge);
      await humanScroll(page);
      const items = await extract(page, opts.top);
      return items.map((i) => ({ ...i, engine: "brave" as const, fetchedAt }));
    } finally {
      await ctx.close();
    }
  },
};
