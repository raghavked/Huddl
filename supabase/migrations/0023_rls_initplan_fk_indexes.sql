-- Huddl schema: performance-advisor sweep. Two classes of fix:
--
-- 1 · auth_rls_initplan — every policy that calls auth.uid() bare re-runs it
--     per row; wrapping it as a scalar subquery makes Postgres evaluate it
--     once per statement. Rewritten mechanically from pg_policies so all 50+
--     policies get the same treatment (run once: reapplying would nest the
--     wrapper — harmless but ugly).
--
-- 2 · unindexed_foreign_keys — covering indexes for the FKs behind real
--     query paths and heavy cascades. Cold audit/creator columns are left
--     unindexed on purpose; indexes cost writes.
--
-- Accepted advisor leftovers: citext in public (0002, handle depends on it),
-- the intentional guarded definer RPCs, the event_rsvps manage-own/select
-- policy overlap, and "unused index" notes on a pre-launch database.

do $$
declare
  pol record;
  cmd text;
begin
  for pol in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname = 'public'
      and (coalesce(qual, '') like '%auth.uid()%'
        or coalesce(with_check, '') like '%auth.uid()%')
  loop
    cmd := format('alter policy %I on %I.%I',
                  pol.policyname, pol.schemaname, pol.tablename);
    if pol.qual is not null then
      cmd := cmd || format(' using (%s)',
                           replace(pol.qual, 'auth.uid()', '( SELECT auth.uid() )'));
    end if;
    if pol.with_check is not null then
      cmd := cmd || format(' with check (%s)',
                           replace(pol.with_check, 'auth.uid()', '( SELECT auth.uid() )'));
    end if;
    execute cmd;
  end loop;
end $$;

-- Hot-path FK indexes.
create index if not exists blocks_blocked_idx on public.blocks (blocked_id);
create index if not exists events_course_idx on public.events (course_id) where course_id is not null;
create index if not exists events_club_idx on public.events (club_id) where club_id is not null;
create index if not exists event_rsvps_user_idx on public.event_rsvps (user_id);
create index if not exists poll_votes_user_idx on public.poll_votes (user_id);
create index if not exists polls_channel_idx on public.polls (channel_id);
create index if not exists messages_poll_idx on public.messages (poll_id) where poll_id is not null;
create index if not exists study_checkoffs_item_idx on public.study_checkoffs (item_id);
create index if not exists enrollments_catalog_course_idx on public.enrollments (catalog_course_id) where catalog_course_id is not null;
create index if not exists syllabus_imports_course_idx on public.syllabus_imports (course_id);
create index if not exists message_reactions_user_idx on public.message_reactions (user_id);
create index if not exists notes_uploader_idx on public.notes (uploader_id);
