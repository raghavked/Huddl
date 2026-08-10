-- Huddl schema: the big slate. Group DMs, focus sessions ("studying now"),
-- a private grade tracker, club announcements, study-buddy opt-ins, and
-- course archiving. Each feature is small on its own; together they fill
-- the last obvious gaps in campus life.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · Group DMs. A thread grows past two people, gets a name, and anyone
--     in it can add a classmate or slip out.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.dm_threads add column is_group boolean not null default false;
alter table public.dm_threads add column title text;
alter table public.dm_threads add column created_by uuid references public.profiles(id) on delete set null;

comment on column public.dm_threads.is_group is
  'A named thread with 3+ people. 1:1 threads stay is_group = false so find-or-create never collides with a group.';

-- Groups can be renamed by anyone inside them; 1:1 threads have no name.
create policy "participants can rename their group"
  on public.dm_threads for update
  to authenticated
  using (is_group and public.is_dm_participant(id))
  with check (is_group and public.is_dm_participant(id));

-- 1:1 find-or-create must never return a group that happens to hold both
-- people — the not-is_group guard is the whole fix.
create or replace function public.create_dm_thread(other_user uuid)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  thread uuid;
begin
  if other_user = auth.uid() then
    raise exception 'Cannot start a DM with yourself';
  end if;
  if not exists (select 1 from public.profiles where id = other_user) then
    raise exception 'No such user';
  end if;
  if public.is_blocked_either(auth.uid(), other_user) then
    raise exception 'You can''t message this person';
  end if;

  select p1.thread_id into thread
  from public.dm_participants p1
  join public.dm_participants p2 on p1.thread_id = p2.thread_id
  join public.dm_threads t on t.id = p1.thread_id
  where p1.user_id = auth.uid() and p2.user_id = other_user
    and not t.is_group;

  if thread is null then
    insert into public.dm_threads default values returning id into thread;
    insert into public.dm_participants (thread_id, user_id)
    values (thread, auth.uid()), (thread, other_user);
  end if;
  return thread;
end;
$$;

create or replace function public.create_group_thread(p_title text, p_user_ids uuid[])
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_university uuid;
  v_thread uuid;
  v_other uuid;
  v_count int;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if p_title is null or char_length(trim(p_title)) not between 2 and 60 then
    raise exception 'group names run 2-60 characters';
  end if;

  -- Dedupe, drop the caller, and count what's actually left.
  select array_agg(distinct u) into p_user_ids
  from unnest(coalesce(p_user_ids, '{}'::uuid[])) u
  where u <> v_uid;

  v_count := coalesce(array_length(p_user_ids, 1), 0);
  if v_count < 2 or v_count > 15 then
    raise exception 'groups hold 3-16 people including you';
  end if;

  select university_id into v_university from public.profiles where id = v_uid;

  foreach v_other in array p_user_ids loop
    if not exists (
      select 1 from public.profiles p
      where p.id = v_other and p.university_id = v_university
    ) then
      raise exception 'everyone in a group has to be on your campus';
    end if;
    if public.is_blocked_either(v_uid, v_other) then
      raise exception 'someone in that list can''t be added';
    end if;
  end loop;

  insert into public.dm_threads (is_group, title, created_by)
  values (true, trim(p_title), v_uid)
  returning id into v_thread;

  insert into public.dm_participants (thread_id, user_id)
  select v_thread, v_uid
  union all
  select v_thread, u from unnest(p_user_ids) u;

  return v_thread;
end;
$$;

comment on function public.create_group_thread(text, uuid[]) is
  'Starts a named group thread with 2-15 campus classmates plus the caller. Blocked pairs are refused.';

