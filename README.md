# Timeblock

An AI-powered time-blocking app. Describe your week in plain English — *"3 leetcode a day, gym twice a week, dentist Tuesday at 3pm"* — and Timeblock turns it into a conflict-free, time-blocked schedule that syncs across web and mobile.

## How it works — the "split brain"

Timeblock deliberately splits language from logic:

- **Claude (the language layer)** reads what you type and turns it into one structured *intent* — add a recurring task, schedule a one-time event, edit a task's time/length/frequency, reorder tasks, or delete something. It estimates durations, chunks work sensibly, and asks a clarifying question when it's genuinely unsure. It never decides exact placement.
- **A deterministic TypeScript engine** does all the actual placement: it lays your fixed commitments (work, sleep) as walls, computes the free gaps, and greedily drops each task into the earliest legal slot — reserving buffers so nothing double-books. Anything that can't fit is surfaced as a conflict, never silently dropped.

LLMs can't reliably pack a week without overlaps; a solver can't understand "a couple leetcode sessions, spaced out." Each half does what it's good at.

```
"gym twice a week"  ─►  Claude  ─►  { task: Gym, 60m, 2×/week, non-consecutive }  ─►  Engine  ─►  Mon 1pm, Thu 1pm
   (natural language)     (parse)          (structured intent)                        (placement)   (conflict-free blocks)
```

## Features

- **Natural-language scheduling** — recurring habits and one-time events from a chat box.
- **Edits by conversation** — *"move gym to 6pm"*, *"make leetcode 45 minutes"*, *"soccer every day now"* (switches cadence daily ↔ weekly), *"gym at 7am"* (pins a fixed time-of-day).
- **Day vs. week scope** — a toggle tells the assistant whether an edit hits today only or the whole week; specific-day edits ("move soccer on Thursday to 3pm") pin just that occurrence.
- **Rearrange by order** — *"do soccer after job applications but before the gym"* reshuffles a day without touching exact times.
- **Overlap handling** — manually moving a block onto another prompts you to either keep them side-by-side or push the other one out of the way; the calendar renders overlaps in columns.
- **Fixed hours** — manage your own work/sleep/class blocks; they always constrain the scheduler and can optionally be drawn on the calendar.
- **Habit learning** — log how long a task actually took and Timeblock suggests adjusting its planned duration.
- **Confirm before it moves things** — pure gap-fill additions apply instantly; anything that shifts existing blocks shows exactly what will move and waits for your OK.
- **Web + mobile** — a Vite/React web app and an Expo (React Native) phone app share the same engine and backend. Mobile adds local reminders 5 minutes before each block.

## Repository layout

```
timeblock/
├── src/                     # Shared, pure scheduling engine (no UI, no network)
│   ├── scheduler.ts         #   core placement algorithm
│   ├── freespace.ts         #   free-gap computation
│   ├── suggest.ts           #   "find another time" slot finder
│   ├── types.ts, time.ts    #   domain model + time helpers
│   └── llm/                 #   language-layer seam (prompt, Anthropic client, mock)
├── app/                     # Web app — Vite + React (port 5174)
│   └── src/                 #   Chat, Calendar, Today, BlockDetail, AddForm, FixedHours, data layer
├── mobile/                  # Phone app — Expo SDK 54 / React Native
│   ├── engine/              #   COPY of src/ (Metro can't reach across roots — keep in sync)
│   └── components/, lib/    #   RN screens + data layer
├── supabase/functions/parse/# Deno Edge Function: holds the Anthropic key, returns the parsed intent
├── db/                      # Postgres schema.sql + numbered migrations (002…005)
├── server/                  # Local Express parse server (dev alternative to the Edge Function)
└── test/                    # vitest suites for the engine + parser
```

## Tech stack

