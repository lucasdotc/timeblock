import type { FixedBlock, Task, TimeWindow } from "../types";

/**
 * A task as proposed by the LLM. Mirrors the engine's `Task` but adds
 * `estimateNote` — a short human-readable justification for the duration /
 * chunking the LLM chose, so the app can show it to the user for a quick
 * confirm before the block is locked in.
 */
export interface ProposedTask {
  id: string;
  title: string;
  durationMin: number;
  quota: number;
  period: "day" | "week";
  window?: TimeWindow;
  /** Fixed time-of-day (minutes from midnight) — every occurrence pinned here. */
  fixedTimeMin?: number;
  bufferMin?: number;
  spread?: boolean;
  nonConsecutiveDays?: boolean;
  /** Why the LLM chose this duration/chunking, e.g. "≈15 min per application". */
  estimateNote?: string;
}

/**
 * The result of parsing one natural-language request. Either the LLM is
 * confident and proposes tasks, or it needs the user to answer a question
 * first (the "ask when unsure" path).
 */
export type ParseResult =
  | { kind: "tasks"; tasks: ProposedTask[]; summary?: string }
  | { kind: "clarify"; questions: string[] };

/**
 * What the LLM knows about the user's existing schedule when interpreting a
 * request — so it can size windows sensibly (e.g. avoid clashing with work)
 * and not double-propose something already scheduled.
 */
export interface ScheduleContext {
  fixedBlocks: FixedBlock[];
  existingTasks: Task[];
  /** Free-form notes the app has learned about the user (Phase 5 habit data). */
  notes?: string[];
}

/**
 * The seam between the language layer and any model backend. The real
 * implementation calls Claude; the mock returns canned results for offline
 * tests and demos. Everything above this interface is model-agnostic.
 */
export interface LlmClient {
  proposeTasks(input: {
    request: string;
    context: ScheduleContext;
  }): Promise<ParseResult>;
}

/** Drop the LLM-only `estimateNote` to get a plain engine Task. */
export function toEngineTask(p: ProposedTask): Task {
  const { estimateNote, ...task } = p;
  void estimateNote;
  return task;
}
