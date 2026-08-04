import type { SourceAdapter, SourceDoc } from "./types.js";
import { wikipediaAdapter } from "./wikipedia.js";
import { arxivAdapter } from "./arxiv.js";
import { stackExchangeAdapter } from "./stackexchange.js";
import { githubAdapter } from "./github.js";
import { npmAdapter } from "./npm.js";

export type { SourceAdapter, SourceDoc } from "./types.js";

/** Order matters only if two adapters could match one URL; today none overlap. */
export const SOURCE_ADAPTERS: SourceAdapter[] = [
  wikipediaAdapter,
  arxivAdapter,
  stackExchangeAdapter,
  githubAdapter,
  npmAdapter,
];

export function findAdapter(url: string): SourceAdapter | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== "http:" && u.protocol !== "https:") return null;
  return SOURCE_ADAPTERS.find((a) => a.match(u)) ?? null;
}

/**
 * Try the adapter for this URL. Returns null when no adapter matches OR when the
 * adapter declines/fails — callers must fall back to the generic fetch path, never
 * treat null as "no content exists".
 */
export async function fetchFromSource(
  url: string,
  timeoutMs = 15000,
): Promise<{ adapter: string; doc: SourceDoc } | null> {
  const adapter = findAdapter(url);
  if (!adapter) return null;
  try {
    const u = new URL(url);
    const doc = await adapter.fetch(u, timeoutMs);
    if (!doc || !doc.textContent.trim()) return null;
    return { adapter: adapter.id, doc };
  } catch {
    return null;
  }
}
