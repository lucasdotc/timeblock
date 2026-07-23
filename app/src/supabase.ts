import { createClient } from "@supabase/supabase-js";

export const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL as string,
  import.meta.env.VITE_SUPABASE_ANON_KEY as string,
);

export interface PlannedBlock {
  id: string;
  task_id: string | null;
  title: string;
  starts_at: string;
  ends_at: string;
  status: "planned" | "done" | "skipped";
  note: string | null;
  pinned: boolean;
}

/** Most recent Monday 00:00 local — the calendar's week origin. */
export function weekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
}

export async function fetchWeek(start: Date): Promise<PlannedBlock[]> {
  const end = new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000);
  return fetchRange(start, end);
}

export async function fetchDay(day = new Date()): Promise<PlannedBlock[]> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
  return fetchRange(start, end);
}

async function fetchRange(start: Date, end: Date): Promise<PlannedBlock[]> {
  const { data, error } = await supabase
    .from("scheduled_blocks")
    .select("*")
    .gte("starts_at", start.toISOString())
    .lt("starts_at", end.toISOString())
    .order("starts_at", { ascending: true });
  if (error) throw error;
  return (data ?? []) as PlannedBlock[];
}
