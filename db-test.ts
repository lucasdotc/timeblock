/**
 * End-to-end persistence round-trip against your real Supabase project.
 *
 *   1. In Supabase: Authentication -> Users -> Add user (email + password).
 *      (Or enable email signups.) This is YOUR test account.
 *   2. Add to .env:  TEST_USER_EMAIL=...  and  TEST_USER_PASSWORD=...
 *   3. npx tsx db-test.ts
 *
 * It signs in as that user, writes fixed blocks + tasks (parsed from natural
 * language via the free mock LLM), schedules the week, saves the plan, then
 * reads it back — proving RLS-scoped persistence works end to end.
 */
import "dotenv/config";
import { createAppClient, signInWithEnv } from "./src/db/client";
import {
  listFixedBlocks,
  listPlan,
  listTasks,
  replacePlan,
  saveFixedBlock,
  saveTask,
  thisWeekStart,
} from "./src/db/store";
import { createMockLlm } from "./src/llm/mock";
import { parseRequest } from "./src/llm/parseRequest";
import { toEngineTask } from "./src/llm/types";
import { schedule, wakingWindow } from "./src/scheduler";
import { hm } from "./src/time";

async function main() {
  const sb = createAppClient();
  const userId = await signInWithEnv(sb);
  console.log(`Signed in as ${userId.slice(0, 8)}…`);

  // Start clean so re-runs don't pile up duplicates (RLS scopes deletes to us).
  await sb.from("scheduled_blocks").delete().eq("status", "planned");
  await sb.from("tasks").delete().neq("id", "00000000-0000-0000-0000-000000000000");
  await sb.from("fixed_blocks").delete().neq("id", "00000000-0000-0000-0000-000000000000");

  // 1. Fixed commitments.
  await saveFixedBlock(sb, { title: "Work", days: [0, 2, 3], startMin: hm(17), endMin: hm(20, 15) });
  await saveFixedBlock(sb, { title: "Sleep", days: [], startMin: hm(1), endMin: hm(9) });

  // 2. Flexible tasks — parsed from plain English (mock LLM, no API cost).
  const fixedBlocks = await listFixedBlocks(sb);
  const parsed = await parseRequest(
    "3 leetcode a day, apply for 5 jobs a day, soccer 2 hours a day, gym 3 times a week",
    { fixedBlocks, existingTasks: [] },
    createMockLlm(),
  );
  if (parsed.kind !== "tasks") throw new Error("expected tasks");
  for (const p of parsed.tasks) await saveTask(sb, toEngineTask(p), p.estimateNote);

  // 3. Read persisted state back and schedule it.
  const tasks = await listTasks(sb);
  console.log(`Persisted: ${fixedBlocks.length} fixed blocks, ${tasks.length} tasks`);

  const { blocks, conflicts } = schedule({
    horizonDays: 7,
    fixedBlocks,
    tasks,
    defaultWindow: wakingWindow(fixedBlocks),
  });

  // 4. Save the plan, then read it back.
  const saved = await replacePlan(sb, blocks, thisWeekStart());
  const plan = await listPlan(sb);
  console.log(`Saved ${saved} scheduled blocks; read back ${plan.length}.`);
  console.log(`Conflicts: ${conflicts.length ? conflicts.map((c) => c.title).join(", ") : "none ✓"}`);

  console.log("\nFirst 6 blocks (from the DB):");
  for (const b of plan.slice(0, 6)) {
    const s = new Date(b.startsAt);
    const e = new Date(b.endsAt);
    const t = (d: Date) => d.toLocaleString(undefined, { weekday: "short", hour: "2-digit", minute: "2-digit" });
    console.log(`  ${t(s)}–${e.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" })}  ${b.title}`);
  }
}

main().catch((e) => {
  console.error("\nRound-trip failed:", e?.message ?? e);
  process.exit(1);
});
