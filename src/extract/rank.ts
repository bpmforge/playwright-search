const STOPWORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "but",
  "by",
  "for",
  "from",
  "has",
  "have",
  "i",
  "in",
  "is",
  "it",
  "its",
  "of",
  "on",
  "or",
  "that",
  "the",
  "this",
  "to",
  "was",
  "were",
  "what",
  "when",
  "where",
  "which",
  "who",
  "why",
  "with",
  "will",
  "would",
  "do",
  "does",
  "did",
  "can",
  "could",
  "should",
  "shall",
  "may",
  "might",
  "must",
  "you",
  "your",
  "they",
  "their",
  "there",
  "these",
  "those",
  "not",
  "no",
  "than",
  "how",
  "then",
  "so",
  "such",
  "up",
  "down",
  "out",
  "over",
  "under",
  "one",
  "two",
  "also",
  "only",
  "just",
  "into",
  "about",
  "my",
  "me",
  "we",
  "our",
  "us",
  "he",
  "she",
  "his",
  "her",
  "them",
  "i'm",
  "i've",
  "i'll",
  "it's",
  "that's",
  "you're",
  "we're",
  "they're",
]);

export function tokenizeQuery(query: string): string[] {
  return query
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 2 && !STOPWORDS.has(t));
}

export function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n+/)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 40);
}

interface ScoredParagraph {
  index: number;
  text: string;
  score: number;
  distinctTerms: number;
  totalHits: number;
}

export function scoreParagraphs(
  paragraphs: string[],
  queryTerms: string[],
): ScoredParagraph[] {
  if (queryTerms.length === 0) {
    return paragraphs.map((text, index) => ({
      index,
      text,
      score: 1 / (index + 1),
      distinctTerms: 0,
      totalHits: 0,
    }));
  }

  const lengths = paragraphs.map((p) => p.length);
  const avgLen =
    lengths.reduce((a, b) => a + b, 0) / Math.max(1, paragraphs.length);
  const k1 = 1.2;
  const b = 0.6;

  return paragraphs.map((text, index) => {
    const lower = text.toLowerCase();
    let totalHits = 0;
    let distinctTerms = 0;
    let bm25 = 0;

    for (const term of queryTerms) {
      const re = new RegExp(
        `\\b${term.replace(/[.*+?^${}()|[\\]\\\\]/g, "\\$&")}\\b`,
        "g",
      );
      const hits = (lower.match(re) || []).length;
      if (hits > 0) {
        distinctTerms++;
        totalHits += hits;
        const tf = hits;
        const norm = 1 - b + b * (text.length / avgLen);
        bm25 += (tf * (k1 + 1)) / (tf + k1 * norm);
      }
    }

    const earlyBoost = 1 + 0.15 * Math.exp(-index / 5);
    const score = bm25 * earlyBoost + distinctTerms * 0.5;
    return { index, text, score, distinctTerms, totalHits };
  });
}

export interface RankedExtract {
  paragraphs: string[];
  totalParagraphs: number;
  selectedCount: number;
  charsUsed: number;
}

export function packTopParagraphs(
  scored: ScoredParagraph[],
  maxChars: number,
): RankedExtract {
  const sorted = [...scored].sort(
    (a, b) => b.score - a.score || a.index - b.index,
  );
  const picked: ScoredParagraph[] = [];
  let used = 0;

  for (const p of sorted) {
    const cost = p.text.length + 2;
    if (used + cost <= maxChars) {
      picked.push(p);
      used += cost;
    } else if (picked.length === 0) {
      picked.push({ ...p, text: p.text.slice(0, maxChars - 2) });
      used = maxChars;
      break;
    }
  }

  picked.sort((a, b) => a.index - b.index);
  return {
    paragraphs: picked.map((p) => p.text),
    totalParagraphs: scored.length,
    selectedCount: picked.length,
    charsUsed: used,
  };
}

export function rankByQuery(
  text: string,
  query: string,
  maxChars: number,
): RankedExtract {
  const paragraphs = splitParagraphs(text);
  if (paragraphs.length === 0) {
    const trimmed = text.length > maxChars ? text.slice(0, maxChars) : text;
    return {
      paragraphs: [trimmed],
      totalParagraphs: 0,
      selectedCount: 1,
      charsUsed: trimmed.length,
    };
  }
  const terms = tokenizeQuery(query);
  const scored = scoreParagraphs(paragraphs, terms);
  return packTopParagraphs(scored, maxChars);
}
