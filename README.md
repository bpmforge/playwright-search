# playwright-search

Human-paced multi-engine web search + page extraction via Playwright + Mozilla Readability. Free, polite, local.

- **Step 1**: query → top-N results (title, url, snippet) from DuckDuckGo, Brave, Bing, Google
- **Step 2 (now)**: search → fetch each URL → extract main content (Readability) → cache → return enriched JSON

For consuming this from Jarvis, claude-experts, bpm-opencode-experts, etc. see [`INTEGRATION.md`](./INTEGRATION.md).

## Engine status (verified 2026-04-27)

| Engine  | Headless | Headed | Notes |
|---------|----------|--------|-------|
| DDG     | ✓        | ✓      | Tries `duckduckgo.com` first, falls back to `html.duckduckgo.com` via `context.request` (Node TLS) when the JS site blocks |
| Brave   | ✓        | ✓      | Stable selectors, clean snippets |
| Bing    | ✓        | ✓      | URLs are unwrapped from `bing.com/ck/a?u=a1<base64>` redirects |
| Google  | captcha  | ✓ (likely) | Headless Chromium fingerprint trips Google's challenge. Run without `--headless` |

## Install

```bash
cd /Users/bmatthews/Code/playwright-search
npm install
```

`npm install` runs `playwright install chromium` (postinstall).

## CLI

```bash
# All four engines, top 10, headed (default — most human-like)
npm run search -- "rust async runtime comparison"

# Only the engines that work headless, top 5
npm run search -- "wcag 2.2" --engines ddg,brave,bing -n 5 --headless

# JSON output for piping
npm run search -- "claude api caching" --json --headless > out.json
```

Flags: `-e/--engines <list>`, `-n/--top <N>`, `--json`, `--headless`, `--debug`, `-h/--help`.

### Enrichment (search + fetch + extract)

```bash
# Search, dedup across engines, fetch top 5, extract article content
npm run search -- "playwright stealth fingerprint" --engines ddg,brave,bing --top 5 --headless --enrich --enrich-top 4
```

Returns a list per result with `{rank, engines, title, url, snippet, fetched: {extract: {textContent, byline, siteName, paywalled, …}}}`.

Enrichment flags:
- `--enrich` — turn on the fetch+extract pipeline
- `--enrich-top <N>` — only enrich top N after dedup (default: `--top`)
- `--concurrency <N>` — parallel fetches (default 3)
- `--no-cache` — skip the 24h disk cache at `~/.playwright-search/cache/`
- `--no-robots` — skip robots.txt checks (impolite — default respects robots)

## Library

```ts
import { searchAll, search } from "./src/index.js";

const runs = await searchAll("playwright stealth 2026", {
  engines: ["ddg", "brave", "bing"],
  top: 10,
  headless: true,
});
for (const r of runs) console.log(r.engine, r.ok ? r.results.length : r.error);

// Single engine
const ddg = await search("playwright stealth", "ddg", { top: 5 });
```

## How it stays under the radar (step 1)

- Persistent Chromium profile under `~/.playwright-search/profile/` — cookies and consent state carry between runs
- Real recent macOS Chrome user-agent + matching locale/timezone/viewport
- 7 fingerprint patches (`src/stealth.ts`): `navigator.webdriver`, plugins/mimeTypes, full `window.chrome` (incl. `loadTimes`/`csi`), permissions query, WebGL vendor/renderer, languages, iframe `contentWindow`
- `--disable-blink-features=AutomationControlled` + drop `--enable-automation`
- Human typing (55–175ms per char with 5% chance of 180–420ms pause), random pre-submit delay, scroll + mouse moves before extraction
- Per-engine cooldown (DDG 6s, Brave 7s, Bing 9s, Google 12s) + jitter, plus 1.5–4s gap between engines in `searchAll`
- Headed by default. `--headless` is best-effort: DDG, Brave, Bing reliable; Google trips captcha

## Result shape

```ts
{
  engine: "ddg" | "brave" | "bing" | "google",
  rank: 1..N,
  title: string,
  url: string,        // already unwrapped from engine redirects
  snippet: string,
  fetchedAt: ISO8601 string
}
```

## What's NOT here yet

- Captcha solving (Google headless aborts cleanly)
- Proxy rotation / IP-pool support
- Cross-engine result deduplication / merge
- API server / scheduler
- Tests with golden HTML fixtures

## Layout

```
src/
  types.ts           # SearchResult, EngineAdapter, options
  stealth.ts         # 7 fingerprint patches via addInitScript
  browser.ts         # launchPersistentContext factory
  human.ts           # humanType, humanScroll, humanMoveMouse, jitter
  rateLimit.ts       # per-engine cooldown
  index.ts           # searchAll, search
  cli.ts             # bin entry
  engines/
    ddg.ts           # primary path + html.duckduckgo.com fallback
    brave.ts
    bing.ts          # unwraps /ck/a?u=a1<base64> redirects
    google.ts        # direct /search URL; captcha-aware
```

## Tradeoffs / known gaps

- **Headless Google**: needs proper TLS fingerprint masking (e.g. `curl-impersonate`-style or undetected fork) — out of scope for step 1.
- **DDG headless**: only the `html.duckduckgo.com` path works; the React UI 418s headless Chromium even with stealth patches. Headed mode uses the React UI normally.
- **Brave snippets**: selectors track current Svelte build (`.title.search-snippet-title`, `.generic-snippet .content`); will need re-targeting if Brave reskins the SERP.
- **Bing snippet truncation**: Bing serves "…" truncated snippets; we don't expand them.
- **Rate limit is process-local**: `lastCall` is in-memory, so multiple parallel processes won't share cooldowns. Move to a file/Redis lock for step 2 if needed.
