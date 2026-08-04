import { getJson, type SourceAdapter, type SourceDoc } from "./types.js";
import { githubReadme } from "./github.js";

interface Packument {
  name?: string;
  description?: string;
  readme?: string;
  "dist-tags"?: Record<string, string>;
  versions?: Record<string, { readme?: string; description?: string }>;
  repository?: { url?: string; directory?: string } | string;
  homepage?: string;
  license?: string;
}

/** "git+https://github.com/facebook/react.git" -> facebook/react */
function githubRepoOf(
  repository: Packument["repository"],
): { owner: string; repo: string; directory?: string } | null {
  const url = typeof repository === "string" ? repository : repository?.url;
  if (!url) return null;
  const m = url.match(/github\.com[/:]([^/]+)\/([^/#?]+?)(?:\.git)?$/i);
  if (!m?.[1] || !m[2]) return null;
  const directory =
    typeof repository === "object" ? repository.directory : undefined;
  return { owner: m[1], repo: m[2], directory };
}

/** /package/react, /package/@scope/name, with optional /v/1.2.3 */
function nameFrom(u: URL): string | null {
  const m = u.pathname.match(/^\/package\/((?:@[^/]+\/)?[^/]+)/);
  return m?.[1] ?? null;
}

export const npmAdapter: SourceAdapter = {
  id: "npm",
  match: (u) =>
    /^(?:www\.)?npmjs\.com$/i.test(u.hostname) && nameFrom(u) !== null,

  async fetch(u, timeoutMs): Promise<SourceDoc | null> {
    const name = nameFrom(u);
    if (!name) return null;

    // The registry serves the packument (metadata + README) as JSON; the website is a
    // JS app that yields almost nothing to a plain fetch.
    const pkg = await getJson<Packument>(
      `https://registry.npmjs.org/${name.replace("/", "%2F")}`,
      timeoutMs,
    );
    if (!pkg?.name) return null;

    const latest = pkg["dist-tags"]?.latest;

    // The registry's readme is empty for plenty of major packages (react included),
    // which would leave nothing but a metadata stub. Try the version entry first.
    let readme =
      pkg.readme || (latest ? (pkg.versions?.[latest]?.readme ?? "") : "");
    if (!readme.trim()) {
      // Fall back to the linked GitHub repo, honouring `directory` so a monorepo
      // package gets its own README rather than the repo root's.
      const gh = githubRepoOf(pkg.repository);
      if (gh) {
        readme = await githubReadme(gh.owner, gh.repo, timeoutMs, gh.directory);
      }
    }
    const header = [
      pkg.name,
      pkg.description ?? "",
      [
        latest ? `Latest: ${latest}` : "",
        pkg.license ? `License: ${pkg.license}` : "",
        pkg.homepage ? `Homepage: ${pkg.homepage}` : "",
      ]
        .filter(Boolean)
        .join(" | "),
    ].filter(Boolean);

    const textContent = [...header, "", readme]
      .join("\n\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();

    return {
      title: pkg.name,
      byline: "",
      siteName: "npm",
      excerpt: (pkg.description ?? textContent).slice(0, 300),
      textContent,
      contentHtml: "",
      canonicalUrl: `https://www.npmjs.com/package/${pkg.name}`,
    };
  },
};
