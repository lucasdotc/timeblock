import type { Minutes } from "./types";

/** Minutes in a day. */
export const DAY = 1440;

export const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"] as const;

/** Convenience: hours (+optional minutes) as minutes-from-midnight. hm(17,15) => 1035. */
export function hm(h: number, m = 0): number {
  return h * 60 + m;
}

/** Which day index (0-based) an absolute minute falls in. */
export function dayIndexOf(min: Minutes): number {
  return Math.floor(min / DAY);
}

/** Weekday for a given horizon day index (day 0 = Monday). */
export function weekdayOf(dayIndex: number): number {
  return ((dayIndex % 7) + 7) % 7;
}

/** Format an absolute minute as a wall-clock "HH:MM" string. */
export function fmtClock(min: Minutes): string {
  const t = ((min % DAY) + DAY) % DAY;
  const h = Math.floor(t / 60);
  const mm = Math.round(t % 60);
  return `${String(h).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
}
