import type {
  Conflict,
  EngineInput,
  FixedBlock,
  Interval,
  ScheduleResult,
  ScheduledBlock,
  Task,
  TimeWindow,
} from "./types";
import { DAY } from "./time";
import { FreeSpace, computeFreeGaps, expandFixed } from "./freespace";

/**
 * Sensible waking-hours window for windowless tasks, derived from the daily
 * sleep block: from when you wake until midnight. Prevents a task with no
 * window of its own from being scheduled in the small hours before sleep.
 */
export function wakingWindow(fixed: FixedBlock[]): TimeWindow {
  const sleep = fixed.find((f) => /sleep/i.test(f.title) && f.days.length === 0);
  return sleep ? { startMin: sleep.endMin, endMin: DAY } : { startMin: 9 * 60, endMin: DAY };
}

/** Soft minimum spacing between repeats of a spread task, in minutes. */
const SPREAD_GAP = 90;

/**
 * Deterministic scheduler.
 *
 * Strategy: lay fixed blocks as walls -> compute free gaps -> place the most
 * constrained tasks first (constraint-first / hardest-fit) -> for each task,
 * greedily drop occurrences into the earliest legal slot, reserving buffers so
 * nothing can overlap. Anything that can't be placed is reported as a Conflict
 * (never silently dropped or crammed) for the LLM layer to explain upstream.
 */
export function schedule(input: EngineInput): ScheduleResult {
  const fixed = expandFixed(input.fixedBlocks, input.horizonDays);
  const free = new FreeSpace(computeFreeGaps(fixed, input.horizonDays));
  // Reserve pre-occupied intervals (pinned one-time blocks) so recurring tasks
  // are placed around them.
  for (const iv of input.occupied ?? []) free.reserve(iv.start, iv.end);
  const blocks: ScheduledBlock[] = [];
  const conflicts: Conflict[] = [];

  const dflt = input.defaultWindow ?? { startMin: 0, endMin: DAY };

  // Fixed-time tasks (e.g. gym 1pm daily) are placed at their exact time first
  // and reserved, so flexible tasks schedule around them.
  const fixedTimeTasks = input.tasks.filter((t) => t.fixedTimeMin != null);
  const flexTasks = [...input.tasks.filter((t) => t.fixedTimeMin == null)].sort((a, b) => constraintScore(b) - constraintScore(a));

  for (const t of fixedTimeTasks) placeFixedTime(t, input.horizonDays, free, blocks);

  for (const t of flexTasks) {
    if (t.period === "day") {
      for (let d = 0; d < input.horizonDays; d++) {
        placeDay(t, d, dflt, free, blocks, conflicts);
      }
    } else {
      placeWeek(t, input.horizonDays, dflt, free, blocks, conflicts, input.reservedDaysByTask?.[t.id]);
    }
  }

  blocks.sort((a, b) => a.start - b.start);
  return { blocks, conflicts };
}

/**
 * How hard a task is to place. Higher = scheduled first. Long blocks, narrow
 * windows and buffered tasks are the tightest to fit, so they win the good
 * slots before easier tasks fill the space.
 */
function constraintScore(t: Task): number {
  const windowSpan = t.window ? t.window.endMin - t.window.startMin : DAY;
  const narrowness = DAY - windowSpan; // narrower window => higher
  const buffer = (t.bufferMin ?? 0) * 2;
  const priority = (t.priority ?? 0) * 1000;
  return priority + t.durationMin + narrowness + buffer;
}

/** Total contiguous free length a task needs for one occurrence (block + both buffers). */
function slotLength(t: Task): number {
  return t.durationMin + 2 * (t.bufferMin ?? 0);
}

/** First free interval (already window-clipped) that can host `need` minutes at/after `minStart`. */
function firstFit(candidates: Interval[], need: number, minStart: number): number | null {
  for (const c of candidates) {
    const start = Math.max(c.start, minStart);
    if (start + need <= c.end) return start;
  }
  return null;
}

/** Reserve the slot (including buffers) and record the block (buffer-offset inside it). */
function commit(t: Task, slotStart: number, free: FreeSpace, blocks: ScheduledBlock[]): number {
  const buf = t.bufferMin ?? 0;
  const need = slotLength(t);
  free.reserve(slotStart, slotStart + need);
  const start = slotStart + buf;
  const end = start + t.durationMin;
  blocks.push({ taskId: t.id, title: t.title, start, end });
  return end + buf; // end of the reserved region
}

/** Place a fixed-time task at its exact time-of-day on each relevant day. */
function placeFixedTime(t: Task, horizonDays: number, free: FreeSpace, blocks: ScheduledBlock[]): void {
  const time = t.fixedTimeMin ?? 0;
  const days =
    t.period === "day"
      ? Array.from({ length: horizonDays }, (_, i) => i)
      : t.nonConsecutiveDays
        ? spreadNonAdjacent(t.quota, horizonDays)
        : preferredDays(t.quota, horizonDays);
  for (const d of days) {
    const start = d * DAY + time;
    const end = start + t.durationMin;
    free.reserve(start, end);
    blocks.push({ taskId: t.id, title: t.title, start, end });
  }
}

