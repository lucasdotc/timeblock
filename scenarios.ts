/**
 * Stress scenarios — poke the engine with overloaded / adversarial weeks and
 * see whether it stays honest (fills what fits, reports the rest clearly).
 *   npx tsx scenarios.ts
 */
import { schedule } from "./src/scheduler";
import { DAY, hm, fmtClock } from "./src/time";
import type { EngineInput, Task } from "./src/types";

function run(name: string, input: EngineInput): void {
  const { blocks, conflicts } = schedule(input);
  console.log(`\n─── ${name} ───`);

  // Placed vs required per task.
  for (const t of input.tasks) {
    const placed = blocks.filter((b) => b.taskId === t.id).length;
    const required = t.period === "day" ? t.quota * input.horizonDays : t.quota;
    const mark = placed === required ? "✓" : "✗";
    console.log(
      `  ${mark} ${t.title.padEnd(24)} ${placed}/${required} placed` +
        (t.period === "week" ? "  (weekly)" : ""),
    );
  }

  if (conflicts.length === 0) {
    console.log("  conflicts: none");
  } else {
    console.log(`  conflicts (${conflicts.length}):`);
    // De-dupe identical day-by-day messages into a count for readability.
    const seen = new Map<string, number>();
    for (const c of conflicts) {
      const key = `${c.title}: ${c.reason.replace(/day \d+/, "day N").replace(/\d+ of \d+/, "some")}`;
      seen.set(key, (seen.get(key) ?? 0) + 1);
    }
    for (const [msg, n] of seen) console.log(`    ⚠ ${msg}${n > 1 ? `  (x${n})` : ""}`);
  }
}

const sleep = { id: "sleep", title: "Sleep", days: [] as number[], startMin: hm(1), endMin: hm(9) };
const work = { id: "work", title: "Work", days: [0, 2, 3], startMin: hm(17), endMin: hm(20, 15) };

// A) Baseline sanity — the real week.
run("A) Baseline (real week)", {
  horizonDays: 7,
  fixedBlocks: [sleep, work],
  tasks: [
    { id: "soccer", title: "Soccer", durationMin: 120, quota: 1, period: "day", window: { startMin: hm(8), endMin: hm(20, 30) }, bufferMin: 20 },
    { id: "gym", title: "Gym", durationMin: 60, quota: 3, period: "week", window: { startMin: hm(6), endMin: hm(22) }, bufferMin: 15, nonConsecutiveDays: true },
    { id: "jobapps", title: "Job apps", durationMin: 75, quota: 1, period: "day", window: { startMin: hm(9), endMin: hm(23) } },
    { id: "leetcode", title: "LeetCode", durationMin: 30, quota: 3, period: "day", window: { startMin: hm(9), endMin: hm(23) }, spread: true },
  ],
});

// B) Deliberately overloaded — should NOT cram; should report shortfalls.
run("B) Overloaded day (too much to fit)", {
  horizonDays: 7,
  fixedBlocks: [sleep, work],
  tasks: [
    { id: "soccer", title: "Soccer 4h", durationMin: 240, quota: 1, period: "day", window: { startMin: hm(8), endMin: hm(20, 30) }, bufferMin: 20 },
    { id: "study", title: "Deep study 3h", durationMin: 180, quota: 2, period: "day", window: { startMin: hm(9), endMin: hm(23) } },
    { id: "leetcode", title: "LeetCode x6", durationMin: 30, quota: 6, period: "day", window: { startMin: hm(9), endMin: hm(23) }, spread: true },
  ],
});

// C) Packed fixed calendar — classes + meals eat the free time.
run("C) Packed calendar (classes + meals)", {
  horizonDays: 7,
  fixedBlocks: [
    sleep, work,
    { id: "class", title: "Class", days: [0, 1, 2, 3, 4], startMin: hm(10), endMin: hm(13) },
    { id: "lunch", title: "Lunch", days: [], startMin: hm(13), endMin: hm(13, 45) },
    { id: "dinner", title: "Dinner", days: [], startMin: hm(20, 30), endMin: hm(21, 15) },
  ],
  tasks: [
    { id: "soccer", title: "Soccer", durationMin: 120, quota: 1, period: "day", window: { startMin: hm(8), endMin: hm(20, 30) }, bufferMin: 20 },
    { id: "gym", title: "Gym", durationMin: 60, quota: 3, period: "week", window: { startMin: hm(6), endMin: hm(22) }, bufferMin: 15, nonConsecutiveDays: true },
    { id: "leetcode", title: "LeetCode", durationMin: 30, quota: 3, period: "day", window: { startMin: hm(9), endMin: hm(23) }, spread: true },
  ],
});

// D) Gym 4x/week non-consecutive — SHOULD fit (Mon/Wed/Fri/Sun).
run("D) Gym 4x/week non-consecutive (feasible)", {
  horizonDays: 7,
  fixedBlocks: [sleep],
  tasks: [
    { id: "gym", title: "Gym", durationMin: 60, quota: 4, period: "week", window: { startMin: hm(6), endMin: hm(22) }, nonConsecutiveDays: true },
  ],
});

// E) Gym 5x/week non-consecutive — IMPOSSIBLE (max 4 in 7 days). How gracefully?
run("E) Gym 5x/week non-consecutive (impossible)", {
  horizonDays: 7,
  fixedBlocks: [sleep],
  tasks: [
    { id: "gym", title: "Gym", durationMin: 60, quota: 5, period: "week", window: { startMin: hm(6), endMin: hm(22) }, nonConsecutiveDays: true },
  ],
});

// F) One giant block that only fits in a single narrow gap.
run("F) 6h block, narrow window", {
  horizonDays: 2,
  fixedBlocks: [sleep, { id: "appt", title: "Appt", days: [], startMin: hm(16), endMin: hm(18) }],
  tasks: [
    { id: "marathon", title: "6h project", durationMin: 360, quota: 1, period: "day", window: { startMin: hm(9), endMin: hm(23) } } satisfies Task,
  ],
});

console.log("");