create or replace function public.add_to_group_thread(p_thread_id uuid, p_user_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_university uuid;
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not public.is_dm_participant(p_thread_id) then
    raise exception 'you''re not in this group';
  end if;
  if not exists (
    select 1 from public.dm_threads t where t.id = p_thread_id and t.is_group
  ) then
    raise exception 'only groups take more people';
  end if;
  if (select count(*) from public.dm_participants where thread_id = p_thread_id) >= 16 then
    raise exception 'this group is full at 16';
  end if;

  select university_id into v_university from public.profiles where id = v_uid;
  if not exists (
    select 1 from public.profiles p
    where p.id = p_user_id and p.university_id = v_university
  ) then
    raise exception 'everyone in a group has to be on your campus';
  end if;
  if public.is_blocked_either(v_uid, p_user_id) then
    raise exception 'that person can''t be added';
  end if;

  insert into public.dm_participants (thread_id, user_id)
  values (p_thread_id, p_user_id)
  on conflict do nothing;
end;
$$;

create or replace function public.leave_group_thread(p_thread_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'not signed in';
  end if;
  if not exists (
    select 1 from public.dm_threads t where t.id = p_thread_id and t.is_group
  ) then
    raise exception 'you can only leave a group';
  end if;
  delete from public.dm_participants
  where thread_id = p_thread_id and user_id = v_uid;
end;
$$;

revoke execute on function public.create_group_thread(text, uuid[]) from public, anon;
grant execute on function public.create_group_thread(text, uuid[]) to authenticated;
revoke execute on function public.add_to_group_thread(uuid, uuid) from public, anon;
grant execute on function public.add_to_group_thread(uuid, uuid) to authenticated;
revoke execute on function public.leave_group_thread(uuid) from public, anon;
grant execute on function public.leave_group_thread(uuid) to authenticated;

-- Group messages announce the room, not just the sender.
create or replace function public.notify_dm_message()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select p.user_id, 'dm',
         case
           when t.is_group
             then coalesce(t.title, 'Group') || ' · ' || pr.display_name
           else 'New message from ' || pr.display_name
         end,
         left(new.content, 140),
         '/messages/' || new.thread_id
  from public.dm_participants p
  join public.dm_threads t on t.id = p.thread_id
  join public.profiles pr on pr.id = new.author_id
  where p.thread_id = new.thread_id
    and p.user_id <> new.author_id
    and not public.is_blocked_either(p.user_id, new.author_id);
  return new;
end;
$$;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Focus sessions. "I'm studying right now" — optionally for a course,
--     so classmates can see they're not alone in it.
-- ═══════════════════════════════════════════════════════════════════════

create table public.focus_sessions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.profiles(id) on delete cascade,
  course_id    uuid references public.courses(id) on delete set null,
  goal_minutes integer not null default 25 check (goal_minutes between 5 and 240),
  note         text check (note is null or char_length(note) <= 80),
  started_at   timestamptz not null default now(),
  ended_at     timestamptz
);

comment on table public.focus_sessions is
  'A student sitting down to work. Open rows (ended_at is null) are the "studying now" list; closed rows are the quiet history behind the streak.';

create index focus_sessions_open_idx
  on public.focus_sessions (course_id, started_at desc) where ended_at is null;
create index focus_sessions_user_idx
  on public.focus_sessions (user_id, started_at desc);

alter table public.focus_sessions enable row level security;

create policy "campus can see who's studying"
  on public.focus_sessions for select
  to authenticated
  using (exists (
    select 1 from public.profiles p
    where p.id = focus_sessions.user_id
      and p.university_id = public.current_university_id()
  ));

create policy "students run their own sessions"
  on public.focus_sessions for all
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

alter publication supabase_realtime add table public.focus_sessions;

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · Grade tracker. Entirely private: your categories, your scores, your
--     estimate. Nobody — not classmates, not us in the UI — sees it.
-- ═══════════════════════════════════════════════════════════════════════

create table public.grade_categories (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.profiles(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 60),
  weight     numeric(5,2) not null check (weight >= 0 and weight <= 100),
  position   integer not null default 0,
  created_at timestamptz not null default now()
);

create index grade_categories_owner_idx
  on public.grade_categories (user_id, course_id, position);

create table public.grade_entries (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  category_id     uuid not null references public.grade_categories(id) on delete cascade,
  title           text not null check (char_length(title) between 1 and 120),
  points_earned   numeric(8,2) not null check (points_earned >= 0),
  points_possible numeric(8,2) not null check (points_possible > 0),
  recorded_at     timestamptz not null default now()
);

create index grade_entries_category_idx
  on public.grade_entries (category_id, recorded_at);
create index grade_entries_user_idx on public.grade_entries (user_id);

comment on table public.grade_categories is
  'Private per-student grade buckets for a course (Homework 20%, Midterm 30%, …). Never shared.';
comment on table public.grade_entries is
  'Private scores inside a bucket. The estimate is math the student owns, not a claim about their record.';

alter table public.grade_categories enable row level security;
alter table public.grade_entries enable row level security;

create policy "students own their grade categories"
  on public.grade_categories for all
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

create policy "students own their grade entries"
  on public.grade_entries for all
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ));

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · Club announcements. Officers speak to the whole club; everyone hears
--     it once, in the inbox.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.is_club_member(club uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.club_members
    where club_id = club and user_id = auth.uid()
  );
