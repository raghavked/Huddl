-- Hearth at scale: the syllabus winner stops being recomputed per row.
--
-- 0061 put `winning_syllabus_import(course_id)` inside the calendar's read
-- policy, which is correct and, at one campus's row counts, fast. But the
-- function aggregates imports and endorsements, and the policy calls it for
-- EVERY item row a query touches: a study plan spanning five courses with
-- sixty items apiece runs the aggregation three hundred times. At 40,000
-- students that arithmetic stops being free.
--
-- The winner changes only when an import or an endorsement changes, which
-- is rare and human-paced, so it becomes a column: `courses.
-- winning_import_id`, recomputed by trigger on exactly those four events.
-- `winning_syllabus_import()` keeps its name and its callers (the policy,
-- both clients' RPC) and becomes a primary-key lookup. Same answers, same
-- tiebreak, O(1) per row.

alter table public.courses add column winning_import_id uuid;

comment on column public.courses.winning_import_id is
  'The syllabus import the class calendar shows: most endorsements, then '
  'earliest, then smallest id. Maintained by trigger on syllabus_imports '
  'and syllabus_endorsements; never written by clients.';

-- The one true aggregation, now called only when something actually changed.
create or replace function public.recompute_winning_import(p_course_id uuid)
returns void
language sql
security definer
set search_path = public
as $$
  update public.courses c
     set winning_import_id = (
       select i.id
       from public.syllabus_imports i
       left join public.syllabus_endorsements e on e.import_id = i.id
       where i.course_id = p_course_id
       group by i.id, i.created_at
       order by count(e.user_id) desc, i.created_at asc, i.id asc
       limit 1
     )
   where c.id = p_course_id;
$$;

revoke execute on function public.recompute_winning_import(uuid) from public, anon, authenticated;

create or replace function public.refresh_winner_from_imports()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform public.recompute_winning_import(coalesce(new.course_id, old.course_id));
  return coalesce(new, old);
end;
$$;

create or replace function public.refresh_winner_from_endorsements()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_course uuid;
begin
  select i.course_id into v_course
  from public.syllabus_imports i
  where i.id = coalesce(new.import_id, old.import_id);
  if v_course is not null then
    perform public.recompute_winning_import(v_course);
  end if;
  return coalesce(new, old);
end;
$$;

revoke execute on function public.refresh_winner_from_imports() from public, anon, authenticated;
revoke execute on function public.refresh_winner_from_endorsements() from public, anon, authenticated;

create trigger syllabus_imports_refresh_winner
  after insert or delete on public.syllabus_imports
  for each row execute function public.refresh_winner_from_imports();

create trigger syllabus_endorsements_refresh_winner
  after insert or delete on public.syllabus_endorsements
  for each row execute function public.refresh_winner_from_endorsements();

-- Backfill whatever exists, then swap the hot function to the O(1) lookup.
do $$
declare r record;
begin
  for r in select distinct course_id from public.syllabus_imports loop
    perform public.recompute_winning_import(r.course_id);
  end loop;
end $$;

create or replace function public.winning_syllabus_import(p_course_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select c.winning_import_id from public.courses c where c.id = p_course_id;
$$;
