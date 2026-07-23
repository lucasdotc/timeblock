/**
 * Runnable demo: schedules Lucas's real week and prints the timetable.
 *   npm run demo
 */
import { schedule } from "./src/scheduler";
import { expandFixed } from "./src/freespace";
import { DAY, WEEKDAY_NAMES, fmtClock, weekdayOf } from "./src/time";
import type { Interval } from "./src/types";
import { lucasWeek } from "./test/fixtures";

type Row = { start: number; end: number; label: string; fixed: boolean };

const { blocks, conflicts } = schedule(lucasWeek);

// Fixed blocks (expanded) so we can print them alongside placed tasks for context.
const fixed: Array<Interval & { title: string }> = [];
for (let d = 0; d < lucasWeek.horizonDays; d++) {
  const wd = weekdayOf(d);
  for (const fb of lucasWeek.fixedBlocks) {
    if (fb.days.length === 0 || fb.days.includes(wd as never)) {
      fixed.push({ start: d * DAY + fb.startMin, end: d * DAY + fb.endMin, title: fb.title });
    }
  }
}

const rows: Row[] = [
  ...fixed.map((f) => ({ start: f.start, end: f.end, label: f.title, fixed: true })),
  ...blocks.map((b) => ({ start: b.start, end: b.end, label: b.title, fixed: false })),
];

console.log("\n=== Planned week (day 0 = Monday) ===\n");
for (let d = 0; d < lucasWeek.horizonDays; d++) {
  const dayRows = rows
    .filter((r) => Math.floor(r.start / DAY) === d)
    .sort((a, b) => a.start - b.start);
  console.log(`${WEEKDAY_NAMES[weekdayOf(d)]}`);
  if (dayRows.length === 0) {
    console.log("  (nothing)");
  }
  for (const r of dayRows) {
    const tag = r.fixed ? "[fixed]" : "       ";
    const dur = r.end - r.start;
    console.log(
      `  ${fmtClock(r.start)}–${fmtClock(r.end)} ${tag} ${r.label}  (${dur}m)`,
    );
  }
  console.log("");
}

console.log("=== Conflicts ===");
if (conflicts.length === 0) {
  console.log("  none — everything fit ✓");
} else {
  for (const c of conflicts) console.log(`  ⚠ ${c.title}: ${c.reason}`);
}
console.log("");
