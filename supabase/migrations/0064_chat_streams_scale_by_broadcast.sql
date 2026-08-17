-- Hearth at scale: live chat moves from postgres_changes to broadcast.
--
-- The clients have listened to rooms with Realtime's `postgres_changes`,
-- which re-evaluates row security PER SUBSCRIBER, PER CHANGE. In a room
-- with forty thousand members, one message means forty thousand policy
-- evaluations before anyone's phone buzzes: the documented scaling cliff
-- of that API, and the single hardest wall between this app and a full
-- campus online at once.
--
-- The scalable shape is the one Supabase built for exactly this:
-- `realtime.broadcast_changes()` from an AFTER trigger, into a PRIVATE
-- topic per room. Authorization happens ONCE, when a client joins the
-- topic (a select policy on realtime.messages checks room membership);
-- after that, fan-out is a plain broadcast with no per-event policy work.
-- O(joins), not O(subscribers x messages).
--
-- Topics:
--   room:<channel_id>  for channel messages (inserts and updates, so
--                      edits and soft-deletes stream too)
--   dm:<thread_id>     for direct messages
--
-- Two honest notes:
--   · The old postgres_changes path still works; nothing here removes it.
--     Clients migrate to the broadcast topics and the old builds keep
--     limping until they update.
--   · 0042 hides a blocked author's DM rows from their blocker at the
--     read policy. Broadcast authorizes the TOPIC, not each row, so the
--     blocker's client will receive the event and must keep filtering
--     blocked authors before render, which both clients already do (it
--     was the pre-0042 behaviour). The stored rows stay protected; the
--     live wire relies on the same client filter it always had.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · the wire: one broadcast per message event, from the database
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.broadcast_room_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.broadcast_changes(
    'room:' || coalesce(new.channel_id, old.channel_id)::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return coalesce(new, old);
end;
$$;

create or replace function public.broadcast_dm_message()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  perform realtime.broadcast_changes(
    'dm:' || coalesce(new.thread_id, old.thread_id)::text,
    tg_op, tg_op, tg_table_name, tg_table_schema, new, old
  );
  return coalesce(new, old);
end;
$$;

revoke execute on function public.broadcast_room_message() from public, anon, authenticated;
revoke execute on function public.broadcast_dm_message() from public, anon, authenticated;

create trigger messages_broadcast
  after insert or update on public.messages
  for each row execute function public.broadcast_room_message();

create trigger dm_messages_broadcast
  after insert or update on public.dm_messages
  for each row execute function public.broadcast_dm_message();

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · the door: joining a private topic requires being in the room
-- ═══════════════════════════════════════════════════════════════════════

-- Checked once per join. The regex guard keeps a malformed topic from
-- becoming a cast error; a topic that isn't ours simply doesn't match.
create policy "room members join their room streams"
  on realtime.messages
  for select to authenticated
  using (
    (
      realtime.topic() like 'room:%'
      and substring(realtime.topic() from 6)
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_channel_member(substring(realtime.topic() from 6)::uuid)
    )
    or (
      realtime.topic() like 'dm:%'
      and substring(realtime.topic() from 4)
          ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
      and public.is_dm_participant(substring(realtime.topic() from 4)::uuid)
    )
  );
