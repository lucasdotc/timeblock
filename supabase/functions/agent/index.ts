// Supabase Edge Function: agentic scheduling assistant.
// Runs a Claude tool-use loop. The model reads the current plan and calls tools
// to assemble a set of changes. The tools do NOT write anything; they record the
// intended operations. The function returns the assembled plan, and the client
// applies it through its own propose/confirm/engine flow. Holds the API key.
import Anthropic from "npm:@anthropic-ai/sdk@0.112.4";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const clock = (m: number) => `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

const SYSTEM_PROMPT = `You are the scheduling assistant for a time-blocking app. The user gives you a goal in plain language. You work out the changes by calling tools, then finish with one or two short sentences summarizing what you are proposing.

A separate deterministic engine places every flexible task into a conflict-free slot. You never choose exact clock times unless the user states one. You describe what should happen; the engine decides where.

How to work:
- Read the current plan with get_schedule when you need to see what is there (for example before clearing or moving things).
- Make changes by calling add_task, add_event, edit_task, rearrange, or delete_task. Call as many as the goal needs, in a sensible order.
- Use the task ids listed in the context for edits, deletes, and rearranges. Copy ids exactly. Never invent tasks or ids.
- Change only what the user asked for.
- For a cadence change to an existing task (daily, twice a week, and so on), use edit_task with period and quota. Do not add a duplicate task.
- When you have called every tool the goal needs, stop calling tools and write a short summary of the plan.
- If the request is too vague to act on, call no write tools and instead put a short clarifying question in your final text.

