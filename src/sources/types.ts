/**
 * Source adapters — use a site's official API instead of scraping its HTML.
 *
 * For high-value reference sources this beats extraction on every axis: more content,
 * real structure, no bot-blocking, no markup drift. Measured on Wikipedia's Okapi_BM25:
 * Readability gave 5,518 chars in 1 paragraph; the Action API gives 14,867 in 31.
 *
 * Shaped like engines/http-configs.ts: adding a source is one object in the registry.
 */

export interface SourceDoc {
  title: string;
  byline: string;
  siteName: string;
  excerpt: string;
  /** Paragraph-separated text — blank lines matter, rankByQuery splits on them. */
  textContent: string;
  contentHtml: string;
  canonicalUrl: string;
}

export interface SourceAdapter {
  id: string;
  /** Cheap, synchronous URL test. No network. */
  match: (u: URL) => boolean;
  /** Return null to decline — the caller falls back to the generic fetch path. */
  fetch: (u: URL, timeoutMs: number) => Promise<SourceDoc | null>;
}

export const SOURCE_UA = "quarry/0.4 (+research; contact via repo)";

export async function getJson<T = unknown>(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<T | null> {
  try {
    const res = await fetch(url, {
      headers: {
        "User-Agent": SOURCE_UA,
        Accept: "application/json",
        ...headers,
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function getText(
  url: string,
  timeoutMs: number,
  headers: Record<string, string> = {},
): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": SOURCE_UA, ...headers },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}
