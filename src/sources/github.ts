import {
  getJson,
  getText,
  type SourceAdapter,
  type SourceDoc,
} from "./types.js";

interface Repo {
  full_name?: string;
  description?: string;
  stargazers_count?: number;
  language?: string;
  topics?: string[];
  html_url?: string;
  owner?: { login?: string };
}

/**
 * Raw README for a repo, optionally from a subdirectory (monorepo packages).
 * Returns "" rather than throwing so callers can fall through.
 */
export async function githubReadme(
  owner: string,
  repo: string,
  timeoutMs: number,
  directory?: string,
): Promise<string> {
  const raw = { Accept: "application/vnd.github.raw" };
  if (directory) {
    const dir = directory.replace(/^\/+|\/+$/g, "");
    for (const name of ["README.md", "readme.md"]) {
      const t = await getText(
        `https://api.github.com/repos/${owner}/${repo}/contents/${dir}/${name}`,
        timeoutMs,
        raw,
      );
      if (t) return t;
    }
  }
  return (
    (await getText(
      `https://api.github.com/repos/${owner}/${repo}/readme`,
      timeoutMs,
      raw,
    )) ?? ""
  );
}

function repoFrom(u: URL): { owner: string; repo: string } | null {
  const m = u.pathname.match(/^\/([^/]+)\/([^/]+)\/?$/);
  if (!m) return null;
  const [, owner, repo] = m;
  // /features, /pricing etc. are not repos.
  if (!owner || !repo || owner === "orgs" || owner === "sponsors") return null;
  return { owner, repo: repo.replace(/\.git$/, "") };
}

export const githubAdapter: SourceAdapter = {
  id: "github",
  match: (u) =>
    /^(?:www\.)?github\.com$/i.test(u.hostname) && repoFrom(u) !== null,

  async fetch(u, timeoutMs): Promise<SourceDoc | null> {
    const target = repoFrom(u);
    if (!target) return null;
    const { owner, repo } = target;

    // Unauthenticated GitHub API allows 60 requests/hour per IP. On exhaustion this
    // returns null and the caller falls back to scraping the HTML page.
    const [meta, readme] = await Promise.all([
      getJson<Repo>(`https://api.github.com/repos/${owner}/${repo}`, timeoutMs),
      githubReadme(owner, repo, timeoutMs),
    ]);

    if (!meta?.full_name && !readme) return null;

    const header = [
      meta?.full_name ?? `${owner}/${repo}`,
      meta?.description ?? "",
      [
        meta?.language ? `Language: ${meta.language}` : "",
        meta?.stargazers_count !== undefined
          ? `Stars: ${meta.stargazers_count}`
          : "",
        meta?.topics?.length ? `Topics: ${meta.topics.join(", ")}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    ].filter(Boolean);

    // READMEs are already markdown — paragraph structure is intact as fetched.
    const textContent = [...header, "", readme ?? ""]
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      title: meta?.full_name ?? `${owner}/${repo}`,
      byline: meta?.owner?.login ?? owner,
      siteName: "GitHub",
      excerpt: (meta?.description ?? textContent).slice(0, 300),
      textContent,
      contentHtml: "",
      canonicalUrl: meta?.html_url ?? `https://github.com/${owner}/${repo}`,
    };
  },
};
