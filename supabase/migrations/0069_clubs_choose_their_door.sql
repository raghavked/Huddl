-- Clubs choose their door: open to the campus, or invite only.
--
-- Clubs already had rooms, rosters, roles (member / officer / owner),
-- announcements, events and polls through their channels. What they did
-- not have was a door policy: every club was joinable by anyone on
-- campus. This round gives the president the choice, and gives invite-only
-- clubs a real invitation flow instead of a bouncer with no guest list.
--
--   · clubs.privacy: 'open' (anyone at the university joins, as today) or
--     'invite' (membership moves only through invitations).
--   · club_invites: officers invite classmates; the classmate gets a
--     notification and answers through respond_to_club_invite(), which is
--     the only path that turns an invitation into a membership.
--   · The presidency gets guardrails it always deserved: only the owner
--     can move the crown (transfer_club_presidency swaps both rows in one
--     statement), officers cannot promote anyone to owner or remove the
--     owner, and the owner cannot walk out of a club that still has
--     members: hand it off first, or disband.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · the door setting
-- ═══════════════════════════════════════════════════════════════════════

alter table public.clubs
  add column privacy text not null default 'open'
  check (privacy in ('open', 'invite'));

comment on column public.clubs.privacy is
  'open: anyone at the university can join. invite: membership moves only '
  'through club_invites. Officers change it from club settings.';

-- Self-serve joining now respects the door. Invitations go through the
-- definer function below, so this policy only ever admits open-club joins.
alter policy "students can join clubs at their university" on public.club_members
  with check (
    user_id = (select auth.uid())
    and role = 'member'
    and club_university(club_id) = (select current_university_id())
    and (select c.privacy from public.clubs c where c.id = club_id) = 'open'
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · invitations
-- ═══════════════════════════════════════════════════════════════════════

create table public.club_invites (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete cascade,
  user_id uuid not null references public.profiles(id) on delete cascade,
  invited_by uuid references public.profiles(id) on delete set null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'declined', 'revoked')),
  created_at timestamptz not null default now(),
  responded_at timestamptz
);

-- One live invitation per person per club; settled ones stay as history.
create unique index club_invites_one_pending
  on public.club_invites (club_id, user_id) where status = 'pending';
create index club_invites_user_idx on public.club_invites (user_id, status);

alter table public.club_invites enable row level security;
grant select, insert, update on public.club_invites to authenticated;

create policy "invitations are visible to their people"
  on public.club_invites for select to authenticated
  using (user_id = (select auth.uid()) or is_club_officer(club_id));

create policy "officers invite classmates"
  on public.club_invites for insert to authenticated
  with check (
    invited_by = (select auth.uid())
    and is_club_officer(club_id)
    and (select p.university_id from public.profiles p where p.id = user_id)
        = (select current_university_id())
    and not exists (
      select 1 from public.club_members m
      where m.club_id = club_invites.club_id and m.user_id = club_invites.user_id
    )
  );

-- Officers can take a pending invitation back. Accept and decline belong
-- to the invitee alone, through respond_to_club_invite below.
create policy "officers revoke pending invitations"
  on public.club_invites for update to authenticated
  using (is_club_officer(club_id))
  with check (is_club_officer(club_id) and status = 'revoked');

-- Settled is settled: no resurrecting an answered invitation, and every
-- settling stamps its moment.
create or replace function public.club_invites_settle_once()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.status <> 'pending' then
    raise exception 'This invitation was already answered.';
  end if;
  if new.status <> old.status then
    new.responded_at := now();
  end if;
  return new;
end;
$$;

revoke execute on function public.club_invites_settle_once() from public, anon, authenticated;

create trigger club_invites_settle_once
  before update on public.club_invites
  for each row execute function public.club_invites_settle_once();

-- The invitee hears about it the moment it lands.
create or replace function public.notify_club_invite()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_club text;
begin
  if new.invited_by is not null
     and public.is_blocked_either(new.user_id, new.invited_by) then
    return new;
  end if;
  select name into v_club from public.clubs where id = new.club_id;
  insert into public.notifications (user_id, kind, title, body, link)
  values (
    new.user_id, 'club_invite',
    'You''re invited to ' || v_club,
    'Accept or decline from the club page.',
    '/clubs/' || new.club_id
  );
  return new;
end;
$$;

revoke execute on function public.notify_club_invite() from public, anon, authenticated;

create trigger on_club_invite_notify
  after insert on public.club_invites
  for each row execute function public.notify_club_invite();

alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind = any (array[
    'dm', 'thread_reply', 'schedule_privacy', 'event', 'channel', 'system',
    'course_calendar', 'mention', 'thanks', 'club_post', 'friend',
    'club_invite'
  ]));

