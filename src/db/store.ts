import type { SupabaseClient } from "@supabase/supabase-js";
import type { FixedBlock, ScheduledBlock, Task, Weekday } from "../types";

/**
 * Data-access layer. Every function takes an ALREADY-AUTHENTICATED Supabase
 * client and relies on Row Level Security to scope rows to the signed-in user,
 * so nothing here needs to know how the user logged in. Row shapes map 1:1 to
 * the engine's types.
 */

async function currentUserId(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.auth.getUser();
  if (error || !data.user) throw new Error("Not authenticated");
  return data.user.id;
}

// ---- fixed_blocks ---------------------------------------------------------

function rowToFixed(r: any): FixedBlock {
  return { id: r.id, title: r.title, days: (r.days ?? []) as Weekday[], startMin: r.start_min, endMin: r.end_min };
}

export async function listFixedBlocks(sb: SupabaseClient): Promise<FixedBlock[]> {
  const { data, error } = await sb.from("fixed_blocks").select("*");
  if (error) throw error;
  return (data ?? []).map(rowToFixed);
}

export async function saveFixedBlock(sb: SupabaseClient, fb: Omit<FixedBlock, "id">): Promise<FixedBlock> {
  const user_id = await currentUserId(sb);
  const { data, error } = await sb
    .from("fixed_blocks")
    .insert({ user_id, title: fb.title, days: fb.days, start_min: fb.startMin, end_min: fb.endMin })
    .select()
    .single();
  if (error) throw error;
  return rowToFixed(data);
}

// ---- tasks ----------------------------------------------------------------

function rowToTask(r: any): Task {
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
  return t;
}

export async function listTasks(sb: SupabaseClient): Promise<Task[]> {
  const { data, error } = await sb.from("tasks").select("*").eq("active", true);
  if (error) throw error;
  return (data ?? []).map(rowToTask);
}

export async function saveTask(sb: SupabaseClient, t: Omit<Task, "id">, estimateNote?: string): Promise<Task> {
  const user_id = await currentUserId(sb);
  const { data, error } = await sb
    .from("tasks")
    .insert({
      user_id,
      title: t.title,
      duration_min: t.durationMin,
      quota: t.quota,
      period: t.period,
      window_start_min: t.window?.startMin ?? null,
      window_end_min: t.window?.endMin ?? null,
      buffer_min: t.bufferMin ?? 0,
      spread: t.spread ?? false,
      non_consecutive_days: t.nonConsecutiveDays ?? false,
      priority: t.priority ?? 0,
      estimate_note: estimateNote ?? null,
    })
    .select()
    .single();
  if (error) throw error;
  return rowToTask(data);
}

// ---- scheduled_blocks -----------------------------------------------------

const iso = (start: Date, min: number) => new Date(start.getTime() + min * 60_000).toISOString();

/**
 * Replace the current plan: clear existing 'planned' blocks and insert the
 * fresh ones the engine produced. Engine block times are minutes-from-horizon;
 * `horizonStart` is the wall-clock time of minute 0.
 */
export async function replacePlan(
  sb: SupabaseClient,
  blocks: ScheduledBlock[],
  horizonStart: Date,
): Promise<number> {
  const user_id = await currentUserId(sb);
  const { error: delErr } = await sb.from("scheduled_blocks").delete().eq("status", "planned");
  if (delErr) throw delErr;
  if (blocks.length === 0) return 0;
  const rows = blocks.map((b) => ({
    user_id,
    task_id: isUuid(b.taskId) ? b.taskId : null, // engine slug ids won't FK-match
    title: b.title,
    starts_at: iso(horizonStart, b.start),
    ends_at: iso(horizonStart, b.end),
    status: "planned" as const,
  }));
  const { error } = await sb.from("scheduled_blocks").insert(rows);
  if (error) throw error;
  return rows.length;
}

export interface PlannedBlock {
  id: string;
  taskId: string | null;
  title: string;
  startsAt: string;
  endsAt: string;
  status: "planned" | "done" | "skipped";
}

export async function listPlan(sb: SupabaseClient): Promise<PlannedBlock[]> {
  const { data, error } = await sb
    .from("scheduled_blocks")
    .select("*")
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []).map((r: any) => ({
    id: r.id,
    taskId: r.task_id,
    title: r.title,
    startsAt: r.starts_at,
    endsAt: r.ends_at,
    status: r.status,
  }));
}

function isUuid(s: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(s);
}

/** The most recent Monday at 00:00 local — a natural horizon start. */
export function thisWeekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  const dow = (d.getDay() + 6) % 7; // 0 = Monday
  d.setDate(d.getDate() - dow);
  return d;
}
