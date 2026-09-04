-- Poirier's Planner task system
-- Shared-database-safe naming.
-- Creates only scheduler-specific objects.
-- Does not drop tables, indexes, triggers, policies, or data.

create extension if not exists pgcrypto;

create table if not exists public.tod_donna_calendar_tasks (
  id uuid primary key default gen_random_uuid(),

  title text not null,
  notes text,

  person_key text not null
    references public.tod_donna_calendar_people(person_key),

  task_mode text not null default 'timeless'
    check (task_mode in ('timeless', 'from_date', 'specific_date')),

  assigned_date date,

  priority text not null default 'normal'
    check (priority in ('normal', 'important')),

  completed boolean not null default false,
  completed_at timestamptz,

  sort_order integer not null default 0,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint tod_donna_calendar_tasks_date_check
    check (
      (task_mode = 'timeless' and assigned_date is null)
      or
      (task_mode in ('from_date', 'specific_date') and assigned_date is not null)
    )
);

create index if not exists tod_donna_calendar_tasks_open_idx
  on public.tod_donna_calendar_tasks
  (completed, task_mode, assigned_date, person_key, sort_order);

create index if not exists tod_donna_calendar_tasks_date_idx
  on public.tod_donna_calendar_tasks
  (assigned_date);

alter table public.tod_donna_calendar_tasks
  enable row level security;

create policy tod_donna_calendar_tasks_all
  on public.tod_donna_calendar_tasks
  for all
  using (true)
  with check (true);

grant select, insert, update, delete
  on public.tod_donna_calendar_tasks
  to anon, authenticated;
