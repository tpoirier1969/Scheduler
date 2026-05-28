-- Our Scheduler shared calendar schema
-- All database objects are project-scoped with tod_donna_calendar_ to avoid collisions.

create extension if not exists pgcrypto;

create table if not exists public.tod_donna_calendar_people (
  id uuid primary key default gen_random_uuid(),
  person_key text not null unique check (person_key in ('donna','tod','frank','shared')),
  display_name text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);

create table if not exists public.tod_donna_calendar_presets (
  id uuid primary key default gen_random_uuid(),
  person_key text not null references public.tod_donna_calendar_people(person_key) on delete cascade,
  preset_name text not null,
  default_color_hex text not null,
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  unique(person_key, preset_name)
);

create table if not exists public.tod_donna_calendar_events (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  person_key text not null references public.tod_donna_calendar_people(person_key),
  preset_name text not null,
  status text not null default 'scheduled' check (status in ('scheduled','no_show','cancelled')),
  event_date date not null,
  start_time time not null,
  end_time time not null,
  is_all_day boolean not null default false,
  color_hex text not null default '#c8dff0',
  notes text,
  recurrence_rule jsonb,
  imported_source text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint tod_donna_calendar_events_time_check check (end_time > start_time)
);


-- V1.29: support untimed all-day events such as birthdays and annual reminders.
alter table public.tod_donna_calendar_events
  add column if not exists is_all_day boolean not null default false;

create table if not exists public.tod_donna_calendar_event_exceptions (
  id uuid primary key default gen_random_uuid(),
  parent_event_id uuid not null references public.tod_donna_calendar_events(id) on delete cascade,
  original_event_date date not null,
  exception_status text not null check (exception_status in ('moved','cancelled','modified')),
  new_event_date date,
  new_start_time time,
  new_end_time time,
  new_title text,
  new_notes text,
  created_at timestamptz not null default now(),
  unique(parent_event_id, original_event_date)
);

create table if not exists public.tod_donna_calendar_import_log (
  id uuid primary key default gen_random_uuid(),
  import_name text not null,
  source_filename text,
  imported_event_count integer not null default 0,
  warning_count integer not null default 0,
  warnings jsonb,
  created_at timestamptz not null default now()
);

create or replace function public.tod_donna_calendar_touch_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

drop trigger if exists tod_donna_calendar_events_touch_updated_at on public.tod_donna_calendar_events;
create trigger tod_donna_calendar_events_touch_updated_at
before update on public.tod_donna_calendar_events
for each row execute function public.tod_donna_calendar_touch_updated_at();

insert into public.tod_donna_calendar_people (person_key, display_name, sort_order) values
  ('donna','Donna',1),
  ('tod','Tod',2),
  ('frank','Frank',3),
  ('shared','Shared',4)
on conflict (person_key) do update set display_name=excluded.display_name, sort_order=excluded.sort_order;

insert into public.tod_donna_calendar_presets (person_key, preset_name, default_color_hex, sort_order) values
  ('donna','Class','#f5c6d6',1),('donna','Lesson','#c8dff0',2),('donna','Rehearsal','#d8c7ef',3),('donna','Meeting','#cde8d1',4),('donna','Performance','#f8d7a8',5),('donna','No-show','#ffd6cc',6),('donna','Other','#d7e7e4',7),
  ('tod','Meeting','#d8dde2',1),('tod','Event','#b6c1cc',2),('tod','Appointment','#8f9aa3',3),('tod','Other','#60707a',4),
  ('frank','Doctor','#c9b18f',1),('frank','Hair','#b99767',2),('frank','Church','#b9aa7f',3),('frank','Appointment','#9f7f55',4),('frank','Other','#7d6a55',5),
  ('shared','Camping','#b7d4c5',1),('shared','Roadtrip','#9eb7c7',2),('shared','Shopping','#e3c97f',3),('shared','Friends','#d3b4c6',4),('shared','Family','#c79c8a',5),('shared','Other','#a8bfa0',6)
