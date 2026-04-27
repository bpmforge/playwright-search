import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { detectPaywall } from "./paywall.js";

export interface Extracted {
  title: string;
  byline: string;
  siteName: string;
  excerpt: string;
  textContent: string;
  contentHtml: string;
  textLength: number;
  paywalled: boolean;
}

export function extract(html: string, url: string): Extracted | null {
  if (!html || html.length < 200) return null;

  const virtualConsole = new VirtualConsole();
  virtualConsole.on("error", () => {});
  virtualConsole.on("warn", () => {});
  virtualConsole.on("jsdomError", () => {});

  let dom: JSDOM;
  try {
    dom = new JSDOM(html, { url, virtualConsole });
  } catch {
    return null;
  }

  let parsed: ReturnType<Readability["parse"]> = null;
  try {
    const reader = new Readability(dom.window.document, { keepClasses: false });
    parsed = reader.parse();
  } catch {
    return null;
  } finally {
    dom.window.close();
  }

  if (!parsed) return null;

  const textContent = (parsed.textContent ?? "")
    .replace(/\s+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  const contentHtml = parsed.content ?? "";
  const textLength = textContent.length;

  const paywalled = detectPaywall({
    textContent,
    contentHtml,
    fullHtml: html,
    textLength,
  });

  return {
    title: (parsed.title ?? "").trim(),
    byline: (parsed.byline ?? "").trim(),
    siteName: (parsed.siteName ?? "").trim(),
    excerpt: (parsed.excerpt ?? "").trim(),
    textContent,
    contentHtml,
    textLength,
    paywalled,
  };
}
