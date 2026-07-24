import { supabase, weekStart, type PlannedBlock } from "./supabase";
import { schedule, wakingWindow, findNextSlot } from "../engine";
import type { FixedBlock, Task, TimeWindow, Weekday } from "../engine";

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

export interface TaskRow extends Task {
  description: string | null;
}

const PARSE_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/parse`;
const AGENT_URL = `${process.env.EXPO_PUBLIC_SUPABASE_URL}/functions/v1/agent`;

export interface ProposedTask {
  id: string;
  title: string;
  durationMin: number;
  quota: number;
  period: "day" | "week";
  window?: TimeWindow;
  fixedTimeMin?: number;
  bufferMin?: number;
  spread?: boolean;
  nonConsecutiveDays?: boolean;
  estimateNote?: string;
}

export interface EventInput {
  title: string;
  durationMin: number;
  startAt: string | null;
  day: string | null;
}

export interface EditInput {
  taskId: string;
  scope: "day" | "week";
  day: string | null;
  timeMin: number | null;
  durationMin: number | null;
  period: "day" | "week" | null;
  quota: number | null;
  summary: string;
}

export interface RearrangeInput {
  scope: "day" | "week";
  day: string | null;
  orderedTaskIds: string[];
  summary: string;
}

export type ParseResult =
  | { kind: "tasks"; tasks: ProposedTask[] }
  | { kind: "clarify"; questions: string[] }
  | { kind: "delete"; taskIds: string[]; summary: string }
  | { kind: "events"; events: EventInput[] }
  | { kind: "edit"; edits: EditInput[] }
  | { kind: "rearrange"; rearrange: RearrangeInput };

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

/** A fixed commitment (work, sleep…) — always a scheduling wall; can be shown on the calendar. */
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

// Serialize re-plans so two overlapping calls can't both delete-then-insert and
// double every block. See the web app for the fuller note.
let rescheduleLock: Promise<unknown> = Promise.resolve();

export function rescheduleAndSave(): Promise<{ placed: number; conflicts: string[] }> {
  const run = rescheduleLock.then(rescheduleAndSaveInner, rescheduleAndSaveInner);
  rescheduleLock = run.then(() => {}, () => {});
  return run;
}

/** Remove duplicate planned blocks sharing the same task (or title) and start time. */
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

  const { data: pinnedRows } = await supabase
    .from("scheduled_blocks")
    .select("task_id, starts_at, ends_at")
    .eq("pinned", true)
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());
  const occupied = (pinnedRows ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }));

  // A pinned occurrence of a recurring task counts toward that task's quota:
  // reduce the flexible quota and mark the pinned day off-limits so remaining
  // occurrences spread onto other days (no over-scheduling).
  const pinnedByTask = new Map<string, number>();
  const reservedDaysByTask: Record<string, number[]> = {};
  for (const r of pinnedRows ?? []) {
    if (!r.task_id) continue;
    pinnedByTask.set(r.task_id, (pinnedByTask.get(r.task_id) ?? 0) + 1);
    (reservedDaysByTask[r.task_id] ??= []).push(dayOf(r.starts_at));
  }
  const planTasks = tasks
    .map((t) => {
      // Only WEEKLY tasks' quotas are consumed by a pin; daily tasks keep their
      // per-day quota (the pinned day is excluded via `resolved`).
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

  const { data: kept } = await supabase
    .from("scheduled_blocks")
    .select("task_id, starts_at")
    .or("status.neq.planned,pinned.eq.true")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());
  const resolved = new Set((kept ?? []).map((r: any) => `${r.task_id}|${dayOf(r.starts_at)}`));

  await supabase
    .from("scheduled_blocks")
    .delete()
    .eq("status", "planned")
    .eq("pinned", false)
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());

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

export async function setBlockStatus(blockId: string, status: "planned" | "done" | "skipped"): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").update({ status }).eq("id", blockId);
  if (error) throw error;
}

export async function markDoneWithActual(blockId: string, actualMin: number): Promise<void> {
  const { error } = await supabase
    .from("scheduled_blocks")
    .update({ status: "done", actual_min: Math.max(1, Math.round(actualMin)) })
    .eq("id", blockId);
  if (error) throw error;
}

export async function taskTitles(ids: string[]): Promise<string[]> {
  if (ids.length === 0) return [];
  const { data } = await supabase.from("tasks").select("title").in("id", ids);
  return (data ?? []).map((r: any) => r.title);
}

export async function deleteTasks(ids: string[]): Promise<void> {
  for (const id of ids) {
    // Remove the task and ALL its blocks — nothing left untethered.
    const { error: bErr } = await supabase.from("scheduled_blocks").delete().eq("task_id", id);
    if (bErr) throw bErr;
    const { error } = await supabase.from("tasks").delete().eq("id", id);
    if (error) throw error;
  }
}

export async function parse(request: string, scope: "day" | "week" = "week"): Promise<ParseResult> {
  const [fixedBlocks, existingTasks] = await Promise.all([listFixedBlocks(), listTasks()]);
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? anon;
  const res = await fetch(PARSE_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, apikey: anon },
    body: JSON.stringify({ request, context: { now: localNow(), scope, fixedBlocks, existingTasks } }),
  });
  if (!res.ok) throw new Error(`parse error (${res.status})`);
  return res.json();
}

// --- Agentic assistant (server-side Claude tool-use loop; client applies the plan) ---

export type AgentOp =
  | { op: "add_task"; task: { title: string; durationMin: number; quota: number; period: "day" | "week"; fixedTimeMin: number | null } }
  | { op: "add_event"; event: EventInput }
  | { op: "edit_task"; edit: { taskId: string; scope: "day" | "week"; day: string | null; timeMin: number | null; durationMin: number | null; period: "day" | "week" | null; quota: number | null } }
  | { op: "rearrange"; rearrange: { scope: "day" | "week"; day: string | null; orderedTaskIds: string[] } }
  | { op: "delete_task"; taskId: string }
  | { op: "move_occurrence"; taskId: string; fromDate: string; toDate: string; timeMin: number | null };

export interface AgentResult {
  operations: AgentOp[];
  summary: string;
}

const fmtTimeOfDay = (m: number) => {
  const h = Math.floor(m / 60), mm = m % 60;
  const ap = h < 12 ? "am" : "pm";
  const h12 = h % 12 === 0 ? 12 : h % 12;
  return `${h12}:${String(mm).padStart(2, "0")}${ap}`;
};

async function currentWeekContext(): Promise<any[]> {
  const start = weekStart();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const { data } = await supabase
    .from("scheduled_blocks")
    .select("id, task_id, title, starts_at, ends_at, status, pinned")
    .eq("status", "planned")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString());
  const p = (n: number) => String(n).padStart(2, "0");
  return (data ?? []).map((b: any) => {
    const s = new Date(b.starts_at), e = new Date(b.ends_at);
    return {
      id: b.id, taskId: b.task_id, title: b.title,
      date: `${s.getFullYear()}-${p(s.getMonth() + 1)}-${p(s.getDate())}`,
      weekday: (s.getDay() + 6) % 7,
      startMin: s.getHours() * 60 + s.getMinutes(),
      endMin: e.getHours() * 60 + e.getMinutes(),
      status: b.status, pinned: b.pinned,
    };
  });
}

export async function runAgent(request: string, scope: "day" | "week" = "week"): Promise<AgentResult> {
  const [fixedBlocks, existingTasks, currentBlocks] = await Promise.all([listFixedBlocks(), listTasks(), currentWeekContext()]);
  const anon = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string;
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token ?? anon;
  const res = await fetch(AGENT_URL, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}`, apikey: anon },
    body: JSON.stringify({ request, context: { now: localNow(), scope, fixedBlocks, existingTasks, currentBlocks } }),
  });
  if (!res.ok) throw new Error(`agent error (${res.status})`);
  const out = await res.json();
  return { operations: out.operations ?? [], summary: out.summary ?? "" };
}

