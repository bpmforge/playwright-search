import { sleep } from "../human.js";

const last = new Map<string, number>();
const failures = new Map<string, number>();
const blacklist = new Set<string>();

const MIN_GAP_MS = 1200;
const MAX_GAP_MS = 2500;
const FAILURE_BLACKLIST_AFTER = 3;

export function hostnameOf(url: string): string {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function isBlacklisted(host: string): boolean {
  return blacklist.has(host);
}

export function recordFailure(host: string): void {
  const n = (failures.get(host) ?? 0) + 1;
  failures.set(host, n);
  if (n >= FAILURE_BLACKLIST_AFTER) blacklist.add(host);
}

export function recordSuccess(host: string): void {
  failures.delete(host);
}

export async function waitForHost(host: string): Promise<void> {
  const prev = last.get(host) ?? 0;
  const elapsed = Date.now() - prev;
  const gap =
    MIN_GAP_MS + Math.floor(Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
  if (elapsed < gap) await sleep(gap - elapsed);
  last.set(host, Date.now());
}

export function resetForTests(): void {
  last.clear();
  failures.clear();
  blacklist.clear();
}
