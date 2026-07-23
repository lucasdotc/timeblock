import { describe, expect, it } from "vitest";
import { schedule, wakingWindow } from "../src/scheduler";
import { expandFixed } from "../src/freespace";
import { DAY, weekdayOf } from "../src/time";
import type { EngineInput, Interval, ScheduledBlock } from "../src/types";
import { lucasWeek } from "./fixtures";

function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

function fixedIntervals(input: EngineInput): Interval[] {
  return expandFixed(input.fixedBlocks, input.horizonDays);
}

describe("schedule() on Lucas's real week", () => {
  const result = schedule(lucasWeek);
  const { blocks, conflicts } = result;

  it("places everything with no conflicts", () => {
    expect(conflicts).toEqual([]);
  });

  it("never double-books two placed blocks", () => {
    for (let i = 0; i < blocks.length; i++) {
      for (let j = i + 1; j < blocks.length; j++) {
        expect(overlaps(blocks[i]!, blocks[j]!)).toBe(false);
      }
    }
  });

  it("never overlaps a fixed block (work / sleep)", () => {
    const fixed = fixedIntervals(lucasWeek);
    for (const b of blocks) {
      for (const f of fixed) {
        expect(overlaps(b, f)).toBe(false);
      }
    }
  });

  it("respects each task's time-of-day window", () => {
    for (const b of blocks) {
      const task = lucasWeek.tasks.find((t) => t.id === b.taskId)!;
      if (!task.window) continue;
      const startTod = b.start % DAY;
      const endTod = b.end - Math.floor(b.start / DAY) * DAY;
      expect(startTod).toBeGreaterThanOrEqual(task.window.startMin);
      expect(endTod).toBeLessThanOrEqual(task.window.endMin);
    }
  });

  it("meets every per-day quota", () => {
    for (const task of lucasWeek.tasks.filter((t) => t.period === "day")) {
      for (let d = 0; d < lucasWeek.horizonDays; d++) {
        const count = blocks.filter(
          (b) => b.taskId === task.id && Math.floor(b.start / DAY) === d,
        ).length;
        expect(count).toBe(task.quota);
      }
    }
  });

  it("meets every weekly quota", () => {
    for (const task of lucasWeek.tasks.filter((t) => t.period === "week")) {
      const count = blocks.filter((b) => b.taskId === task.id).length;
      expect(count).toBe(task.quota);
    }
  });

  it("keeps gym sessions on non-consecutive days", () => {
    const gymDays = blocks
      .filter((b) => b.taskId === "gym")
      .map((b) => Math.floor(b.start / DAY))
      .sort((a, b) => a - b);
    for (let i = 1; i < gymDays.length; i++) {
      expect(gymDays[i]! - gymDays[i - 1]!).toBeGreaterThan(1);
    }
  });

  it("honours transit buffers between a block and its neighbours", () => {
    // Soccer has a 20-min buffer; no other block should start within 20 min of its edges.
    const soccer = blocks.filter((b) => b.taskId === "soccer");
    for (const s of soccer) {
      for (const other of blocks) {
        if (other === s) continue;
        const gapAfter = other.start - s.end;
        const gapBefore = s.start - other.end;
        // If adjacent on the same side, the gap must be >= buffer.
        if (gapAfter >= 0 && gapAfter < 20) expect(gapAfter).toBeGreaterThanOrEqual(20);
        if (gapBefore >= 0 && gapBefore < 20) expect(gapBefore).toBeGreaterThanOrEqual(20);
      }
    }
  });
});

describe("non-consecutive weekly packing", () => {
  const gym = (quota: number): EngineInput => ({
    horizonDays: 7,
    fixedBlocks: [{ id: "sleep", title: "Sleep", days: [], startMin: 60, endMin: 540 }],
    tasks: [
      { id: "gym", title: "Gym", durationMin: 60, quota, period: "week", nonConsecutiveDays: true },
    ],
  });

  it("packs 4x/week into the 7-day max (feasible)", () => {
    const { blocks, conflicts } = schedule(gym(4));
    expect(blocks).toHaveLength(4);
    expect(conflicts).toEqual([]);
  });

  it("places the true maximum (4), not fewer, when 5x is impossible", () => {
    const { blocks } = schedule(gym(5));
    // 4 is the max independent set of non-adjacent days in a 7-day week.
    expect(blocks).toHaveLength(4);
    const days = blocks.map((b) => Math.floor(b.start / DAY)).sort((a, b) => a - b);
    for (let i = 1; i < days.length; i++) {
      expect(days[i]! - days[i - 1]!).toBeGreaterThan(1);
    }
  });
});

describe("windowless tasks respect the waking-hours default", () => {
  const input: EngineInput = {
    horizonDays: 2,
    fixedBlocks: [{ id: "sleep", title: "Sleep", days: [], startMin: 60, endMin: 540 }],
    // No window -> without a default this would land at 00:00.
    tasks: [{ id: "meditate", title: "Meditate", durationMin: 10, quota: 1, period: "day" }],
    defaultWindow: { startMin: 540, endMin: DAY }, // wake 09:00 -> midnight
  };

  it("never schedules a windowless task before the waking window", () => {
    const { blocks } = schedule(input);
    expect(blocks.length).toBe(2);
    for (const b of blocks) {
      const tod = b.start % DAY;
      expect(tod).toBeGreaterThanOrEqual(540); // not in the 00:00–01:00 pre-sleep sliver
    }
  });

  it("wakingWindow() derives the window from the sleep block", () => {
    expect(wakingWindow(input.fixedBlocks)).toEqual({ startMin: 540, endMin: DAY });
  });
});

describe("overflow behaviour", () => {
  it("reports a conflict instead of cramming when a day is impossible", () => {
    const impossible: EngineInput = {
      horizonDays: 1,
      fixedBlocks: [
        // Awake only 09:00–10:00; sleep swallows the rest of the day.
        { id: "sleep", title: "Sleep", days: [], startMin: 600, endMin: 1440 },
        { id: "dawn", title: "Sleep-in", days: [], startMin: 0, endMin: 540 },
      ],
      tasks: [
        { id: "big", title: "Impossible 2h task", durationMin: 120, quota: 1, period: "day" },
      ],
    };
    const { blocks, conflicts } = schedule(impossible);
    expect(blocks).toHaveLength(0);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.taskId).toBe("big");
  });
});
