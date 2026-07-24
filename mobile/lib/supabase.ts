import "react-native-url-polyfill/auto";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { createClient } from "@supabase/supabase-js";

// On-device session persistence via AsyncStorage; no URL-based session
// detection (that's a web-only concern).
export const supabase = createClient(
  process.env.EXPO_PUBLIC_SUPABASE_URL as string,
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY as string,
  {
    auth: {
      storage: AsyncStorage,
      autoRefreshToken: true,
      persistSession: true,
      detectSessionInUrl: false,
    },
  },
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

export function weekStart(now = new Date()): Date {
  const d = new Date(now);
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return d;
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

export async function fetchDay(day = new Date()): Promise<PlannedBlock[]> {
  const start = new Date(day);
  start.setHours(0, 0, 0, 0);
  return fetchRange(start, new Date(start.getTime() + 24 * 60 * 60 * 1000));
}

export async function fetchWeek(start = weekStart()): Promise<PlannedBlock[]> {
  return fetchRange(start, new Date(start.getTime() + 7 * 24 * 60 * 60 * 1000));
}
