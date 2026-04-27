export type EngineId = "ddg" | "brave" | "bing" | "google";

export interface SearchResult {
  engine: EngineId;
  rank: number;
  title: string;
  url: string;
  snippet: string;
  fetchedAt: string;
}

export interface SearchOptions {
  top?: number;
  headless?: boolean;
  profileDir?: string;
  timeoutMs?: number;
  debug?: boolean;
}

export interface EngineAdapter {
  id: EngineId;
  search(
    query: string,
    opts: Required<Omit<SearchOptions, "profileDir">>,
  ): Promise<SearchResult[]>;
}
