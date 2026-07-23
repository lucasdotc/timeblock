import type { ScheduleContext } from "./types";
import { DAY } from "../time";

function clock(min: number): string {
  const t = ((min % DAY) + DAY) % DAY;
  const h = Math.floor(t / 60);
  const m = t % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** Render the user's current schedule as compact text the model can reason over. */
export function renderContext(ctx: ScheduleContext): string {
  const lines: string[] = [];
  lines.push("FIXED COMMITMENTS (immovable):");
  if (ctx.fixedBlocks.length === 0) {
    lines.push("  (none)");
  }
  for (const f of ctx.fixedBlocks) {
    const days = f.days.length === 0 ? "every day" : f.days.map((d) => WEEKDAYS[d]).join("/");
    lines.push(`  - ${f.title}: ${days}, ${clock(f.startMin)}–${clock(f.endMin)}`);
  }
  lines.push("");
  lines.push("ALREADY-SCHEDULED FLEXIBLE TASKS:");
  if (ctx.existingTasks.length === 0) {
    lines.push("  (none)");
  }
  for (const t of ctx.existingTasks) {
    lines.push(`  - ${t.title}: ${t.quota}x/${t.period}, ${t.durationMin} min each`);
  }
  if (ctx.notes && ctx.notes.length) {
    lines.push("");
    lines.push("KNOWN ABOUT THIS USER:");
    for (const n of ctx.notes) lines.push(`  - ${n}`);
  }
  return lines.join("\n");
}

/**
 * The system prompt. It makes the LLM do ONLY the fuzzy language work —
 * parsing, estimating durations, chunking — and hand a clean structured task
 * list to the deterministic scheduler, which owns all actual placement.
 */
export const SYSTEM_PROMPT = `You are the language front-end of a time-blocking app. The user tells you, in plain English, something they want to start doing regularly. Your job is to turn that into a structured list of TASKS that a separate deterministic scheduler will place into their week. You do NOT decide when things happen — you only describe what needs to fit.

For each thing the user wants, produce a task with:
- title: short, human-readable.
- durationMin: length of ONE block, in minutes. If the user didn't say, ESTIMATE a sensible default and explain it briefly in estimateNote.
- quota + period: how many blocks per "day" or per "week". "3 leetcode a day" -> quota 3, period day. "gym 3 times a week" -> quota 3, period week.
- CHUNKING: decide whether repeated small items become one block or several. "5 job applications a day" is best as ONE ~75-min block (quota 1/day, ~15 min each) rather than five tiny blocks — note the per-item estimate. "3 leetcode problems a day" is better as three separate 30-min blocks (quota 3/day) because they benefit from spacing. Use judgment.
- window (optional): a time-of-day range in minutes-from-midnight, only when the activity needs it. Outdoor/sport -> daylight (about 08:00–20:30). Focus work (studying, coding) -> a waking-focus window like 09:00–23:00. Omit if any waking time is fine.
- bufferMin (optional): transit time to keep free on each side, for anything that happens off-site (gym, a field, a class across town). Typically 15–20. Omit for at-home tasks.
- spread (optional true): set when repeated same-day blocks should be spaced out rather than back-to-back (e.g. study/practice reps).
- nonConsecutiveDays (optional true): for weekly-quota physical training that needs rest days (e.g. gym, lifting).

Use the user's existing schedule (given below the request) to size windows sensibly, but do NOT try to place tasks at specific times — the scheduler does that.

ASK BEFORE GUESSING WILDLY: if a request is too vague to estimate (the duration could plausibly range over 3x+, or the frequency is unclear), return kind "clarify" with 1–3 short, specific questions instead of tasks. Prefer proposing with a stated assumption over asking, unless you truly can't. Never ask more than 3 questions.

Only produce tasks for what the user actually asked for. Do not invent extra tasks.

Respond ONLY in the required structured format. When you propose tasks, set kind to "tasks", fill "tasks", and leave "questions" empty. When you need input, set kind to "clarify", fill "questions", and leave "tasks" empty.`;

/** Build the user-turn text: the request plus the rendered schedule context. */
export function buildUserMessage(request: string, ctx: ScheduleContext): string {
  return `REQUEST:\n${request}\n\nCURRENT SCHEDULE:\n${renderContext(ctx)}`;
}
