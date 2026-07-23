import type { EngineInput, ScheduleResult } from "../types";
import { schedule, wakingWindow } from "../scheduler";
import type { LlmClient, ParseResult, ScheduleContext } from "./types";
import { toEngineTask } from "./types";

/**
 * Turn a natural-language request into a ParseResult (tasks or clarifying
 * questions), using whichever LlmClient is passed. This is the single entry
 * point the app/backend calls; it is model-agnostic.
 */
export async function parseRequest(
  request: string,
  context: ScheduleContext,
  llm: LlmClient,
): Promise<ParseResult> {
  return llm.proposeTasks({ request, context });
}

/**
 * Convenience for the demo/app: parse a request, and if it produced tasks,
 * fold them into the existing schedule and run the scheduler so you can show
 * the resulting week (or the conflicts) immediately.
 */
export async function parseAndSchedule(
  request: string,
  context: ScheduleContext,
  horizonDays: number,
  llm: LlmClient,
): Promise<
  | { kind: "clarify"; questions: string[] }
  | { kind: "scheduled"; result: ScheduleResult; addedTitles: string[] }
> {
  const parsed = await parseRequest(request, context, llm);
  if (parsed.kind === "clarify") {
    return { kind: "clarify", questions: parsed.questions };
  }
  const added = parsed.tasks.map(toEngineTask);
  const input: EngineInput = {
    horizonDays,
    fixedBlocks: context.fixedBlocks,
    tasks: [...context.existingTasks, ...added],
    defaultWindow: wakingWindow(context.fixedBlocks),
  };
  return {
    kind: "scheduled",
    result: schedule(input),
    addedTitles: added.map((t) => t.title),
  };
}