export async function describeOps(ops: AgentOp[]): Promise<string[]> {
  const tasks = await listTasks();
  const nameOf = (id: string) => tasks.find((t) => t.id === id)?.title ?? "a task";
  return ops.map((o) => {
    if (o.op === "add_task") return `Add ${o.task.title} — ${o.task.quota}x/${o.task.period}, ${o.task.durationMin} min${o.task.fixedTimeMin != null ? ` at ${fmtTimeOfDay(o.task.fixedTimeMin)}` : ""}`;
    if (o.op === "add_event") return `Add event: ${o.event.title}`;
    if (o.op === "delete_task") return `Remove ${nameOf(o.taskId)}`;
    if (o.op === "rearrange") return `Reorder: ${o.rearrange.orderedTaskIds.map(nameOf).join(" > ")}`;
    if (o.op === "move_occurrence") return `Move ${nameOf(o.taskId)} to ${o.toDate}${o.timeMin != null ? ` at ${fmtTimeOfDay(o.timeMin)}` : ""}`;
    const e = o.edit;
    const parts: string[] = [];
    if (e.period || e.quota != null) parts.push(`${e.quota ?? "same"}x/${e.period ?? "period"}`);
    if (e.durationMin != null) parts.push(`${e.durationMin} min`);
    if (e.timeMin != null) parts.push(`at ${fmtTimeOfDay(e.timeMin)}`);
    return `Change ${nameOf(e.taskId)}${parts.length ? " — " + parts.join(", ") : ""}`;
  });
}

