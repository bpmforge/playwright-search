interface RobotsRules {
  disallow: string[];
  allow: string[];
  fetchedAt: number;
}

const cache = new Map<string, RobotsRules>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export function parseRobots(text: string, ourUa = "*"): RobotsRules {
  const rules: RobotsRules = { disallow: [], allow: [], fetchedAt: Date.now() };
  let active = false;
  let starActive = false;
  let starRules: RobotsRules = {
    disallow: [],
    allow: [],
    fetchedAt: Date.now(),
  };
  let uaRules: RobotsRules = { disallow: [], allow: [], fetchedAt: Date.now() };

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();
    if (key === "user-agent") {
      const ua = val.toLowerCase();
      active = ua === ourUa.toLowerCase() || ourUa === "*";
      starActive = ua === "*";
    } else if (key === "disallow") {
      if (active) uaRules.disallow.push(val);
      if (starActive) starRules.disallow.push(val);
    } else if (key === "allow") {
      if (active) uaRules.allow.push(val);
      if (starActive) starRules.allow.push(val);
    }
  }

  return uaRules.disallow.length > 0 || uaRules.allow.length > 0
    ? uaRules
    : starRules;
}

function pathMatches(rule: string, path: string): boolean {
  if (!rule) return false;
  const escaped = rule
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  const anchored = rule.endsWith("$") ? `^${escaped}` : `^${escaped}`;
  try {
    return new RegExp(anchored).test(path);
  } catch {
    return path.startsWith(rule);
  }
}

export function isAllowed(rules: RobotsRules, path: string): boolean {
  let longestDisallow = -1;
  let longestAllow = -1;
  for (const r of rules.disallow) {
    if (pathMatches(r, path) && r.length > longestDisallow)
      longestDisallow = r.length;
  }
  for (const r of rules.allow) {
    if (pathMatches(r, path) && r.length > longestAllow)
      longestAllow = r.length;
  }
  if (longestDisallow < 0) return true;
  return longestAllow >= longestDisallow;
}

export async function canFetch(url: string, ua = "*"): Promise<boolean> {
  let host: string;
  let path: string;
  try {
    const u = new URL(url);
    host = u.host;
    path = u.pathname + u.search;
  } catch {
    return false;
  }

  const cached = cache.get(host);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return isAllowed(cached, path);
  }

  let rules: RobotsRules = { disallow: [], allow: [], fetchedAt: Date.now() };
  try {
    const res = await fetch(`https://${host}/robots.txt`, {
      headers: { "User-Agent": "playwright-search-bot/0.1 (research)" },
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const text = await res.text();
      rules = parseRobots(text, ua);
    }
  } catch {}

  cache.set(host, rules);
  return isAllowed(rules, path);
}

export function resetForTests(): void {
  cache.clear();
}
