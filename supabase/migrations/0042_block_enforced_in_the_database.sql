-- Huddl schema: make "they won't be able to message you" true at the
-- database, without breaking "they're never told".
--
-- The block sheet in the DM room makes both promises in one breath:
--
--     "They won't be able to message you, and you won't see their posts.
--      This conversation stays where it is. They're never told."
--
-- The second half has always been kept properly: `is_blocked_either` is
-- checked before a new thread is opened and before every notification, and
-- 0037 took the EXECUTE grant away so the block graph can't be probed.
--
-- The first half was only ever kept by the client. `dm_messages` lets any
-- participant read every message in a thread, so a blocked classmate could
-- keep typing into a conversation that already existed and the rows arrived
-- perfectly readable — it was the room's own render that dropped them. That
-- is a promise made by a component, and every surface that forgets to make
-- it breaks it: this session alone found the group-thread previews in the
-- Messages tab quoting a blocked author, the unread dot lighting up for
-- words the room refuses to draw, and the 1:1 room filtering nothing at all.
-- Those are fixed, but they are three instances of a class, and the class is
-- "the database said yes".
--
-- The obvious fix is the wrong one. Refusing the INSERT is how you'd stop a
-- message you don't want, and it is exactly what the sheet's last sentence
-- forbids: a send that suddenly fails, for one person, in one conversation,
-- tells them precisely what happened. Blocking has to stay invisible from
-- the blocked side or it isn't this feature.
--
-- So the enforcement goes on the read. Their message is written, and their
-- own client shows it to them the way it always has — they learn nothing.
-- It simply never reaches you: the row is not selectable by the person who
-- blocked its author, so previews, unread counts, search, saved messages and
-- any surface written next are all covered by the same rule, whether or not
-- they remember to be.
--
-- Deliberately one-way. `is_blocked_either` is the right guard for opening a
-- thread (a block should stop a conversation starting in either direction),
-- and the wrong one here: hiding YOUR messages from someone you blocked
-- would punch holes in their copy of the conversation, which is a tell.
-- Only the blocker's view changes.
--
-- Deliberately not applied to `public.messages`. The same argument fits a
-- channel, but reporting doesn't: `reportMessage` looks the message up first
-- and leans on RLS as the access check, so a student who blocked someone
-- would lose the ability to report them — and "block, then report" is the
-- ordinary order. Channel rooms keep filtering on the client until that read
-- is moved behind a definer function. DM triage is already safe:
-- `moderation_context` (0038) is SECURITY DEFINER and doesn't consult this.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · "Have I blocked this person?" — answerable, unlike the block graph.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.i_blocked(p_user uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (
    select 1 from public.blocks
    where blocker_id = ( SELECT auth.uid() )
      and blocked_id = p_user
  );
$$;

comment on function public.i_blocked(uuid) is
  'True when the CALLER has blocked p_user. Unlike is_blocked_either this is safe to expose: the blocker side is pinned to auth.uid(), so it only ever reports a row the student can already read through the blocks SELECT policy, and it cannot answer whether somebody has blocked THEM. SECURITY DEFINER so the dm_messages read policy does not have to re-enter RLS on blocks for every row.';

revoke execute on function public.i_blocked(uuid) from public, anon;
grant execute on function public.i_blocked(uuid) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · A blocked classmate's messages stop arriving.
--
--     Participation still decides what you can reach; the block subtracts
--     from it. Your own rows are matched first and never tested, both
--     because it is cheaper and because `no_self_block` means the question
--     could not be true anyway.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "participants can read messages" on public.dm_messages;

create policy "participants can read messages"
  on public.dm_messages for select
  to authenticated
  using (
    public.is_dm_participant(thread_id)
    and (
      author_id = ( SELECT auth.uid() )
      or not public.i_blocked(author_id)
    )
  );

comment on table public.dm_messages is
  'Direct messages, 1:1 and group. Readable by participants, minus anyone the reader has blocked — since 0042 that subtraction is the policy''s job rather than each screen''s. The block is invisible from the other side on purpose: their sends still succeed and still appear in their own copy of the thread.';

-- The policy asks "did I block this author" once per row, so the lookup
-- wants to be a single index hit on the primary key rather than a scan of
-- everyone the student has blocked. The blocks PK (blocker_id, blocked_id)
-- already serves it; this is a note, not a new index.
