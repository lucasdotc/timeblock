export * from "./types";
export { schedule, wakingWindow } from "./scheduler";
export { DAY, hm, fmtClock, weekdayOf, dayIndexOf, WEEKDAY_NAMES } from "./time";
export {
  FreeSpace,
  expandFixed,
  mergeIntervals,
  computeFreeGaps,
} from "./freespace";

// Language layer (Phase 2)
export type { LlmClient, ParseResult, ProposedTask, ScheduleContext } from "./llm/types";
export { toEngineTask } from "./llm/types";
export { parseRequest, parseAndSchedule } from "./llm/parseRequest";
export { createMockLlm } from "./llm/mock";
export { SYSTEM_PROMPT, renderContext, buildUserMessage } from "./llm/prompt";
// Note: createAnthropicLlm is intentionally NOT re-exported here so importing
// the core doesn't pull in the Anthropic SDK. Import it directly:
//   import { createAnthropicLlm } from "timeblock-core/src/llm/anthropic";

// Persistence layer (Phase 2/3). Auth-agnostic — operates on an authenticated
// Supabase client. Import from ./db/* directly to keep supabase-js out of the
// core bundle for consumers that don't need it.
export type { PlannedBlock } from "./db/store";
