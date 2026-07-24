import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { LlmClient, ParseResult, ProposedTask } from "./types";
import { SYSTEM_PROMPT, buildUserMessage } from "./prompt";

/**
 * Structured-output schema. Optional engine fields are modeled as `.nullable()`
 * (the model returns null when they don't apply); we strip the nulls when
 * building the ProposedTask so the engine sees clean `undefined`s.
 */
const ProposedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationMin: z.number(),
  quota: z.number(),
  period: z.enum(["day", "week"]),
  window: z.object({ startMin: z.number(), endMin: z.number() }).nullable(),
  bufferMin: z.number().nullable(),
  spread: z.boolean().nullable(),
  nonConsecutiveDays: z.boolean().nullable(),
  estimateNote: z.string().nullable(),
});

const ResultSchema = z.object({
  kind: z.enum(["tasks", "clarify"]),
  tasks: z.array(ProposedTaskSchema),
  questions: z.array(z.string()),
});

type RawTask = z.infer<typeof ProposedTaskSchema>;

/** null -> undefined, so optional engine fields are truly absent. */
function clean(raw: RawTask): ProposedTask {
  const t: ProposedTask = {
    id: raw.id,
    title: raw.title,
    durationMin: raw.durationMin,
    quota: raw.quota,
    period: raw.period,
  };
  if (raw.window) t.window = raw.window;
  if (raw.bufferMin != null) t.bufferMin = raw.bufferMin;
  if (raw.spread != null) t.spread = raw.spread;
  if (raw.nonConsecutiveDays != null) t.nonConsecutiveDays = raw.nonConsecutiveDays;
  if (raw.estimateNote != null) t.estimateNote = raw.estimateNote;
  return t;
}

/**
 * Real LLM backend. Uses Claude Opus 4.8 with structured outputs so the model
 * is constrained to the exact task shape the engine consumes. The API key is
 * read from the environment (ANTHROPIC_API_KEY) or an `ant auth login` profile
 * — never passed in from the app/client.
 */
export function createAnthropicLlm(client: Anthropic = new Anthropic()): LlmClient {
  return {
    async proposeTasks({ request, context }): Promise<ParseResult> {
      const message = await client.messages.parse({
        model: "claude-sonnet-5",
        max_tokens: 16000,
        thinking: { type: "adaptive" },
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: buildUserMessage(request, context) }],
        output_config: { format: zodOutputFormat(ResultSchema) },
      });

      const out = message.parsed_output;
      if (!out) {
        // Model refused or produced unparseable output — surface as a clarify.
        return {
          kind: "clarify",
          questions: ["I couldn't interpret that — can you rephrase what you'd like to schedule?"],
        };
      }
      if (out.kind === "clarify") {
        return { kind: "clarify", questions: out.questions };
      }
      return { kind: "tasks", tasks: out.tasks.map(clean) };
    },
  };
}
