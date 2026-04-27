import { chromium, type BrowserContext } from "playwright";
import { homedir } from "node:os";
import { join } from "node:path";
import { mkdirSync } from "node:fs";
import { applyStealth } from "./stealth.js";

const REAL_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36";

export interface LaunchOpts {
  headless?: boolean;
  profileDir?: string;
}

export async function launchContext(
  opts: LaunchOpts = {},
): Promise<BrowserContext> {
  const profileBase = join(homedir(), ".playwright-search", "profile");
  const profileDir = opts.profileDir
    ? opts.profileDir.startsWith("/")
      ? opts.profileDir
      : join(profileBase, opts.profileDir)
    : profileBase;
  mkdirSync(profileDir, { recursive: true });

  const ctx = await chromium.launchPersistentContext(profileDir, {
    headless: opts.headless ?? false,
    viewport: {
      width: 1366 + Math.floor(Math.random() * 80),
      height: 820 + Math.floor(Math.random() * 60),
    },
    userAgent: REAL_UA,
    locale: "en-US",
    timezoneId: "America/New_York",
    deviceScaleFactor: 2,
    hasTouch: false,
    isMobile: false,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--disable-features=IsolateOrigins,site-per-process",
      "--no-default-browser-check",
      "--no-first-run",
      "--password-store=basic",
    ],
    ignoreDefaultArgs: ["--enable-automation"],
  });

  await applyStealth(ctx);
  ctx.setDefaultTimeout(30_000);
  ctx.setDefaultNavigationTimeout(45_000);
  return ctx;
}
