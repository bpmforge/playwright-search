# Integration guide

How to consume `playwright-search` from your other projects (Jarvis, claude-experts, bpm-opencode-experts, ai-daytrader, …). Three integration modes ordered by ease.

## 1. CLI (works from anywhere)

Easiest. Subprocess from any language. Always-fresh JSON.

```bash
# Search only (top 10 from all engines, dedup'd via JSON output)
playwright-search "your query" --json

# Search + fetch + extract (enrichment pipeline)
playwright-search "your query" --enrich --enrich-top 5 --headless --json
```

Output for `--enrich --json`:

```json
[
  {
    "rank": 1,
    "engines": ["ddg", "brave", "bing"],
    "title": "...",
    "url": "https://...",
    "snippet": "...",
    "fetched": {
      "url": "...", "finalUrl": "...", "status": 200,
      "contentType": "text/html", "fetchedAt": "2026-04-27T...",
      "cached": false,
      "fetch": { "url": "...", "html": "<full html>", ... },
      "extract": {
        "title": "...", "byline": "...", "siteName": "...",
        "excerpt": "...", "textContent": "<plain text>",
        "contentHtml": "<readability html>", "paywalled": false
      }
    }
  }
]
```

**Use this when:** the consuming code is in a different language (Python, Go, Rust) or you want zero coupling.

## 2. Library (Node/TypeScript projects)

Import directly. No subprocess overhead, full type safety.

```ts
import { searchAndFetch, search, searchAll } from "playwright-search";

// Highest-level: search + fetch + extract in one call
const enriched = await searchAndFetch("rust async runtime", {
  engines: ["ddg", "brave", "bing"],
  top: 10,
  enrichTop: 5,
  headless: true,
  concurrency: 3,
  fetchOpts: { useCache: true, respectRobots: true, ttlMs: 24 * 60 * 60 * 1000 },
});

for (const r of enriched) {
  console.log(r.rank, r.title, r.url);
  console.log(r.engines.join(", "));      // which engines surfaced this
  console.log(r.fetched.extract?.textContent);  // full article text
}

// Lower-level if you only want search results (no fetch)
const ddgOnly = await search("rust async", "ddg", { top: 5 });
```

For Jarvis/claude-experts (already npm-based) this is the cleanest path. Add to `package.json`:

```json
{ "dependencies": { "playwright-search": "file:../playwright-search" } }
```

(Or push to a Gitea repo and reference it via git URL.)

## 3. HTTP API + MCP (planned step 3)

Sketch — not built yet, but the shape is locked:

**HTTP** (Fastify, port 4099):
```
POST /search          {query, engines, top}                    → SearchResult[]
POST /search-fetch    {query, engines, top, enrichTop}         → EnrichedResult[]
POST /fetch           {url}                                    → FetchResult
GET  /cache/:hash                                              → cached entry
GET  /healthz
```

**MCP** (stdio):
```
tools:
  - web_search(query, engines?, top?)
  - web_search_and_extract(query, top?)
  - web_fetch(url)
```

This is the path for opencode + Claude Code: register the MCP server, agents get `web_search_and_extract` as a native tool, no subprocess plumbing.

## How each existing project would consume this

### bpm-opencode-experts → researcher agent
The researcher.md agent currently uses `task()` and times out. Two-step migration:

1. **Today:** add a CLI invocation to the agent's prompt. When it needs web context, run:
   ```bash
   playwright-search "<query>" --enrich --enrich-top 5 --headless --json
   ```
   Pipe stdout to JSON, feed `extract.textContent` into the LLM. No timeout, deterministic output, cached.

2. **Step 3 (MCP):** register `playwright-search-mcp` in opencode's MCP config. The researcher agent gets `web_search_and_extract` as a tool.

### claude-experts → researcher agent
Same as above. CLI today, MCP later.

### Jarvis → research-director / chat agent
Already Node. Use the **library** path:

```ts
// In src/services/research.service.ts (or wherever)
import { searchAndFetch } from "playwright-search";

export async function deepResearch(query: string) {
  const sources = await searchAndFetch(query, {
    engines: ["ddg", "brave", "bing"],
    top: 10,
    enrichTop: 5,
    headless: true,
  });
  return sources.map((s) => ({
    title: s.title,
    url: s.url,
    sourceType: "web" as const,
    text: s.fetched.extract?.textContent ?? s.snippet,
    siteName: s.fetched.extract?.siteName ?? "",
    extractedAt: s.fetched.fetchedAt,
  }));
}
```

This replaces / augments the existing playbook-based research path. Cached pages mean repeated queries cost nothing.

### ai-daytrader / vulnforge / kryptkeeper
On-demand. Library when Node, CLI otherwise.

## Operational notes for downstream consumers

- **First run is slow** (8–30s for full enrichment of 5 pages). **Cached runs are fast** (<2s). Show a progress indicator or stream results.
- **Cache lives at** `~/.playwright-search/cache/<hash>.json`. Wipe it with `rm -rf ~/.playwright-search/cache`.
- **Profile lives at** `~/.playwright-search/profile/`. Persistent Chromium profile — DON'T delete unless you want to lose accumulated cookies/consent state.
- **Headless caveats:** Google still trips a captcha headless. Use `--headless` only with `--engines ddg,brave,bing`, OR run headed (default) to also get Google.
- **Rate limits are process-local.** Two parallel processes won't share cooldowns. If you need shared rate limit, lift `domainLimit.ts` state into Redis/SQLite (step 3 candidate).
- **Paywall results** still come back, with `fetched.extract.paywalled = true`. Downstream code should usually skip these or fall back to `snippet`.
- **Robots-blocked URLs** come back with `fetched.skipped = "robots"` and no extract. We're polite by default; pass `respectRobots: false` to override (don't).

## What downstream code should do with the output

For LLM context windows, format like this:

```
[Source 1: <title> — <siteName> — <url>]
<extract.textContent>

[Source 2: ...]
...
```

That keeps source attribution clean and makes hallucination guards easier downstream. Trim each `textContent` to ~3000 chars unless you need long-form. For a research summary, 5 sources × 3k chars = 15k tokens, very digestible.