export async function applyPlan(ops: AgentOp[]): Promise<{ placed: number; conflicts: string[] }> {
  const deletes = ops.flatMap((o) => (o.op === "delete_task" ? [o.taskId] : []));
  const addTasks = ops.flatMap((o) => (o.op === "add_task" ? [o.task] : []));
  const addEvents = ops.flatMap((o) => (o.op === "add_event" ? [o.event] : []));
  const edits = ops.flatMap((o) => (o.op === "edit_task" ? [o.edit] : []));
  const moves = ops.flatMap((o) => (o.op === "move_occurrence" ? [o] : []));
  const rearranges = ops.flatMap((o) => (o.op === "rearrange" ? [o.rearrange] : []));

  let last: { placed: number; conflicts: string[] } = { placed: 0, conflicts: [] };

  if (deletes.length) { await deleteTasks(deletes); last = await rescheduleAndSave(); }
  if (addTasks.length || addEvents.length) {
    const proposed: ProposedTask[] = addTasks.map((t) => ({
      id: `${t.title.trim().toLowerCase().replace(/\s+/g, "-").slice(0, 30)}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      title: t.title, durationMin: t.durationMin, quota: t.quota, period: t.period,
      ...(t.fixedTimeMin != null ? { fixedTimeMin: t.fixedTimeMin } : {}),
    }));
    last = await (await proposeAdd(proposed, addEvents)).apply();
  }
  if (edits.length) {
    const editInputs: EditInput[] = edits.map((e) => ({ taskId: e.taskId, scope: e.scope, day: e.day, timeMin: e.timeMin, durationMin: e.durationMin, period: e.period, quota: e.quota, summary: "" }));
    last = await (await proposeEdit(editInputs)).apply();
  }
  if (moves.length) {
    for (const m of moves) await moveOccurrence(m.taskId, m.fromDate, m.toDate, m.timeMin);
    last = await rescheduleAndSave();
  }
  for (const r of rearranges) {
    last = await (await proposeRearrange({ ...r, summary: "" })).apply();
  }
  return last;
}

/** Move one occurrence of a task from fromDate to toDate (source skipped, target pinned). */
export async function moveOccurrence(taskId: string, fromDate: string, toDate: string, timeMin: number | null): Promise<void> {
  const uid = await userId();
  const task = await getTask(taskId);
  const from = weekdayInThisWeek(`${fromDate}T00:00`).date;
  const fromEnd = new Date(from.getTime() + 86_400_000);
  const { data: rows } = await supabase
    .from("scheduled_blocks")
    .select("id, starts_at, ends_at")
    .eq("task_id", taskId)
    .eq("status", "planned")
    .gte("starts_at", from.toISOString())
    .lt("starts_at", fromEnd.toISOString())
    .limit(1);
  const src = rows?.[0] as any;
  const dur = task?.durationMin ?? (src ? Math.round((new Date(src.ends_at).getTime() - new Date(src.starts_at).getTime()) / 60_000) : 30);
  const srcTime = src ? new Date(src.starts_at).getHours() * 60 + new Date(src.starts_at).getMinutes() : 9 * 60;
  const t = timeMin != null ? timeMin : srcTime;
  const target = weekdayInThisWeek(`${toDate}T00:00`).date;
  const s = new Date(target.getTime() + t * 60_000);
  if (src) await setBlockStatus(src.id, "skipped");
  await supabase.from("scheduled_blocks").insert({
    user_id: uid, task_id: taskId, title: task?.title ?? "Task",
    starts_at: s.toISOString(), ends_at: new Date(s.getTime() + dur * 60_000).toISOString(),
    status: "planned", pinned: true,
  });
}

/** Auto-apply only pure adds that fit; anything else confirms. Surfaces any moves an add causes. */
export async function previewPlan(ops: AgentOp[]): Promise<{ autoApply: boolean; moves: { title: string; from: string; to: string }[]; removes: string[] }> {
  const onlyAdds = ops.length > 0 && ops.every((o) => o.op === "add_task" || o.op === "add_event");
  if (!onlyAdds) return { autoApply: false, moves: [], removes: [] };
  const addTasks = ops.flatMap((o) => (o.op === "add_task" ? [o.task] : []));
  const addEvents = ops.flatMap((o) => (o.op === "add_event" ? [o.event] : []));
  const proposed: ProposedTask[] = addTasks.map((t) => ({
    id: `preview-${Math.random().toString(36).slice(2, 8)}`,
    title: t.title, durationMin: t.durationMin, quota: t.quota, period: t.period,
    ...(t.fixedTimeMin != null ? { fixedTimeMin: t.fixedTimeMin } : {}),
  }));
  const p = await proposeAdd(proposed, addEvents);
  return { autoApply: p.moves.length === 0 && p.removes.length === 0, moves: p.moves, removes: p.removes };
}

/**
 * Map any date reference to the same weekday within the current planning week
 * (day 0 = this week's Monday). The LLM resolves relative day names to their
 * next occurrence, which can land in next week (outside the 7-day horizon); this
 * keeps every day edit on the week the user is looking at.
 */
function weekdayInThisWeek(isoDate: string): { dayIndex: number; date: Date } {
  const start = weekStart();
  const abs = Math.floor((new Date(isoDate).getTime() - start.getTime()) / 86_400_000);
  const dayIndex = ((abs % 7) + 7) % 7;
  return { dayIndex, date: new Date(start.getTime() + dayIndex * 86_400_000) };
}

function localNow(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  const wd = d.toLocaleDateString([], { weekday: "long" });
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())} (${wd})`;
}

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

export async function updateBlockTime(blockId: string, startAt: string, durationMin: number): Promise<void> {
  const s = new Date(startAt);
  const e = new Date(s.getTime() + durationMin * 60_000);
  const { error } = await supabase
    .from("scheduled_blocks")
    .update({ starts_at: s.toISOString(), ends_at: e.toISOString(), pinned: true, status: "planned" })
    .eq("id", blockId);
  if (error) throw error;
}

export async function updateBlockTitle(blockId: string, title: string): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").update({ title }).eq("id", blockId);
  if (error) throw error;
}

export async function deleteBlock(blockId: string): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").delete().eq("id", blockId);
  if (error) throw error;
}

// --- Detail / edit / reschedule / habit-learning (mobile parity) ---

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
  const { error: bErr } = await supabase.from("scheduled_blocks").delete().eq("task_id", id);
  if (bErr) throw bErr;
  const { error } = await supabase.from("tasks").delete().eq("id", id);
  if (error) throw error;
}

export async function setBlockNote(blockId: string, note: string): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").update({ note }).eq("id", blockId);
  if (error) throw error;
}

