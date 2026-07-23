// Supabase Edge Function: parse natural language into a scheduling intent.
// Classifies the request as ADD (propose tasks), DELETE (identify existing
// tasks to remove — the client still requires explicit confirmation), or
// CLARIFY (ask a question). Holds ANTHROPIC_API_KEY server-side.
import Anthropic from "npm:@anthropic-ai/sdk@0.112.4";
import { zodOutputFormat } from "npm:@anthropic-ai/sdk@0.112.4/helpers/zod";
import { z } from "npm:zod@4.4.3";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const clock = (m: number) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const SYSTEM_PROMPT =
  `You are the language front-end of a time-blocking app. The user speaks in plain English and you translate that into ONE structured intent for a deterministic scheduler. You never decide exact times — you only describe what needs to fit or what to remove.

Classify the request as exactly one of:

(A) ADD — the user wants to start doing something regularly. Set kind "tasks".
For each thing, produce a task with:
- title: short, human-readable.
- durationMin: length of ONE block. If unstated, ESTIMATE and explain briefly in estimateNote.
- quota + period: how many blocks per "day" or per "week". "3 leetcode a day" -> quota 3, period day.
- CHUNKING: "5 job applications a day" is best as ONE ~75-min block (quota 1/day); "3 leetcode a day" is three 30-min blocks (quota 3/day, spread). Use judgment.
- window (optional): minutes-from-midnight range, only when needed. Outdoor/sport -> daylight (~08:00–20:30). Focus work -> ~09:00–23:00. Omit if any waking time is fine.
- fixedTimeMin (optional): if the user gives a SPECIFIC clock time for the recurring task ("meditate every day at 6am", "gym at 7", "nightly reading at 9pm"), set minutes-from-midnight (6am -> 360, 7am -> 420, 9pm -> 1260). Every occurrence is then pinned to this exact time. Prefer this over window when an exact time is stated. Omit if no specific time is given.
- bufferMin (optional): transit time (15–20) for off-site things. Omit for at-home.
- spread (optional true): space repeated same-day blocks apart.
- nonConsecutiveDays (optional true): weekly physical training needing rest days.

(B) DELETE — the user wants to remove, cancel, clear, stop, or get rid of one or more EXISTING tasks (listed below with [id]). Set kind "delete". Fill taskIds with the [id] values of the tasks to remove — copy them EXACTLY. For "clear everything" / "delete all", include every listed task's id. Write a one-sentence summary naming the tasks that will be removed (e.g. "Remove Yoga and Gym."). If the request clearly targets removal but you cannot confidently match it to any listed task, use kind "clarify" instead and ask which one (listing the current tasks). Never delete a task the user only wants to CHANGE.

(D) EVENT — the user wants ONE-TIME things that happen once, not a recurring habit: a meeting, appointment, call, deadline, or reminder. Cues: "meeting", "appointment", "reminder", "remind me", "call", "on Tuesday", "tomorrow", "next Friday", "at 3pm", a specific date. Set kind "events". For each event provide:
   - title: short (e.g. "Dentist appointment", "Call the bank").
   - durationMin: estimate — a meeting/appointment ~60, a quick call/reminder ~15, or as stated.
   - startAt: if a specific clock time is given ("at 3pm", "9:30"), the LOCAL date-time as "YYYY-MM-DDTHH:MM" (24h). Otherwise null.
   - day: if only a day/date is given with no clock time ("on Friday", "tomorrow"), the LOCAL date as "YYYY-MM-DD". Otherwise null.
   - If neither a time nor a day is given ("sometime this week"), leave both startAt and day null.
   Resolve relative dates ("tomorrow", "next Tuesday", "Friday") using the CURRENT TIME given in the schedule context. A one-off with a specific clock time is fixed at that time; day-only or neither is flexible and the scheduler picks a slot.

(E) EDIT — the user wants to CHANGE an EXISTING recurring task (listed with [id]): its time, length, or HOW OFTEN it recurs. Set kind "edit". CRITICAL: if the thing they describe is already a listed task, changing its cadence ("make soccer daily", "soccer every day", "gym 5 times a week", "only twice a week now") is an EDIT of that task — NOT a new ADD. For each edit provide:
   - taskId: the [id] of the existing task (copy exactly).
   - scope: "day" if they name a specific day ("on Thursday", "tomorrow"); otherwise "week" (every day / whole week / a cadence change / no day given). When unclear, use the DEFAULT SCOPE from context. Cadence changes are always scope "week".
   - day: for scope "day", the LOCAL date "YYYY-MM-DD" (resolve relative days from CURRENT TIME); null for scope "week".
   - timeMin: new time-of-day in MINUTES from midnight if they give a clock time (1pm -> 780, 3pm -> 900, 9:30am -> 570); null if no time change.
   - durationMin: new length in minutes if changed, else null.
   - period: the new recurrence bucket, "day" or "week", ONLY if the cadence changes between daily and weekly; else null. "daily"/"every day" -> period "day". "X times a week" / "weekly" -> period "week".
   - quota: new count PER period if frequency changes, else null. With period "day", quota is per-day (daily = quota 1). With period "week", quota is per-week (3x a week = quota 3). "every day" -> period "day", quota 1.
   - summary: one short sentence describing the change.
   Examples: "change gym to 1pm daily" -> {scope:"week", timeMin:780}. "move soccer on thursday to 3pm" -> {scope:"day", day:<thu date>, timeMin:900}. "make leetcode 45 minutes" -> {scope:"week", durationMin:45}. "make soccer training daily" / "soccer every day" -> {scope:"week", period:"day", quota:1}. "cut gym to twice a week" -> {scope:"week", period:"week", quota:2}. "do 2 leetcode a day instead of 3" -> {scope:"week", quota:2}.

(F) REARRANGE — the user wants to REORDER existing tasks/blocks by their sequence relative to each other, without giving exact clock times ("do soccer after job applications but before the gym", "put the gym before yoga", "reorder my afternoon: leetcode, then lunch, then emails"). Set kind "rearrange". Provide:
   - scope: "day" if a specific day is named ("today", "on Friday"); otherwise "week". When unclear, use DEFAULT SCOPE.
   - day: for scope "day", the LOCAL date "YYYY-MM-DD" (resolve relative days from CURRENT TIME); null for scope "week".
   - orderedTaskIds: the [id]s of the involved EXISTING tasks in the desired order, EARLIEST first. "soccer after job applications but before gym" -> [job applications id, soccer id, gym id]. Copy ids EXACTLY; include only tasks the user named. If any named thing isn't an existing task, use kind "clarify" instead.
   - summary: one short sentence describing the new order.

(C) CLARIFY — the request is too vague to act on (duration could range 3x+, unclear which task, ambiguous intent). Set kind "clarify" with 1–3 short, specific questions. Prefer acting with a stated assumption over asking, unless you truly can't.

Rules:
- Choose ONE kind. Fill only that kind's fields; leave the others empty.
- Recurring ("every day", "3x a week", "daily") for a NEW thing -> ADD. But if that recurring thing ALREADY EXISTS as a listed task, a cadence change is an EDIT of it, never a new ADD. One-time ("on Friday", "at 3pm", "meeting", "remind me") -> EVENT. Changing an EXISTING task's time/length/frequency -> EDIT. Reordering existing tasks relative to each other with no exact times -> REARRANGE. When in doubt between a habit and a one-off, prefer EVENT if a specific date/time is present.
- Only ADD what was asked; only DELETE existing tasks that clearly match; never invent tasks.
- Respond ONLY in the required structured format.`;

const ProposedTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  durationMin: z.number(),
  quota: z.number(),
  period: z.enum(["day", "week"]),
  window: z.object({ startMin: z.number(), endMin: z.number() }).nullable(),
  fixedTimeMin: z.number().nullable(),
  bufferMin: z.number().nullable(),
  spread: z.boolean().nullable(),
  nonConsecutiveDays: z.boolean().nullable(),
  estimateNote: z.string().nullable(),
});
const EventSchema = z.object({
  title: z.string(),
  durationMin: z.number(),
  startAt: z.string().nullable(),
  day: z.string().nullable(),
});
const EditSchema = z.object({
  taskId: z.string(),
  scope: z.enum(["day", "week"]),
  day: z.string().nullable(),
  timeMin: z.number().nullable(),
  durationMin: z.number().nullable(),
  period: z.enum(["day", "week"]).nullable(),
  quota: z.number().nullable(),
  summary: z.string(),
});
const RearrangeSchema = z.object({
  scope: z.enum(["day", "week"]),
  day: z.string().nullable(),
  orderedTaskIds: z.array(z.string()),
  summary: z.string(),
});
const ResultSchema = z.object({
  kind: z.enum(["tasks", "clarify", "delete", "events", "edit", "rearrange"]),
  tasks: z.array(ProposedTaskSchema),
  questions: z.array(z.string()),
  taskIds: z.array(z.string()),
  summary: z.string(),
  events: z.array(EventSchema),
  edits: z.array(EditSchema),
  rearrange: RearrangeSchema.nullable(),
});

