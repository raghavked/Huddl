-- Hearth schema: the class agrees on one syllabus, and notes feed decks.
--
-- SYLLABUS CONSENSUS. Until now a second classmate pasting the same
-- syllabus doubled every due date on the shared calendar, and there was no
-- notion of which version the class actually trusts. Now:
--
--   · Every imported item remembers its import (`import_id`). Hand-added
--     items carry null and are always shown.
--   · Classmates endorse an import ("This matches my syllabus"); importing
--     endorses your own automatically. One endorsement per person per
--     import.
--   · THE CALENDAR'S OWN READ POLICY shows only the winning import: most
--     endorsements, earliest import as the tiebreak. This is enforced at
--     the database, so the course calendar, the study plan, the month
--     view, home's "next up", and the reminder sweeps all agree without
--     any of them changing a query. A losing import isn't deleted, it is
--     simply not the class's calendar right now; if endorsements shift,
--     the view shifts with them.
--   · An importer can withdraw their import; its items (and any checkoffs
--     and reminders hanging off them) go with it.
--
-- NOTES BECOME FLASHCARDS. `decks.source_note_id` lets a deck credit the
-- notes it was built from, so "turn these notes into flashcards" is a
-- first-class path: the client creates (or reopens) the note's deck and
-- drops the student into the paste importer.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · items remember their import; importers can withdraw
-- ═══════════════════════════════════════════════════════════════════════

alter table public.course_calendar_items
  add column import_id uuid references public.syllabus_imports(id) on delete cascade;

create index course_calendar_items_import_idx
  on public.course_calendar_items (import_id) where import_id is not null;

create policy "importers can withdraw their import" on public.syllabus_imports
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant delete on public.syllabus_imports to authenticated;
grant insert (import_id) on public.course_calendar_items to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · endorsements: "this matches my syllabus"
-- ═══════════════════════════════════════════════════════════════════════

create table public.syllabus_endorsements (
  import_id uuid not null references public.syllabus_imports(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (import_id, user_id)
);

comment on table public.syllabus_endorsements is
  'One classmate saying one syllabus import matches their copy. The count '
  'decides which import the class calendar shows.';

alter table public.syllabus_endorsements enable row level security;

create policy "classmates can read endorsements" on public.syllabus_endorsements
  for select to authenticated
  using (exists (
    select 1
    from public.syllabus_imports i
    join public.enrollments e on e.course_id = i.course_id
    where i.id = syllabus_endorsements.import_id
      and e.user_id = (select auth.uid())
  ));

create policy "classmates endorse for themselves" on public.syllabus_endorsements
  for insert to authenticated
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1
      from public.syllabus_imports i
      join public.enrollments e on e.course_id = i.course_id
      where i.id = syllabus_endorsements.import_id
        and e.user_id = (select auth.uid())
    )
  );

create policy "endorsers can take it back" on public.syllabus_endorsements
  for delete to authenticated
  using (user_id = (select auth.uid()));

grant select, delete on public.syllabus_endorsements to authenticated;
grant insert (import_id, user_id) on public.syllabus_endorsements to authenticated;

-- Importing is endorsing your own version.
create or replace function public.endorse_own_import()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.syllabus_endorsements (import_id, user_id)
  values (new.id, new.user_id)
  on conflict do nothing;
  return new;
end;
$$;

revoke execute on function public.endorse_own_import() from public, anon, authenticated;

create trigger syllabus_imports_self_endorse
  after insert on public.syllabus_imports
  for each row execute function public.endorse_own_import();

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · the winner, and the read policy that honours it
-- ═══════════════════════════════════════════════════════════════════════

-- SECURITY DEFINER so the calendar's own read policy can call it without
-- the caller needing table access mid-policy; it leaks nothing (an id the
-- caller's own reads could derive) and takes the course id as its only
-- input. Most endorsements wins; the earliest import breaks ties, so a
-- freshly pasted duplicate never displaces the standing version by default.
create or replace function public.winning_syllabus_import(p_course_id uuid)
returns uuid
language sql
stable
security definer
set search_path = public
as $$
  select i.id
  from public.syllabus_imports i
  left join public.syllabus_endorsements e on e.import_id = i.id
  where i.course_id = p_course_id
  group by i.id, i.created_at
  order by count(e.user_id) desc, i.created_at asc, i.id asc
  limit 1;
$$;

grant execute on function public.winning_syllabus_import(uuid) to authenticated;

-- The one-line heart of the feature: hand-added items always, imported
-- items only from the winning import.
drop policy "classmates can read the course calendar" on public.course_calendar_items;
create policy "classmates can read the course calendar" on public.course_calendar_items
  for select to authenticated
  using (
    exists (
      select 1 from public.enrollments e
      where e.course_id = course_calendar_items.course_id
        and e.user_id = (select auth.uid())
    )
    and (
      import_id is null
      or import_id = public.winning_syllabus_import(course_id)
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · decks can credit the notes they came from
-- ═══════════════════════════════════════════════════════════════════════

alter table public.decks
  add column source_note_id uuid references public.notes(id) on delete set null;

grant insert (source_note_id) on public.decks to authenticated;
