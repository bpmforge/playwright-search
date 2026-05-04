/**
 * pullmd-serp.ts
 *
 * Fetches search-engine result pages via the pullmd MCP (localhost:33000)
 * and parses each engine's markdown output into normalised SerpResult objects.
 *
 * Four engines, chosen because pullmd's extraction pipeline handles them cleanly:
 *   DDG HTML   – redirected URLs decoded from uddg= param
 *   Mojeek     – direct URLs, cleanest structure, independent index
 *   Brave      – web + Reddit community answers + Q&A boxes
 *   Startpage  – Google-quality results via Startpage proxy
 */

export interface SerpResult {
  title: string;
  url: string;
  snippet: string;
  engines: string[];
}

// ── pullmd HTTP client ────────────────────────────────────────────────────

const PULLMD_URL = process.env.PULLMD_URL ?? "http://localhost:33000/mcp";

export async function pullmdReadUrl(url: string): Promise<string> {
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "tools/call",
    params: { name: "read_url", arguments: { url } },
  });

  const res = await fetch(PULLMD_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json, text/event-stream",
    },
    body: payload,
  });

  if (!res.ok) throw new Error(`pullmd HTTP ${res.status}`);

  const text = await res.text();
  for (const line of text.split("\n")) {
    if (!line.startsWith("data:")) continue;
    const d = JSON.parse(line.slice(5));
    if (d?.result?.content) {
      for (const c of d.result.content) {
        if (c.type === "text") return c.text as string;
      }
    }
  }
  return "";
}

// ── text helpers ──────────────────────────────────────────────────────────

