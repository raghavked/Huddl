-- Hearth repair: a mention notification leads to the message it quotes.
--
-- Found by the launch wiring audit. `notify_mentions` (0019) always linked
-- to the bare channel, but thread replies deliberately never appear in the
-- main channel list on either client, so "Maya mentioned you" from inside a
-- thread landed a student in a room where the mentioning message is nowhere
-- on screen. Both clients already route `?thread=` links correctly (0039
-- taught `notify_thread_reply` this exact lesson); the trigger just never
-- wrote it, despite having `new.parent_id` in scope the whole time.
--
-- While it's open: the body said 'In #general', and the hash went out with
-- the room-identity rework. The words now match what the app calls rooms.

create or replace function public.notify_mentions()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_channel_name text;
  v_author_name text;
begin
  if new.deleted_at is not null or position('@' in new.content) = 0 then
    return new;
  end if;
  select name into v_channel_name from public.channels where id = new.channel_id;
  select display_name into v_author_name from public.profiles where id = new.author_id;

  insert into public.notifications (user_id, kind, title, body, link)
  select distinct p.id, 'mention',
         v_author_name || ' mentioned you',
         'In ' || v_channel_name || ': ' || left(new.content, 140),
         '/channels/' || new.channel_id
           || case when new.parent_id is not null
                   then '?thread=' || new.parent_id
                   else '' end
  from regexp_matches(lower(new.content), '@([a-z0-9_]{3,24})', 'g') m
  join public.profiles p on p.handle = m[1]
  join public.channel_members cm
    on cm.channel_id = new.channel_id and cm.user_id = p.id
  where p.id <> new.author_id
    and not public.is_blocked_either(p.id, new.author_id);
  return new;
end;
$$;