export interface Suggestion {
  startsAt: string;
  endsAt: string;
  label: string;
}

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
  const label = new Date(startsAt).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });
  return { startsAt, endsAt: iso(slot.end), label };
}

export async function applyReschedule(blockId: string, s: Suggestion): Promise<void> {
  const { error } = await supabase
    .from("scheduled_blocks")
    .update({ starts_at: s.startsAt, ends_at: s.endsAt, status: "planned" })
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

export async function applyInsight(taskId: string, durationMin: number): Promise<void> {
  await updateTask(taskId, { durationMin });
  await rescheduleAndSave();
}

// ---------------------------------------------------------------------------
// Propose → diff → confirm → apply (mobile parity with web). Nothing persists
// until apply() runs, so cancelling a proposal is a no-op.
// ---------------------------------------------------------------------------

export interface Proposal {
  moves: { title: string; from: string; to: string }[];
  adds: string[];
  removes: string[];
  apply: () => Promise<{ placed: number; conflicts: string[] }>;
}

const shortLabel = (iso: string) => new Date(iso).toLocaleString([], { weekday: "short", hour: "numeric", minute: "2-digit" });

/** ProposedTask → engine Task (drop the estimate note). */
function toEngineTask(p: ProposedTask): Task {
  const { estimateNote, ...task } = p;
  void estimateNote;
  return task;
}

type GroupRow = { task_id: string | null; title: string; startMin: number };
function groupByTaskDay(rows: GroupRow[]): Map<string, { title: string; startMin: number }[]> {
  const m = new Map<string, { title: string; startMin: number }[]>();
  for (const r of rows) {
    const k = `${r.task_id}|${Math.floor(r.startMin / 1440)}`;
    (m.get(k) ?? m.set(k, []).get(k)!).push({ title: r.title, startMin: r.startMin });
  }
  for (const a of m.values()) a.sort((x, y) => x.startMin - y.startMin);
  return m;
}

/** Diff current vs proposed (grouped by task+day) into move/add/remove lists. */
function diffPlan(
  curMap: Map<string, { title: string; startMin: number }[]>,
  propMap: Map<string, { title: string; startMin: number }[]>,
  iso: (min: number) => string,
): { moves: Proposal["moves"]; adds: string[]; removes: string[] } {
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
  return { moves, adds, removes };
}

export async function proposeAdd(newTasksRaw: ProposedTask[], newEvents: EventInput[]): Promise<Proposal> {
  const fixedBlocks = await listFixedBlocks();
  const currentTasks = await listTasks();
  // Drop proposed tasks whose title already matches an existing active task, so
  // a misread edit-as-add can't create a second identical task.
  const existingTitles = new Set(currentTasks.map((t) => t.title.trim().toLowerCase()));
  const newTasks = newTasksRaw.filter((t) => !existingTitles.has(t.title.trim().toLowerCase()));
  const start = weekStart();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();
  const toMin = (s: string) => Math.round((new Date(s).getTime() - start.getTime()) / 60_000);
  const dayOf = (s: string) => Math.floor((new Date(s).getTime() - start.getTime()) / 86_400_000);

  const { data: pinnedRows } = await supabase.from("scheduled_blocks").select("starts_at, ends_at").eq("pinned", true).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const occupied = (pinnedRows ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }));
  const { data: existingAll } = await supabase.from("scheduled_blocks").select("starts_at, ends_at").neq("status", "skipped");
  const busy = [...occupied, ...(existingAll ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }))];

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

  const { data: curPlanned } = await supabase.from("scheduled_blocks").select("task_id, title, starts_at").eq("status", "planned").eq("pinned", false).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const curMap = groupByTaskDay((curPlanned ?? []).map((r: any) => ({ task_id: r.task_id, title: r.title, startMin: toMin(r.starts_at) })));
  const propMap = groupByTaskDay(fresh.map((b) => ({ task_id: b.taskId, title: b.title, startMin: b.start })));
  const { moves, adds, removes } = diffPlan(curMap, propMap, iso);

  const apply = async () => {
    for (const t of newTasks) await saveProposedTask(t);
    if (newEvents.length) await createEvents(newEvents);
    return rescheduleAndSave();
  };

  return { moves, adds: [...new Set([...eventAdds, ...adds])], removes: [...new Set(removes)], apply };
}

