-- Timeblock — Supabase/Postgres schema (Phase 2 design; applied in Phase 2 wiring).
--
-- Personal-first but multi-user-ready: every row is owned by a user_id and
-- guarded by Row Level Security, so adding accounts later is a config step,
-- not a rewrite. Times are stored the way the engine models them: fixed blocks
-- as minutes-from-midnight + weekday mask; tasks as quota-per-period; generated
-- blocks as absolute timestamps for a concrete plan.

-- ---------------------------------------------------------------------------
-- Fixed commitments (work, sleep, classes) — the immovable walls.
-- ---------------------------------------------------------------------------
create table if not exists fixed_blocks (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references auth.users (id) on delete cascade,
  title       text not null,
  days        smallint[] not null default '{}',   -- 0=Mon..6=Sun; empty = every day
  start_min   int not null check (start_min between 0 and 1440),
  end_min     int not null check (end_min between 0 and 1440),
  created_at  timestamptz not null default now(),
  check (end_min > start_min)
);

-- ---------------------------------------------------------------------------
-- Flexible tasks — what the scheduler fits in. Mirrors the engine `Task`.
-- ---------------------------------------------------------------------------
create table if not exists tasks (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references auth.users (id) on delete cascade,
  title                 text not null,
  duration_min          int not null check (duration_min > 0),
  quota                 int not null check (quota > 0),
  period                text not null check (period in ('day', 'week')),
  window_start_min      int check (window_start_min between 0 and 1440),
  window_end_min        int check (window_end_min between 0 and 1440),
  buffer_min            int not null default 0 check (buffer_min >= 0),
  spread                boolean not null default false,
  non_consecutive_days  boolean not null default false,
  priority              int not null default 0,
  estimate_note         text,                       -- LLM's rationale, for the confirm UI
  active                boolean not null default true,
  created_at            timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Scheduled blocks — the concrete plan the engine produced for the horizon.
-- Regenerated on the nightly re-plan; `status` feeds Phase 5 habit-learning.
-- ---------------------------------------------------------------------------
create table if not exists scheduled_blocks (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references auth.users (id) on delete cascade,
  task_id       uuid references tasks (id) on delete cascade,
  title         text not null,
  starts_at     timestamptz not null,
  ends_at       timestamptz not null,
  status        text not null default 'planned'
                  check (status in ('planned', 'done', 'skipped')),
  actual_min    int check (actual_min > 0),          -- logged actual time (Phase 5)
  created_at    timestamptz not null default now(),
  check (ends_at > starts_at)
);

create index if not exists scheduled_blocks_user_time_idx
  on scheduled_blocks (user_id, starts_at);

-- ---------------------------------------------------------------------------
-- Row Level Security: each user sees only their own rows.
-- ---------------------------------------------------------------------------
alter table fixed_blocks      enable row level security;
alter table tasks             enable row level security;
alter table scheduled_blocks  enable row level security;

do $$
declare t text;
begin
  foreach t in array array['fixed_blocks', 'tasks', 'scheduled_blocks'] loop
    execute format(
      'create policy %1$s_owner on %1$s using (user_id = auth.uid()) with check (user_id = auth.uid());',
      t
    );
  end loop;
end $$;
