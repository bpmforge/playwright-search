import { JSDOM, VirtualConsole } from "jsdom";
import { Readability } from "@mozilla/readability";
import { detectPaywall } from "./paywall.js";
import { toMarkdown } from "../bpm-pull.js";

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

  const contentHtml = parsed.content ?? "";

  // Readability's own textContent flattens every block element into one run, and the
  // cleanup below only collapses newlines that already exist — it never inserts any.
  // The result was a single "paragraph" for every page, which made rankByQuery skip
  // relevance selection entirely and just head-truncate. Deriving the text from the
  // article HTML keeps paragraph boundaries, which is what BM25 ranks over.
  const blockText = contentHtml ? toMarkdown(contentHtml) : "";
  const textContent = (blockText || parsed.textContent || "")
    // Trailing horizontal whitespace only. The previous `\s+\n` also ate the newline
    // *before* a blank line, collapsing every paragraph break it was meant to tidy.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
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
