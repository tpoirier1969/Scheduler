-- Poirier's Planner task support
-- Run against the SAME Supabase project used by config.js.
-- Safe to re-run.

create extension if not exists pgcrypto;

create table if not exists public.tod_donna_calendar_tasks (
  id uuid primary key default gen_random_uuid(),
  title text not null check (char_length(trim(title)) between 1 and 240),
  notes text,
  person_key text not null default 'shared' references public.tod_donna_calendar_people(person_key),
  task_mode text not null default 'timeless' check (task_mode in ('timeless','from_date','specific_date')),
  task_date date,
  completed boolean not null default false,
  completed_at timestamptz,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tod_donna_calendar_tasks_date_check check (
    (task_mode = 'timeless' and task_date is null)
    or (task_mode in ('from_date','specific_date') and task_date is not null)
  ),
  constraint tod_donna_calendar_tasks_completion_check check (
    (completed = false and completed_at is null)
    or completed = true
  )
);

create index if not exists tod_donna_calendar_tasks_open_idx
  on public.tod_donna_calendar_tasks (completed, task_date, sort_order, created_at);

alter table public.tod_donna_calendar_tasks enable row level security;

drop policy if exists tod_donna_calendar_tasks_all on public.tod_donna_calendar_tasks;
create policy tod_donna_calendar_tasks_all
  on public.tod_donna_calendar_tasks
  for all
  using (true)
  with check (true);

grant select, insert, update, delete on public.tod_donna_calendar_tasks to anon, authenticated;

drop trigger if exists tod_donna_calendar_tasks_touch_updated_at on public.tod_donna_calendar_tasks;
create trigger tod_donna_calendar_tasks_touch_updated_at
before update on public.tod_donna_calendar_tasks
for each row execute function public.tod_donna_calendar_touch_updated_at();