on conflict (person_key, preset_name) do update set default_color_hex=excluded.default_color_hex, sort_order=excluded.sort_order;

-- Basic grants for browser app use. Tighten with RLS/auth later if desired.
alter table public.tod_donna_calendar_people enable row level security;
alter table public.tod_donna_calendar_presets enable row level security;
alter table public.tod_donna_calendar_events enable row level security;
alter table public.tod_donna_calendar_event_exceptions enable row level security;
alter table public.tod_donna_calendar_import_log enable row level security;

drop policy if exists tod_donna_calendar_people_read on public.tod_donna_calendar_people;
create policy tod_donna_calendar_people_read on public.tod_donna_calendar_people for select using (true);

drop policy if exists tod_donna_calendar_presets_read on public.tod_donna_calendar_presets;
create policy tod_donna_calendar_presets_read on public.tod_donna_calendar_presets for select using (true);

drop policy if exists tod_donna_calendar_events_all on public.tod_donna_calendar_events;
create policy tod_donna_calendar_events_all on public.tod_donna_calendar_events for all using (true) with check (true);

drop policy if exists tod_donna_calendar_event_exceptions_all on public.tod_donna_calendar_event_exceptions;
create policy tod_donna_calendar_event_exceptions_all on public.tod_donna_calendar_event_exceptions for all using (true) with check (true);

drop policy if exists tod_donna_calendar_import_log_all on public.tod_donna_calendar_import_log;
create policy tod_donna_calendar_import_log_all on public.tod_donna_calendar_import_log for all using (true) with check (true);

-- V1.22: active Donna student quick-add list with standard lesson time
-- Project-scoped table name avoids collisions with other Supabase projects.
create table if not exists public.tod_donna_calendar_active_students (
  id uuid primary key default gen_random_uuid(),
  student_group text not null default 'Active Students',
  student_name text not null,
  standard_lesson_minutes integer not null default 30 check (standard_lesson_minutes in (30, 60)),
  sort_order integer not null default 0,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (student_group, student_name)
);

-- If the earlier V1.18 semester table exists, copy its active names forward once.
do $$
begin
  if to_regclass('public.tod_donna_calendar_student_quick_adds') is not null then
    insert into public.tod_donna_calendar_active_students (student_group, student_name, standard_lesson_minutes, sort_order, is_active)
    select coalesce(nullif(semester_name,''),'Active Students'), student_name, 30, sort_order, is_active
    from public.tod_donna_calendar_student_quick_adds
    where is_active = true
    on conflict (student_group, student_name) do update
      set sort_order = excluded.sort_order, is_active = excluded.is_active;
  end if;
end $$;

create index if not exists tod_donna_calendar_active_students_idx
  on public.tod_donna_calendar_active_students (is_active, sort_order, student_name);

alter table public.tod_donna_calendar_active_students enable row level security;

drop policy if exists tod_donna_calendar_active_students_all on public.tod_donna_calendar_active_students;
create policy tod_donna_calendar_active_students_all
  on public.tod_donna_calendar_active_students
  for all
  using (true)
  with check (true);

drop trigger if exists tod_donna_calendar_active_students_touch_updated_at on public.tod_donna_calendar_active_students;
create trigger tod_donna_calendar_active_students_touch_updated_at
before update on public.tod_donna_calendar_active_students
for each row execute function public.tod_donna_calendar_touch_updated_at();


-- V1.22 migration for projects that already created the V1.21 table.
alter table public.tod_donna_calendar_active_students
  add column if not exists standard_lesson_minutes integer not null default 30;

alter table public.tod_donna_calendar_active_students
  drop constraint if exists tod_donna_calendar_active_students_standard_lesson_minutes_check;

alter table public.tod_donna_calendar_active_students
  add constraint tod_donna_calendar_active_students_standard_lesson_minutes_check
  check (standard_lesson_minutes in (30, 60));
