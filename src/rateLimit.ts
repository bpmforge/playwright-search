import type { EngineId } from "./types.js";
import { sleep } from "./human.js";

const lastCall = new Map<EngineId, number>();
const minGapMs: Record<EngineId, number> = {
  ddg: 6000,
  brave: 7000,
  bing: 9000,
  google: 12000,
};

export async function waitForSlot(engine: EngineId): Promise<void> {
  const last = lastCall.get(engine) ?? 0;
  const elapsed = Date.now() - last;
  const gap = minGapMs[engine];
  const need = gap + Math.floor(Math.random() * 2000);
  if (elapsed < need) {
    await sleep(need - elapsed);
  }
  lastCall.set(engine, Date.now());
}
