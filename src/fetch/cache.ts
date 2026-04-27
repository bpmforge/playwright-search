import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export interface CachedFetch {
  url: string;
  finalUrl: string;
  status: number;
  contentType: string;
  html: string;
  fetchedAt: string;
}

export interface CachedExtract {
  title: string;
  byline: string;
  siteName: string;
  excerpt: string;
  textContent: string;
  contentHtml: string;
  paywalled: boolean;
}

export interface CacheEntry {
  fetch: CachedFetch;
  extract: CachedExtract | null;
  expiresAt: string;
}

const DEFAULT_TTL_MS = 24 * 60 * 60 * 1000;

let cacheRoot = join(homedir(), ".playwright-search", "cache");

export function setCacheRoot(dir: string): void {
  cacheRoot = dir;
}

function pathFor(url: string): string {
  const h = createHash("sha1").update(url).digest("hex");
  return join(cacheRoot, h.slice(0, 2), `${h}.json`);
}

export function read(url: string): CacheEntry | null {
  const p = pathFor(url);
  if (!existsSync(p)) return null;
  try {
    const entry = JSON.parse(readFileSync(p, "utf8")) as CacheEntry;
    if (Date.parse(entry.expiresAt) < Date.now()) return null;
    return entry;
  } catch {
    return null;
  }
}

export function write(
  url: string,
  entry: Omit<CacheEntry, "expiresAt">,
  ttlMs = DEFAULT_TTL_MS,
): void {
  const p = pathFor(url);
  mkdirSync(join(p, ".."), { recursive: true });
  const full: CacheEntry = {
    ...entry,
    expiresAt: new Date(Date.now() + ttlMs).toISOString(),
  };
  writeFileSync(p, JSON.stringify(full, null, 2), "utf8");
}