/** Place all of a per-day task's occurrences on a single day. */
function placeDay(
  t: Task,
  d: number,
  dflt: { startMin: number; endMin: number },
  free: FreeSpace,
  blocks: ScheduledBlock[],
  conflicts: Conflict[],
): void {
  const win = t.window ?? dflt;
  const lo = d * DAY + win.startMin;
  const hi = d * DAY + win.endMin;
  const need = slotLength(t);

  let cursor = lo;
  for (let k = 0; k < t.quota; k++) {
    // Try to honour spacing first (cursor advanced past last placement + gap).
    let start = firstFit(free.within(cursor, hi), need, cursor);
    // If spacing left no room, relax and take any legal slot in the window.
    if (start === null && cursor > lo) {
      start = firstFit(free.within(lo, hi), need, lo);
    }
    if (start === null) {
      conflicts.push({
        taskId: t.id,
        title: t.title,
        reason: `No ${t.durationMin}-min slot on day ${d} within ${fmtWin(win)} (${t.quota - k} of ${t.quota} unplaced)`,
        dayIndex: d,
      });
      return; // remaining occurrences on this day won't fit either
    }
    const reservedEnd = commit(t, start, free, blocks);
    cursor = reservedEnd + (t.spread ? SPREAD_GAP : 0);
  }
}

/** Place a weekly-quota task across the horizon, preferring spread / non-consecutive days. */
function placeWeek(
  t: Task,
  horizonDays: number,
  dflt: { startMin: number; endMin: number },
  free: FreeSpace,
  blocks: ScheduledBlock[],
  conflicts: Conflict[],
  reservedDays?: number[],
): void {
  const win = t.window ?? dflt;
  const need = slotLength(t);
  // Days the task already occupies (a pinned occurrence) are seeded as "used"
  // so remaining flexible occurrences avoid them and honour non-consecutive
  // spacing against them — but they aren't re-placed (placed stays 0).
  const used: number[] = [...(reservedDays ?? [])];
  let placed = 0;

  const tryDay = (d: number): boolean => {
    if (used.includes(d)) return false;
    if (t.nonConsecutiveDays && used.some((u) => Math.abs(u - d) <= 1)) return false;
    const lo = d * DAY + win.startMin;
    const hi = d * DAY + win.endMin;
    const start = firstFit(free.within(lo, hi), need, lo);
    if (start === null) return false;
    commit(t, start, free, blocks);
    used.push(d);
    placed++;
    return true;
  };

  // Preferred days: evenly spread across the horizon. When non-consecutive is
  // required we spread with a guaranteed >=2-day gap so we never waste a
  // feasible day (e.g. 4x/week -> Mon/Wed/Fri/Sun, the true maximum in 7 days).
  const preferred = t.nonConsecutiveDays
    ? spreadNonAdjacent(t.quota, horizonDays)
    : preferredDays(t.quota, horizonDays);
  for (const d of preferred) {
    if (placed >= t.quota) break;
    tryDay(d);
  }
  // Fallback: any remaining day (still respecting non-consecutive if set).
  for (let d = 0; d < horizonDays && placed < t.quota; d++) {
    if (!used.includes(d)) tryDay(d);
  }

  if (placed < t.quota) {
    conflicts.push({
      taskId: t.id,
      title: t.title,
      reason: `Only placed ${placed}/${t.quota} weekly sessions of ${t.durationMin} min within ${fmtWin(win)}`,
    });
  }
}

/**
 * Evenly spaced days that are guaranteed non-adjacent (>=2 apart). Starts from
 * an even distribution, then pushes any too-close pick forward to keep the gap,
 * dropping picks that no longer fit — which yields the optimal count (e.g.
 * 5x/week in 7 days packs to 4: Mon/Wed/Fri/Sun, not 3).
 */
function spreadNonAdjacent(quota: number, horizonDays: number): number[] {
  const ideal = Array.from({ length: quota }, (_, i) =>
    Math.round((i * horizonDays) / quota),
  );
  const out: number[] = [];
  let prev = -2;
  for (const raw of ideal) {
    const d = Math.max(raw, prev + 2);
    if (d > horizonDays - 1) break; // no more room for a non-adjacent day
    out.push(d);
    prev = d;
  }
  return out;
}

/** Evenly spaced day indices across the horizon. */
function preferredDays(quota: number, horizonDays: number): number[] {
  if (quota <= 1) return [Math.floor((horizonDays - 1) / 2)];
  const days: number[] = [];
  for (let i = 0; i < quota; i++) {
    days.push(Math.round((i * (horizonDays - 1)) / (quota - 1)));
  }
  return days;
}

function fmtWin(w: { startMin: number; endMin: number }): string {
  const f = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
  return `${f(w.startMin)}-${f(w.endMin)}`;
}
