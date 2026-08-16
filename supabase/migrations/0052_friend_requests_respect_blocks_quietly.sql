-- Hearth schema: friend requests across a block, done the way blocks work.
--
-- 0050's insert policy called `is_blocked_either()` directly, which fails
-- for everyone: 0037 revoked EXECUTE on that function from `authenticated`
-- so the block graph cannot be probed, and a policy runs with the caller's
-- privileges. The first simulated user to send a friend request found it.
--
-- The repair is better than a grant. If the policy refused blocked pairs,
-- a refused insert would tell the asker "this pair is special", which is
-- exactly the tell a block must never produce (the DM sheet's promise:
-- "they're never told"). So the block check moves into a BEFORE INSERT
-- trigger that runs as definer and, on a blocked pair, silently drops the
-- row: the asker's insert "succeeds", nothing is stored, nobody is
-- notified, and the experience is indistinguishable from being quietly
-- ignored, which is already a first-class outcome for a friend request.

-- The policy keeps everything it can check with the caller's own eyes:
-- you, as yourself, pending, to a classmate on your campus.
drop policy friendships_insert on public.friendships;
create policy friendships_insert on public.friendships
  for insert to authenticated
  with check (
    requester_id = auth.uid()
    and status = 'pending'
    and responded_at is null
    and exists (
      select 1 from public.profiles p
      where p.id = addressee_id
        and p.university_id = public.current_university_id()
    )
  );

-- The block check runs with definer eyes and answers with silence.
create or replace function public.absorb_blocked_friend_request()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if public.is_blocked_either(new.requester_id, new.addressee_id) then
    return null; -- swallow: no row, no notification, no tell
  end if;
  return new;
end;
$$;

create trigger friendships_absorb_blocked
  before insert on public.friendships
  for each row execute function public.absorb_blocked_friend_request();
