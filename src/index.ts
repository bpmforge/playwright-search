import type {
  EngineAdapter,
  EngineId,
  SearchOptions,
  SearchResult,
} from "./types.js";
import { ddgAdapter } from "./engines/ddg.js";
import { braveAdapter } from "./engines/brave.js";
import { bingAdapter } from "./engines/bing.js";
import { googleAdapter } from "./engines/google.js";
import { sleep } from "./human.js";

export * from "./types.js";
export {
  searchAndFetch,
  type EnrichedResult,
  type SearchAndFetchOptions,
} from "./pipeline.js";
export {
  fetchAndExtract,
  type FetchOptions,
  type FetchResult,
} from "./fetch/fetcher.js";
export { extract, type Extracted } from "./extract/readability.js";

const ALL: Record<EngineId, EngineAdapter> = {
  ddg: ddgAdapter,
  brave: braveAdapter,
  bing: bingAdapter,
  google: googleAdapter,
};

export interface SearchAllOptions extends SearchOptions {
  engines?: EngineId[];
}

export interface EngineRun {
  engine: EngineId;
  ok: boolean;
  results: SearchResult[];
  error?: string;
  durationMs: number;
}

export async function searchAll(
  query: string,
  opts: SearchAllOptions = {},
): Promise<EngineRun[]> {
  const engines =
    opts.engines ?? (["ddg", "brave", "bing", "google"] as EngineId[]);
  const top = opts.top ?? 10;
  const debug = opts.debug ?? false;
  const headless = opts.headless ?? false;
  const timeoutMs = opts.timeoutMs ?? 20_000;

  const runs = await Promise.all(
    engines.map(async (id, idx): Promise<EngineRun> => {
      if (idx > 0) await sleep(200 + Math.random() * 600);
      const adapter = ALL[id];
      const started = Date.now();
      try {
        const results = await Promise.race<SearchResult[]>([
          adapter.search(query, { top, debug, headless, timeoutMs }),
          new Promise<SearchResult[]>((_, rej) =>
            setTimeout(() => rej(new Error(`${id}: timeout`)), timeoutMs),
          ),
        ]);
        return {
          engine: id,
          ok: true,
          results,
          durationMs: Date.now() - started,
        };
      } catch (err) {
        return {
          engine: id,
          ok: false,
          results: [],
          error: err instanceof Error ? err.message : String(err),
          durationMs: Date.now() - started,
        };
      }
    }),
  );
  return runs;
}

export async function search(
  query: string,
  engine: EngineId,
  opts: SearchOptions = {},
): Promise<SearchResult[]> {
  const adapter = ALL[engine];
  const top = opts.top ?? 10;
  const debug = opts.debug ?? false;
  const headless = opts.headless ?? false;
  const timeoutMs = opts.timeoutMs ?? 20_000;
  return adapter.search(query, { top, debug, headless, timeoutMs });
}
