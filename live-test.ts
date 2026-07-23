/**
 * Live test against the REAL Claude model. Costs a few cents per run.
 *
 *   1. Put ANTHROPIC_API_KEY in a .env file (see .env.example).
 *   2. npx tsx live-test.ts
 *
 * The requests below use phrasings the mock LLM does NOT recognise, so a
 * sensible result here proves the real model is doing the estimating,
 * chunking, and clarifying — not our keyword shims.
 */
import "dotenv/config";
import { createAnthropicLlm } from "./src/llm/anthropic";
import { parseRequest } from "./src/llm/parseRequest";
import { schedule, wakingWindow } from "./src/scheduler";
import { toEngineTask, type ScheduleContext } from "./src/llm/types";
import { DAY, WEEKDAY_NAMES, fmtClock, hm, weekdayOf } from "./src/time";

if (!process.env.ANTHROPIC_API_KEY) {
  console.error("Missing ANTHROPIC_API_KEY — create a .env file (see .env.example).");
  process.exit(1);
}

const llm = createAnthropicLlm();

const context: ScheduleContext = {
  fixedBlocks: [
    { id: "work", title: "Work", days: [0, 2, 3], startMin: hm(17), endMin: hm(20, 15) },
    { id: "sleep", title: "Sleep", days: [], startMin: hm(1), endMin: hm(9) },
  ],
  existingTasks: [],
};

// None of these hit the mock's keyword rules — the real model must reason.
const requests = [
  "I want to practice Spanish on Duolingo every morning and meditate for a bit daily",
  "get in some guitar practice a few times a week and meal prep on the weekend",
  "I'd like to get fitter", // vague on purpose -> expect a clarifying question
];

async function main() {
  for (const request of requests) {
    console.log(`\n=== You: "${request}" ===`);
    const parsed = await parseRequest(request, context, llm);

    if (parsed.kind === "clarify") {
      console.log("  Assistant asks:");
      for (const q of parsed.questions) console.log(`    ? ${q}`);
      continue;
    }

    for (const p of parsed.tasks) {
      context.existingTasks.push(toEngineTask(p));
      const win = p.window ? ` @ ${fmtClock(p.window.startMin)}-${fmtClock(p.window.endMin)}` : "";
      console.log(`  + ${p.title}: ${p.durationMin}m x${p.quota}/${p.period}${win}`);
      if (p.estimateNote) console.log(`      note: ${p.estimateNote}`);
    }
  }

  console.log("\n\n=== Scheduled week (Mon + Sat sample) ===");
  const { blocks, conflicts } = schedule({
    horizonDays: 7,
    fixedBlocks: context.fixedBlocks,
    tasks: context.existingTasks,
    defaultWindow: wakingWindow(context.fixedBlocks),
  });
  for (const d of [0, 5]) {
    console.log(`\n${WEEKDAY_NAMES[weekdayOf(d)]}`);
    for (const b of blocks.filter((b) => Math.floor(b.start / DAY) === d).sort((a, b) => a.start - b.start)) {
      console.log(`  ${fmtClock(b.start)}–${fmtClock(b.end)}  ${b.title}`);
    }
  }
  console.log(conflicts.length ? `\nConflicts: ${conflicts.map((c) => c.title).join(", ")}` : "\nConflicts: none ✓");
}

main().catch((e) => {
  console.error("\nLive call failed:", e?.message ?? e);
  process.exit(1);
});
