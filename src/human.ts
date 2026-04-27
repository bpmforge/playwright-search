import type { Page } from "playwright";

const rand = (min: number, max: number) => min + Math.random() * (max - min);
const randInt = (min: number, max: number) => Math.floor(rand(min, max + 1));

export const sleep = (ms: number) =>
  new Promise<void>((r) => setTimeout(r, ms));

export const jitter = (min: number, max: number) => sleep(randInt(min, max));

export async function humanType(
  page: Page,
  selector: string,
  text: string,
): Promise<void> {
  const el = page.locator(selector).first();
  await el.click({ delay: randInt(40, 120) });
  await jitter(150, 400);
  for (const ch of text) {
    await page.keyboard.type(ch, { delay: randInt(55, 175) });
    if (Math.random() < 0.05) await jitter(180, 420);
  }
}

export async function humanScroll(page: Page): Promise<void> {
  const steps = randInt(2, 4);
  for (let i = 0; i < steps; i++) {
    await page.mouse.wheel(0, randInt(180, 420));
    await jitter(200, 550);
  }
}

export async function humanMoveMouse(page: Page): Promise<void> {
  const vp = page.viewportSize();
  if (!vp) return;
  const x = randInt(50, vp.width - 50);
  const y = randInt(50, vp.height - 50);
  await page.mouse.move(x, y, { steps: randInt(8, 18) });
}
