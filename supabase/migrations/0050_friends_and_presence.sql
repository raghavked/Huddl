-- Hearth schema: the two social facts the app talked around but never stored.
--
-- FRIENDS. Everything social in Hearth so far is either ambient (you share a
-- campus, you share a section) or transactional (a DM thread, a study-buddy
-- opt-in scoped to one course). There was no way to say "this is my person
-- across all of it". `friendships` is that edge: one row per pair, asked by
-- one side and answered by the other.
--
--   · One edge per pair, whoever asked first: the unique index on the
--     (least, greatest) normalisation makes a reverse-direction duplicate
--     impossible at the database, not just awkward in the client.
--   · Same campus only. Every person you can see in the app is on your
--     campus already; the insert policy makes the database agree.
--   · Blocks win. You cannot ask someone you've blocked or who blocked you
--     (`is_blocked_either`, the same guard DM threads use). Blocking someone
--     later does not tear down an existing edge, deliberately: the block
--     already hides their content, and deleting the friendship row would be
--     visible to them, which a block must never be. Client surfaces hide
--     blocked friends the same way they hide blocked posts.
--   · Declining is deleting. A declined request leaves no tombstone: the
--     asker sees "still pending" forever rather than "rejected", which is
--     the kind answer, and they cannot tell it apart from being ignored.
--     (They can ask again; the addressee can delete again. Nothing loops by
--     itself, and rows carry no retry machinery.)
--   · Unfriending is the same delete, by either side, any time.
--
-- STATUS. "Is Maya around?" had no honest answer anywhere in the schema.
-- `last_seen_at` is the whole feature: stamped by the app through
-- `touch_last_seen()` (throttled, clamped to now(), never client-supplied),
-- and shared only while `share_last_seen` stays on. The toggle does not hide
-- the timestamp, it ERASES it: flipping it off nulls the column in the same
-- statement, and the touch function refuses to write while it is off. There
-- is nothing to leak because there is nothing stored. Focus sessions remain
-- the loud, deliberate "I'm studying now"; this is the quiet dot under a
-- name, and it is off-switchable because presence is a privacy surface.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · friendships
-- ═══════════════════════════════════════════════════════════════════════

create table public.friendships (
  requester_id uuid not null references public.profiles(id) on delete cascade,
  addressee_id uuid not null references public.profiles(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'accepted')),
  created_at timestamptz not null default now(),
  responded_at timestamptz,
  primary key (requester_id, addressee_id),
  constraint friendships_not_self check (requester_id <> addressee_id)
);

comment on table public.friendships is
  'Friend edges: one row per pair, asked by requester, answered by addressee. '
  'Declining is deleting the row (no tombstone, no tell). Accepted rows are '
  'the friends list read from either end.';

-- A pair is one edge no matter who asked.
create unique index friendships_one_edge_per_pair
  on public.friendships (
    least(requester_id, addressee_id),
    greatest(requester_id, addressee_id)
  );

-- "Requests waiting on me" is the hot read.
create index friendships_pending_inbox
  on public.friendships (addressee_id) where status = 'pending';

alter table public.friendships enable row level security;

-- Both ends see the edge; nobody else ever does. The social graph is not
-- browsable: you can list YOUR friends, not someone else's.
create policy friendships_select on public.friendships
  for select to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- Asking: you, someone on your campus, not across a block in either
-- direction, and the row starts pending. The column-level insert grant below
-- means the API cannot even mention `status`, so "insert it pre-accepted"
-- fails twice.
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    and responded_at is null
    and not public.is_blocked_either(requester_id, addressee_id)
    and exists (
      select 1 from public.profiles p
      where p.id = addressee_id
        and p.university_id = public.current_university_id()
    )
  );

-- Answering: only the person asked, only while it's pending, and the only
-- place it can land is accepted. responded_at is stamped by trigger, not
-- trusted from the client.
create policy friendships_update on public.friendships
  for update to authenticated
  using (addressee_id = auth.uid() and status = 'pending')
  with check (status = 'accepted');

