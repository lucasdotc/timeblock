-- Fixed schedules (work, sleep, etc.) can optionally be shown on the calendar.
-- They always constrain the scheduler; this flag only controls visibility.
alter table fixed_blocks
  add column if not exists show_on_calendar boolean not null default false;