$$;

revoke execute on function public.is_club_member(uuid) from public, anon;
grant execute on function public.is_club_member(uuid) to authenticated;

create table public.club_announcements (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  author_id  uuid references public.profiles(id) on delete set null,
  title      text not null check (char_length(title) between 1 and 120),
  body       text not null check (char_length(body) between 1 and 2000),
  created_at timestamptz not null default now()
);

create index club_announcements_club_idx
  on public.club_announcements (club_id, created_at desc);

comment on table public.club_announcements is
  'Officer-written notices for club members. One notification each, no chat noise.';

alter table public.club_announcements enable row level security;

create policy "members read club announcements"
  on public.club_announcements for select
  to authenticated
  using (public.is_club_member(club_id));

create policy "officers write club announcements"
  on public.club_announcements for insert
  to authenticated
  with check (author_id = ( SELECT auth.uid() ) and public.is_club_officer(club_id));

create policy "authors can remove their announcements"
  on public.club_announcements for delete
  to authenticated
  using (author_id = ( SELECT auth.uid() ));

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('dm', 'thread_reply', 'schedule_privacy', 'event', 'channel',
                  'system', 'course_calendar', 'mention', 'thanks', 'club_post'));

create or replace function public.notify_club_announcement()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_club text;
begin
  select name into v_club from public.clubs where id = new.club_id;
  insert into public.notifications (user_id, kind, title, body, link)
  select m.user_id, 'club_post',
         v_club || ': ' || new.title,
         left(new.body, 140),
         '/clubs/' || new.club_id
  from public.club_members m
  where m.club_id = new.club_id
    and m.user_id <> coalesce(new.author_id, '00000000-0000-0000-0000-000000000000')
    and not public.is_blocked_either(m.user_id, new.author_id);
  return new;
end;
$$;

create trigger on_club_announcement_notify
  after insert on public.club_announcements
  for each row execute function public.notify_club_announcement();

revoke execute on function public.notify_club_announcement() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 5 · Study buddies. Opt in per course, and classmates who did the same
--     can find you. Opt-out is a delete — no lingering profile flag.
-- ═══════════════════════════════════════════════════════════════════════

create table public.study_buddy_optins (
  user_id    uuid not null references public.profiles(id) on delete cascade,
  course_id  uuid not null references public.courses(id) on delete cascade,
  note       text check (note is null or char_length(note) <= 140),
  created_at timestamptz not null default now(),
  primary key (user_id, course_id)
);

create index study_buddy_course_idx on public.study_buddy_optins (course_id, created_at desc);

comment on table public.study_buddy_optins is
  'Classmates open to studying together in a course. Visible only to people enrolled in that course.';

alter table public.study_buddy_optins enable row level security;

create policy "classmates see who's looking"
  on public.study_buddy_optins for select
  to authenticated
  using (public.is_enrolled(course_id));

create policy "students manage their own opt-in"
  on public.study_buddy_optins for all
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (user_id = ( SELECT auth.uid() ) and public.is_enrolled(course_id));

-- ═══════════════════════════════════════════════════════════════════════
-- 6 · Course archiving. Last quarter's classes stop crowding the list
--     without losing the chat, the notes, or the memory.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.enrollments add column archived_at timestamptz;

comment on column public.enrollments.archived_at is
  'Set when a student tucks a finished course away. The enrollment (and its channel membership) survives — this is shelving, not dropping.';

create index enrollments_active_idx
  on public.enrollments (user_id) where archived_at is null;
