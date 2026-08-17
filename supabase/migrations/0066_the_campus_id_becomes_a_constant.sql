-- Hearth at scale: current_university_id() stops running once per row.
--
-- The 40,000-profile load test caught it: the directory search seq-scanned
-- and spent 120,000 buffer reads, because the profiles read policy says
-- `university_id = current_university_id()` and Postgres, unsure the
-- function is stable enough to hoist, called it for EVERY candidate row,
-- each call a fresh lookup of the caller's own profile. 655ms for one
-- search, warm.
--
-- The cure is the same one 0058 applied to the friendships policies: wrap
-- the call as `(select current_university_id())` so the planner runs it
-- ONCE as an InitPlan and compares rows against a constant. That also
-- unlocks the 0065 indexes, since `university_id = $constant` is exactly
-- the shape (university_id, display_name) carries. Same answers, same
-- security, three orders of magnitude fewer function calls.
--
-- Every policy that named the function bare gets the wrap, including the
-- with-check side of single-row writes, so the idiom is uniform and the
-- next reader never wonders which spelling is the fast one.

alter policy "campus reads the board" on public.board_posts
  using (university_id = (select current_university_id()));

alter policy "authors edit their own posts" on public.board_posts
  using (author_id = (select auth.uid()))
  with check (
    author_id = (select auth.uid())
    and university_id = (select current_university_id())
  );

alter policy "channels are visible within own university" on public.channels
  using (university_id = (select current_university_id()));

alter policy "club rosters are visible within own university" on public.club_members
  using (club_university(club_id) = (select current_university_id()));

alter policy "clubs are visible within own university" on public.clubs
  using (university_id = (select current_university_id()));

alter policy "courses are readable within own university" on public.courses
  using (university_id = (select current_university_id()));

alter policy "events are visible within own university" on public.events
  using (university_id = (select current_university_id()));

alter policy "creators can update own events" on public.events
  using (creator_id = (select auth.uid()))
  with check (
    creator_id = (select auth.uid())
    and university_id = (select current_university_id())
    and (club_id is null or is_club_officer(club_id))
  );

alter policy "rsvps are visible with the event" on public.event_rsvps
  using (
    user_id = (select auth.uid())
    or exists (
      select 1 from public.events e
      where e.id = event_rsvps.event_id
        and e.university_id = (select current_university_id())
    )
  );

alter policy "students change their own rsvp" on public.event_rsvps
  using (user_id = (select auth.uid()))
  with check (
    user_id = (select auth.uid())
    and exists (
      select 1 from public.events e
      where e.id = event_rsvps.event_id
        and e.university_id = (select current_university_id())
    )
  );

alter policy "campus can see who's studying right now" on public.focus_sessions
  using (
    user_id = (select auth.uid())
    or (
      ended_at is null
      and not is_private
      and exists (
        select 1 from public.profiles p
        where p.id = focus_sessions.user_id
          and p.university_id = (select current_university_id())
      )
    )
  );

alter policy "profiles are readable within own university" on public.profiles
  using (
    id = (select auth.uid())
    or university_id = (select current_university_id())
  );

alter policy "users can update own profile" on public.profiles
  using (id = (select auth.uid()))
  with check (
    id = (select auth.uid())
    and university_id = (select current_university_id())
  );

alter policy "reporters and moderators read reports" on public.reports
  using (
    reporter_id = (select auth.uid())
    or (
      is_moderator()
      and (
        exists (
          select 1 from public.profiles p
          where p.id = reports.reporter_id
            and p.university_id = (select current_university_id())
        )
        or (
          reporter_id is null
          and exists (
            select 1 from public.profiles p
            where p.id = reports.reported_user_id
              and p.university_id = (select current_university_id())
          )
        )
      )
    )
  );

alter policy "moderators triage the queue" on public.reports
  using (
    is_moderator()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = reports.reporter_id
          and p.university_id = (select current_university_id())
      )
      or (
        reporter_id is null
        and exists (
          select 1 from public.profiles p
          where p.id = reports.reported_user_id
            and p.university_id = (select current_university_id())
        )
      )
    )
  )
  with check (
    is_moderator()
    and (
      exists (
        select 1 from public.profiles p
        where p.id = reports.reporter_id
          and p.university_id = (select current_university_id())
      )
      or (
        reporter_id is null
        and exists (
          select 1 from public.profiles p
          where p.id = reports.reported_user_id
            and p.university_id = (select current_university_id())
        )
      )
    )
  );
