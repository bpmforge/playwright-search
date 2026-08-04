import { getText, type SourceAdapter, type SourceDoc } from "./types.js";

/** /abs/2005.11401, /pdf/2005.11401v2, /abs/cs/0112017 */
function idFrom(u: URL): string | null {
  const m = u.pathname.match(/^\/(?:abs|pdf)\/(.+?)(?:\.pdf)?$/);
  return m?.[1] ?? null;
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "i"));
  return (m?.[1] ?? "").replace(/\s+/g, " ").trim();
}

export const arxivAdapter: SourceAdapter = {
  id: "arxiv",
  match: (u) => /(^|\.)arxiv\.org$/i.test(u.hostname) && idFrom(u) !== null,

  async fetch(u, timeoutMs): Promise<SourceDoc | null> {
    const id = idFrom(u);
    if (!id) return null;

    // The export host is the one arXiv asks automated clients to use.
    const xml = await getText(
      `https://export.arxiv.org/api/query?id_list=${encodeURIComponent(id)}&max_results=1`,
      timeoutMs,
    );
    if (!xml) return null;

    const entry = xml.slice(xml.indexOf("<entry>"));
    if (!entry.startsWith("<entry>")) return null;

    const title = tag(entry, "title");
    const summary = tag(entry, "summary");
    if (!title || !summary) return null;

    const authors = [...entry.matchAll(/<name[^>]*>([\s\S]*?)<\/name>/gi)]
      .map((m) => m[1]!.trim())
      .filter(Boolean);
    const published = tag(entry, "published").slice(0, 10);

    const textContent = [
      title,
      authors.length ? `Authors: ${authors.join(", ")}` : "",
      published ? `Published: ${published}` : "",
      "",
      summary,
    ]
      .filter(Boolean)
      .join("\n\n");

    return {
      title,
      byline: authors.join(", "),
      siteName: "arXiv",
      excerpt: summary.slice(0, 300),
      textContent,
      contentHtml: "",
      canonicalUrl: `https://arxiv.org/abs/${id}`,
    };
  },
};
