/**
 * End-to-end offline demo: natural language -> (mock) Claude -> Task[] ->
 * scheduler -> week. No API key, no network, no cost.
 *
 *   npx tsx parse-demo.ts
 *
 * Swap createMockLlm() for createAnthropicLlm() (and set ANTHROPIC_API_KEY) to
 * run it against the real model.
 */
import { schedule, wakingWindow } from "./src/scheduler";
import { createMockLlm } from "./src/llm/mock";
import { parseRequest } from "./src/llm/parseRequest";
import { toEngineTask, type ScheduleContext } from "./src/llm/types";
import { DAY, WEEKDAY_NAMES, fmtClock, hm, weekdayOf } from "./src/time";

const llm = createMockLlm();

// Lucas's real fixed schedule as the starting context; tasks accumulate as we
// go, so each request is scheduled around everything requested before it.
const context: ScheduleContext = {
  fixedBlocks: [
    { id: "work", title: "Work", days: [0, 2, 3], startMin: hm(17), endMin: hm(20, 15) },
    { id: "sleep", title: "Sleep", days: [], startMin: hm(1), endMin: hm(9) },
  ],
  existingTasks: [],
};

const requests = [
  "I want to do 3 leetcode questions a day and apply for 5 jobs a day",
  "also train soccer for 2 hours a day and hit the gym 3 times a week",
  "I want to read more", // deliberately vague -> should ask, not guess
];

async function main() {
  for (const request of requests) {
    console.log(`\n=== You: "${request}" ===`);
    const parsed = await parseRequest(request, context, llm);

    if (parsed.kind === "clarify") {
      console.log("  Assistant (needs input before scheduling):");
      for (const q of parsed.questions) console.log(`    ? ${q}`);
      continue;
    }

    for (const p of parsed.tasks) {
      context.existingTasks.push(toEngineTask(p));
      console.log(`  + ${p.title}  (${p.durationMin}m x${p.quota}/${p.period})` + (p.estimateNote ? `  — ${p.estimateNote}` : ""));
    }
  }

  console.log("\n\n=== Resulting week ===");
  const { blocks, conflicts } = schedule({
    horizonDays: 7,
    fixedBlocks: context.fixedBlocks,
    tasks: context.existingTasks,
    defaultWindow: wakingWindow(context.fixedBlocks),
  });

  for (let d = 0; d < 7; d++) {
    const fixed = context.fixedBlocks
      .filter((f) => f.days.length === 0 || f.days.includes(weekdayOf(d) as never))
      .map((f) => ({ start: d * DAY + f.startMin, end: d * DAY + f.endMin, title: f.title, fixed: true }));
    const day = [
      ...fixed,
      ...blocks.filter((b) => Math.floor(b.start / DAY) === d).map((b) => ({ ...b, fixed: false })),
    ].sort((a, b) => a.start - b.start);
    console.log(`\n${WEEKDAY_NAMES[weekdayOf(d)]}`);
    for (const r of day) {
      console.log(`  ${fmtClock(r.start)}–${fmtClock(r.end)} ${r.fixed ? "[fixed]" : "       "} ${r.title}`);
    }
  }

  console.log(conflicts.length ? `\nConflicts: ${conflicts.map((c) => c.title).join(", ")}` : "\nConflicts: none ✓");
}

main();