-- Cancel, decline, or unfriend: the same quiet delete, from either end.
create policy friendships_delete on public.friendships
  for delete to authenticated
  using (auth.uid() in (requester_id, addressee_id));

-- Grants, in the 0039/0040 shape: say exactly what the API may touch.
grant select, delete on public.friendships to authenticated;
grant insert (requester_id, addressee_id) on public.friendships to authenticated;
grant update (status) on public.friendships to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · friend notifications, and the accept timestamp
-- ═══════════════════════════════════════════════════════════════════════

-- A new kind for the inbox. Clients map it to its own icon; anything older
-- falls back to their system row, so this is safe to ship data-first.
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in ('dm','thread_reply','schedule_privacy','event','channel',
                  'system','course_calendar','mention','thanks','club_post',
                  'friend'));

-- BEFORE UPDATE: the accept moment is the database's clock, not the client's.
create or replace function public.stamp_friend_accept()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status = 'accepted' then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

create trigger friendships_stamp_accept
  before update on public.friendships
  for each row execute function public.stamp_friend_accept();

-- AFTER INSERT: tell the person who was asked. The insert policy already
-- refused blocked pairs, so no second check is needed here.
create or replace function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select new.addressee_id, 'friend',
         p.display_name || ' wants to be friends',
         'Say yes from their profile, or quietly let it sit.',
         '/u/' || p.handle
  from public.profiles p
  where p.id = new.requester_id;
  return new;
end;
$$;

create trigger friendships_notify_request
  after insert on public.friendships
  for each row execute function public.notify_friend_request();

-- AFTER UPDATE to accepted: tell the person who asked.
create or replace function public.notify_friend_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.notifications (user_id, kind, title, body, link)
  select new.requester_id, 'friend',
         p.display_name || ' said yes',
         'You two are friends on Hearth now.',
         '/u/' || p.handle
  from public.profiles p
  where p.id = new.addressee_id;
  return new;
end;
$$;

create trigger friendships_notify_accept
  after update on public.friendships
  for each row
  when (old.status = 'pending' and new.status = 'accepted')
  execute function public.notify_friend_accept();

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · presence: last_seen_at, its kill switch, and the only writer
-- ═══════════════════════════════════════════════════════════════════════

alter table public.profiles add column last_seen_at timestamptz;
alter table public.profiles add column share_last_seen boolean not null default true;

comment on column public.profiles.last_seen_at is
  'Written only by touch_last_seen(), throttled to once a minute, and erased '
  'the moment share_last_seen turns off. Clients render it as "Active now" / '
  '"Active today", never as a raw timestamp.';

-- The app calls this on foreground and on a slow heartbeat. It clamps to the
-- server clock, throttles itself, and goes silent while sharing is off, so
-- there is no value a client can put here that the server didn't choose.
create or replace function public.touch_last_seen()
returns void
language sql
security definer
set search_path = public
as $$
  update public.profiles
     set last_seen_at = now()
   where id = auth.uid()
     and share_last_seen
     and (last_seen_at is null or last_seen_at < now() - interval '60 seconds');
$$;

revoke execute on function public.touch_last_seen() from public, anon;
grant execute on function public.touch_last_seen() to authenticated;

-- Turning sharing off erases the fact, in the same write.
create or replace function public.scrub_last_seen()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.share_last_seen = false then
    new.last_seen_at := null;
  end if;
  return new;
end;
$$;

create trigger profiles_scrub_last_seen
  before update of share_last_seen on public.profiles
  for each row execute function public.scrub_last_seen();

-- The 0040 column list, restated with the one new toggle. last_seen_at is
-- deliberately NOT here: the API cannot write it, only touch_last_seen() can.
grant update (handle, display_name, avatar_url, bio, major, grad_year,
              is_public, accepted_terms_at, notification_prefs,
              share_read_receipts, share_typing, interests, looking_for,
              quiet_hours, dm_privacy, updated_at, share_last_seen)
  on public.profiles to authenticated;