Tool notes:
- add_task: a recurring habit. durationMin is the length of one block. quota + period is how often ("3 a day" is quota 3 period day). fixedTimeMin (minutes from midnight) only if the user names an exact time.
- add_event: a one-time thing. startAt ("YYYY-MM-DDTHH:MM") if a clock time is given, else day ("YYYY-MM-DD") if only a day is given, else leave both null.
- edit_task: scope "day" if a specific day is named (resolve the date), else "week". timeMin, durationMin, period, quota only for what changes.
- rearrange: orderedTaskIds earliest first, for reordering tasks relative to each other with no exact times.
- delete_task: one existing task by id.
- move_occurrence: move a single occurrence from one day to another. Call get_schedule first to see what is on the source day and its dates, then move each occurrence you want to shift. Resolve day names (today, tomorrow) to dates from the current time.`;

const tools: Anthropic.Tool[] = [
  {
    name: "get_schedule",
    description: "Read the currently placed blocks. Pass a day (YYYY-MM-DD) to see just that day, or omit it for the whole week.",
    input_schema: { type: "object", properties: { day: { type: "string", description: "YYYY-MM-DD, or omit for the whole week" } } },
  },
  {
    name: "add_task",
    description: "Add a recurring task (a habit that repeats).",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        durationMin: { type: "number", description: "length of one block in minutes" },
        quota: { type: "number", description: "how many blocks per period" },
        period: { type: "string", enum: ["day", "week"] },
        fixedTimeMin: { type: "number", description: "minutes from midnight, only if an exact time is given" },
      },
      required: ["title", "durationMin", "quota", "period"],
    },
  },
  {
    name: "add_event",
    description: "Add a one-time event or appointment.",
    input_schema: {
      type: "object",
      properties: {
        title: { type: "string" },
        durationMin: { type: "number" },
        startAt: { type: "string", description: "YYYY-MM-DDTHH:MM if an exact time is given" },
        day: { type: "string", description: "YYYY-MM-DD if only a day is given" },
      },
      required: ["title", "durationMin"],
    },
  },
  {
    name: "edit_task",
    description: "Change an existing task's time, length, or how often it recurs. Use the task id from the context.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string" },
        scope: { type: "string", enum: ["day", "week"] },
        day: { type: "string", description: "YYYY-MM-DD, for scope day" },
        timeMin: { type: "number", description: "new time of day in minutes from midnight" },
        durationMin: { type: "number" },
        period: { type: "string", enum: ["day", "week"] },
        quota: { type: "number" },
      },
      required: ["taskId", "scope"],
    },
  },
  {
    name: "rearrange",
    description: "Reorder existing tasks relative to each other, earliest first, with no exact times.",
    input_schema: {
      type: "object",
      properties: {
        scope: { type: "string", enum: ["day", "week"] },
        day: { type: "string", description: "YYYY-MM-DD, for scope day" },
        orderedTaskIds: { type: "array", items: { type: "string" }, description: "task ids, earliest first" },
      },
      required: ["scope", "orderedTaskIds"],
    },
  },
  {
    name: "delete_task",
    description: "Remove an existing task and its blocks. Use the task id from the context.",
    input_schema: { type: "object", properties: { taskId: { type: "string" } }, required: ["taskId"] },
  },
  {
    name: "move_occurrence",
    description: "Move ONE occurrence of a task from one day to another (for example clear it off today and put it on tomorrow). Use get_schedule to see what is on a day. The occurrence on the source day is cleared; a new one is placed on the target day.",
    input_schema: {
      type: "object",
      properties: {
        taskId: { type: "string", description: "the task whose occurrence moves" },
        fromDate: { type: "string", description: "YYYY-MM-DD the occurrence is currently on" },
        toDate: { type: "string", description: "YYYY-MM-DD to move it to" },
        timeMin: { type: "number", description: "time of day on the new day in minutes from midnight; omit to keep the same time" },
      },
      required: ["taskId", "fromDate", "toDate"],
    },
  },
];

function renderContext(ctx: any): string {
  const lines: string[] = [];
  if (ctx.now) lines.push(`CURRENT TIME (user local): ${ctx.now}`);
  if (ctx.scope) lines.push(`DEFAULT SCOPE when day/week is unspecified: ${ctx.scope}`);
  lines.push("", "FIXED COMMITMENTS (immovable walls):");
  if (!ctx.fixedBlocks?.length) lines.push("  (none)");
  for (const f of ctx.fixedBlocks ?? []) {
    const days = !f.days?.length ? "every day" : f.days.map((d: number) => WEEKDAYS[d]).join("/");
    lines.push(`  - ${f.title}: ${days}, ${clock(f.startMin)}-${clock(f.endMin)}`);
  }
  lines.push("", "EXISTING TASKS (use [id] for edits, deletes, rearranges):");
  if (!ctx.existingTasks?.length) lines.push("  (none)");
  for (const t of ctx.existingTasks ?? []) {
    lines.push(`  - [${t.id}] ${t.title}: ${t.quota}x/${t.period}, ${t.durationMin} min each`);
  }
  return lines.join("\n");
}

// get_schedule reads from the placed blocks the client sends in context.
function scheduleForDay(ctx: any, day: string | undefined): string {
  const blocks = (ctx.currentBlocks ?? []) as any[];
  const rows = day
    ? blocks.filter((b) => b.date === day)
    : blocks;
  if (!rows.length) return day ? `No blocks on ${day}.` : "No blocks scheduled.";
  return rows
    .slice()
    .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.startMin - b.startMin))
    .map((b) => `${WEEKDAYS[b.weekday] ?? "?"} ${b.date} ${clock(b.startMin)}-${clock(b.endMin)} ${b.taskId ? `[${b.taskId}] ` : ""}${b.title}${b.pinned ? " (pinned)" : ""}${b.status !== "planned" ? ` [${b.status}]` : ""}`)
    .join("\n");
}

const client = new Anthropic({ apiKey: Deno.env.get("ANTHROPIC_API_KEY") });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const json = (body: unknown, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { ...cors, "content-type": "application/json" } });

  try {
    const { request, context } = await req.json();
    if (!request || !context) return json({ error: "request and context required" }, 400);

    const known = new Set((context.existingTasks ?? []).map((t: any) => t.id));
    const operations: any[] = [];

    // Record a write-tool call as an operation. Returns the message shown back to the model.
    function record(name: string, input: any): string {
      switch (name) {
        case "add_task":
          operations.push({ op: "add_task", task: { title: input.title, durationMin: input.durationMin, quota: input.quota, period: input.period, fixedTimeMin: input.fixedTimeMin ?? null } });
          return `Recorded: add ${input.title} (${input.quota}x/${input.period}, ${input.durationMin} min).`;
        case "add_event":
          operations.push({ op: "add_event", event: { title: input.title, durationMin: input.durationMin, startAt: input.startAt ?? null, day: input.day ?? null } });
          return `Recorded: add event ${input.title}.`;
        case "edit_task":
          if (!known.has(input.taskId)) return `No task with id ${input.taskId}. Use an id from the context.`;
          operations.push({ op: "edit_task", edit: { taskId: input.taskId, scope: input.scope, day: input.day ?? null, timeMin: input.timeMin ?? null, durationMin: input.durationMin ?? null, period: input.period ?? null, quota: input.quota ?? null } });
          return `Recorded: edit task ${input.taskId}.`;
        case "rearrange": {
          const ids = (input.orderedTaskIds ?? []).filter((id: string) => known.has(id));
          if (ids.length < 2) return "Rearrange needs at least two known task ids.";
          operations.push({ op: "rearrange", rearrange: { scope: input.scope, day: input.day ?? null, orderedTaskIds: ids } });
          return `Recorded: rearrange ${ids.length} tasks.`;
        }
        case "delete_task":
          if (!known.has(input.taskId)) return `No task with id ${input.taskId}.`;
          operations.push({ op: "delete_task", taskId: input.taskId });
          return `Recorded: delete task ${input.taskId}.`;
        case "move_occurrence":
          if (!known.has(input.taskId)) return `No task with id ${input.taskId}.`;
          operations.push({ op: "move_occurrence", taskId: input.taskId, fromDate: input.fromDate, toDate: input.toDate, timeMin: input.timeMin ?? null });
          return `Recorded: move ${input.taskId} from ${input.fromDate} to ${input.toDate}.`;
        default:
          return "Unknown tool.";
      }
    }

    const messages: Anthropic.MessageParam[] = [
      { role: "user", content: `GOAL:\n${request}\n\nCURRENT SCHEDULE CONTEXT:\n${renderContext(context)}` },
    ];

    let summary = "";
    for (let turn = 0; turn < 8; turn++) {
      const res = await client.messages.create({
        model: "claude-opus-4-8",
        max_tokens: 4000,
        system: SYSTEM_PROMPT,
        tools,
        messages,
      });

      const toolUses = res.content.filter((b): b is Anthropic.ToolUseBlock => b.type === "tool_use");
      const text = res.content.filter((b) => b.type === "text").map((b: any) => b.text).join(" ").trim();
      if (text) summary = text;

      if (res.stop_reason !== "tool_use" || toolUses.length === 0) break;

      messages.push({ role: "assistant", content: res.content });
      const results: Anthropic.ToolResultBlockParam[] = toolUses.map((tu) => ({
        type: "tool_result",
        tool_use_id: tu.id,
        content: tu.name === "get_schedule" ? scheduleForDay(context, (tu.input as any)?.day) : record(tu.name, tu.input),
      }));
      messages.push({ role: "user", content: results });
    }

    return json({ kind: "plan", operations, summary: summary || "Here is the proposed plan." });
  } catch (e) {
    console.error("agent error:", e instanceof Error ? e.message : e);
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
});
