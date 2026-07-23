import type { EngineInput } from "../src/types";
import { hm } from "../src/time";

/**
 * Lucas's real week, exactly as described:
 *  - Work: Mon / Wed / Thu, 17:00–20:15
 *  - Sleep: every day, 01:00–09:00
 *  - Wants: 3 leetcode/day, 5 job apps/day, soccer 2h/day, gym 1h x3/week
 *
 * Note the "chunking" (Claude's job upstream) is already applied here:
 *   - "5 job applications a day" -> one 75-min block/day
 *   - "3 leetcode a day"         -> three 30-min blocks/day (spread apart)
 */
export const lucasWeek: EngineInput = {
  horizonDays: 7, // day 0 = Monday
  fixedBlocks: [
    {
      id: "work",
      title: "Work",
      days: [0, 2, 3], // Mon, Wed, Thu
      startMin: hm(17, 0),
      endMin: hm(20, 15),
    },
    {
      id: "sleep",
      title: "Sleep",
      days: [], // every day
      startMin: hm(1, 0),
      endMin: hm(9, 0),
    },
  ],
  tasks: [
    {
      id: "soccer",
      title: "Soccer training",
      durationMin: 120,
      quota: 1,
      period: "day",
      window: { startMin: hm(8, 0), endMin: hm(20, 30) }, // daylight
      bufferMin: 20, // transit to/from the field
    },
    {
      id: "gym",
      title: "Gym",
      durationMin: 60,
      quota: 3,
      period: "week",
      window: { startMin: hm(6, 0), endMin: hm(22, 0) },
      bufferMin: 15, // transit
      nonConsecutiveDays: true,
    },
    {
      id: "jobapps",
      title: "Job applications (x5)",
      durationMin: 75,
      quota: 1,
      period: "day",
      window: { startMin: hm(9, 0), endMin: hm(23, 0) },
    },
    {
      id: "leetcode",
      title: "LeetCode",
      durationMin: 30,
      quota: 3,
      period: "day",
      window: { startMin: hm(9, 0), endMin: hm(23, 0) },
      spread: true,
    },
  ],
};
