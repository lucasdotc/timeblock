/**
 * Local parse server — the dev stand-in for the Supabase Edge Function.
 *
 * Its ONLY job is the one thing that needs the secret Anthropic key: turning a
 * natural-language request into structured tasks (or clarifying questions).
 * Everything else — auth, DB writes, scheduling — stays client-side under the
 * user's own session. When the real Edge Function is deployed, the frontend
 * just points at that URL instead; the request/response shape is identical.
 *
 *   npm run server   (reads ANTHROPIC_API_KEY from .env)
 */
import "dotenv/config";
import express from "express";
import cors from "cors";
import { createAnthropicLlm } from "../src/llm/anthropic";
import { parseRequest } from "../src/llm/parseRequest";
import type { ScheduleContext } from "../src/llm/types";

const llm = createAnthropicLlm();
const app = express();
app.use(cors({ origin: "http://localhost:5174" }));
app.use(express.json());

app.get("/health", (_req, res) => res.json({ ok: true }));

app.post("/parse", async (req, res) => {
  try {
    const { request, context } = req.body as { request: string; context: ScheduleContext };
    if (!request || !context) return res.status(400).json({ error: "request and context required" });
    const result = await parseRequest(request, context, llm);
    res.json(result);
  } catch (e: any) {
    console.error("parse error:", e?.message ?? e);
    res.status(500).json({ error: String(e?.message ?? e) });
  }
});

const PORT = 8787;
app.listen(PORT, () => console.log(`parse server ready on http://localhost:${PORT}`));
