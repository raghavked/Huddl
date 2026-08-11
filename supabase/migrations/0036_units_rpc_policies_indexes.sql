-- Huddl schema: the audit round. One latent data-loss trap, two RLS policies
-- that were being evaluated twice per read, and the foreign keys that never
-- got a covering index.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · update_course_details had grown a second signature, and the pair of
--     them was a trap.
--
--     Migration 0032 added a five-argument version (…, p_units) without
--     removing the four-argument one, so both exist. PostgREST picks by the
--     keys in the request body, and every caller in both clients sends four
--     keys — so the five-argument version has never once run, and the units
--     column it was added to write has no writer at all.
--
--     The trap is what happens to whoever tidies this up. The five-argument
--     body sets `units = p_units` unconditionally with `p_units` defaulting
--     to null, so the moment the four-argument overload is dropped, every
--     existing save — a student fixing a room number — silently erases that
--     course's units for the whole class, and the semester GPA quietly stops
--     being weighted.
--
--     So: drop the overload rather than the original, and give units its own
--     RPC. It is a different concern anyway. Instructor, room and meeting
--     time are the front-matter of a course; units feed the GPA maths, want
--     their own validation, and want to be clearable on purpose rather than
--     by omission.
-- ═══════════════════════════════════════════════════════════════════════

drop function public.update_course_details(uuid, text, text, text, numeric);

comment on function public.update_course_details(uuid, text, text, text) is
  'The four front-matter columns on a shared course row, editable by anyone enrolled. Units are deliberately NOT here — see set_course_units, which exists so that saving a room number can never blank the number the GPA is weighted by.';

-- Units, on their own, explicitly. Null is a real value and means "nobody
-- knows yet" — the semester screen already renders that honestly rather than
-- guessing a default, so clearing has to stay possible.
create or replace function public.set_course_units(
  p_course_id uuid,
  p_units numeric
)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;

  -- Same gate as the details RPC: this is a shared row, and the people who
  -- may correct it are the people taking the class.
  if not exists (
    select 1 from public.enrollments e
    where e.course_id = p_course_id and e.user_id = v_uid
  ) then
    raise exception 'join the course before editing its details';
  end if;

  if p_units is not null and (p_units < 0.5 or p_units > 30) then
    raise exception 'units run 0.5 to 30';
  end if;

  update public.courses set units = p_units where id = p_course_id;
end;
$$;

comment on function public.set_course_units(uuid, numeric) is
  'Set or clear courses.units, for anyone enrolled. Null clears it, which the semester overview reports as "missing its units" rather than papering over with a default.';

revoke execute on function public.set_course_units(uuid, numeric) from public, anon;
grant execute on function public.set_course_units(uuid, numeric) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Two tables were evaluating two permissive SELECT policies per read.
--     Postgres ORs them together, so the visible behaviour is unchanged by
--     merging — it just stops running both on every row.
-- ═══════════════════════════════════════════════════════════════════════

-- reports: 0034 added the moderator policy next to the existing reporter one.
drop policy "moderators read the queue" on public.reports;
drop policy "reporters can see their own reports" on public.reports;

create policy "reporters and moderators read reports"
  on public.reports for select
  to authenticated
  using (
    reporter_id = ( SELECT auth.uid() )
    or public.is_moderator()
  );

-- event_rsvps: "students manage own rsvps" is FOR ALL, so it was also
-- answering every SELECT alongside the campus-visibility policy. Narrow it to
-- the writes it was actually for, and fold your own rows into the one read
-- policy so nothing you can see today disappears.
drop policy "students manage own rsvps" on public.event_rsvps;
drop policy "rsvps are visible with the event" on public.event_rsvps;

create policy "rsvps are visible with the event"
  on public.event_rsvps for select
  to authenticated
  using (
    user_id = ( SELECT auth.uid() )
    or exists (
      select 1 from public.events e
      where e.id = event_rsvps.event_id
        and e.university_id = public.current_university_id()
    )
  );

create policy "students add their own rsvp"
  on public.event_rsvps for insert
  to authenticated
  with check (user_id = ( SELECT auth.uid() ));

create policy "students change their own rsvp"
  on public.event_rsvps for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

create policy "students withdraw their own rsvp"
  on public.event_rsvps for delete
  to authenticated
  using (user_id = ( SELECT auth.uid() ));

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · Covering indexes for foreign keys that never had one. Most of these
--     only matter on a cascade delete, but three are on read paths that now
--     exist: the moderation queue joins reports to its subjects, the
--     availability poll points at an event, and the semester overview groups
--     courses by term.
-- ═══════════════════════════════════════════════════════════════════════

create index if not exists reports_message_idx
  on public.reports (message_id) where message_id is not null;
create index if not exists reports_reported_user_idx
  on public.reports (reported_user_id) where reported_user_id is not null;
create index if not exists availability_polls_event_idx
  on public.availability_polls (event_id) where event_id is not null;
create index if not exists courses_term_idx
  on public.courses (term_id) where term_id is not null;

-- The rest are delete-path only, but an unindexed FK turns "delete my
-- account" into a sequential scan per table, and that is the one operation
-- that must never time out.
create index if not exists channels_created_by_idx on public.channels (created_by);
create index if not exists clubs_created_by_idx on public.clubs (created_by);
create index if not exists course_calendar_created_by_idx
  on public.course_calendar_items (created_by);
create index if not exists course_links_added_by_idx on public.course_links (added_by);
create index if not exists events_creator_idx on public.events (creator_id);
create index if not exists messages_pinned_by_idx
  on public.messages (pinned_by) where pinned_by is not null;
create index if not exists polls_creator_idx on public.polls (creator_id);
create index if not exists schedule_uploads_user_idx on public.schedule_uploads (user_id);
create index if not exists syllabus_imports_user_idx on public.syllabus_imports (user_id);

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · One note, so the next audit does not re-raise it. event_reminder_sent
--     has RLS on and no policies, which the linter flags. That is the
--     intent: it is cron bookkeeping, written only by a security-definer
--     sweep, and no student has any business reading which reminders have
--     gone out. Deny-all is the correct policy set, and the empty set is how
--     you spell it.
-- ═══════════════════════════════════════════════════════════════════════

comment on table public.event_reminder_sent is
  'Bookkeeping for the event-reminder cron: one row per reminder already delivered, so a re-run cannot buzz the same person twice. RLS is on with no policies ON PURPOSE — the only writer is the security-definer sweep, and deny-all for everyone else is exactly right.';
