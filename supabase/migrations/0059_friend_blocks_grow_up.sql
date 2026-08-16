-- Hearth repair: friendships learn the whole block philosophy, not half.
--
-- 0052 absorbed a blocked friend request at insert: no row, no error. The
-- adversarial review traced what that actually feels like from the asker's
-- side: tap "Add friend", see "Request sent", reload two seconds later,
-- "Add friend" again, deterministically, every time. A genuinely ignored
-- request keeps its row and shows "Request sent" forever, so the absorb
-- model created exactly the distinguishable behaviour it existed to
-- prevent. The review also found three neighbours: a pending edge that
-- predates a block could still be ACCEPTED (minting a friendship and
-- pushing "said yes" to the blocker's phone), the friends screens showed
-- people the viewer had blocked, and request/cancel/request cycles could
-- ring the addressee's inbox without limit.
--
-- The repair follows 0042's rule to the letter: ONLY THE BLOCKER'S VIEW
-- CHANGES.
--
--   · The request row is stored again, block or no block. The asker sees a
--     persistent "Request sent", indistinguishable from being ignored,
--     which is the honest answer.
--   · The select policy hides any edge with a person the viewer has
--     blocked. The blocker's Requests tab never shows the ask; the blocked
--     side keeps seeing exactly what they always saw.
--   · The request notification is skipped for blocked pairs (the blocker
--     hears nothing), and throttled to one per pair per day for everyone,
--     which ends the cancel/re-ask inbox spam. Cancelling a pending ask
--     also withdraws its unread notification, so an inbox can't fill with
--     invitations that no longer exist.
--   · Accepting across a block quietly withdraws the request instead: the
--     row is deleted, no friendship is minted, nobody is notified. To the
--     tapper it reads as "that request isn't waiting any more", which is
--     also what a cancelled request reads as. No tell.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · the absorb model retires
-- ═══════════════════════════════════════════════════════════════════════

drop trigger friendships_absorb_blocked on public.friendships;
drop function public.absorb_blocked_friend_request();

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · the blocker's view: edges with people you blocked do not exist
-- ═══════════════════════════════════════════════════════════════════════

drop policy friendships_select on public.friendships;
create policy friendships_select on public.friendships
  for select to authenticated
  using (
    ((select auth.uid()) = requester_id and not public.i_blocked(addressee_id))
    or
    ((select auth.uid()) = addressee_id and not public.i_blocked(requester_id))
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · accepting across a block withdraws the request, silently
-- ═══════════════════════════════════════════════════════════════════════

-- BEFORE UPDATE, after the stamp trigger alphabetically, so it has the
-- final word. Deleting the row and returning NULL makes the accept a
-- no-op: the caller's update reports zero rows, the client says "that
-- request isn't waiting any more" and refetches, and the refetch finds
-- nothing, exactly as if the asker had cancelled. Which is the point.
create or replace function public.withdraw_blocked_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' and new.status = 'accepted'
     and public.is_blocked_either(old.requester_id, old.addressee_id) then
    delete from public.friendships
     where requester_id = old.requester_id
       and addressee_id = old.addressee_id;
    return null;
  end if;
  return new;
end;
$$;

revoke execute on function public.withdraw_blocked_accept() from public, anon, authenticated;

create trigger friendships_withdraw_blocked_accept
  before update on public.friendships
  for each row execute function public.withdraw_blocked_accept();

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · notifications: silent for blocked pairs, one per pair per day
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.notify_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- The blocker hears nothing; the row still stores so the asker's view
  -- stays honest.
  if public.is_blocked_either(new.requester_id, new.addressee_id) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body, link)
  select new.addressee_id, 'friend',
         p.display_name || ' wants to be friends',
         'Say yes from their profile, or quietly let it sit.',
         '/u/' || p.handle
  from public.profiles p
  where p.id = new.requester_id
    -- Ask, cancel, ask again: the inbox hears about a pair once a day.
    and not exists (
      select 1 from public.notifications n
      where n.user_id = new.addressee_id
        and n.kind = 'friend'
        and n.link = '/u/' || p.handle
        and n.created_at > now() - interval '1 day'
    );
  return new;
end;
$$;

create or replace function public.notify_friend_accept()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Belt and braces: the withdraw trigger already stops a blocked accept.
  if public.is_blocked_either(new.requester_id, new.addressee_id) then
    return new;
  end if;

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

-- Cancelling a pending ask settles the unread invitation it sent: marked
-- read, not deleted, deliberately. Deleting it would re-arm the
-- once-a-day throttle above (which counts notification rows), so an
-- ask/cancel loop could buzz the addressee on every lap. Marking it read
-- clears the badge, keeps the throttle armed, and a stale invitation in
-- read history is no stranger than any other event that moved on. The
-- addressee's friend-kind notifications that link to the asker's profile
-- are only ever "wants to be friends" rows ("said yes" goes the other
-- way), so kind + link identifies them safely.
create or replace function public.retract_friend_notification()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status = 'pending' then
    update public.notifications n
       set read_at = now()
    from public.profiles p
    where p.id = old.requester_id
      and n.user_id = old.addressee_id
      and n.kind = 'friend'
      and n.read_at is null
      and n.link = '/u/' || p.handle;
  end if;
  return old;
end;
$$;

revoke execute on function public.retract_friend_notification() from public, anon, authenticated;

create trigger friendships_retract_notification
  after delete on public.friendships
  for each row execute function public.retract_friend_notification();
