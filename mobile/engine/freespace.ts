import type { FixedBlock, Interval } from "./types";
import { DAY, weekdayOf } from "./time";

/** Expand recurring fixed blocks into concrete intervals across the horizon. */
export function expandFixed(fixed: FixedBlock[], horizonDays: number): Interval[] {
  const out: Interval[] = [];
  for (let d = 0; d < horizonDays; d++) {
    const wd = weekdayOf(d);
    for (const fb of fixed) {
      const everyDay = fb.days.length === 0;
      if (everyDay || fb.days.includes(wd as never)) {
        out.push({ start: d * DAY + fb.startMin, end: d * DAY + fb.endMin });
      }
    }
  }
  return mergeIntervals(out);
}

/** Union overlapping/touching intervals into a minimal sorted set. */
export function mergeIntervals(ivs: Interval[]): Interval[] {
  const sorted = [...ivs].sort((a, b) => a.start - b.start);
  const res: Interval[] = [];
  for (const iv of sorted) {
    const last = res[res.length - 1];
    if (last && iv.start <= last.end) {
      last.end = Math.max(last.end, iv.end);
    } else {
      res.push({ ...iv });
    }
  }
  return res;
}

/** Complement of the fixed intervals within [0, horizonDays*DAY): the free time. */
export function computeFreeGaps(fixedMerged: Interval[], horizonDays: number): Interval[] {
  const total = horizonDays * DAY;
  const gaps: Interval[] = [];
  let cursor = 0;
  for (const iv of fixedMerged) {
    if (iv.start > cursor) gaps.push({ start: cursor, end: iv.start });
    cursor = Math.max(cursor, iv.end);
  }
  if (cursor < total) gaps.push({ start: cursor, end: total });
  return gaps;
}

/**
 * Mutable pool of free time. Placements reserve (subtract) intervals so that
 * later placements can never overlap earlier ones — the engine's core
 * no-double-booking guarantee.
 */
export class FreeSpace {
  private gaps: Interval[];

  constructor(gaps: Interval[]) {
    this.gaps = gaps.map((g) => ({ ...g }));
  }

  /** Free sub-intervals intersected with [lo, hi), sorted by start. */
  within(lo: number, hi: number): Interval[] {
    const r: Interval[] = [];
    for (const g of this.gaps) {
      const s = Math.max(g.start, lo);
      const e = Math.min(g.end, hi);
      if (e > s) r.push({ start: s, end: e });
    }
    return r;
  }

  /** Remove [start, end) from the free pool. */
  reserve(start: number, end: number): void {
    const next: Interval[] = [];
    for (const g of this.gaps) {
      if (end <= g.start || start >= g.end) {
        next.push(g); // untouched
        continue;
      }
      if (g.start < start) next.push({ start: g.start, end: start });
      if (end < g.end) next.push({ start: end, end: g.end });
    }
    this.gaps = next;
  }

  /** Snapshot of remaining free intervals (for inspection/tests). */
  snapshot(): Interval[] {
    return this.gaps.map((g) => ({ ...g }));
  }
}
