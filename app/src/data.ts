import { supabase, weekStart, type PlannedBlock } from "./supabase";
import { schedule, wakingWindow } from "../../src/scheduler";
import { findNextSlot } from "../../src/suggest";
import type { FixedBlock, Task, Weekday } from "../../src/types";
import { toEngineTask } from "../../src/llm/types";
import type { ProposedTask } from "../../src/llm/types";

/** A task with its DB description (not part of the pure engine Task). */
export interface TaskRow extends Task {
  description: string | null;
}

// The deployed Supabase Edge Function (key held server-side). To fall back to
// the local dev server, set this to "http://localhost:8787/parse".
const PARSE_URL = `${import.meta.env.VITE_SUPABASE_URL}/functions/v1/parse`;

export interface EventInput {
  title: string;
  durationMin: number;
  startAt: string | null; // local naive "YYYY-MM-DDTHH:MM" fixed time
  day: string | null; // local "YYYY-MM-DD" flexible day
}

export type ParseResult =
  | { kind: "tasks"; tasks: ProposedTask[] }
  | { kind: "clarify"; questions: string[] }
  | { kind: "delete"; taskIds: string[]; summary: string }
  | { kind: "events"; events: EventInput[] }
  | { kind: "edit"; edits: EditInput[] }
  | { kind: "rearrange"; rearrange: RearrangeInput };

/** Extract a readable message from anything thrown (Error, Supabase error, string). */
export function errMsg(e: unknown): string {
  if (!e) return "Unknown error";
  if (e instanceof Error) return e.message;
  if (typeof e === "string") return e;
  if (typeof e === "object") {
    const o = e as Record<string, unknown>;
    return (
      (o.message as string) ||
      (o.error_description as string) ||
      (o.hint as string) ||
      (o.details as string) ||
      JSON.stringify(o)
    );
  }
  return String(e);
}

async function userId(): Promise<string> {
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

export async function listFixedBlocks(): Promise<FixedBlock[]> {
  const { data, error } = await supabase.from("fixed_blocks").select("*");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    days: (r.days ?? []) as Weekday[],
    startMin: r.start_min,
    endMin: r.end_min,
  }));
}

/** A fixed commitment (work, sleep, class…) — always a scheduling wall; can be shown on the calendar. */
export interface FixedSchedule {
  id: string;
  title: string;
  days: number[]; // 0=Mon..6=Sun; empty = every day
  startMin: number;
  endMin: number;
  showOnCalendar: boolean;
}
export type FixedScheduleInput = Omit<FixedSchedule, "id">;

export async function listFixedSchedules(): Promise<FixedSchedule[]> {
  const { data, error } = await supabase.from("fixed_blocks").select("*").order("start_min");
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    title: r.title,
    days: (r.days ?? []) as number[],
    startMin: r.start_min,
    endMin: r.end_min,
    showOnCalendar: !!r.show_on_calendar,
  }));
}

export async function createFixedSchedule(f: FixedScheduleInput): Promise<void> {
  const user_id = await userId();
  const { error } = await supabase.from("fixed_blocks").insert({
    user_id,
    title: f.title,
    days: f.days,
    start_min: f.startMin,
    end_min: f.endMin,
    show_on_calendar: f.showOnCalendar,
  });
  if (error) throw error;
}

export async function updateFixedSchedule(id: string, f: Partial<FixedScheduleInput>): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (f.title !== undefined) patch.title = f.title;
  if (f.days !== undefined) patch.days = f.days;
  if (f.startMin !== undefined) patch.start_min = f.startMin;
  if (f.endMin !== undefined) patch.end_min = f.endMin;
  if (f.showOnCalendar !== undefined) patch.show_on_calendar = f.showOnCalendar;
  const { error } = await supabase.from("fixed_blocks").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteFixedSchedule(id: string): Promise<void> {
  const { error } = await supabase.from("fixed_blocks").delete().eq("id", id);
  if (error) throw error;
}

export async function listTasks(): Promise<Task[]> {
  const { data, error } = await supabase.from("tasks").select("*").eq("active", true);
  if (error) throw error;
  return (data ?? []).map((r: any) => {
    const t: Task = {
      id: r.id,
      title: r.title,
      durationMin: r.duration_min,
      quota: r.quota,
      period: r.period,
      bufferMin: r.buffer_min ?? 0,
      spread: r.spread ?? false,
      nonConsecutiveDays: r.non_consecutive_days ?? false,
      priority: r.priority ?? 0,
    };
    if (r.window_start_min != null && r.window_end_min != null) {
      t.window = { startMin: r.window_start_min, endMin: r.window_end_min };
    }
    if (r.fixed_time_min != null) t.fixedTimeMin = r.fixed_time_min;
    return t;
  });
}

export async function saveProposedTask(p: ProposedTask): Promise<void> {
  const user_id = await userId();
  const { error } = await supabase.from("tasks").insert({
    user_id,
    title: p.title,
    duration_min: p.durationMin,
    quota: p.quota,
    period: p.period,
    window_start_min: p.window?.startMin ?? null,
    window_end_min: p.window?.endMin ?? null,
    fixed_time_min: p.fixedTimeMin ?? null,
    buffer_min: p.bufferMin ?? 0,
    spread: p.spread ?? false,
    non_consecutive_days: p.nonConsecutiveDays ?? false,
    estimate_note: p.estimateNote ?? null,
  });
  if (error) throw error;
}

