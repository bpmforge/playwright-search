const PAYWALL_PATTERNS: RegExp[] = [
  /subscribe to (continue reading|read|access)/i,
  /create a free account to (continue|read)/i,
  /already a (subscriber|member)\??\s*(sign|log) ?in/i,
  /this (article|story) is for subscribers only/i,
  /you've reached your (free )?article limit/i,
  /unlock (this|the full) (article|story)/i,
  /register to (continue|view) this (article|story)/i,
];

const PAYWALL_SELECTORS_HINTS = [
  "paywall",
  "subscriber-wall",
  "register-wall",
  "meter-overlay",
  "regiwall",
];

export function detectPaywall(opts: {
  textContent: string;
  contentHtml: string;
  fullHtml: string;
  textLength: number;
}): boolean {
  const { textContent, contentHtml, fullHtml, textLength } = opts;

  for (const re of PAYWALL_PATTERNS) {
    if (re.test(textContent) || re.test(fullHtml)) return true;
  }

  for (const hint of PAYWALL_SELECTORS_HINTS) {
    if (
      fullHtml.toLowerCase().includes(`class="${hint}`) ||
      fullHtml.toLowerCase().includes(`id="${hint}`)
    ) {
      return true;
    }
  }

  const looksTruncated =
    textLength < 800 &&
    /\.\.\.$|continue reading|read more|sign in|subscribe/i.test(
      textContent.slice(-200),
    );
  if (looksTruncated) return true;

  const visibleToHiddenRatio = textLength / Math.max(1, contentHtml.length);
  if (textLength < 400 && visibleToHiddenRatio < 0.05) return true;

  return false;
}
