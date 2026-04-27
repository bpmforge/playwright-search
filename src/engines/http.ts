import { JSDOM, VirtualConsole } from "jsdom";
import type { EngineId, SearchResult } from "../types.js";

const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

const COMMON_HEADERS: Record<string, string> = {
  "User-Agent": REAL_UA,
  Accept: "text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8",
  "Accept-Language": "en-US,en;q=0.9",
  "Accept-Encoding": "gzip, deflate, br",
  "Cache-Control": "no-cache",
  Pragma: "no-cache",
  "Sec-Fetch-Dest": "document",
  "Sec-Fetch-Mode": "navigate",
  "Sec-Fetch-Site": "none",
  "Sec-Fetch-User": "?1",
  "Upgrade-Insecure-Requests": "1",
};

export interface HttpEngineConfig {
  id: EngineId;
  buildUrl: (query: string) => string;
  method?: "GET" | "POST";
  body?: (query: string) => string;
  extraHeaders?: Record<string, string>;
  parse: (
    doc: Document,
    top: number,
  ) => Omit<SearchResult, "engine" | "fetchedAt">[];
  detectBlocked?: (html: string, doc: Document) => string | null;
}

function makeDoc(html: string): Document {
  const vc = new VirtualConsole();
  vc.on("error", () => {});
  vc.on("warn", () => {});
  vc.on("jsdomError", () => {});
  return new JSDOM(html, { virtualConsole: vc, url: "https://example.com/" })
    .window.document;
}

export async function httpSearch(
  query: string,
  top: number,
  config: HttpEngineConfig,
  timeoutMs = 12000,
): Promise<Omit<SearchResult, "engine" | "fetchedAt">[]> {
  const url = config.buildUrl(query);
  const headers: Record<string, string> = {
    ...COMMON_HEADERS,
    ...(config.extraHeaders ?? {}),
  };
  const init: RequestInit = {
    method: config.method ?? "GET",
    headers,
    signal: AbortSignal.timeout(timeoutMs),
    redirect: "follow",
  };
  if (config.method === "POST" && config.body) {
    init.body = config.body(query);
    headers["Content-Type"] = "application/x-www-form-urlencoded";
  }

  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${config.id} http: HTTP ${res.status}`);
  const html = await res.text();
  if (html.length < 500)
    throw new Error(`${config.id} http: empty response (${html.length} bytes)`);

  const doc = makeDoc(html);

  if (config.detectBlocked) {
    const blocked = config.detectBlocked(html, doc);
    if (blocked) throw new Error(`${config.id} http: ${blocked}`);
  }

  const items = config.parse(doc, top);
  if (items.length === 0)
    throw new Error(`${config.id} http: 0 results parsed`);
  return items;
}
