import { canFetch } from "./robots.js";
import {
  hostnameOf,
  isBlacklisted,
  recordFailure,
  recordSuccess,
  waitForHost,
} from "./domainLimit.js";
import {
  read as cacheRead,
  write as cacheWrite,
  type CachedFetch,
  type CachedExtract,
} from "./cache.js";
import { extract } from "../extract/readability.js";

const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface FetchOptions {
  timeoutMs?: number;
  respectRobots?: boolean;
  useCache?: boolean;
  ttlMs?: number;
  retries?: number;
}

export interface FetchResult {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  fetchedAt: string;
  cached: boolean;
  fetch: CachedFetch | null;
  extract: CachedExtract | null;
  skipped?: "blacklisted" | "robots" | "non-html" | "blocked";
  error?: string;
}

const HTML_CT = /^text\/html|^application\/xhtml\+xml/i;

export async function fetchAndExtract(
  url: string,
  opts: FetchOptions = {},
): Promise<FetchResult> {
  const {
    timeoutMs = 15000,
    respectRobots = true,
    useCache = true,
    ttlMs,
    retries = 1,
  } = opts;

  const host = hostnameOf(url);
  if (!host) {
    return baseResult(url, { error: "invalid url", finalUrl: url, status: 0 });
  }

  if (useCache) {
    const cached = cacheRead(url);
    if (cached) {
      return {
        url,
        finalUrl: cached.fetch.finalUrl,
        status: cached.fetch.status,
        contentType: cached.fetch.contentType,
        fetchedAt: cached.fetch.fetchedAt,
        cached: true,
        fetch: cached.fetch,
        extract: cached.extract,
      };
    }
  }

  if (isBlacklisted(host)) {
    return baseResult(url, {
      skipped: "blacklisted",
      finalUrl: url,
      status: 0,
    });
  }

  if (respectRobots) {
    const allowed = await canFetch(url);
    if (!allowed) {
      return baseResult(url, { skipped: "robots", finalUrl: url, status: 0 });
    }
  }

  await waitForHost(host);

  let lastError = "";
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetch(url, {
        redirect: "follow",
        headers: {
          "User-Agent": REAL_UA,
          Accept:
            "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
          "Accept-Language": "en-US,en;q=0.9",
          "Accept-Encoding": "gzip, deflate, br",
        },
        signal: AbortSignal.timeout(timeoutMs),
      });

      const finalUrl = res.url || url;
      const contentType = res.headers.get("content-type") ?? "";
      const status = res.status;

      if (status >= 500 && attempt < retries) {
        lastError = `HTTP ${status}`;
        await new Promise((r) => setTimeout(r, 1000 * (attempt + 1)));
        continue;
      }

      if (!res.ok) {
        recordFailure(host);
        return baseResult(url, {
          skipped: "blocked",
          finalUrl,
          status,
          contentType,
          error: `HTTP ${status}`,
        });
      }

      if (!HTML_CT.test(contentType)) {
        recordSuccess(host);
        return baseResult(url, {
          skipped: "non-html",
          finalUrl,
          status,
          contentType,
        });
      }

      const html = await res.text();
      const fetchedAt = new Date().toISOString();
      const fetchData: CachedFetch = {
        url,
        finalUrl,
        status,
        contentType,
        html,
        fetchedAt,
      };

      const ex = extract(html, finalUrl);
      const extractData: CachedExtract | null = ex
        ? {
            title: ex.title,
            byline: ex.byline,
            siteName: ex.siteName,
            excerpt: ex.excerpt,
            textContent: ex.textContent,
            contentHtml: ex.contentHtml,
            paywalled: ex.paywalled,
          }
        : null;

      if (useCache) {
        cacheWrite(url, { fetch: fetchData, extract: extractData }, ttlMs);
      }

      recordSuccess(host);
      return {
        url,
        finalUrl,
        status,
        contentType,
        fetchedAt,
        cached: false,
        fetch: fetchData,
        extract: extractData,
      };
    } catch (err) {
      lastError = err instanceof Error ? err.message : String(err);
    }
  }

  recordFailure(host);
  return baseResult(url, { error: lastError, finalUrl: url, status: 0 });
}

function baseResult(url: string, fields: Partial<FetchResult>): FetchResult {
  return {
    url,
    finalUrl: url,
    status: 0,
    contentType: "",
    fetchedAt: new Date().toISOString(),
    cached: false,
    fetch: null,
    extract: null,
    ...fields,
  };
}
