import { searchAll, type SearchAllOptions } from "./index.js";
import {
  fetchAndExtract,
  type FetchOptions,
  type FetchResult,
} from "./fetch/fetcher.js";
import type { EngineId } from "./types.js";
import { fuseRuns } from "./fuse.js";

export interface EnrichedResult {
  rank: number;
  engines: EngineId[];
  title: string;
  url: string;
  snippet: string;
  fetched: FetchResult;
}

export interface SearchAndFetchOptions extends SearchAllOptions {
  fetchOpts?: FetchOptions;
  concurrency?: number;
  enrichTop?: number;
  onProgress?: (event: ProgressEvent) => void;
}

export interface ProgressEvent {
  phase: "search" | "fetch";
  current: number;
  total: number;
  message: string;
}

async function pool<T, R>(
  items: T[],
  concurrency: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let cursor = 0;
  const workers = new Array(Math.min(concurrency, items.length))
    .fill(null)
    .map(async () => {
      while (true) {
        const i = cursor++;
        if (i >= items.length) return;
        const item = items[i]!;
        results[i] = await fn(item);
      }
    });
  await Promise.all(workers);
  return results;
}

export async function searchAndFetch(
  query: string,
  opts: SearchAndFetchOptions = {},
): Promise<EnrichedResult[]> {
  const concurrency = opts.concurrency ?? 3;
  const enrichTop = opts.enrichTop ?? opts.top ?? 10;
  const progress = opts.onProgress ?? (() => {});

  const enginesCount = (opts.engines ?? ["ddg", "brave", "bing", "google"])
    .length;
  progress({
    phase: "search",
    current: 0,
    total: enginesCount,
    message: `searching ${enginesCount} engines`,
  });
  const runs = await searchAll(query, opts);
  progress({
    phase: "search",
    current: enginesCount,
    total: enginesCount,
    message: `${runs.filter((r) => r.ok).length}/${enginesCount} engines returned`,
  });

  const merged: EnrichedResult[] = fuseRuns(runs, enrichTop).map((f) => ({
    rank: f.rank,
    engines: f.engines,
    title: f.title,
    url: f.url,
    snippet: f.snippet,
    fetched: {} as FetchResult,
  }));

  const totalFetches = merged.length;
  let fetchedCount = 0;
  progress({
    phase: "fetch",
    current: 0,
    total: totalFetches,
    message: `fetching ${totalFetches} pages`,
  });

  const fetched = await pool(merged, concurrency, async (m) => {
    const result = await fetchAndExtract(m.url, opts.fetchOpts);
    fetchedCount++;
    progress({
      phase: "fetch",
      current: fetchedCount,
      total: totalFetches,
      message: `${fetchedCount}/${totalFetches}: ${hostnameOf(m.url)}`,
    });
    return result;
  });
  merged.forEach((m, i) => {
    m.fetched = fetched[i]!;
  });

  return merged;
}

function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}
