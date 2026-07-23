-- Migration 004 — optional fixed time-of-day for recurring tasks.
-- When set, every occurrence of the task is pinned to this minute-of-day
-- (e.g. gym 1pm daily). Null = flexible (the scheduler picks the time).
alter table tasks add column if not exists fixed_time_min int
  check (fixed_time_min is null or (fixed_time_min >= 0 and fixed_time_min < 1440));
