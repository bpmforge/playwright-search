import { getJson, type SourceAdapter, type SourceDoc } from "./types.js";

interface ExtractQuery {
  query?: {
    pages?: Record<
      string,
      { title?: string; extract?: string; missing?: unknown }
    >;
  };
}

/** en.wikipedia.org, de.wikipedia.org, en.m.wikipedia.org, and the sister projects. */
const WIKI_HOST =
  /^([a-z-]+\.)?(m\.)?(wikipedia|wiktionary|wikibooks|wikiquote|wikisource|wikivoyage)\.org$/i;

function titleFrom(u: URL): string | null {
  const m = u.pathname.match(/^\/wiki\/(.+)$/);
  if (m?.[1]) return decodeURIComponent(m[1]).replace(/_/g, " ");
  // /w/index.php?title=Foo
  const q = u.searchParams.get("title");
  return q ? q.replace(/_/g, " ") : null;
}

export const wikipediaAdapter: SourceAdapter = {
  id: "wikipedia",
  match: (u) => WIKI_HOST.test(u.hostname) && titleFrom(u) !== null,

  async fetch(u, timeoutMs): Promise<SourceDoc | null> {
    const title = titleFrom(u);
    if (!title) return null;

    // The desktop host serves the API for every language edition; strip the mobile
    // prefix so en.m.wikipedia.org resolves to the same wiki.
    const apiHost = u.hostname.replace(/\.m\./, ".");
    const api =
      `https://${apiHost}/w/api.php?action=query&format=json&redirects=1` +
      `&prop=extracts&explaintext=1&exsectionformat=plain&titles=${encodeURIComponent(title)}`;

    const data = await getJson<ExtractQuery>(api, timeoutMs);
    const pages = data?.query?.pages;
    if (!pages) return null;

    const page = Object.values(pages)[0];
    if (!page || page.missing !== undefined || !page.extract) return null;

    // explaintext returns section headings as bare lines; keep them but guarantee a
    // blank line around each so they never fuse with the following paragraph.
    const textContent = page.extract
      .replace(/\n(={2,}.*?={2,})\n/g, "\n\n$1\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    const siteName = apiHost.split(".").slice(-2).join(".");
    return {
      title: page.title ?? title,
      byline: "",
      siteName,
      excerpt: textContent.slice(0, 300),
      textContent,
      contentHtml: "",
      canonicalUrl: `https://${apiHost}/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
    };
  },
};