// Serialize re-plans: rescheduleAndSave does a non-atomic delete-then-insert, so
// two overlapping calls (e.g. two quick UI actions) could both delete then both
// insert, doubling every block. The lock forces them to run one after another.
let rescheduleLock: Promise<unknown> = Promise.resolve();

/** Re-run the engine over all persisted tasks and replace the saved plan. Serialized. */
export function rescheduleAndSave(): Promise<{ placed: number; conflicts: string[] }> {
  const run = rescheduleLock.then(rescheduleAndSaveInner, rescheduleAndSaveInner);
  rescheduleLock = run.then(() => {}, () => {}); // keep the chain alive through errors
  return run;
}

/**
 * Guardrail: remove any duplicate planned blocks that share the same task (or
 * title) and start time, keeping one. Belt-and-suspenders against duplicates
 * however they arise (concurrent writes, another tab, a crashed mid-write).
 */
async function dedupePlannedWeek(start: Date, end: Date): Promise<void> {
  const { data } = await supabase
    .from("scheduled_blocks")
    .select("id, title, task_id, starts_at")
    .eq("status", "planned")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("id");
  const seen = new Set<string>();
  const extra: string[] = [];
  for (const b of data ?? []) {
    const k = `${(b as any).task_id ?? (b as any).title}|${(b as any).starts_at}`;
    if (seen.has(k)) extra.push((b as any).id);
    else seen.add(k);
  }
  if (extra.length) await supabase.from("scheduled_blocks").delete().in("id", extra);
}

async function rescheduleAndSaveInner(): Promise<{ placed: number; conflicts: string[] }> {
  const user_id = await userId();
  const fixedBlocks = await listFixedBlocks();
  const tasks = await listTasks();

  const start = weekStart();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();
  const dayOf = (isoStr: string) => Math.floor((new Date(isoStr).getTime() - start.getTime()) / 86_400_000);
  const toMin = (isoStr: string) => Math.round((new Date(isoStr).getTime() - start.getTime()) / 60_000);

  // Pinned blocks (one-time events + manually-timed occurrences) are fixed:
  // reserve their time so recurring tasks avoid them, and never move them.
  const { data: pinnedRows } = await supabase
    .from("scheduled_blocks")
    .select("task_id, starts_at, ends_at")
    .eq("pinned", true)
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());
  const occupied = (pinnedRows ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }));

  // A pinned occurrence that belongs to a recurring task counts toward that
  // task's quota — otherwise the engine would place the full flexible quota
  // AROUND the pin and over-schedule the task (e.g. soccer 2x/wk + pinned Thu = 3).
  const pinnedByTask = new Map<string, number>();
  const reservedDaysByTask: Record<string, number[]> = {};
  for (const r of pinnedRows ?? []) {
    if (!r.task_id) continue;
    pinnedByTask.set(r.task_id, (pinnedByTask.get(r.task_id) ?? 0) + 1);
    (reservedDaysByTask[r.task_id] ??= []).push(dayOf(r.starts_at));
  }
  const planTasks = tasks
    .map((t) => {
      // Only WEEKLY tasks' quotas are consumed by a pin (their quota is a weekly
      // total). A DAILY task keeps its per-day quota; its pinned day is excluded
      // via the `resolved` set below, so it still places on every other day.
      const pins = t.period === "week" ? pinnedByTask.get(t.id) ?? 0 : 0;
      return pins ? { ...t, quota: Math.max(0, t.quota - pins) } : t;
    })
    .filter((t) => t.quota > 0);

  const { blocks, conflicts } = schedule({
    horizonDays: 7,
    fixedBlocks,
    tasks: planTasks,
    defaultWindow: wakingWindow(fixedBlocks),
    occupied,
    reservedDaysByTask,
  });

  // Don't regenerate a task+day already resolved (done/skipped) or pinned.
  const { data: kept } = await supabase
    .from("scheduled_blocks")
    .select("task_id, starts_at")
    .or("status.neq.planned,pinned.eq.true")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());
  const resolved = new Set((kept ?? []).map((r: any) => `${r.task_id}|${dayOf(r.starts_at)}`));

  // Replace only NON-pinned planned blocks.
  await supabase
    .from("scheduled_blocks")
    .delete()
    .eq("status", "planned")
    .eq("pinned", false)
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());

  // Self-heal: purge untethered NON-pinned ghost blocks (pinned one-time blocks
  // legitimately have no task_id).
  await supabase.from("scheduled_blocks").delete().is("task_id", null).eq("pinned", false);

  const fresh = blocks.filter((b) => !resolved.has(`${b.taskId}|${Math.floor(b.start / 1440)}`));
  if (fresh.length) {
    const rows = fresh.map((b) => ({
      user_id,
      task_id: b.taskId,
      title: b.title,
      starts_at: iso(b.start),
      ends_at: iso(b.end),
      status: "planned" as const,
    }));
    const { error } = await supabase.from("scheduled_blocks").insert(rows);
    if (error) throw error;
  }
  await dedupePlannedWeek(start, end);
  return { placed: fresh.length, conflicts: conflicts.map((c) => `${c.title}: ${c.reason}`) };
}

