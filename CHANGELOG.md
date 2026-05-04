# Changelog

All notable changes are documented here. Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and versioning follows [Semantic Versioning](https://semver.org/).

## [0.2.0] — 2026-05-04

Tiered research architecture — two new pullmd-backed tools that let the researcher start fast (no browser) and escalate to Playwright only when needed.

### Added

- **`src/pullmd-serp.ts`** — SERP parser for four engines (DDG HTML, Mojeek, Brave, Startpage) fetched via pullmd MCP at `localhost:33000`. Exports `pullmdSearch(query, limit)` which runs all four engines in parallel, deduplicates by URL, and ranks by engine-agreement score. Exports `pullmdReadUrl(url)` for direct page fetches via the same SSE MCP transport.
- **`web_search_pullmd` tool** — Tier 1. SERP-only, no browser. Queries DDG + Mojeek + Brave + Startpage simultaneously via pullmd. Returns titles/URLs/snippets ranked by engine agreement (~5-10s). Use first to triage candidate URLs before fetching full content.
- **`web_research_pullmd` tool** — Tier 2. SERP + full-page fetch via pullmd + BM25 paragraph ranking. Automatically falls back to Playwright (`fetchAndExtract`) for any URL where pullmd returns < 500 chars (JS-heavy SPAs, auth walls, Cloudflare). Each source annotated `fetch: pullmd` or `fetch: playwright fallback`. Escalate to `web_research` only if this returns < 2 useful sources.

### Changed

- **Tool descriptions** — all five tools now carry tier labels and prescriptive "when to use" guidance so the researcher agent cannot rationalize skipping a tier. `web_research` and `web_fetch` descriptions updated to position them as escalation paths, not defaults.

### Research tier order (mandatory)

| Tier | Tool | When |
|------|------|------|
| 1 | `web_search_pullmd` | Every new topic — always start here |
| 2 | `web_research_pullmd` | When full content is needed |
| 3 | `web_research` | Only if tier 2 returns < 2 useful sources |
| 4 | `web_fetch` / `web_search` | Single known URL or Playwright-only SERP |

## [0.1.0] — 2026-05-03

Initial release: human-paced multi-engine search + page extraction via Playwright.

### Added

- **`web_research` tool** — multi-engine SERP (DDG + Brave + Bing + Google) → dedup → Playwright fetch → Mozilla Readability extract → BM25 paragraph ranking → `[Source N]` blocks.
- **`web_search` tool** — SERP-only across DDG + Brave + Bing, returns titles/URLs/snippets.
- **`web_fetch` tool** — single URL fetch via Playwright + Readability + 24h disk cache + optional BM25 ranking with `relevance_query`.
- Per-domain rate limiting, robots.txt respect, stealth Chromium launch.
- HTTP-first architecture: pullmd MCP client (`pullmdReadUrl`) for non-browser fetches.