-- The one path from invitation to membership. Definer, because the join
-- policy above deliberately refuses invite-club inserts.
create or replace function public.respond_to_club_invite(p_invite_id uuid, p_accept boolean)
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_invite public.club_invites%rowtype;
  v_club text;
  v_name text;
begin
  select * into v_invite
  from public.club_invites
  where id = p_invite_id and user_id = auth.uid() and status = 'pending'
  for update;
  if not found then
    raise exception 'That invitation is gone or was already answered.';
  end if;

  update public.club_invites
     set status = case when p_accept then 'accepted' else 'declined' end
   where id = p_invite_id;

  if p_accept then
    insert into public.club_members (club_id, user_id, role)
    values (v_invite.club_id, auth.uid(), 'member')
    on conflict do nothing;

    if v_invite.invited_by is not null
       and not public.is_blocked_either(auth.uid(), v_invite.invited_by) then
      select name into v_club from public.clubs where id = v_invite.club_id;
      select display_name into v_name from public.profiles where id = auth.uid();
      insert into public.notifications (user_id, kind, title, body, link)
      values (
        v_invite.invited_by, 'club_invite',
        coalesce(v_name, 'A classmate') || ' joined ' || v_club,
        'They accepted your invitation.',
        '/clubs/' || v_invite.club_id
      );
    end if;
  end if;
end;
$$;

grant execute on function public.respond_to_club_invite(uuid, boolean) to authenticated;
revoke execute on function public.respond_to_club_invite(uuid, boolean) from anon, public;

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · the crown moves deliberately
-- ═══════════════════════════════════════════════════════════════════════

-- Officers manage roles, but the presidency is not theirs to hand out or
-- take away: any change that touches 'owner' requires the caller to BE
-- the owner. transfer_club_presidency satisfies this naturally.
create or replace function public.club_crown_moves_deliberately()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if (old.role = 'owner' or new.role = 'owner') and not exists (
    select 1 from public.club_members m
    where m.club_id = old.club_id and m.user_id = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'Only the club president can move the presidency.';
  end if;
  return new;
end;
$$;

revoke execute on function public.club_crown_moves_deliberately() from public, anon, authenticated;

create trigger club_crown_moves_deliberately
  before update on public.club_members
  for each row execute function public.club_crown_moves_deliberately();

-- The owner leaves last. While the club exists and anyone else is still
-- in it, the owner's row cannot be removed by anyone, including the
-- owner: hand the presidency off first, or disband the club (deleting
-- the club cascades here with the club row already gone, which is the
-- one case this lets through).
create or replace function public.the_owner_leaves_last()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if old.role = 'owner'
     and exists (select 1 from public.clubs c where c.id = old.club_id)
     and exists (
       select 1 from public.club_members m
       where m.club_id = old.club_id and m.user_id <> old.user_id
     ) then
    raise exception 'Hand the presidency to someone first, or disband the club.';
  end if;
  return old;
end;
$$;

revoke execute on function public.the_owner_leaves_last() from public, anon, authenticated;

create trigger the_owner_leaves_last
  before delete on public.club_members
  for each row execute function public.the_owner_leaves_last();

-- Presidency transfer: promote first, then step down, in one
-- transaction. The order is load-bearing: the crown trigger checks that
-- the caller holds the presidency at each row, and a single two-row
-- UPDATE can process the step-down first and strip the caller's crown
-- before the promotion's guard looks for it (the verification run caught
-- exactly that). Promoting first keeps the caller an owner through both
-- checks, and the transaction means nobody ever observes the brief
-- two-owner moment. The caller becomes an officer, not a member;
-- outgoing presidents have earned that much.
create or replace function public.transfer_club_presidency(p_club_id uuid, p_to_user uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not exists (
    select 1 from public.club_members m
    where m.club_id = p_club_id and m.user_id = auth.uid() and m.role = 'owner'
  ) then
    raise exception 'Only the club president can hand off the presidency.';
  end if;
  if p_to_user = auth.uid() then
    raise exception 'You already hold the presidency.';
  end if;
  if not exists (
    select 1 from public.club_members m
    where m.club_id = p_club_id and m.user_id = p_to_user
  ) then
    raise exception 'The next president has to be a member of the club first.';
  end if;

  update public.club_members set role = 'owner'
   where club_id = p_club_id and user_id = p_to_user;
  update public.club_members set role = 'officer'
   where club_id = p_club_id and user_id = auth.uid();
end;
$$;

grant execute on function public.transfer_club_presidency(uuid, uuid) to authenticated;
revoke execute on function public.transfer_club_presidency(uuid, uuid) from anon, public;
