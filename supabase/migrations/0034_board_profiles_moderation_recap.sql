-- Huddl schema: the campus-and-community wave. A board for the things
-- students actually need from each other, richer profiles, a real
-- moderation queue, and a Sunday recap.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · The campus board. Rides home for break, a lost water bottle, a
--     couch that needs a new apartment, a tutor. One table, campus-scoped.
-- ═══════════════════════════════════════════════════════════════════════

create table public.board_posts (
  id            uuid primary key default gen_random_uuid(),
  university_id uuid not null references public.universities(id) on delete cascade,
  author_id     uuid not null references public.profiles(id) on delete cascade,
  category      text not null check (category in
                  ('ride', 'lost', 'found', 'free', 'sale', 'ask', 'offer')),
  title         text not null check (char_length(title) between 3 and 120),
  body          text check (body is null or char_length(body) <= 1500),
  price_cents   integer check (price_cents is null or (price_cents >= 0 and price_cents <= 500000)),
  happens_on    date,
  closed_at     timestamptz,
  created_at    timestamptz not null default now()
);

comment on table public.board_posts is
  'The campus board: rides, lost and found, free stuff, things for sale, asks and offers. Campus-scoped, author-owned, and closable rather than deletable so a resolved post can still be read.';
comment on column public.board_posts.happens_on is
  'For a ride, the day it leaves. Null for everything else.';
comment on column public.board_posts.closed_at is
  'Set when the ride filled, the bottle came home, the couch went. A closed post stays readable, greyed, at the bottom.';

create index board_posts_feed_idx
  on public.board_posts (university_id, created_at desc) where closed_at is null;
create index board_posts_category_idx
  on public.board_posts (university_id, category, created_at desc);
create index board_posts_author_idx on public.board_posts (author_id);

alter table public.board_posts enable row level security;

create policy "campus reads the board"
  on public.board_posts for select
  to authenticated
  using (university_id = public.current_university_id());

create policy "students post to their own campus"
  on public.board_posts for insert
  to authenticated
  with check (
    author_id = ( SELECT auth.uid() )
    and university_id = public.current_university_id()
  );

create policy "authors edit their own posts"
  on public.board_posts for update
  to authenticated
  using (author_id = ( SELECT auth.uid() ))
  with check (author_id = ( SELECT auth.uid() ));

create policy "authors remove their own posts"
  on public.board_posts for delete
  to authenticated
  using (author_id = ( SELECT auth.uid() ));

-- Board posts are user-generated content in a campus-wide space, so the
-- report flow has to be able to name one.
alter table public.reports add column board_post_id uuid
  references public.board_posts(id) on delete set null;

alter table public.reports drop constraint reports_have_subject;
alter table public.reports add constraint reports_have_subject
  check (message_id is not null or reported_user_id is not null
         or board_post_id is not null);

create index reports_board_post_idx
  on public.reports (board_post_id) where board_post_id is not null;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Richer profiles. What you are into, and what you are looking for —
--     the two things that turn a directory row into a person.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles
  add column interests text[] not null default '{}'::text[],
  add column looking_for text check (looking_for is null or char_length(looking_for) <= 140);

comment on column public.profiles.interests is
  'Up to eight short interests. Normalized by trigger like note tags, so a client sends what the student typed.';
comment on column public.profiles.looking_for is
  'One line: study partners, a lab group, people to run with, a sublet. Optional and easy to clear.';

create or replace function public.normalize_interests()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.interests is null then
    new.interests := '{}'::text[];
    return new;
  end if;
  new.interests := (
    select coalesce(array_agg(t order by ord), '{}'::text[])
    from (
      select lower(trim(tag)) as t, min(ord) as ord
      from unnest(new.interests) with ordinality as u(tag, ord)
      where char_length(trim(tag)) between 2 and 28
      group by lower(trim(tag))
    ) cleaned
  );
  if array_length(new.interests, 1) > 8 then
    new.interests := new.interests[1:8];
  end if;
  return new;
end;
$$;

create trigger profiles_interests_normalize
  before insert or update of interests on public.profiles
  for each row execute function public.normalize_interests();

revoke execute on function public.normalize_interests() from public, anon, authenticated;

create index profiles_interests_idx on public.profiles using gin (interests);

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · Moderation. Reports have existed since 0015 with triage living in
--     the service role — which means nobody can triage from the app.
--     A moderator flag plus two policies gives the queue a front door.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles add column is_moderator boolean not null default false;

comment on column public.profiles.is_moderator is
  'Campus moderator. Set by an admin through the service role — never self-assignable, since the profiles update policy is owner-scoped and this column is revoked from the authenticated grant below.';

-- A student may update their own profile, but not promote themselves.
revoke update on public.profiles from authenticated;
grant update (handle, display_name, avatar_url, bio, major, grad_year,
              is_public, accepted_terms_at, notification_prefs,
              share_read_receipts, share_typing, interests, looking_for,
              updated_at)
  on public.profiles to authenticated;

create or replace function public.is_moderator()
returns boolean
language sql stable security definer set search_path = public
as $$
  select coalesce(
    (select p.is_moderator from public.profiles p where p.id = auth.uid()),
    false
  );
$$;

revoke execute on function public.is_moderator() from public, anon;
grant execute on function public.is_moderator() to authenticated;

create policy "moderators read the queue"
  on public.reports for select
  to authenticated
  using (public.is_moderator());

create policy "moderators triage the queue"
  on public.reports for update
  to authenticated
  using (public.is_moderator())
  with check (public.is_moderator());

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · The Sunday recap. Not a leaderboard — a quiet note about the week
--     that was, and only when there was one.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.send_weekly_recap()
returns void
language plpgsql security definer set search_path = public
as $$
begin
  with week as (
    select p.id as user_id,
           (select count(*) from public.study_checkoffs c
             where c.user_id = p.id and c.done_at > now() - interval '7 days') as handled,
           (select count(*) from public.focus_sessions f
             where f.user_id = p.id and f.ended_at > now() - interval '7 days') as sessions,
           (select count(*) from public.messages m
             where m.author_id = p.id and m.created_at > now() - interval '7 days') as messages
    from public.profiles p
  )
  insert into public.notifications (user_id, kind, title, body, link)
  select w.user_id, 'system',
         'Your week, in short',
         trim(both ' ·' from concat_ws(' · ',
           case when w.handled > 0
                then w.handled || (case when w.handled = 1 then ' thing' else ' things' end) || ' checked off' end,
           case when w.sessions > 0
                then w.sessions || (case when w.sessions = 1 then ' focus session' else ' focus sessions' end) end,
           case when w.messages > 0 then 'and you kept up with your classes' end
         )),
         '/plan'
  from week w
  where w.handled > 0 or w.sessions > 0;
end;
$$;

revoke execute on function public.send_weekly_recap() from public, anon, authenticated;

-- Sunday 01:00 UTC — Saturday evening on the US West Coast, when the week
-- is genuinely over and the next one has not started weighing yet.
select cron.schedule('huddl-weekly-recap', '0 1 * * 0',
                     $$select public.send_weekly_recap()$$);
