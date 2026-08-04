/**
 * fuse.ts — the single canonical SERP merge + ranking.
 *
 * Replaces three drifted copies of dedupe/normalizeUrl (pipeline.ts, mcp.ts,
 * pullmd-serp.ts). The old copies sorted by engine-agreement and broke ties on an
 * *insertion counter*, never reading the engine's own SERP position — so a ddg-only
 * result at position 10 outranked a brave-only result at position 1.
 *
 * This uses Reciprocal Rank Fusion, which consumes that discarded per-engine rank.
 */

import type { EngineId, SearchResult } from "./types.js";

export interface FusedResult {
  /** 1-based position after fusion. */
  rank: number;
  /** RRF score — higher is better. Exposed for debugging/telemetry. */
  score: number;
  engines: EngineId[];
  title: string;
  url: string;
  snippet: string;
}

/**
 * RRF damping constant (Cormack et al. 2009). Large enough that one engine's #1
 * (1/61) cannot outrank two engines agreeing at #5 (2/65) — agreement wins, but a
 * strong single-engine hit still beats a weak one, which pure agreement-counting lost.
 */
const RRF_K = 60;

const TRACKING_PARAMS = [
  "utm_source",
  "utm_medium",
  "utm_campaign",
  "utm_term",
  "utm_content",
  "fbclid",
  "gclid",
  "ref",
];

/**
 * Canonical form for dedup keys only — never for fetching.
 *
 * `new URL()` already lowercases scheme and host; we deliberately do NOT lowercase
 * the whole string, because path case is significant on most servers and the old
 * copies false-merged distinct URLs because of it.
 */
export function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of TRACKING_PARAMS) u.searchParams.delete(p);
    // Strip one trailing path slash whether or not a query follows. The old
    // `s.endsWith("/")` check only fired on bare URLs, so `/x/?a=1` and `/x?a=1`
    // were treated as different pages.
    return u.toString().replace(/\/(?=$|\?)/, "");
  } catch {
    return url;
  }
}

type Run = { engine: EngineId; ok: boolean; results: SearchResult[] };

/**
 * Merge per-engine result lists into one ranked list via Reciprocal Rank Fusion.
 * Failed runs are skipped. `limit` omitted returns everything.
 */
export function fuseRuns(runs: Run[], limit?: number): FusedResult[] {
  const byUrl = new Map<string, FusedResult & { firstSeen: number }>();
  let order = 0;

  for (const run of runs) {
    if (!run.ok) continue;
    for (const r of run.results) {
      // Guard rank 0/undefined: an engine that forgot to stamp position still
      // contributes, at the value of a #1 hit, rather than dividing by K alone.
      const position = r.rank > 0 ? r.rank : 1;
      const contribution = 1 / (RRF_K + position);
      const key = normalizeUrl(r.url);
      const existing = byUrl.get(key);

      if (existing) {
        existing.score += contribution;
        if (!existing.engines.includes(r.engine))
          existing.engines.push(r.engine);
        if (r.snippet.length > existing.snippet.length)
          existing.snippet = r.snippet;
        if (!existing.title && r.title) existing.title = r.title;
      } else {
        byUrl.set(key, {
          rank: 0,
          score: contribution,
          engines: [r.engine],
          title: r.title,
          url: r.url,
          snippet: r.snippet,
          firstSeen: order++,
        });
      }
    }
  }

  const merged = [...byUrl.values()].sort(
    // firstSeen tiebreak keeps the order deterministic across runs.
    (a, b) => b.score - a.score || a.firstSeen - b.firstSeen,
  );

  return (limit === undefined ? merged : merged.slice(0, limit)).map(
    ({ firstSeen: _firstSeen, ...rest }, i) => ({ ...rest, rank: i + 1 }),
  );
}