/** Call the parse server with the current schedule as context. */
export async function parse(request: string, scope: "day" | "week" = "week"): Promise<ParseResult> {
  const [fixedBlocks, existingTasks] = await Promise.all([listFixedBlocks(), listTasks()]);
  const anon = import.meta.env.VITE_SUPABASE_ANON_KEY as string;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? anon;
  const res = await fetch(PARSE_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
      apikey: anon,
    },
    body: JSON.stringify({ request, context: { now: localNow(), scope, fixedBlocks, existingTasks } }),
  });
  if (!res.ok) throw new Error(`parse error (${res.status})`);
  return res.json();
}

/** Current time as a local naive string with weekday, for resolving relative dates. */
function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const wd = d.toLocaleDateString([], { weekday: "long" });
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())} (${wd})`;
}

/**
 * Map any date reference to the SAME weekday within the current planning week
 * (day 0 = this week's Monday). The LLM resolves relative day names to their
 * next occurrence, so a day earlier in the week than today (e.g. "monday" on a
 * Wednesday) lands in next week — outside the visible 7-day horizon. Wrapping by
 * weekday keeps every day edit on the week the user is looking at.
 */
function weekdayInThisWeek(isoDate: string): { dayIndex: number; date: Date } {
  const start = weekStart();
  const abs = Math.floor((new Date(isoDate).getTime() - start.getTime()) / 86_400_000);
  const dayIndex = ((abs % 7) + 7) % 7;
  return { dayIndex, date: new Date(start.getTime() + dayIndex * 86_400_000) };
}

/**
 * Place one-time events as PINNED blocks. Fixed-time events go at their exact
 * time; flexible ones (a day, or no constraint) are dropped into the earliest
 * free slot via the engine. Pinned blocks are never moved by the weekly re-plan.
 */
export async function createEvents(events: EventInput[]): Promise<{ placed: number; unplaced: string[] }> {
  const user_id = await userId();
  const fixedBlocks = await listFixedBlocks();
  const start = weekStart();
  const toMin = (iso: string) => Math.round((new Date(iso).getTime() - start.getTime()) / 60_000);
  const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();

  const { data: existing } = await supabase.from("scheduled_blocks").select("starts_at, ends_at").neq("status", "skipped");
  const busy = (existing ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }));

  const rows: any[] = [];
  const unplaced: string[] = [];
  for (const ev of events) {
    if (ev.startAt) {
      const s = new Date(ev.startAt);
      const e = new Date(s.getTime() + ev.durationMin * 60_000);
      rows.push({ user_id, task_id: null, title: ev.title, starts_at: s.toISOString(), ends_at: e.toISOString(), status: "planned", pinned: true });
      busy.push({ start: toMin(s.toISOString()), end: toMin(e.toISOString()) });
    } else {
      const dayStart = ev.day ? new Date(`${ev.day}T00:00`).getTime() : Date.now();
      const afterMin = Math.max(0, Math.round((Math.max(Date.now(), dayStart) - start.getTime()) / 60_000));
      const slot = findNextSlot({
        task: { id: "ev", title: ev.title, durationMin: ev.durationMin, quota: 1, period: "day" },
        fixedBlocks,
        busy,
        horizonDays: 7,
        afterMin,
        defaultWindow: wakingWindow(fixedBlocks),
      });
      if (!slot) {
        unplaced.push(ev.title);
        continue;
      }
      rows.push({ user_id, task_id: null, title: ev.title, starts_at: iso(slot.start), ends_at: iso(slot.end), status: "planned", pinned: true });
      busy.push({ start: slot.start, end: slot.end });
    }
  }
  if (rows.length) {
    const { error } = await supabase.from("scheduled_blocks").insert(rows);
    if (error) throw error;
  }
  return { placed: rows.length, unplaced };
}

export interface Proposal {
  moves: { title: string; from: string; to: string }[];
  adds: string[];
  removes: string[];
  apply: () => Promise<{ placed: number; conflicts: string[] }>;
}

const shortLabel = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

/**
 * Compute what adding `newTasks` / `newEvents` would do to the week WITHOUT
 * saving anything — returns the list of existing blocks that would move (plus
 * adds/removes) and an apply() to commit. Nothing persists until apply() runs,
 * so cancelling is a no-op. Underpins the "confirm before moving" policy (#6).
 */
export async function proposeAdd(newTasksRaw: ProposedTask[], newEvents: EventInput[]): Promise<Proposal> {
  const fixedBlocks = await listFixedBlocks();
  const currentTasks = await listTasks();
  // Guard against duplicate tasks: if a proposed task's title already matches an
  // existing active task (e.g. the model read an edit request as a fresh add),
  // drop it instead of creating a second identical task.
  const existingTitles = new Set(currentTasks.map((t) => t.title.trim().toLowerCase()));
  const newTasks = newTasksRaw.filter((t) => !existingTitles.has(t.title.trim().toLowerCase()));
  const start = weekStart();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();
  const toMin = (s: string) => Math.round((new Date(s).getTime() - start.getTime()) / 60_000);
  const dayOf = (s: string) => Math.floor((new Date(s).getTime() - start.getTime()) / 86_400_000);

  // Pinned blocks + all existing blocks are obstacles for both new events and recurring placement.
  const { data: pinnedRows } = await supabase.from("scheduled_blocks").select("starts_at, ends_at").eq("pinned", true).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const occupied = (pinnedRows ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }));
  const { data: existingAll } = await supabase.from("scheduled_blocks").select("starts_at, ends_at").neq("status", "skipped");
  const busy = [...occupied, ...(existingAll ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }))];

  // Place prospective one-time events (in memory) so recurring tasks avoid them.
  const eventAdds: string[] = [];
  for (const ev of newEvents) {
    let sMin: number, eMin: number;
    if (ev.startAt) {
      sMin = toMin(new Date(ev.startAt).toISOString());
      eMin = sMin + ev.durationMin;
    } else {
      const dayStart = ev.day ? new Date(`${ev.day}T00:00`).getTime() : Date.now();
      const afterMin = Math.max(0, Math.round((Math.max(Date.now(), dayStart) - start.getTime()) / 60_000));
      const slot = findNextSlot({ task: { id: "ev", title: ev.title, durationMin: ev.durationMin, quota: 1, period: "day" }, fixedBlocks, busy, horizonDays: 7, afterMin, defaultWindow: wakingWindow(fixedBlocks) });
      if (!slot) continue;
      sMin = slot.start;
      eMin = slot.end;
    }
    occupied.push({ start: sMin, end: eMin });
    busy.push({ start: sMin, end: eMin });
    eventAdds.push(ev.title);
  }

  const allTasks = [...currentTasks, ...newTasks.map(toEngineTask)];
  const { blocks } = schedule({ horizonDays: 7, fixedBlocks, tasks: allTasks, defaultWindow: wakingWindow(fixedBlocks), occupied });

  const { data: kept } = await supabase.from("scheduled_blocks").select("task_id, starts_at").or("status.neq.planned,pinned.eq.true").gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const resolved = new Set((kept ?? []).map((r: any) => `${r.task_id}|${dayOf(r.starts_at)}`));
  const fresh = blocks.filter((b) => !resolved.has(`${b.taskId}|${Math.floor(b.start / 1440)}`));

  // Diff proposed recurring blocks vs current non-pinned planned blocks.
  const { data: curPlanned } = await supabase.from("scheduled_blocks").select("task_id, title, starts_at").eq("status", "planned").eq("pinned", false).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const group = (rows: { task_id: string | null; title: string; startMin: number }[]) => {
    const m = new Map<string, { title: string; startMin: number }[]>();
    for (const r of rows) {
      const k = `${r.task_id}|${Math.floor(r.startMin / 1440)}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push({ title: r.title, startMin: r.startMin });
    }
    for (const a of m.values()) a.sort((x, y) => x.startMin - y.startMin);
    return m;
  };
  const curMap = group((curPlanned ?? []).map((r: any) => ({ task_id: r.task_id, title: r.title, startMin: toMin(r.starts_at) })));
  const propMap = group(fresh.map((b) => ({ task_id: b.taskId, title: b.title, startMin: b.start })));

  const moves: Proposal["moves"] = [];
  const adds: string[] = [...eventAdds];
  const removes: string[] = [];
  for (const k of new Set([...curMap.keys(), ...propMap.keys()])) {
    const cur = curMap.get(k) ?? [];
    const prop = propMap.get(k) ?? [];
    for (let i = 0; i < Math.max(cur.length, prop.length); i++) {
      const c = cur[i];
      const p = prop[i];
      if (c && p) {
        if (c.startMin !== p.startMin) moves.push({ title: p.title, from: shortLabel(iso(c.startMin)), to: shortLabel(iso(p.startMin)) });
      } else if (p && !c) adds.push(p.title);
      else if (c && !p) removes.push(c.title);
    }
  }

  const apply = async () => {
    for (const t of newTasks) await saveProposedTask(t);
    if (newEvents.length) await createEvents(newEvents);
    return rescheduleAndSave();
  };

  return { moves, adds: [...new Set(adds)], removes: [...new Set(removes)], apply };
}