function cleanText(s: string): string {
  return s
    .replace(/\*\*(.+?)\*\*/g, "$1")
    .replace(/\*(.+?)\*/g, "$1")
    .replace(/`(.+?)`/g, "$1")
    .replace(/\[([^\]]+)\]\([^)]+\)/g, "$1")
    .replace(/\\([_.])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function isUrlLike(s: string): boolean {
  const t = s.trim().replace(/^["']+|["']+$/g, "");
  return t.startsWith("http") || t.startsWith("//");
}

function isUrlBreadcrumb(s: string): boolean {
  return /^[a-zA-Z0-9._-]+\.[a-zA-Z]{2,6}\//.test(s);
}

function bestSnippet(block: string, skip: string[] = []): string {
  for (const raw of block.split("\n")) {
    const line = raw.trim();
    if (!line) continue;
    if (skip.some((p) => line.includes(p))) continue;
    if (isUrlLike(line)) continue;
    if (/^\[.+\]\(.+\)\s*$/.test(line)) continue; // pure link line
    if (line.startsWith("![") || line.startsWith("[ ](")) continue;
    const clean = cleanText(line);
    if (clean.length >= 25) return clean.slice(0, 300);
  }
  return "";
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

function pathSlug(url: string): string {
  try {
    return new URL(url).pathname.replace(/\/$/, "").split("/").pop() ?? "";
  } catch {
    return "";
  }
}

// ── DDG HTML parser ───────────────────────────────────────────────────────
// URL: https://html.duckduckgo.com/html/?q=<query>
//
// ## [Title](//duckduckgo.com/l/?uddg=<encoded-url>&...)
// [ ](favicon)  [domain.com/path/](ddg-redirect)  date   ← breadcrumb
// [Actual snippet text...](ddg-redirect)                 ← real snippet
// [See more results from domain »](ddg-link)

function parseDDG(md: string): SerpResult[] {
  const headingRe =
    /^## \[(.+?)\]\(\/\/duckduckgo\.com\/l\/\?uddg=([^&)]+)[^)]*\)/gm;
  const results: SerpResult[] = [];
  const matches = [...md.matchAll(headingRe)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const title = cleanText(m[1]!);
    const url = decodeURIComponent(m[2]!);
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : md.length;
    const block = md.slice(start, end);

    // Skip URL breadcrumbs; take first real snippet link text
    const linkRe = /\[([^\]]{20,})\]\(\/\/duckduckgo/g;
    let snippet = "";
    for (const lm of block.matchAll(linkRe)) {
      const clean = cleanText(lm[1]!);
      if (isUrlBreadcrumb(clean)) continue;
      if (clean.includes("See more")) continue;
      if (clean.length >= 30) {
        snippet = clean.slice(0, 300);
        break;
      }
    }

    if (url && !url.startsWith("//")) {
      results.push({ title, url, snippet, engines: ["ddg"] });
    }
  }
  return results;
}

// ── Mojeek parser ─────────────────────────────────────────────────────────
// URL: https://www.mojeek.com/search?q=<query>
//
// - [https://domain.com › path](url "url")   ← breadcrumb (skip)
// ## [Title](url "url")                       ← heading
// snippet text with **bold** terms            ← real snippet

function parseMojeek(md: string): SerpResult[] {
  const headingRe = /^## \[(.+?)\]\((https?:\/\/[^\s"]+)/gm;
  const results: SerpResult[] = [];
  const matches = [...md.matchAll(headingRe)];

  for (let i = 0; i < matches.length; i++) {
    const m = matches[i]!;
    const title = cleanText(m[1]!);
    const url = m[2]!.replace(/[)"]+$/, "");
    const start = m.index! + m[0].length;
    const end = i + 1 < matches.length ? matches[i + 1]!.index! : md.length;
    const block = md.slice(start, end);
    const snippet = bestSnippet(block, ["See more", "- [http"]);
    results.push({ title, url, snippet, engines: ["mojeek"] });
  }
  return results;
}

// ── Brave parser ──────────────────────────────────────────────────────────
// URL: https://search.brave.com/search?q=<query>
//
// 1. Web: [ ](https://url)\nMeta line\n[snippet]
// 2. Reddit/SO top-answers: [ N  answer text\n](https://reddit...)
// 3. Reddit Q&A: ## Question\n[More on reddit.com](url)

function parseBrave(md: string): SerpResult[] {
  const results: SerpResult[] = [];
  const seen = new Set<string>();

  // Strip video section
  let body = md;
  const vIdx = body.indexOf("##### Videos");
  if (vIdx !== -1) {
    const nxt = body.indexOf("\n[ ](", vIdx + 1);
    body = body.slice(0, vIdx) + (nxt !== -1 ? body.slice(nxt) : "");
  }

  // ── 1. Web results ─────────────────────────────────
  const anchorRe = /^\[ \]\((https?:\/\/[^)]+)\)/gm;
  const anchors = [...body.matchAll(anchorRe)].map((m) => ({
    pos: m.index!,
    url: m[1]!,
  }));

  for (let idx = 0; idx < anchors.length; idx++) {
    const { pos, url } = anchors[idx]!;
    if (seen.has(url)) continue;

    const end = idx + 1 < anchors.length ? anchors[idx + 1]!.pos : body.length;
    const after = body.slice(pos + `[ ](${url})\n`.length, end);

    // First non-empty line = "SourceName domain › path/slug  Title"
    const meta = after.split("\n").find((l) => l.trim()) ?? "";
    const parts = meta.split("›").map((p) => p.trim());
    let titleRaw = parts.length >= 2 ? parts[parts.length - 1]! : meta;

    // Strip URL-slug prefix that trafilatura leaves
    const slug = pathSlug(url);
    if (slug && titleRaw.toLowerCase().startsWith(slug.toLowerCase())) {
      titleRaw = titleRaw.slice(slug.length).replace(/^[\s\-·]+/, "");
    }

    const title = cleanText(titleRaw) || cleanText(meta);
    const rest = after.split("\n").slice(2).join("\n");
    const snippet = bestSnippet(rest, [
      "**Starred",
      "**Forked",
      "**Languages",
      "[More on",
      "More on reddit",
      "#####",
      "## ",
    ]);

    seen.add(url);
    results.push({ title, url, snippet, engines: ["brave"] });
  }

  // ── 2. Reddit/SO top-answer blocks ─────────────────
  const ansRe =
    /\[ (?:Top answer \d+ of \d+\s+)?\d+\s+(.*?)\n\]\((https?:\/\/(?:reddit|stackoverflow)[^)]+)\)/gs;
  for (const m of body.matchAll(ansRe)) {
    const url = m[2]!.trim();
    const body2 = m[1]!.replace(/\s+/g, " ").trim();
    if (seen.has(url) || isUrlLike(body2) || body2.length < 25) continue;
    const titleSentence = body2.split(".")[0]!.slice(0, 80).trim();
    seen.add(url);
    results.push({
      title: `[Community – ${hostname(url)}] ${titleSentence}`,
      url,
      snippet: cleanText(body2.slice(0, 300)),
      engines: ["brave"],
    });
  }

  // ── 3. Reddit Q&A inline ────────────────────────────
  const qaRe =
    /^## ([^\[\n][^\n]+)\n\[More on reddit\.com\]\((https?:\/\/[^)]+)\)/gm;
  for (const m of body.matchAll(qaRe)) {
    const url = m[2]!.trim();
    if (!seen.has(url)) {
      seen.add(url);
      results.push({
        title: `[Reddit discussion] ${m[1]!.trim()}`,
        url,
        snippet: "",
        engines: ["brave"],
      });
    }
  }

  return results;
}

// ── Startpage parser ──────────────────────────────────────────────────────
// URL: https://www.startpage.com/sp/search?query=<query>
//
// [](https://real-url.com)
// [SourceName](url)  [breadcrumb](url)
// [Title of Page](url)
// date … snippet text
// [Visit in Anonymous View](https://us2-browse.startpage.com/...)

function parseStartpage(md: string): SerpResult[] {
  const results: SerpResult[] = [];
  const seen = new Set<string>();

  const blockRe = /^\[\]\((https?:\/\/[^)]+)\)\s*\n([\s\S]*?)(?=^\[\]|\Z)/gm;
  for (const m of md.matchAll(blockRe)) {
    const url = m[1]!.trim();
    const block = m[2]!;

    if (url.includes("startpage.com") || seen.has(url)) continue;

    // First link pointing at url whose text isn't a URL / breadcrumb / anon-view
    let title = "";
    const linkRe = new RegExp(
      `\\[([^\\]]{5,150})\\]\\(${url.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\)`,
      "g",
    );
    for (const lm of block.matchAll(linkRe)) {
      const cand = cleanText(lm[1]!);
      if (
        cand.includes("Anonymous") ||
        cand.toLowerCase().includes("startpage") ||
        cand.startsWith("http") ||
        isUrlLike(cand)
      )
        continue;
      title = cand;
      break;
    }

    // Fallback: first ## heading or first A-Z non-anon link text
    if (!title || title.startsWith("http")) {
      const hm = /^## (.+)$/m.exec(block);
      if (hm) title = cleanText(hm[1]!);
    }
    if (!title || title.startsWith("http")) {
      for (const lm of block.matchAll(/\[([A-Z][^\]]{4,80})\]/g)) {
        const cand = cleanText(lm[1]!);
        if (
          cand.includes("Anonymous") ||
          cand.includes("Visit") ||
          cand.toLowerCase().includes("startpage")
        )
          continue;
        title = cand;
        break;
      }
    }

    const snippet = bestSnippet(block, [
      "Visit in Anonymous",
      "startpage.com",
      "http",
    ]);

    seen.add(url);
    results.push({ title: title || url, url, snippet, engines: ["startpage"] });
  }

  return results;
}

// ── Orchestration ─────────────────────────────────────────────────────────

type Engine = {
  name: string;
  url: (q: string) => string;
  parse: (md: string) => SerpResult[];
};

const SEARCH_ENGINES: Engine[] = [
  {
    name: "ddg",
    url: (q) => `https://html.duckduckgo.com/html/?q=${encodeURIComponent(q)}`,
    parse: parseDDG,
  },
  {
    name: "mojeek",
    url: (q) => `https://www.mojeek.com/search?q=${encodeURIComponent(q)}`,
    parse: parseMojeek,
  },
  {
    name: "brave",
    url: (q) => `https://search.brave.com/search?q=${encodeURIComponent(q)}`,
    parse: parseBrave,
  },
  {
    name: "startpage",
    url: (q) =>
      `https://www.startpage.com/sp/search?query=${encodeURIComponent(q)}`,
    parse: parseStartpage,
  },
];

/**
 * Fetch all configured search engines via pullmd, parse, deduplicate, and
 * rank results by how many engines returned each URL. Returns up to `limit`
 * unique results sorted by engine-agreement score descending.
 */
export async function pullmdSearch(
  query: string,
  limit = 20,
): Promise<SerpResult[]> {
  // Parallel SERP fetches — all 4 engines at once
  const fetched = await Promise.allSettled(
    SEARCH_ENGINES.map(async (engine) => {
      const md = await pullmdReadUrl(engine.url(query));
      return engine.parse(md);
    }),
  );

  // Merge: accumulate engine agreement per URL
  const byUrl = new Map<string, SerpResult>();
  for (const r of fetched) {
    if (r.status !== "fulfilled") continue;
    for (const result of r.value) {
      const key = normalizeUrl(result.url);
      const existing = byUrl.get(key);
      if (existing) {
        // Merge engine tags; prefer longer snippet
        for (const e of result.engines) {
          if (!existing.engines.includes(e)) existing.engines.push(e);
        }
        if (result.snippet.length > existing.snippet.length) {
          existing.snippet = result.snippet;
        }
      } else {
        byUrl.set(key, { ...result });
      }
    }
  }

  // Sort: most engine agreement first, then original order as tiebreak
  const all = [...byUrl.values()];
  all.sort((a, b) => b.engines.length - a.engines.length);
  return all.slice(0, limit);
}

function normalizeUrl(url: string): string {
  try {
    const u = new URL(url);
    u.hash = "";
    for (const p of [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
    ]) {
      u.searchParams.delete(p);
    }
    let s = u.toString();
    if (s.endsWith("/")) s = s.slice(0, -1);
    return s.toLowerCase();
  } catch {
    return url;
  }
}
