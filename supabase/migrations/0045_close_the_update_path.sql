-- Huddl schema: two tables where the INSERT was guarded and the UPDATE was
-- not, and one of them undoes a fix from three migrations ago.
--
-- ═══════════════════════════════════════════════════════════════════════
-- 1 · messages and dm_messages: a blanket UPDATE grant walks around 0041.
--
--     0039 shut the chat-uploads bucket by requiring that an object sit in
--     the folder of the author of a message you can read. 0041 reopened
--     forwarding on top of that by trusting `forwarded_author_id` — safe,
--     it argued, because a BEFORE INSERT trigger writes that column itself
--     from a verified lookup and overwrites whatever the client sent.
--
--     BEFORE INSERT. Not before update. And `authenticated` holds a
--     table-wide UPDATE grant on both message tables, while the update
--     policy asks only `author_id = auth.uid()`, which is a question about
--     WHOSE row and no question at all about WHICH COLUMNS. So the sequence
--     that defeats it is: insert an ordinary message with no attachment,
--     which the trigger waves through because there is nothing to verify;
--     then update that same row, setting `attachment_path` to a stranger's
--     object key and `forwarded_author_id` to that stranger's id. The read
--     policy's forward disjunct matches, and the photo opens. The hole 0039
--     closed is open again, reached by a different verb.
--
--     The same grant hands over more besides. `pinned_at` and `pinned_by`
--     exist so that only a moderator can pin, through a definer RPC — but
--     an author could set them directly on their own message. `created_at`
--     decides where a message sits in the room's history. `channel_id`
--     moves a message into any other channel the author belongs to, since
--     the WITH CHECK re-tests membership and is satisfied. `poll_id` staples
--     somebody else's poll to your words.
--
--     Every edit either client performs is `content, edited_at` or
--     `deleted_at` — checked, all seven call sites across both apps. So the
--     grant can say exactly that, and the answer to all of the above becomes
--     "permission denied for column".
-- ═══════════════════════════════════════════════════════════════════════

revoke update on public.messages from authenticated;
grant update (content, edited_at, deleted_at) on public.messages to authenticated;

revoke update on public.dm_messages from authenticated;
grant update (content, edited_at, deleted_at) on public.dm_messages to authenticated;

-- Belt and braces, so the invariant survives the next person to widen a
-- grant: run 0041's verification on UPDATE as well. Scoped with WHEN to the
-- two columns that matter, because re-verifying on every edit would mean a
-- student who forwarded a photo and later left the source channel could no
-- longer fix a typo in their own caption.
drop trigger if exists verify_forwarded_attachment_update on public.messages;
create trigger verify_forwarded_attachment_update
  before update on public.messages
  for each row
  when (
    new.attachment_path is distinct from old.attachment_path
    or new.forwarded_author_id is distinct from old.forwarded_author_id
  )
  execute function public.verify_forwarded_attachment();

drop trigger if exists verify_forwarded_attachment_update on public.dm_messages;
create trigger verify_forwarded_attachment_update
  before update on public.dm_messages
  for each row
  when (
    new.attachment_path is distinct from old.attachment_path
    or new.forwarded_author_id is distinct from old.forwarded_author_id
  )
  execute function public.verify_forwarded_attachment();

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · phone_verifications: the student holds the pen on their own proof.
--
--     The "Verified" badge is `profiles.phone_verified_at`, and 0039 took
--     that column out of the profiles grant precisely because a badge you
--     can set yourself is a lie. The badge is therefore written by
--     /api/phone/check with the service client, after it checks a code
--     against `phone_verifications.code_hash`.
--
--     But `phone_verifications` is written by the student's own session —
--     /api/phone/start inserts through `createClient()` — so `authenticated`
--     needs INSERT and, as it happens, held UPDATE and DELETE too. Which
--     means a student never has to receive a text at all:
--
--       insert into phone_verifications (user_id, phone, code_hash, expires_at)
--       values (me, '+1...anything', sha256('123456'), now() + interval '10 min');
--
--     then POST /api/phone/check with 123456. The route finds the row, the
--     hash matches, and it stamps the badge with the service client on a
--     number nobody ever sent an SMS to. The one column 0039 protected is
--     handed over by the table that vouches for it.
--
--     So the proof stops being client-writable. The route writes it with the
--     service client instead — the same client it already uses one function
--     call later for the badge — and SELECT stays, because the phone screen
--     reads the number back to prefill the field.
-- ═══════════════════════════════════════════════════════════════════════

revoke insert, update, delete on public.phone_verifications from authenticated;

comment on table public.phone_verifications is
  'One row per verification attempt: the number, a hash of the code, an expiry and an attempt count. Owner-readable so the phone screen can prefill the number, and NOT owner-writable since 0045 — the row is the evidence behind profiles.phone_verified_at, and a student who can write their own code_hash can mint the Verified badge on any number without an SMS ever being sent. Both /api/phone routes write it with the service client.';
