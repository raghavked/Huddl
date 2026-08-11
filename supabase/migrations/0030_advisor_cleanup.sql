-- Huddl schema: advisor cleanup after the big push.
--
-- Three findings worth acting on, and a note on the ones deliberately left.

-- 1 · message_bookmarks had no primary key: its subject column alternates
-- (channel message or DM message), so 0027 used two partial uniques instead.
-- Those still enforce one-bookmark-per-message; a surrogate key just gives
-- the row a handle and settles the linter.
alter table public.message_bookmarks
  add column id uuid primary key default gen_random_uuid();

-- 2 · Overlapping permissive policies. focus_sessions and study_buddy_optins
-- each carried a broad SELECT policy plus a FOR ALL owner policy, so every
-- read evaluated both. Split the owner policy into the write actions it was
-- actually there for; the read policy already covers the owner (you are on
-- your own campus, and you are enrolled in your own course).
drop policy "students run their own sessions" on public.focus_sessions;

create policy "students start their own sessions"
  on public.focus_sessions for insert
  to authenticated
  with check (user_id = ( SELECT auth.uid() ));

create policy "students end their own sessions"
  on public.focus_sessions for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

create policy "students delete their own sessions"
  on public.focus_sessions for delete
  to authenticated
  using (user_id = ( SELECT auth.uid() ));

drop policy "students manage their own opt-in" on public.study_buddy_optins;

create policy "students raise their own hand"
  on public.study_buddy_optins for insert
  to authenticated
  with check (user_id = ( SELECT auth.uid() ) and public.is_enrolled(course_id));

create policy "students edit their own note"
  on public.study_buddy_optins for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

create policy "students lower their own hand"
  on public.study_buddy_optins for delete
  to authenticated
  using (user_id = ( SELECT auth.uid() ));

-- 3 · Covering indexes for the foreign keys this push added that sit on a
-- real query or cascade path.
create index if not exists club_announcements_author_idx
  on public.club_announcements (author_id);
create index if not exists grade_categories_course_idx
  on public.grade_categories (course_id);
create index if not exists decks_created_by_idx on public.decks (created_by);
create index if not exists cards_created_by_idx on public.cards (created_by);
create index if not exists dm_threads_created_by_idx
  on public.dm_threads (created_by) where created_by is not null;
create index if not exists event_reminder_sent_user_idx
  on public.event_reminder_sent (user_id);

-- Deliberately left: the event_rsvps SELECT overlap (both policies predate
-- this push and the narrower one is the owner fast path), citext in public
-- (0002, the handle column depends on it), the guarded definer RPCs, and
-- every "unused index" note — this database has no production traffic yet,
-- so usage counters say nothing about whether an index earns its keep.