function renderContext(ctx: any): string {
  const lines: string[] = [];
  if (ctx.now) lines.push(`CURRENT TIME (user local): ${ctx.now}`);
  if (ctx.scope) lines.push(`DEFAULT SCOPE (when day/week is unspecified): ${ctx.scope}`);
  lines.push("");
  lines.push("FIXED COMMITMENTS (immovable):");
  if (!ctx.fixedBlocks?.length) lines.push("  (none)");
  for (const f of ctx.fixedBlocks ?? []) {
    const days = !f.days?.length ? "every day" : f.days.map((d: number) => WEEKDAYS[d]).join("/");
    lines.push(`  - ${f.title}: ${days}, ${clock(f.startMin)}–${clock(f.endMin)}`);
  }
  lines.push("", "EXISTING FLEXIBLE TASKS (use [id] for deletes):");
  if (!ctx.existingTasks?.length) lines.push("  (none)");
  for (const t of ctx.existingTasks ?? []) {
    lines.push(`  - [${t.id}] ${t.title}: ${t.quota}x/${t.period}, ${t.durationMin} min each`);
  }
  return lines.join("\n");
}

function clean(raw: any) {
  const t: any = { id: raw.id, title: raw.title, durationMin: raw.durationMin, quota: raw.quota, period: raw.period };
  if (raw.window) t.window = raw.window;
  if (raw.fixedTimeMin != null) t.fixedTimeMin = raw.fixedTimeMin;
  if (raw.bufferMin != null) t.bufferMin = raw.bufferMin;
  if (raw.spread != null) t.spread = raw.spread;
  if (raw.nonConsecutiveDays != null) t.nonConsecutiveDays = raw.nonConsecutiveDays;
  if (raw.estimateNote != null) t.estimateNote = raw.estimateNote;
  return t;
}

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

  try {
    const { request, context } = await req.json();
    if (!request || !context) return json({ error: "request and context required" }, 400);

    const message = await client.messages.parse({
      model: "claude-opus-4-8",
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: `REQUEST:\n${request}\n\nCURRENT SCHEDULE:\n${renderContext(context)}` }],
      output_config: { format: zodOutputFormat(ResultSchema) },
    });

    const out = message.parsed_output;
    if (!out) return json({ kind: "clarify", questions: ["I couldn't interpret that — can you rephrase?"] });
    if (out.kind === "clarify") return json({ kind: "clarify", questions: out.questions });
    if (out.kind === "delete") {
      // Validate ids against the ones we actually sent — never trust free-form ids.
      const known = new Set((context.existingTasks ?? []).map((t: any) => t.id));
      const taskIds = (out.taskIds ?? []).filter((id: string) => known.has(id));
      if (taskIds.length === 0) {
        return json({ kind: "clarify", questions: ["I couldn't tell which task to remove. Which one did you mean?"] });
      }
      return json({ kind: "delete", taskIds, summary: out.summary });
    }
    if (out.kind === "edit") {
      const known = new Set((context.existingTasks ?? []).map((t: any) => t.id));
      const edits = (out.edits ?? []).filter((e: any) => known.has(e.taskId));
      if (edits.length === 0) return json({ kind: "clarify", questions: ["Which task did you want to change?"] });
      return json({ kind: "edit", edits });
    }
    if (out.kind === "rearrange") {
      const known = new Set((context.existingTasks ?? []).map((t: any) => t.id));
      const r = out.rearrange;
      const orderedTaskIds = (r?.orderedTaskIds ?? []).filter((id: string) => known.has(id));
      if (!r || orderedTaskIds.length < 2) {
        return json({ kind: "clarify", questions: ["Which tasks did you want to reorder, and in what order?"] });
      }
      return json({ kind: "rearrange", rearrange: { scope: r.scope, day: r.day ?? null, orderedTaskIds, summary: r.summary } });
    }
    if (out.kind === "events") {
      const events = (out.events ?? []).map((e: any) => ({
        title: e.title,
        durationMin: e.durationMin,
        startAt: e.startAt ?? null,
        day: e.day ?? null,
      }));
      if (events.length === 0) {
        return json({ kind: "clarify", questions: ["What's the event, and when is it?"] });
      }
      return json({ kind: "events", events });
    }
    return json({ kind: "tasks", tasks: out.tasks.map(clean) });
  } catch (e) {
    console.error("parse error:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
