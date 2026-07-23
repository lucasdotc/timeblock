import type { FixedBlock, Task, TimeWindow } from "./types";
import { DAY } from "./time";
import { FreeSpace, computeFreeGaps, expandFixed } from "./freespace";

export interface Busy {
  start: number;
  end: number;
}

/**
 * Find the earliest free slot (absolute minutes from horizon start) that fits
 * `task` at or after `afterMin`, given the immovable fixed blocks and the
 * already-occupied `busy` intervals (other scheduled blocks). Respects the
 * task's window and transit buffer. Returns the placed block bounds (buffers
 * excluded) or null if nothing fits in the horizon.
 *
 * This is what powers "a task was missed — suggest another time": deterministic,
 * conflict-free placement of one occurrence without disturbing the rest.
 */
export function findNextSlot(opts: {
  task: Task;
  fixedBlocks: FixedBlock[];
  busy: Busy[];
  horizonDays: number;
  afterMin: number;
  defaultWindow?: TimeWindow;
}): { start: number; end: number } | null {
  const { task, fixedBlocks, busy, horizonDays, afterMin, defaultWindow } = opts;
  const fixed = expandFixed(fixedBlocks, horizonDays);
  const free = new FreeSpace(computeFreeGaps(fixed, horizonDays));
  for (const b of busy) free.reserve(b.start, b.end);

  const buf = task.bufferMin ?? 0;
  const need = task.durationMin + 2 * buf;
  const win = task.window ?? defaultWindow ?? { startMin: 0, endMin: DAY };

  for (let d = 0; d < horizonDays; d++) {
    const lo = Math.max(d * DAY + win.startMin, afterMin);
    const hi = d * DAY + win.endMin;
    for (const c of free.within(lo, hi)) {
      const s = Math.max(c.start, lo);
      if (s + need <= c.end) {
        return { start: s + buf, end: s + buf + task.durationMin };
      }
    }
  }
  return null;
}
