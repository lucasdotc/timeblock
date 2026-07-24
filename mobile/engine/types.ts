/**
 * Core domain model for the scheduling engine.
 *
 * Time is represented as ABSOLUTE MINUTES since the start of the planning
 * horizon (day 0 at 00:00 local). Working on one continuous integer timeline
 * makes gap math trivial and makes overnight windows (e.g. sleep 01:00–09:00,
 * awake time flowing 09:00 → 01:00 next day) fall out for free.
 */

/** Absolute minutes since the start of the horizon (day 0 @ 00:00 local). */
export type Minutes = number;

/** 0 = Monday … 6 = Sunday. Day 0 of the horizon is assumed to be Monday. */
export type Weekday = 0 | 1 | 2 | 3 | 4 | 5 | 6;

/** A half-open interval [start, end) on the absolute timeline. */
export interface Interval {
  start: Minutes;
  end: Minutes;
}

/** Minutes-from-local-midnight window, e.g. 09:00–23:00 => { startMin: 540, endMin: 1380 }. */
export interface TimeWindow {
  startMin: number;
  endMin: number;
}

/**
 * An immovable commitment (work, sleep, a fixed class). These are the "walls"
 * the scheduler packs flexible tasks around.
 */
export interface FixedBlock {
  id: string;
  title: string;
  /** Weekdays this recurs on. Empty array => every day. */
  days: Weekday[];
  /** Minutes from local midnight. */
  startMin: number;
  /** Minutes from local midnight (must be > startMin). */
  endMin: number;
}

/**
 * A flexible thing to fit in. The engine consumes tasks that are ALREADY
 * chunked — i.e. `durationMin` is the length of one placed block, and `quota`
 * is how many such blocks are needed per period. (Deciding that "5 job apps"
 * becomes one 75-min block is Claude's job, upstream of this engine.)
 */
export interface Task {
  id: string;
  title: string;
  /** Length of ONE occurrence/block, in minutes. */
  durationMin: number;
  /** Occurrences required per period. */
  quota: number;
  period: "day" | "week";
  /** Allowed time-of-day window (applied per day). Omit => any waking time. */
  window?: TimeWindow;
  /** Transit buffer kept free immediately before AND after the block. */
  bufferMin?: number;
  /** Prefer spacing repeats apart within a bucket (soft; day tasks only). */
  spread?: boolean;
  /** Weekly tasks: avoid landing on adjacent days (e.g. gym rest days). */
  nonConsecutiveDays?: boolean;
  /** Higher = placed earlier when time is contended. Optional tiebreak. */
  priority?: number;
  /**
   * Fixed time-of-day (minutes from midnight). When set, every occurrence is
   * pinned to this time (e.g. gym 1pm daily) rather than the scheduler picking.
   */
  fixedTimeMin?: number;
}

export interface ScheduledBlock {
  taskId: string;
  title: string;
  start: Minutes;
  end: Minutes;
}

export interface Conflict {
  taskId: string;
  title: string;
  reason: string;
  dayIndex?: number;
}

export interface EngineInput {
  /** Length of the rolling plan, e.g. 7. */
  horizonDays: number;
  fixedBlocks: FixedBlock[];
  tasks: Task[];
  /**
   * Fallback time-of-day window for tasks that declare no `window` of their
   * own — i.e. the user's waking hours. Without it, a windowless task can be
   * placed at 00:00. Defaults to the full day (0–1440) if omitted.
   */
  defaultWindow?: TimeWindow;
  /**
   * Pre-occupied intervals (absolute minutes) reserved before any task is
   * placed — e.g. pinned one-time blocks. Recurring tasks schedule around them.
   */
  occupied?: Interval[];
  /**
   * Days (0-based horizon index) a weekly task ALREADY has an occurrence on —
   * e.g. a pinned/manually-timed session of that recurring task. Those days are
   * off-limits for the task's remaining flexible occurrences, so the engine
   * spreads the rest onto other days instead of doubling up. Keyed by task id.
   */
  reservedDaysByTask?: Record<string, number[]>;
}

export interface ScheduleResult {
  blocks: ScheduledBlock[];
  conflicts: Conflict[];
}