export async function proposeEdit(edits: EditInput[]): Promise<Proposal> {
  const fixedBlocks = await listFixedBlocks();
  const currentTasks = await listTasks();
  const start = weekStart();
  const end = new Date(start.getTime() + 7 * 86_400_000);
  const iso = (min: number) => new Date(start.getTime() + min * 60_000).toISOString();
  const toMin = (s: string) => Math.round((new Date(s).getTime() - start.getTime()) / 60_000);
  const dayOf = (s: string) => Math.floor((new Date(s).getTime() - start.getTime()) / 86_400_000);
  const byId = new Map(currentTasks.map((t) => [t.id, t]));

  const editedTasks = currentTasks.map((t) => {
    const e = edits.find((x) => x.taskId === t.id && x.scope === "week");
    if (!e) return t;
    return { ...t, durationMin: e.durationMin ?? t.durationMin, quota: e.quota ?? t.quota, period: e.period ?? t.period, fixedTimeMin: e.timeMin ?? t.fixedTimeMin };
  });

  const dayEdits = edits.filter((e) => e.scope === "day" && e.day && e.timeMin != null);
  const pins = dayEdits.map((e) => {
    const { dayIndex } = weekdayInThisWeek(`${e.day}T00:00`);
    const task = byId.get(e.taskId);
    const dur = e.durationMin ?? task?.durationMin ?? 30;
    return { taskId: e.taskId, title: task?.title ?? "Task", dayIndex, startMin: e.timeMin!, durationMin: dur };
  });

  const { data: pinnedRows } = await supabase.from("scheduled_blocks").select("starts_at, ends_at").eq("pinned", true).gte("starts_at", start.toISOString()).lt("starts_at", end.toISOString());
  const occupied = (pinnedRows ?? []).map((r: any) => ({ start: toMin(r.starts_at), end: toMin(r.ends_at) }));
  for (const p of pins) occupied.push({ start: p.dayIndex * 1440 + p.startMin, end: p.dayIndex * 1440 + p.startMin + p.durationMin });

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
  const curMap = groupByTaskDay((curPlanned ?? []).map((r: any) => ({ task_id: r.task_id, title: r.title, startMin: toMin(r.starts_at) })));
  const propMap = groupByTaskDay(proposed);
  const { moves, adds, removes } = diffPlan(curMap, propMap, iso);

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
        const uid = await userId();
        const s = new Date(at);
        await supabase.from("scheduled_blocks").insert({ user_id: uid, task_id: e.taskId, title: byId.get(e.taskId)?.title ?? "Task", starts_at: s.toISOString(), ends_at: new Date(s.getTime() + dur * 60_000).toISOString(), status: "planned", pinned: true });
      }
    }
    return rescheduleAndSave();
  };

  return { moves, adds: [...new Set(adds)], removes: [...new Set(removes)], apply };
}

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

  const targetDays = r.scope === "day" && r.day ? [weekdayInThisWeek(`${r.day}T00:00`).dayIndex] : Array.from({ length: 7 }, (_, i) => i);

  // Never reschedule a block to a time already in the past: on TODAY the earliest
  // a task may land is the current time (rearranging only moves things forward).
  const nowAbs = Math.round((Date.now() - start.getTime()) / 60_000);
  const todayIndex = Math.floor((new Date().setHours(0, 0, 0, 0) - start.getTime()) / 86_400_000);

  const retimes: { id: string; title: string; startMin: number; durationMin: number }[] = [];
  for (const d of targetDays) {
    const dayRows = (rows ?? []).filter((b: any) => dayOf(b.starts_at) === d);
    const present = r.orderedTaskIds.map((id) => dayRows.find((b: any) => b.task_id === id)).filter(Boolean) as any[];
    if (present.length < 2) continue;
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

  const curStart = new Map((rows ?? []).map((b: any) => [b.id, toMin(b.starts_at)]));
  const moves: Proposal["moves"] = [];
  for (const rt of retimes) {
    const cur = curStart.get(rt.id);
    if (cur != null && cur !== rt.startMin) moves.push({ title: rt.title, from: shortLabel(iso(cur)), to: shortLabel(iso(rt.startMin)) });
  }

  const apply = async () => {
    for (const rt of retimes) await updateBlockTime(rt.id, iso(rt.startMin), rt.durationMin);
    return rescheduleAndSave();
  };

  return { moves, adds: [], removes: [], apply };
}