export interface EditInput {
  taskId: string;
  scope: "day" | "week";
  day: string | null; // ISO date, for scope=day
  timeMin: number | null; // new time-of-day in minutes
  durationMin: number | null;
  period: "day" | "week" | null; // new recurrence bucket if cadence changes
  quota: number | null;
  summary: string;
}

/**
 * Propose edits to existing recurring tasks (fixed time, duration, frequency) —
 * whole-week (scope "week") or a single occurrence (scope "day"). Same
 * compute-in-memory + diff + confirm flow as proposeAdd.
 */
export async function proposeEdit(edits: EditInput[]): Promise<Proposal> {
  const fixedBlocks = await listFixedBlocks();
  const currentTasks = await listTasks();
  const start = weekStart();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();
  const toMin = (s: string) => Math.round((new Date(s).getTime() - start.getTime()) / 60_000);
  const dayOf = (s: string) => Math.floor((new Date(s).getTime() - start.getTime()) / 86_400_000);
  const byId = new Map(currentTasks.map((t) => [t.id, t]));

  // Apply week-scope edits to an in-memory copy of the tasks.
  const editedTasks = currentTasks.map((t) => {
    const e = edits.find((x) => x.taskId === t.id && x.scope === "week");
    if (!e) return t;
    return {
      ...t,
      durationMin: e.durationMin ?? t.durationMin,
      quota: e.quota ?? t.quota,
      period: e.period ?? t.period,
      fixedTimeMin: e.timeMin ?? t.fixedTimeMin,
    };
  });

  // Day-scope edits become one-off pinned occurrences.
  const dayEdits = edits.filter((e) => e.scope === "day" && e.day && e.timeMin != null);
  const pins = dayEdits.map((e) => {
    const { dayIndex, date } = weekdayInThisWeek(`${e.day}T00:00`);
    const task = byId.get(e.taskId);
    const dur = e.durationMin ?? task?.durationMin ?? 30;
    return { taskId: e.taskId, title: task?.title ?? "Task", dayIndex, date, startMin: e.timeMin!, durationMin: dur };
  });

  const { data: pinnedRows } = await supabase.from("scheduled_blocks").select("starts_at, ends_at").eq("pinned", true).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const occupied = (pinnedRows ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }));
  for (const p of pins) occupied.push({ start: p.dayIndex * 1440 + p.startMin, end: p.dayIndex * 1440 + p.startMin + p.durationMin });

  // A day-pin on a weekly task consumes one of its weekly occurrences, so drop
  // the flexible quota by the number of pins to avoid over-scheduling.
  const pinCount = new Map<string, number>();
  const reservedDaysByTask: Record<string, number[]> = {};
  for (const p of pins) {
    pinCount.set(p.taskId, (pinCount.get(p.taskId) ?? 0) + 1);
    (reservedDaysByTask[p.taskId] ??= []).push(p.dayIndex);
  }
  const planTasks = editedTasks.map((t) => {
    const pc = pinCount.get(t.id) ?? 0;
    return pc && t.period === "week" ? { ...t, quota: Math.max(0, t.quota - pc) } : t;
  });

  const { blocks } = schedule({ horizonDays: 7, fixedBlocks, tasks: planTasks, defaultWindow: wakingWindow(fixedBlocks), occupied, reservedDaysByTask });

  const { data: kept } = await supabase.from("scheduled_blocks").select("task_id, starts_at").or("status.neq.planned,pinned.eq.true").gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const resolved = new Set((kept ?? []).map((r: any) => `${r.task_id}|${dayOf(r.starts_at)}`));
  for (const p of pins) resolved.add(`${p.taskId}|${p.dayIndex}`);

  const proposed = blocks.filter((b) => !resolved.has(`${b.taskId}|${Math.floor(b.start / 1440)}`)).map((b) => ({ task_id: b.taskId as string | null, title: b.title, startMin: b.start }));
  for (const p of pins) proposed.push({ task_id: p.taskId, title: p.title, startMin: p.dayIndex * 1440 + p.startMin });

  const { data: curPlanned } = await supabase.from("scheduled_blocks").select("task_id, title, starts_at").eq("status", "planned").eq("pinned", false).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const group = (rows: { task_id: string | null; title: string; startMin: number }[]) => {
    const m = new Map<string, { title: string; startMin: number }[]>();
    for (const r of rows) {
      const k = `${r.task_id}|${Math.floor(r.startMin / 1440)}`;
      (m.get(k) ?? m.set(k, []).get(k)!).push({ title: r.title, startMin: r.startMin });
    }
    for (const a of m.values()) a.sort((x, y) => x.startMin - y.startMin);
    return m;
  };
  const curMap = group((curPlanned ?? []).map((r: any) => ({ task_id: r.task_id, title: r.title, startMin: toMin(r.starts_at) })));
  const propMap = group(proposed);
  const moves: Proposal["moves"] = [];
  const adds: string[] = [];
  const removes: string[] = [];
  for (const k of new Set([...curMap.keys(), ...propMap.keys()])) {
    const cur = curMap.get(k) ?? [];
    const prop = propMap.get(k) ?? [];
    for (let i = 0; i < Math.max(cur.length, prop.length); i++) {
      const c = cur[i];
      const p = prop[i];
      if (c && p) {
        if (c.startMin !== p.startMin) moves.push({ title: p.title, from: shortLabel(iso(c.startMin)), to: shortLabel(iso(p.startMin)) });
      } else if (p && !c) adds.push(p.title);
      else if (c && !p) removes.push(c.title);
    }
  }

  const apply = async () => {
    for (const e of edits.filter((x) => x.scope === "week")) {
      const patch: TaskEdit = {};
      if (e.durationMin != null) patch.durationMin = e.durationMin;
      if (e.quota != null) patch.quota = e.quota;
      if (e.period != null) patch.period = e.period;
      if (e.timeMin != null) patch.fixedTimeMin = e.timeMin;
      await updateTask(e.taskId, patch);
    }
    for (const e of dayEdits) {
      // Normalize to the same weekday within the current week (see weekdayInThisWeek).
      const dayStart = weekdayInThisWeek(`${e.day}T00:00`).date;
      const dEnd = new Date(dayStart.getTime() + 86_400_000);
      const { data: rows } = await supabase.from("scheduled_blocks").select("id").eq("task_id", e.taskId).gte("starts_at", dayStart.toISOString()).lt("starts_at", dEnd.toISOString()).limit(1);
      const pad = (n: number) => String(n).padStart(2, "0");
      const s0 = new Date(dayStart.getTime() + e.timeMin! * 60_000);
      const at = `${s0.getFullYear()}-${pad(s0.getMonth() + 1)}-${pad(s0.getDate())}T${pad(s0.getHours())}:${pad(s0.getMinutes())}`;
      const dur = e.durationMin ?? byId.get(e.taskId)?.durationMin ?? 30;
      if (rows?.[0]?.id) {
        await updateBlockTime(rows[0].id, at, dur);
      } else {
        // Task isn't scheduled that day yet — add it as a pinned occurrence.
        const uid = await userId();
        const s = new Date(at);
        await supabase.from("scheduled_blocks").insert({ user_id: uid, task_id: e.taskId, title: byId.get(e.taskId)?.title ?? "Task", starts_at: s.toISOString(), ends_at: new Date(s.getTime() + dur * 60_000).toISOString(), status: "planned", pinned: true });
      }
    }
    return rescheduleAndSave();
  };

  return { moves, adds: [...new Set(adds)], removes: [...new Set(removes)], apply };
}