| Layer      | Choice |
|------------|--------|
| Engine     | TypeScript (pure, shared by web + mobile) |
| Language   | Claude (`claude-opus-4-8`) via the Anthropic SDK, structured output with Zod |
| Web        | Vite + React |
| Mobile     | Expo SDK 54 / React Native |
| Backend    | Supabase — Postgres, Auth, Row-Level Security |
| Server LLM | Supabase Edge Function (Deno) so the API key never ships to the client |

## Getting started

### Prerequisites

- Node.js 18+
- A [Supabase](https://supabase.com) project (Postgres + Auth)
- An [Anthropic API key](https://console.anthropic.com)
- For mobile: the **Expo Go** app on your phone (this project targets **SDK 54** — modern Expo Go supports only one SDK at a time)

### 1. Configure environment

Copy the example and fill in real values (all `.env` files are git-ignored):

```bash
cp .env.example .env
```

- **Root `.env`** — `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (server-side only — bypasses RLS, never ship it to a client), and a `TEST_USER_EMAIL` / `TEST_USER_PASSWORD` for headless scripts.
- **`app/.env`** — `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **`mobile/.env`** — `EXPO_PUBLIC_SUPABASE_URL`, `EXPO_PUBLIC_SUPABASE_ANON_KEY`.

### 2. Set up the database

Run the schema, then each numbered migration in order, against your Supabase project (SQL editor, or the CLI):

```bash
# schema.sql, then 002_interactive.sql, 003_events.sql, 004_fixed_time.sql, 005_fixed_show.sql
npx supabase db query --linked -f db/schema.sql
```

### 3. Deploy the parse Edge Function

The web and mobile apps call a Supabase Edge Function so the Anthropic key stays server-side:

```bash
# set the key as a function secret, then deploy
npx supabase secrets set ANTHROPIC_API_KEY=sk-ant-...
npx supabase functions deploy parse --project-ref <your-project-ref>
```

### 4. Run the apps

```bash
# Engine tests
npm install
npm test                 # vitest — engine + parser suites
npm run check            # type-check the engine

# Web app  →  http://localhost:5174
cd app && npm install && npm run dev

# Mobile app  →  scan the QR with Expo Go
cd mobile && npm install && npm start
```

There's also a **local parse server** (`npm run server`, Express on :8787) as a drop-in alternative to the deployed Edge Function during development — same request/response shape, so switching is a one-line URL change.

## Database model

Three owned, RLS-guarded tables (every row keyed by `user_id`):

- **`fixed_blocks`** — immovable commitments (work, sleep, classes). The walls the scheduler packs around; `show_on_calendar` controls visibility.
- **`tasks`** — flexible things to fit in: `duration_min`, `quota`, `period` (`day`/`week`), optional `window`, `fixed_time_min`, buffers, and non-consecutive-day preferences.
- **`scheduled_blocks`** — the placed plan. `pinned` blocks (one-time events, manually-timed occurrences) are never moved by a re-plan; `status` tracks planned / done / skipped and `actual_min` feeds habit learning.

Times are stored the way the engine models them — minutes from midnight, on a single absolute timeline where day 0 is Monday.

## Security notes

- **Never commit secrets.** `.env` files are git-ignored; the `service_role` key bypasses Row-Level Security and must stay server-side only.
- The Anthropic key lives only in the Edge Function's secrets and the root `.env` — it is never bundled into the web or mobile client.
- If you keep a local database-password scratch file, add it to `.gitignore` too.

## Scripts reference

| Command | Where | What |
|---------|-------|------|
| `npm test` / `npm run test:watch` | root | Run the vitest engine + parser suites |
| `npm run check` | root | Type-check the engine |
| `npm run demo` | root | Run the engine against a sample week |
| `npm run server` | root | Local Express parse server (:8787) |
| `npm run dev` | `app/` | Web app dev server (:5174) |
| `npm run build` / `preview` | `app/` | Production build / preview |
| `npm start` | `mobile/` | Expo dev server (scan QR with Expo Go) |
| `npm run ios` / `android` / `web` | `mobile/` | Launch Expo on a specific target |
