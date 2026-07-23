import { hm } from "../time";
import type { LlmClient, ParseResult, ProposedTask } from "./types";

/**
 * Deterministic stand-in for Claude, used by tests and the offline demo. It
 * recognises a handful of phrasings with simple keyword rules so we can
 * exercise the whole NL -> tasks -> scheduler pipeline without an API key or
 * any network/cost. The REAL interpretation (arbitrary language, real
 * estimation) is createAnthropicLlm — this only mimics its output shape.
 */
export function createMockLlm(): LlmClient {
  return {
    async proposeTasks({ request }): Promise<ParseResult> {
      const r = request.toLowerCase();
      const tasks: ProposedTask[] = [];

      const leetcode = /(\d+)\s*leetcode/.exec(r);
      if (leetcode) {
        tasks.push({
          id: "leetcode",
          title: "LeetCode",
          durationMin: 30,
          quota: Number(leetcode[1]),
          period: "day",
          window: { startMin: hm(9), endMin: hm(23) },
          spread: true,
          estimateNote: "~30 min per problem; spread through the day",
        });
      }

      const jobs = /(\d+)\s*(?:job|jobs|application|applications)/.exec(r);
      if (jobs) {
        const n = Number(jobs[1]);
        tasks.push({
          id: "jobapps",
          title: `Job applications (x${n})`,
          durationMin: n * 15,
          quota: 1,
          period: "day",
          window: { startMin: hm(9), endMin: hm(23) },
          estimateNote: `≈15 min per application, batched into one ${n * 15}-min block`,
        });
      }

      if (r.includes("soccer")) {
        tasks.push({
          id: "soccer",
          title: "Soccer training",
          durationMin: 120,
          quota: 1,
          period: "day",
          window: { startMin: hm(8), endMin: hm(20, 30) },
          bufferMin: 20,
          estimateNote: "2 h as stated; daylight window + transit buffer",
        });
      }

      const gym = /gym.*?(\d+)\s*(?:x|times)?\s*(?:a|per)?\s*week|(\d+)\s*(?:x|times).*gym/.exec(r);
      if (r.includes("gym")) {
        const n = Number(gym?.[1] ?? gym?.[2] ?? 3);
        tasks.push({
          id: "gym",
          title: "Gym",
          durationMin: 60,
          quota: n,
          period: "week",
          window: { startMin: hm(6), endMin: hm(22) },
          bufferMin: 15,
          nonConsecutiveDays: true,
          estimateNote: "1 h session; rest days between",
        });
      }

      // Deliberately vague -> ask instead of guess (mirrors the clarify path).
      if (tasks.length === 0 && (r.includes("read more") || r.includes("study") || r.includes("learn"))) {
        return {
          kind: "clarify",
          questions: [
            "Roughly how long per session, and how many times a week?",
            "Does it need a quiet focus window, or is any time fine?",
          ],
        };
      }

      if (tasks.length === 0) {
        return {
          kind: "clarify",
          questions: ["What would you like to schedule, and roughly how often?"],
        };
      }

      return { kind: "tasks", tasks };
    },
  };
}