export interface RearrangeInput {
  scope: "day" | "week";
  day: string | null; // ISO date, for scope=day
  orderedTaskIds: string[]; // earliest-first desired order
  summary: string;
}

/**
 * Propose a one-time reorder of existing tasks by their relative sequence
 * ("soccer after job apps but before the gym"), without exact clock times.
 * On each affected day, the involved tasks are re-slotted into their existing
 * time positions but in the requested order (pinned so the re-plan keeps them),
 * pushing any overlap forward. Same diff+confirm flow as the other proposers.
 */
export async function proposeRearrange(r: RearrangeInput): Promise<Proposal> {
  const currentTasks = await listTasks();
  const byId = new Map(currentTasks.map((t) => [t.id, t]));
  const start = weekStart();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();
  const toMin = (s: string) => Math.round((new Date(s).getTime() - start.getTime()) / 60_000);
  const dayOf = (s: string) => Math.floor((new Date(s).getTime() - start.getTime()) / 86_400_000);

  const { data: rows } = await supabase
    .from("scheduled_blocks")
    .select("id, task_id, title, starts_at")
    .in("task_id", r.orderedTaskIds)
    .eq("status", "planned")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());

  const targetDays =
    r.scope === "day" && r.day ? [weekdayInThisWeek(`${r.day}T00:00`).dayIndex] : Array.from({ length: 7 }, (_, i) => i);

  // Never reschedule a block to a time already in the past: on TODAY, the
  // earliest a task may be placed is the current time. (Rearranging only moves
  // things forward from now, so a missed 9am block can't be re-slotted before
  // "now" just because another task frees up an early slot.)
  const nowAbs = Math.round((Date.now() - start.getTime()) / 60_000);
  const todayIndex = Math.floor((new Date().setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000);

  // For each affected day, place the present ordered tasks into the day's own
  // set of start positions, sorted ascending, but reassigned in requested order.
  const retimes: { id: string; title: string; startMin: number; durationMin: number }[] = [];
  for (const d of targetDays) {
    const dayRows = (rows ?? []).filter((b: any) => dayOf(b.starts_at) === d);
    // Present tasks in the user's requested order (skip ones with no block today).
    const present = r.orderedTaskIds
      .map((id) => dayRows.find((b: any) => b.task_id === id))
      .filter(Boolean) as any[];
    if (present.length < 2) continue; // nothing to reorder on this day
    const floor = d === todayIndex ? nowAbs : -Infinity; // no backward-into-the-past on today
    const slots = present.map((b) => toMin(b.starts_at)).sort((a, b) => a - b);
    let cursor = Math.max(slots[0], floor);
    present.forEach((b, i) => {
      const dur = byId.get(b.task_id)?.durationMin ?? 30;
      const s = Math.max(slots[i] ?? cursor, cursor);
      retimes.push({ id: b.id, title: b.title, startMin: s, durationMin: dur });
      cursor = s + dur;
    });
  }

  // Diff vs current times to show what moves.
  const curStart = new Map((rows ?? []).map((b: any) => [b.id, toMin(b.starts_at)]));
  const moves: Proposal["moves"] = [];
  for (const rt of retimes) {
    const cur = curStart.get(rt.id);
    if (cur != null && cur !== rt.startMin) {
      moves.push({ title: rt.title, from: shortLabel(iso(cur)), to: shortLabel(iso(rt.startMin)) });
    }
  }

  const apply = async () => {
    for (const rt of retimes) {
      await updateBlockTime(rt.id, iso(rt.startMin), rt.durationMin);
    }
    return rescheduleAndSave();
  };

  return { moves, adds: [], removes: [], apply };
}