// ---------------------------------------------------------------------------
// Overlap handling on manual time edits.
// ---------------------------------------------------------------------------

export interface OverlapHit {
  id: string;
  title: string;
  taskId: string | null;
  pinned: boolean;
  startsAt: string;
  endsAt: string;
}

export async function overlappingBlocks(startAt: string, durationMin: number, excludeBlockId: string): Promise<OverlapHit[]> {
  const s = new Date(startAt);
  const e = new Date(s.getTime() + durationMin * 60_000);
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

export async function setBlockPinned(blockId: string, pinned: boolean): Promise<void> {
  const { error } = await supabase.from("scheduled_blocks").update({ pinned }).eq("id", blockId);
  if (error) throw error;
}

export async function keepOverlapped(blockId: string, startAt: string, durationMin: number, others: OverlapHit[]): Promise<{ placed: number; conflicts: string[] }> {
  await updateBlockTime(blockId, startAt, durationMin);
  for (const o of others) await setBlockPinned(o.id, true);
  return rescheduleAndSave();
}

export async function moveToAccommodate(blockId: string, startAt: string, durationMin: number, others: OverlapHit[]): Promise<{ placed: number; conflicts: string[] }> {
  const newEnd = new Date(new Date(startAt).getTime() + durationMin * 60_000);
  await updateBlockTime(blockId, startAt, durationMin);
  for (const o of others) {
    if (o.taskId) {
      await setBlockPinned(o.id, false);
    } else {
      const dur = Math.round((new Date(o.endsAt).getTime() - new Date(o.startsAt).getTime()) / 60_000);
      await updateBlockTime(o.id, newEnd.toISOString(), dur);
    }
  }
  return rescheduleAndSave();
}
