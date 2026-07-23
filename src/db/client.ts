import { createClient, type SupabaseClient } from "@supabase/supabase-js";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing env var ${name} (see .env.example)`);
  return v;
}

/**
 * A Supabase client using the public anon key. All access is still gated by
 * Row Level Security — an anon client can only read/write rows once a user has
 * signed in on it. This is the client the app (and headless tests) use.
 */
export function createAppClient(): SupabaseClient {
  return createClient(requireEnv("SUPABASE_URL"), requireEnv("SUPABASE_ANON_KEY"), {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/**
 * Sign a client in with email/password for headless/backend use (tests, the
 * nightly re-plan job). In the real apps, interactive login provides the
 * session instead. The password is read from the environment and never appears
 * in code or logs.
 */
export async function signInWithEnv(sb: SupabaseClient): Promise<string> {
  const { data, error } = await sb.auth.signInWithPassword({
    email: requireEnv("TEST_USER_EMAIL"),
    password: requireEnv("TEST_USER_PASSWORD"),
  });
  if (error) throw new Error(`Sign-in failed: ${error.message}`);
  return data.user!.id;
}