/** Manually move a block to a new start time; pins it so re-plan won't move it. */
export async function updateBlockTime(blockId: string, startAt: string, durationMin: number): Promise<void> {
  const s = new Date(startAt);
  const e = new Date(s.getTime() + durationMin * 60_000);
  const { error } = await supabase
    .from("scheduled_blocks")
    .update({ starts_at: s.toISOString(), ends_at: e.toISOString(), pinned: true, status: "planned" })
    .eq("id", blockId);
  if (error) throw error;
}

export interface OverlapHit {
  id: string;
  title: string;
  taskId: string | null;
  pinned: boolean;
  startsAt: string;
  endsAt: string;
}

/**
 * Find planned blocks whose time overlaps [startAt, startAt+durationMin),
 * excluding the block being edited. Used to warn before a manual time change
 * double-books another task.
 */
export async function overlappingBlocks(startAt: string, durationMin: number, excludeBlockId: string): Promise<OverlapHit[]> {
  const s = new Date(startAt);
  const e = new Date(s.getTime() + durationMin * 60_000);
  // Same-day window keeps the query small; overlap is then checked precisely.
  const dayStart = new Date(s.getFullYear(), s.getMonth(), s.getDate());
  const dayEnd = new Date(dayStart.getTime() + 86_400_000);
  const { data, error } = await supabase
    .from("scheduled_blocks")
    .select("id, title, task_id, pinned, starts_at, ends_at")
    .eq("status", "planned")
    .gte("starts_at", dayStart.toISOString())
    .lt("starts_at", dayEnd.toISOString());
  if (error) throw error;
  return (data ?? [])
    .filter((r: any) => r.id !== excludeBlockId && new Date(r.starts_at) < e && new Date(r.ends_at) > s)
    .map((r: any) => ({ id: r.id, title: r.title, taskId: r.task_id, pinned: r.pinned, startsAt: r.starts_at, endsAt: r.ends_at }));
}

