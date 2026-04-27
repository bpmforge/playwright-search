export function decodeBingRedirect(href: string): string {
  try {
    const u = new URL(href);
    if (!u.hostname.endsWith("bing.com") || !u.pathname.startsWith("/ck/"))
      return href;
    const enc = u.searchParams.get("u");
    if (!enc || enc.length <= 2) return href;
    const b64 = enc.slice(2).replace(/-/g, "+").replace(/_/g, "/");
    const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
    const decoded = Buffer.from(padded, "base64").toString("utf8");
    return /^https?:\/\//i.test(decoded) ? decoded : href;
  } catch {
    return href;
  }
}

export function decodeDdgUddg(href: string): string {
  try {
    const u = new URL(href, "https://duckduckgo.com");
    const uddg = u.searchParams.get("uddg");
    return uddg ? decodeURIComponent(uddg) : href;
  } catch {
    return href;
  }
}
