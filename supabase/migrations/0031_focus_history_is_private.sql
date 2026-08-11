-- Huddl schema: a focus session is public while you are sitting in it, and
-- private the moment you stand up.
--
-- 0028's read policy granted campus-wide SELECT on every focus_sessions row,
-- open and closed. The app only ever renders open ones, but the closed rows
-- were reachable through the API and over realtime — a classmate's whole
-- study log: 3am start times, durations, courses, and the free-text note.
-- The point of the table was "you are not studying alone right now", never
-- "here is my history". Closed rows are yours alone; the streak query
-- already reads them scoped to the caller on both clients.

drop policy "campus can see who's studying" on public.focus_sessions;

create policy "campus can see who's studying right now"
  on public.focus_sessions for select
  to authenticated
  using (
    user_id = ( SELECT auth.uid() )
    or (
      ended_at is null
      and exists (
        select 1 from public.profiles p
        where p.id = focus_sessions.user_id
          and p.university_id = public.current_university_id()
      )
    )
  );