/** Pin/unpin a block without moving it. */
export async function setBlockPinned(blockId: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").update({ pinned }).eq("id", blockId);
  if (error) throw error;
}

/**
 * Move `blockId` to `startAt` (pinned) and deliberately KEEP it overlapping the
 * conflicting blocks: pin those too so the re-plan leaves both in place (the
 * calendar renders them side by side). Other tasks schedule around them.
 */
export async function keepOverlapped(blockId: string, startAt: string, durationMin: number, others: OverlapHit[]): Promise<{ placed: number; conflicts: string[] }> {
  await updateBlockTime(blockId, startAt, durationMin);
  for (const o of others) await setBlockPinned(o.id, true);
  return rescheduleAndSave();
}

/**
 * Move `blockId` to `startAt` (pinned) and move the conflicting blocks OUT of
 * the way: task-linked ones are un-pinned so the re-plan relocates them around
 * the new pin; taskless one-offs are slid to the next free slot (kept pinned).
 */
export async function moveToAccommodate(blockId: string, startAt: string, durationMin: number, others: OverlapHit[]): Promise<{ placed: number; conflicts: string[] }> {
  const newEnd = new Date(new Date(startAt).getTime() + durationMin * 60_000);
  await updateBlockTime(blockId, startAt, durationMin);
  for (const o of others) {
    if (o.taskId) {
      await setBlockPinned(o.id, false); // re-plan will place it around the new pin
    } else {
      // One-time event (no task to re-plan): slide it to just after the new
      // block, kept pinned, so it isn't lost or purged.
      const dur = Math.round((new Date(o.endsAt).getTime() - new Date(o.startsAt).getTime()) / 60_000);
      await updateBlockTime(o.id, newEnd.toISOString(), dur);
    }
  }
  return rescheduleAndSave();
}

/** Rename a standalone (taskless) one-time block. */
export async function updateBlockTitle(blockId: string, title: string): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").update({ title }).eq("id", blockId);
  if (error) throw error;
}

export async function deleteBlock(blockId: string): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").delete().eq("id", blockId);
  if (error) throw error;
}

// ---------------------------------------------------------------------------
// Interactive editing: task fields, per-occurrence status/notes, rescheduling.
// ---------------------------------------------------------------------------

export async function getTask(id: string): Promise<TaskRow | null> {
  const { data, error } = await supabase.from("tasks").select("*").eq("id", id).maybeSingle();
  if (error) throw error;
  if (!data) return null;
  const r: any = data;
  const t: TaskRow = {
    id: r.id,
    title: r.title,
    durationMin: r.duration_min,
    quota: r.quota,
    period: r.period,
    bufferMin: r.buffer_min ?? 0,
    spread: r.spread ?? false,
    nonConsecutiveDays: r.non_consecutive_days ?? false,
    priority: r.priority ?? 0,
    description: r.description ?? null,
  };
  if (r.window_start_min != null && r.window_end_min != null) {
    t.window = { startMin: r.window_start_min, endMin: r.window_end_min };
  }
  if (r.fixed_time_min != null) t.fixedTimeMin = r.fixed_time_min;
  return t;
}

export interface TaskEdit {
  title?: string;
  durationMin?: number;
  quota?: number;
  period?: "day" | "week";
  description?: string | null;
  fixedTimeMin?: number | null;
}

/** Update editable task fields. Caller decides whether to re-plan afterwards. */
export async function updateTask(id: string, edit: TaskEdit): Promise<void> {
  const patch: Record<string, unknown> = {};
  if (edit.title !== undefined) patch.title = edit.title;
  if (edit.durationMin !== undefined) patch.duration_min = edit.durationMin;
  if (edit.quota !== undefined) patch.quota = edit.quota;
  if (edit.period !== undefined) patch.period = edit.period;
  if (edit.description !== undefined) patch.description = edit.description;
  if (edit.fixedTimeMin !== undefined) patch.fixed_time_min = edit.fixedTimeMin;
  const { error } = await supabase.from("tasks").update(patch).eq("id", id);
  if (error) throw error;
}

