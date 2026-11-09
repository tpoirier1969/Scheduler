-- REVIEW ONLY: apply to an isolated database first. No existing rows are rewritten.
begin;
alter table public.tod_donna_calendar_events add column if not exists archived_from date;
alter table public.tod_donna_calendar_events add column if not exists cancellation_from date;
alter table public.tod_donna_calendar_event_exceptions add column if not exists occurrence_status text check (occurrence_status in ('scheduled','cancelled','no_show'));
alter table public.tod_donna_calendar_event_exceptions add column if not exists hidden boolean not null default false;
alter table public.tod_donna_calendar_tasks add column if not exists archived boolean not null default false;
-- One RPC is one transaction. Compare the entire original row, including timestamps.
-- No SECURITY DEFINER: existing table permissions and RLS remain in force.
create or replace function public.tod_donna_calendar_write(p_changes jsonb)
returns jsonb language plpgsql security invoker set search_path = public, pg_temp as $$
declare c jsonb; current_row jsonb; saved jsonb; result jsonb := '[]';
 parent_row jsonb; children jsonb;
 t text; cols text; vals text; assignments text; merged jsonb;
begin
 if jsonb_typeof(p_changes) <> 'array' or jsonb_array_length(p_changes) not between 1 and 2000 then raise exception 'Invalid change batch'; end if;
 -- Serialize this app's mutations, including absent-row inserts and student list changes.
 perform pg_advisory_xact_lock(94612034);
 for c in select value from jsonb_array_elements(p_changes) loop
  t := c->>'table';
  if t not in ('tod_donna_calendar_events','tod_donna_calendar_event_exceptions','tod_donna_calendar_active_students','tod_donna_calendar_tasks') then raise exception 'Unsupported table'; end if;
  execute format('select to_jsonb(t) from public.%I t where id=$1 for update',t) into current_row using (c->>'id')::uuid;
  if c ? 'parent_expected' then
   select to_jsonb(e) into parent_row from public.tod_donna_calendar_events e where id=coalesce(c->'patch'->>'parent_event_id',current_row->>'parent_event_id')::uuid for update;
   if parent_row is distinct from nullif(c->'parent_expected','null'::jsonb) then raise exception 'The recurring series changed. Refresh before saving.'; end if;
  end if;
  if c ? 'expected_children' then
   perform 1 from public.tod_donna_calendar_event_exceptions where parent_event_id=(c->>'id')::uuid for update;
   select coalesce(jsonb_agg(to_jsonb(e) order by id),'[]') into children from public.tod_donna_calendar_event_exceptions e where parent_event_id=(c->>'id')::uuid;
   if children is distinct from c->'expected_children' then raise exception 'An occurrence changed on another device. Refresh before cancelling the series.'; end if;
  end if;
  if current_row is distinct from nullif(c->'expected','null'::jsonb) then raise exception 'This record changed on another device. Close the editor, refresh and try again.'; end if;
  if c->>'operation' = 'remove_new' then
   -- Only used to undo creation; callers must supply the exact current row.
   if current_row is null then raise exception 'Record missing'; end if;
   if t='tod_donna_calendar_events' and exists(select 1 from public.tod_donna_calendar_event_exceptions where parent_event_id=(c->>'id')::uuid) then raise exception 'Cannot undo creation: this series now has occurrence changes.'; end if;
   execute format('delete from public.%I where id=$1',t) using (c->>'id')::uuid;
   saved := null;
  else
   if jsonb_typeof(c->'patch') <> 'object' then raise exception 'Invalid patch'; end if;
   if exists(select 1 from jsonb_object_keys(c->'patch') k where k not in (select column_name from information_schema.columns where table_schema='public' and table_name=t)) then raise exception 'Unknown column'; end if;
   merged := coalesce(current_row,'{}') || (c->'patch') || jsonb_build_object('id',(c->>'id')::uuid);
   if current_row is not null then
    merged := merged || jsonb_build_object('created_at',current_row->'created_at');
    if current_row ? 'updated_at' then merged := merged || jsonb_build_object('updated_at',clock_timestamp()); end if;
   end if;
   select string_agg(format('%I',key),','), string_agg(format('(jsonb_populate_record(null::public.%I,$1)).%I',t,key),','), string_agg(format('%I=(jsonb_populate_record(null::public.%I,$1)).%I',key,t,key),',') into cols,vals,assignments from jsonb_object_keys(merged) key;
   if current_row is null then
    execute format('insert into public.%I (%s) select %s returning to_jsonb(%I.*)',t,cols,vals,t) into saved using merged;
   else
    execute format('update public.%I set %s where id=$2 returning to_jsonb(%I.*)',t,assignments,t) into saved using merged,(c->>'id')::uuid;
   end if;
  end if;
  result := result || jsonb_build_array(jsonb_build_object('table',t,'before',current_row,'after',saved));
 end loop;
 return result;
end $$;
revoke all on function public.tod_donna_calendar_write(jsonb) from public;
grant execute on function public.tod_donna_calendar_write(jsonb) to anon, authenticated;
commit;
