#!/usr/bin/env node
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { searchAndFetch, type EnrichedResult } from "./pipeline.js";
import { fetchAndExtract } from "./fetch/fetcher.js";
import { searchAll } from "./index.js";
import { rankByQuery } from "./extract/rank.js";

const DEFAULT_MAX_CHARS = 3000;
const HARD_MAX_CHARS = 12000;

const ENGINES = ["ddg", "brave", "bing", "google"] as const;
type EngineId = (typeof ENGINES)[number];

function formatEnrichedAsText(
  rows: EnrichedResult[],
  maxCharsPerSource: number,
  relevanceQuery: string,
): string {
  if (rows.length === 0) return "No results found.";
  const out: string[] = [];
  for (const r of rows) {
    const fetchTag = r.fetched.skipped
      ? `skipped (${r.fetched.skipped})`
      : r.fetched.error
        ? `error (${r.fetched.error})`
        : r.fetched.extract?.paywalled
          ? "paywalled"
          : r.fetched.extract
            ? `${r.fetched.extract.textContent.length} chars`
            : `no extract (status ${r.fetched.status})`;

    out.push(
      `[Source ${r.rank}: ${r.title || "(untitled)"} — ${r.fetched.extract?.siteName || hostname(r.url)} — ${r.url}]`,
    );
    out.push(`engines: ${r.engines.join(", ")} | fetch: ${fetchTag}`);
    if (r.fetched.extract?.byline)
      out.push(`byline: ${r.fetched.extract.byline}`);

    if (r.fetched.extract?.textContent) {
      const ranked = rankByQuery(
        r.fetched.extract.textContent,
        relevanceQuery,
        maxCharsPerSource,
      );
      out.push(
        `(top ${ranked.selectedCount} of ${ranked.totalParagraphs} paragraphs by relevance)`,
      );
      out.push(ranked.paragraphs.join("\n\n"));
    } else if (r.snippet) {
      out.push(`(snippet) ${r.snippet}`);
    }
    out.push("");
  }
  return out.join("\n").trim();
}

function hostname(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, "");
  } catch {
    return url;
  }
}

const server = new McpServer({ name: "playwright-search", version: "0.1.0" });

server.registerTool(
  "web_research",
  {
    title: "Web research (search → fetch → extract)",
    description:
      "Search the web across multiple engines, deduplicate results, fetch each page, and extract main article content. " +
      "One-call research: returns formatted text with [Source N] markers ready for LLM context. " +
      "Use this when you need full page content to answer a question, not just titles. " +
      "Polite (rate-limited per-domain, robots.txt respected, 24h cache). Free, no API keys.",
    inputSchema: {
      query: z.string().describe("The search query"),
      top: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(3)
        .describe(
          "How many top results to return after dedup (default 3). Higher = slower; the MCP request timeout is ~60s, so top>5 may time out on cache miss.",
        ),
      engines: z
        .array(z.enum(ENGINES))
        .default(["ddg", "brave", "bing"])
        .describe(
          "Which engines to query. Google fails captcha headless — leave it out unless you need it.",
        ),
      max_chars_per_source: z
        .number()
        .int()
        .min(500)
        .max(HARD_MAX_CHARS)
        .default(DEFAULT_MAX_CHARS)
        .describe(
          `Max characters of extracted text per source (default ${DEFAULT_MAX_CHARS}, max ${HARD_MAX_CHARS}). Returns the BEST paragraphs matching the query, packed into this budget. Lower = smaller LLM context.`,
        ),
      relevance_query: z
        .string()
        .optional()
        .describe(
          "Optional refined query for paragraph relevance ranking. If omitted, uses `query`. Use this when you want broader search results but tighter content extraction (e.g., search 'rust async' but rank paragraphs by 'tokio runtime model').",
        ),
      headless: z
        .boolean()
        .default(true)
        .describe(
          "Run Chromium headless (default true). Set false to use real browser window.",
        ),
    },
  },
  async (
    { query, top, engines, max_chars_per_source, relevance_query, headless },
    extra,
  ) => {
    const token = extra?._meta?.progressToken;
    const send = (current: number, total: number, message: string) => {
      if (token === undefined) return;
      extra
        .sendNotification({
          method: "notifications/progress",
          params: { progressToken: token, progress: current, total, message },
        })
        .catch(() => {});
    };

    send(0, 100, `starting research: "${query}"`);
    const rows = await searchAndFetch(query, {
      engines: engines as EngineId[],
      top: Math.max(top, 3),
      enrichTop: top,
      headless,
      concurrency: 4,
      onProgress: (e) => {
        const overall =
          e.phase === "search"
            ? Math.round((e.current / Math.max(1, e.total)) * 30)
            : 30 + Math.round((e.current / Math.max(1, e.total)) * 65);
        send(overall, 100, e.message);
      },
    });
    send(100, 100, `done — ${rows.length} sources`);
    return {
      content: [
        {
          type: "text",
          text: formatEnrichedAsText(
            rows,
            max_chars_per_source,
            relevance_query || query,
          ),
        },
      ],
    };
  },
);

