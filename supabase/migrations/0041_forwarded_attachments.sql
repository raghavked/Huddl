-- Huddl schema: make a forwarded photo readable again, without reopening the
-- hole 0039 closed.
--
-- 0039 narrowed the chat-uploads bucket so that an object is readable only if
-- you can see a message it is attached to AND the object sits in that
-- message's own author's folder. That second half is what makes the policy a
-- gate rather than a wish: `attachment_path` is a plain writable column, so
-- without it any student could create a topic channel of their own, post a
-- message naming somebody else's object key, and read it.
--
-- It also broke forwarding, which is the one legitimate case where those two
-- things come apart. 0033 forwards a photo by re-pointing a NEW message at
-- the SAME object rather than copying the file — deliberately, so a picture
-- sent to three rooms is one object and not three. The new row therefore
-- carries the forwarder as `author_id` and the original uploader's folder in
-- `attachment_path`, fails 0039's folder check, and the image renders broken
-- for everyone in the destination room who was not already in the source one.
--
-- So the read rule needs a third way in, and the whole problem is making that
-- third way trustworthy. `forwarded_author_id` (0033) already records who
-- really uploaded the thing, and reading the folder against THAT column would
-- fix the picture in one line — but the column is as client-writable as
-- `attachment_path`, so the same student could simply claim both and be back
-- to reading strangers' photos. A claim the client makes about itself cannot
-- be the thing that authorises the read.
--
-- The fix is to stop taking the client's word for it. A BEFORE INSERT trigger
-- notices when a message names an object outside its author's own folder —
-- which is exactly and only what a forward looks like — and verifies the
-- claim the way a server should: it finds the message that legitimately owns
-- that object, checks that THIS author can currently read that message, and
-- then writes `forwarded_author_id` itself from what it found. The client's
-- value is overwritten rather than trusted. A forward of something you cannot
-- see is refused outright.
--
-- With the column now written only by the server, the read policy can lean on
-- it, and the picture comes back for exactly the people who should see it.
--
-- What this deliberately does NOT do: copy the object. 0033's choice stands —
-- one upload, one file, however many rooms it reaches.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · Verify a forward at write time, and stamp its provenance.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.verify_forwarded_attachment()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_owner uuid;
begin
  -- No file, or the file is in the author's own folder: an ordinary send.
  -- Nothing to verify, and nothing to stamp.
  if new.attachment_path is null
     or (storage.foldername(new.attachment_path))[1] = new.author_id::text
  then
    return new;
  end if;

  -- Past here the row names an object the author did not upload, which is
  -- what a forward is. Find the message that legitimately carries it — one
  -- whose own author owns the folder — and that this author can read right
  -- now. `is_channel_member` and `is_dm_participant` answer for auth.uid(),
  -- so this is the forwarder's own reach, not the original sender's.
  select m.author_id into v_owner
  from public.messages m
  where m.attachment_path = new.attachment_path
    and (storage.foldername(m.attachment_path))[1] = m.author_id::text
    and public.is_channel_member(m.channel_id)
  limit 1;

  if v_owner is null then
    select d.author_id into v_owner
    from public.dm_messages d
    where d.attachment_path = new.attachment_path
      and (storage.foldername(d.attachment_path))[1] = d.author_id::text
      and public.is_dm_participant(d.thread_id)
    limit 1;
  end if;

  if v_owner is null then
    -- Either the object belongs to nobody's message, or it belongs to one
    -- this student cannot see. Both are the same answer.
    raise exception 'You can''t forward that attachment';
  end if;

  -- Stamp it from what we found rather than from what was sent. This is the
  -- line that makes the read policy below safe to write.
  new.forwarded_author_id := v_owner;
  return new;
end;
$$;

comment on function public.verify_forwarded_attachment() is
  'BEFORE INSERT on messages and dm_messages. A row naming an object outside its own author''s folder is a forward; this checks the forwarder can currently read a message that legitimately carries that object, refuses the insert if not, and writes forwarded_author_id itself from the verified owner. Added 0041 so that the chat-uploads read policy can trust forwarded_author_id — the client can still send the column, but whatever it sends is overwritten here. Trigger-only: not callable over RPC.';

revoke execute on function public.verify_forwarded_attachment()
  from public, anon, authenticated;

drop trigger if exists verify_forwarded_attachment on public.messages;
create trigger verify_forwarded_attachment
  before insert on public.messages
  for each row execute function public.verify_forwarded_attachment();

drop trigger if exists verify_forwarded_attachment on public.dm_messages;
create trigger verify_forwarded_attachment
  before insert on public.dm_messages
  for each row execute function public.verify_forwarded_attachment();

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Let a verified forward be readable in the room it landed in.
--
--     Same policy as 0039 with one disjunct added. The first three are
--     unchanged: your own upload, a channel message whose author owns the
--     object, a direct message whose author owns it. The fourth is the
--     forward — the object's folder must match the message's
--     `forwarded_author_id`, which section 1 guarantees was written by the
--     server after checking the forwarder could see the original.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "chat uploads are readable with the message they ride on"
  on storage.objects;

create policy "chat uploads are readable with the message they ride on"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and (
      -- Your own upload. Always, and first: the object exists before the
      -- message does, and outlives a send that failed.
      (storage.foldername(name))[1] = ( SELECT auth.uid() )::text
      -- A channel message in a room you are in, whose author uploaded it.
      or exists (
        select 1 from public.messages m
        where m.attachment_path = storage.objects.name
          and (storage.foldername(m.attachment_path))[1] = m.author_id::text
          and public.is_channel_member(m.channel_id)
      )
      -- A direct message in a thread you are part of, same rule.
      or exists (
        select 1 from public.dm_messages d
        where d.attachment_path = storage.objects.name
          and (storage.foldername(d.attachment_path))[1] = d.author_id::text
          and public.is_dm_participant(d.thread_id)
      )
      -- A forward into a room you are in. The folder is matched against
      -- forwarded_author_id, which only the trigger in section 1 writes.
      or exists (
        select 1 from public.messages m
        where m.attachment_path = storage.objects.name
          and m.forwarded_author_id is not null
          and (storage.foldername(m.attachment_path))[1]
              = m.forwarded_author_id::text
          and public.is_channel_member(m.channel_id)
      )
      or exists (
        select 1 from public.dm_messages d
        where d.attachment_path = storage.objects.name
          and d.forwarded_author_id is not null
          and (storage.foldername(d.attachment_path))[1]
              = d.forwarded_author_id::text
          and public.is_dm_participant(d.thread_id)
      )
    )
  );

comment on column public.messages.forwarded_author_id is
  'Who actually wrote the forwarded message, so the bubble can say whose words these are. Since 0041 it is also load-bearing for storage access — the chat-uploads read policy matches an attachment''s folder against this column — and is therefore written by the verify_forwarded_attachment trigger rather than by the client, which can send it but cannot decide it.';
