import { toMarkdown } from "../bpm-pull.js";
import { getJson, type SourceAdapter, type SourceDoc } from "./types.js";

interface SEItem {
  title?: string;
  body?: string;
  score?: number;
  is_accepted?: boolean;
  owner?: { display_name?: string };
  link?: string;
}
interface SEResponse {
  items?: SEItem[];
}

/** stackoverflow.com/questions/123, serverfault.com, *.stackexchange.com */
const SE_HOST =
  /^(?:www\.)?(stackoverflow|serverfault|superuser|askubuntu|mathoverflow)\.com$|^(?:www\.)?([a-z-]+)\.stackexchange\.com$/i;

function siteParam(hostname: string): string | null {
  const m = hostname.match(SE_HOST);
  if (!m) return null;
  return (m[1] ?? m[2] ?? "").toLowerCase() || null;
}

function idFrom(u: URL): string | null {
  return u.pathname.match(/^\/questions\/(\d+)/)?.[1] ?? null;
}

export const stackExchangeAdapter: SourceAdapter = {
  id: "stackexchange",
  match: (u) => siteParam(u.hostname) !== null && idFrom(u) !== null,

  async fetch(u, timeoutMs): Promise<SourceDoc | null> {
    const site = siteParam(u.hostname);
    const id = idFrom(u);
    if (!site || !id) return null;

    const base = `https://api.stackexchange.com/2.3/questions/${id}`;
    const common = `site=${site}&filter=withbody`;

    // The HTML pages 403 plain fetch; the API is the supported path and needs no key
    // for modest volume (300 requests/day per IP).
    const [q, a] = await Promise.all([
      getJson<SEResponse>(`${base}?${common}`, timeoutMs),
      getJson<SEResponse>(
        `${base}/answers?${common}&sort=votes&order=desc&pagesize=3`,
        timeoutMs,
      ),
    ]);

    const question = q?.items?.[0];
    if (!question?.title) return null;

    const parts: string[] = [question.title];
    if (question.body) parts.push(toMarkdown(question.body).trim());

    for (const ans of a?.items ?? []) {
      if (!ans.body) continue;
      const label = ans.is_accepted ? "Accepted answer" : "Answer";
      parts.push(`${label} (score ${ans.score ?? 0}):`);
      parts.push(toMarkdown(ans.body).trim());
    }

    const textContent = parts.filter(Boolean).join("\n\n");
    return {
      title: question.title,
      byline: question.owner?.display_name ?? "",
      siteName: u.hostname.replace(/^www\./, ""),
      excerpt: textContent.slice(0, 300),
      textContent,
      contentHtml: "",
      canonicalUrl: question.link ?? u.toString(),
    };
  },
};
