interface RobotsRules {
  disallow: string[];
  allow: string[];
  fetchedAt: number;
}

const cache = new Map<string, RobotsRules>();
const CACHE_TTL_MS = 60 * 60 * 1000;

export function parseRobots(text: string, ourUa = "*"): RobotsRules {
  const our = ourUa.toLowerCase();
  const starRules: RobotsRules = {
    disallow: [],
    allow: [],
    fetchedAt: Date.now(),
  };
  const uaRules: RobotsRules = {
    disallow: [],
    allow: [],
    fetchedAt: Date.now(),
  };

  // Consecutive User-agent lines share one group; the first rule line ends it.
  let group: string[] = [];
  let lastWasUa = false;

  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, "").trim();
    if (!line) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const key = line.slice(0, idx).trim().toLowerCase();
    const val = line.slice(idx + 1).trim();

    if (key === "user-agent") {
      if (!lastWasUa) group = [];
      group.push(val.toLowerCase());
      lastWasUa = true;
      continue;
    }
    if (key !== "disallow" && key !== "allow") continue;
    lastWasUa = false;

    // Only our own group and the wildcard group bind us. Rules addressed to other
    // crawlers are not ours to obey — treating every group as active meant one
    // "User-agent: MJ12bot / Disallow: /" line blocked the entire site for us
    // (which is exactly what all of Wikipedia did).
    const mine = our !== "*" && group.includes(our);
    const star = group.includes("*");

    if (key === "disallow") {
      if (mine) uaRules.disallow.push(val);
      if (star) starRules.disallow.push(val);
    } else {
      if (mine) uaRules.allow.push(val);
      if (star) starRules.allow.push(val);
    }
  }

  // A group naming us wins outright; otherwise fall back to the wildcard group.
  return uaRules.disallow.length > 0 || uaRules.allow.length > 0
    ? uaRules
    : starRules;
}

function pathMatches(rule: string, path: string): boolean {
  if (!rule) return false;
  // A trailing "$" is an end-of-path anchor. It used to be escaped along with the
  // other metacharacters, so "/*.pdf$" compiled to /^\/.*\.pdf\$/ and only matched
  // paths containing a literal "$" — i.e. end-anchored rules never matched at all.
  const endAnchored = rule.endsWith("$");
  const body = endAnchored ? rule.slice(0, -1) : rule;
  const escaped = body
    .replace(/[.+^${}()|[\]\\]/g, "\\$&")
    .replace(/\*/g, ".*");
  try {
    return new RegExp(`^${escaped}${endAnchored ? "$" : ""}`).test(path);
  } catch {
    return path.startsWith(body);
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