export async function deleteTask(id: string): Promise<void> {
  // Remove the task and ALL of its blocks (planned + completed). Deleting
  // blocks explicitly first guarantees nothing is left untethered on the
  // calendar (the FK is also ON DELETE CASCADE as a backstop).
  const { error: bErr } = await supabase.from("scheduled_blocks").delete().eq("task_id", id);
  if (bErr) throw bErr;
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

/** Look up task titles for a set of ids (for confirmation UIs). */
export async function taskTitles(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("tasks").select("title").in("id", ids);
  return (data ?? []).map((r: any) => r.title);
}

export async function deleteTasks(ids: string[]): Promise<void> {
  for (const id of ids) await deleteTask(id);
}

export async function setBlockStatus(blockId: string, status: "planned" | "done" | "skipped"): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").update({ status }).eq("id", blockId);
  if (error) throw error;
}

/** Mark a block done and record how long it actually took (feeds habit-learning). */
export async function markDoneWithActual(blockId: string, actualMin: number): Promise<void> {
  const { error } = await supabase
    .from("scheduled_blocks")
    .update({ status: "done", actual_min: Math.max(1, Math.round(actualMin)) })
    .eq("id", blockId);
  if (error) throw error;
}

export interface Insight {
  taskId: string;
  title: string;
  planned: number;
  avgActual: number;
  samples: number;
  suggested: number;
}

/**
 * Habit-learning: for tasks completed with logged actual times, compare the
 * average actual duration against the planned estimate. When they diverge
 * meaningfully (>20%, >=2 samples), suggest a new estimate rounded to 5 min.
 */
export async function durationInsights(): Promise<Insight[]> {
  const [{ data: doneRows }, tasks] = await Promise.all([
    supabase
      .from("scheduled_blocks")
      .select("task_id, actual_min")
      .eq("status", "done")
      .not("actual_min", "is", null)
      .not("task_id", "is", null),
    listTasks(),
  ]);

  const byTask = new Map<string, number[]>();
  for (const r of (doneRows ?? []) as any[]) {
    const arr = byTask.get(r.task_id) ?? [];
    arr.push(r.actual_min);
    byTask.set(r.task_id, arr);
  }

  const insights: Insight[] = [];
  for (const t of tasks) {
    const samples = byTask.get(t.id);
    if (!samples || samples.length < 2) continue;
    const avg = samples.reduce((a, b) => a + b, 0) / samples.length;
    if (Math.abs(avg - t.durationMin) / t.durationMin < 0.2) continue;
    const suggested = Math.max(5, Math.round(avg / 5) * 5);
    if (suggested === t.durationMin) continue;
    insights.push({ taskId: t.id, title: t.title, planned: t.durationMin, avgActual: Math.round(avg), samples: samples.length, suggested });
  }
  return insights;
}

/** Accept an insight: update the task's estimate and re-plan. */
export async function applyInsight(taskId: string, durationMin: number): Promise<void> {
  await updateTask(taskId, { durationMin });
  await rescheduleAndSave();
}

export async function setBlockNote(blockId: string, note: string): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").update({ note }).eq("id", blockId);
  if (error) throw error;
}

async function moveBlock(blockId: string, startsAt: string, endsAt: string): Promise<void> {
  const { error } = await supabase
    .from("scheduled_blocks")
    .update({ starts_at: startsAt, ends_at: endsAt, status: "planned" })
    .eq("id", blockId);
  if (error) throw error;
}

export interface Suggestion {
  startsAt: string;
  endsAt: string;
  label: string;
}

/**
 * Suggest a new time for a (missed) block: the earliest free slot after now
 * that fits its task, given everything else on the calendar. Deterministic.
 */
export async function suggestReschedule(block: PlannedBlock): Promise<Suggestion | null> {
  if (!block.task_id) return null;
  const [task, fixedBlocks] = await Promise.all([getTask(block.task_id), listFixedBlocks()]);
  if (!task) return null;

  const start = weekStart();
  const toMin = (iso: string) => Math.round((new Date(iso).getTime() - start.getTime()) / 60_000);

  const { data: rows } = await supabase
    .from("scheduled_blocks")
    .select("id, starts_at, ends_at")
    .neq("id", block.id)
    .neq("status", "skipped");
  const busy = (rows ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }));

  const afterMin = Math.max(0, Math.round((Date.now() - start.getTime()) / 60_000));
  const slot = findNextSlot({
    task,
    fixedBlocks,
    busy,
    horizonDays: 7,
    afterMin,
    defaultWindow: wakingWindow(fixedBlocks),
  });
  if (!slot) return null;

  const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();
  const startsAt = iso(slot.start);
  const label = new Date(startsAt).toLocaleString([], {
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
  });
  return { startsAt, endsAt: iso(slot.end), label };
}

/** Accept a suggestion: move the block to the suggested time. */
export async function applyReschedule(blockId: string, s: Suggestion): Promise<void> {
  await moveBlock(blockId, s.startsAt, s.endsAt);
}
