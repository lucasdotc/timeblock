import { describe, expect, it } from "vitest";
import { createMockLlm } from "../src/llm/mock";
import { parseRequest, parseAndSchedule } from "../src/llm/parseRequest";
import { toEngineTask, type ScheduleContext } from "../src/llm/types";
import { hm } from "../src/time";

const llm = createMockLlm();

const baseContext: ScheduleContext = {
  fixedBlocks: [
    { id: "work", title: "Work", days: [0, 2, 3], startMin: hm(17), endMin: hm(20, 15) },
    { id: "sleep", title: "Sleep", days: [], startMin: hm(1), endMin: hm(9) },
  ],
  existingTasks: [],
};

describe("parseRequest (mock LLM)", () => {
  it("turns 'X leetcode a day' into a spread per-day task with the right quota", async () => {
    const res = await parseRequest("do 3 leetcode a day", baseContext, llm);
    expect(res.kind).toBe("tasks");
    if (res.kind !== "tasks") return;
    const t = res.tasks.find((t) => t.id === "leetcode")!;
    expect(t.quota).toBe(3);
    expect(t.period).toBe("day");
    expect(t.spread).toBe(true);
  });

  it("chunks 'apply for 5 jobs a day' into one batched block, not five", async () => {
    const res = await parseRequest("apply for 5 jobs a day", baseContext, llm);
    if (res.kind !== "tasks") throw new Error("expected tasks");
    const t = res.tasks.find((t) => t.id === "jobapps")!;
    expect(t.quota).toBe(1); // one block/day, not five
    expect(t.durationMin).toBe(75); // 5 x ~15 min
  });

  it("marks weekly gym as non-consecutive with a transit buffer", async () => {
    const res = await parseRequest("gym 3 times a week", baseContext, llm);
    if (res.kind !== "tasks") throw new Error("expected tasks");
    const t = res.tasks.find((t) => t.id === "gym")!;
    expect(t.period).toBe("week");
    expect(t.quota).toBe(3);
    expect(t.nonConsecutiveDays).toBe(true);
    expect(t.bufferMin).toBeGreaterThan(0);
  });

  it("asks a clarifying question instead of guessing on a vague request", async () => {
    const res = await parseRequest("I want to read more", baseContext, llm);
    expect(res.kind).toBe("clarify");
    if (res.kind !== "clarify") return;
    expect(res.questions.length).toBeGreaterThan(0);
  });

  it("cleans optional fields to real absence (no leftover nulls)", async () => {
    const res = await parseRequest("do 3 leetcode a day", baseContext, llm);
    if (res.kind !== "tasks") throw new Error("expected tasks");
    const engineTask = toEngineTask(res.tasks[0]!);
    // leetcode has no buffer; the field must be absent, not null.
    expect(engineTask.bufferMin).toBeUndefined();
    expect("estimateNote" in engineTask).toBe(false);
  });
});

describe("parseAndSchedule (end to end)", () => {
  it("parses the full request and places it with no conflicts", async () => {
    const res = await parseAndSchedule(
      "3 leetcode a day, apply for 5 jobs a day, soccer 2 hours a day, gym 3 times a week",
      baseContext,
      7,
      llm,
    );
    expect(res.kind).toBe("scheduled");
    if (res.kind !== "scheduled") return;
    expect(res.result.conflicts).toEqual([]);
    // 7 soccer + 7 jobapps + 21 leetcode + 3 gym = 38 blocks.
    expect(res.result.blocks.length).toBe(38);
  });

  it("returns the clarify path without scheduling when the LLM is unsure", async () => {
    const res = await parseAndSchedule("I want to study", baseContext, 7, llm);
    expect(res.kind).toBe("clarify");
  });
});