server.registerTool(
  "web_search",
  {
    title: "Web search (titles + snippets only)",
    description:
      "Fast multi-engine search returning titles, URLs, and snippets only. No page fetching. " +
      "Use this when you're orienting / triaging URLs and don't need full content. " +
      "For full content, use web_research or web_fetch.",
    inputSchema: {
      query: z.string().describe("The search query"),
      limit: z
        .number()
        .int()
        .min(1)
        .max(20)
        .default(10)
        .describe("Total unique results to return after dedup (default 10)"),
      engines: z
        .array(z.enum(ENGINES))
        .default(["ddg", "brave", "bing"])
        .describe("Which engines to query"),
      headless: z.boolean().default(true),
    },
  },
  async ({ query, limit, engines, headless }) => {
    const runs = await searchAll(query, {
      engines: engines as EngineId[],
      top: Math.max(limit, 10),
      headless,
    });

    const seen = new Set<string>();
    const merged: {
      rank: number;
      engines: EngineId[];
      title: string;
      url: string;
      snippet: string;
    }[] = [];
    let rank = 0;
    for (const run of runs) {
      if (!run.ok) continue;
      for (const r of run.results) {
        const key = normalizeUrl(r.url);
        const existing = merged.find((m) => normalizeUrl(m.url) === key);
        if (existing) {
          if (!existing.engines.includes(r.engine))
            existing.engines.push(r.engine);
          if (r.snippet.length > existing.snippet.length)
            existing.snippet = r.snippet;
        } else {
          if (seen.has(key)) continue;
          seen.add(key);
          merged.push({
            rank: ++rank,
            engines: [r.engine],
            title: r.title,
            url: r.url,
            snippet: r.snippet,
          });
        }
      }
    }

    const top = merged
      .sort((a, b) => b.engines.length - a.engines.length)
      .slice(0, limit);
    const lines: string[] = [];
    top.forEach((r, i) => {
      lines.push(`${i + 1}. ${r.title}`);
      lines.push(`   ${r.url}  (${r.engines.join(", ")})`);
      if (r.snippet) lines.push(`   ${r.snippet}`);
      lines.push("");
    });
    const failed = runs
      .filter((r) => !r.ok)
      .map((r) => `${r.engine}: ${r.error}`);
    if (failed.length)
      lines.push(`(engines that failed: ${failed.join("; ")})`);

    return {
      content: [
        { type: "text", text: lines.join("\n").trim() || "No results." },
      ],
    };
  },
);

server.registerTool(
  "web_fetch",
  {
    title: "Fetch + extract a single URL",
    description:
      "Fetch a URL and return its main article content via Mozilla Readability. " +
      "Use when you already have a URL (citation, doc link, search result) and want its content. " +
      "Strips nav, ads, scripts. Returns clean text. 24h cache.",
    inputSchema: {
      url: z.string().url().describe("The URL to fetch"),
      max_chars: z
        .number()
        .int()
        .min(500)
        .max(HARD_MAX_CHARS)
        .default(8000)
        .describe(
          `Max characters to return (default 8000, max ${HARD_MAX_CHARS})`,
        ),
      no_cache: z.boolean().default(false).describe("Skip the 24h disk cache"),
      relevance_query: z
        .string()
        .optional()
        .describe(
          "Optional query for paragraph relevance ranking. If set, returns the BEST paragraphs matching this query packed into max_chars. If omitted, returns the first max_chars of the article.",
        ),
    },
  },
  async ({ url, max_chars, no_cache, relevance_query }) => {
    const r = await fetchAndExtract(url, { useCache: !no_cache });
    if (r.skipped) {
      return {
        content: [{ type: "text", text: `[skipped: ${r.skipped}] ${url}` }],
        isError: true,
      };
    }
    if (r.error) {
      return {
        content: [{ type: "text", text: `[error: ${r.error}] ${url}` }],
        isError: true,
      };
    }
    if (!r.extract) {
      return {
        content: [
          {
            type: "text",
            text: `[no extractable content, status ${r.status}] ${url}`,
          },
        ],
        isError: true,
      };
    }

    const ex = r.extract;
    let body: string;
    let rankNote = "";
    if (relevance_query && relevance_query.trim().length > 0) {
      const ranked = rankByQuery(ex.textContent, relevance_query, max_chars);
      body = ranked.paragraphs.join("\n\n");
      rankNote = `\nrelevance: top ${ranked.selectedCount} of ${ranked.totalParagraphs} paragraphs for "${relevance_query}"`;
    } else {
      body =
        ex.textContent.length > max_chars
          ? ex.textContent.slice(0, max_chars).trimEnd() +
            ` …[truncated, ${ex.textContent.length - max_chars} more chars]`
          : ex.textContent;
    }
    const header =
      [
        `[${ex.title || "(untitled)"}]`,
        ex.byline ? `byline: ${ex.byline}` : null,
        ex.siteName ? `site: ${ex.siteName}` : null,
        `url: ${r.finalUrl}`,
        ex.paywalled ? "paywalled: true" : null,
        r.cached ? "cached: true" : null,
      ]
        .filter(Boolean)
        .join("\n") + rankNote;

    return { content: [{ type: "text", text: `${header}\n\n${body}` }] };
  },
);

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

async function main() {
  const transport = new StdioServerTransport();
  await server.connect(transport);
}

main().catch((err) => {
  console.error("[playwright-search-mcp] fatal:", err);
  process.exit(1);
});
