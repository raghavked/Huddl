-- Huddl schema: security hardening only. No new columns, no new screens,
-- no new product surface — six things that already shipped and are already
-- wrong, found by reading the policies back against what the app does.
--
-- Read section 1 before scheduling the deploy. Every photo ever sent in
-- Huddl — every course-room image, every DM photo — is readable and
-- listable today by any signed-in student at any university. That is the
-- reason this migration exists. Two others are worth reading before you
-- sign off: section 3.3, where a student can currently repoint their own
-- dm_participants row at somebody else's conversation, and section 3.1,
-- where a student can repoint their own notes row at somebody else's
-- private file and hand it to a whole class. The rest is ordinary
-- tightening.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · The chat-uploads bucket is private in name only.
--
--     0019 created the bucket and then wrote this:
--
--       create policy "authenticated users can read chat uploads"
--         on storage.objects for select to authenticated
--         using (bucket_id = 'chat-uploads');
--
--     Writes were namespaced properly — `(storage.foldername(name))[1]`
--     has to be the uploader's own id, so nobody can put a file in anyone
--     else's folder. Reads were never narrowed at all. `bucket_id` is the
--     entire predicate. Any signed-in student can list the bucket, walk
--     the object names, and mint a signed URL for any of them: photos from
--     course rooms they are not in, from campuses they do not attend, and
--     from other people's direct messages. The bucket being marked private
--     buys nothing when the read policy hands the key to the whole user
--     table.
--
--     The fix is the shape 0012 already used for the notes bucket: an
--     object is readable if you can read a message it is attached to. The
--     paths line up exactly — both clients store the storage key verbatim
--     in `attachment_path`, with no bucket prefix (`chatUploadPath` in
--     src/features/chat/attachments.ts builds `<uid>/<ts>-<rand>.<ext>`,
--     and mobile builds the same string inline) — which is the same
--     relationship 0012 leans on between `notes.storage_path` and
--     `storage.objects.name`.
--
--     Both message tables have to be consulted: channel messages have
--     carried attachment_path since 0004, direct messages since 0019.
--     Forwarding (0033) deliberately re-points a new message at the SAME
--     object rather than copying the file, so one object legitimately
--     hangs off several messages in several rooms. Two `exists` clauses
--     handle that on their own: a forward stays visible to the room it was
--     forwarded into, with no extra bookkeeping and no second file.
--
--     The uploader's own folder stays readable in its own right. The
--     object is created before the message row is, so a sender has to be
--     able to see their own attachment while it is still going out — and
--     if the send fails there is never a message row at all, only their
--     orphaned object.
-- ═══════════════════════════════════════════════════════════════════════

-- The new policy looks an object name up in both message tables on every
-- read. Neither column has ever been indexed, and a sequential scan of
-- `messages` per photo rendered is not something this app can afford.
-- Partial, because the overwhelming majority of messages carry no file.
create index if not exists messages_attachment_path_idx
  on public.messages (attachment_path) where attachment_path is not null;
create index if not exists dm_messages_attachment_path_idx
  on public.dm_messages (attachment_path) where attachment_path is not null;

drop policy if exists "authenticated users can read chat uploads" on storage.objects;

create policy "chat uploads are readable with the message they ride on"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'chat-uploads'
    and (
      -- Your own upload. Always, and first: the object exists before the
      -- message does, and outlives a send that failed.
      (storage.foldername(name))[1] = ( SELECT auth.uid() )::text
      -- Or it is attached to a channel message in a room you are in —
      -- but only if the object sits in the message author's own folder.
      --
      -- That second condition is the whole difference between a read gate
      -- and a wish. `attachment_path` is a plain writable column: without
      -- it, anyone could spin up a topic channel of their own (0004 lets
      -- any student create one), post a message naming somebody else's
      -- object key, and read it — the policy would be asking "can you
      -- WRITE a message pointing at this file", which every student can.
      -- Uploads already land at `<uploader-uuid>/<ts>-<rand>.<ext>` and the
      -- insert policy pins that folder to auth.uid(), so a message can only
      -- unlock a file its own author actually uploaded.
      or exists (
        select 1 from public.messages m
        where m.attachment_path = storage.objects.name
          and (storage.foldername(m.attachment_path))[1] = m.author_id::text
          and public.is_channel_member(m.channel_id)
      )
      -- Or to a direct message in a thread you are part of, same rule.
      or exists (
        select 1 from public.dm_messages d
        where d.attachment_path = storage.objects.name
          and (storage.foldername(d.attachment_path))[1] = d.author_id::text
          and public.is_dm_participant(d.thread_id)
      )
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · The profiles column grant, audited end to end.
--
--     0034 revoked the blanket UPDATE on profiles and granted back an
--     explicit column list so a student could not promote themselves to
--     moderator. Right call — but it turned the grant into a list every
--     future column has to be added to, and nothing fails loudly when one
--     is missed: the write round-trips, RLS passes, the column privilege
--     refuses, and the setting appears to save and then quietly does not.
--
--     That has already happened once. 0035 added profiles.quiet_hours and
--     never touched line 136 of 0034, so quiet hours has never saved for
--     anyone, on either client, since the day it shipped.
--
--     So this restates the whole list rather than appending to it, the way
--     0037 restated the enrollments grant when it found the same bug in
--     `color`. Every profiles column that exists as of 0038 was checked
--     against this list, one at a time.
--
--     Deliberately NOT granted, and each for its own reason:
--       id                — the primary key and the identity itself.
--       university_id     — which campus you belong to; the whole product
--                           is campus-scoped, and 0002's update policy
--                           already re-asserts it, but the grant is the
--                           backstop that does not depend on a policy.
--       phone_verified_at — the trust badge. Written only by the
--                           verification flow; self-settable, it is a lie.
--       is_moderator      — 0034 added this column specifically so it
--                           could be withheld here.
--       created_at        — history, not a setting.
--     (`phone` was dropped in 0012 and does not exist.)
--
--     Additive on purpose — a bare `grant`, no `revoke` first. A table-
--     level REVOKE would also drop every column-level grant, which turns
--     any out-of-order deploy into a silent regression of somebody else's
--     column. Restating the list is enough to make it correct.
-- ═══════════════════════════════════════════════════════════════════════

grant update (handle, display_name, avatar_url, bio, major, grad_year,
              is_public, accepted_terms_at, notification_prefs,
              share_read_receipts, share_typing, interests, looking_for,
              quiet_hours, updated_at)
  on public.profiles to authenticated;

comment on column public.profiles.quiet_hours is
  'Optional {"start":"22:00","end":"08:00","tz":"America/Los_Angeles"}. Inside the window the phone stays silent; the in-app inbox is never affected, and a deferred notification still arrives with the next digest. Named in the authenticated column grant since 0039 — before that the column existed and was silently unwritable, so the setting had never once saved.';

-- ═══════════════════════════════════════════════════════════════════════
-- 3 · Owner-scoped UPDATE policies that pin the owner and leave the scope
--     free.
--
--     The pattern: a policy says "this row is yours to edit" and stops
--     there. Ownership is checked on the new row, so you cannot give your
--     row away — but the column that decides WHICH course, room, thread or
--     campus the row belongs to is unconstrained, so you can keep the row
--     and move it somewhere you do not belong. Insert legitimately, then
--     repoint.
--
--     Postgres RLS cannot see OLD in WITH CHECK, so "the scoping column
--     must not change" is not expressible. The honest fix is to re-assert
--     on the new row the same membership predicate that let the row be
--     created in the first place — which is what 0012 did for messages and
--     dm_messages, and is the model followed throughout this section.
--
--     Every one of these is a no-op for legitimate editing. In each case
--     the table's own SELECT policy already requires the same predicate,
--     so any row a student can find in order to edit it is a row that
--     satisfies the new check. Nothing a student can see today stops being
--     editable.
--
--     3.9-3.11 are the same bug wearing a different hat: those policies
--     have no WITH CHECK at all, and Postgres reuses USING as the check —
--     which names only the owner, so they are loose in exactly the same
--     way and are fixed in exactly the same way.
--
--     Two entries do not fit the sentence at the top of this section and
--     are here anyway, because they are the same walk through the same
--     tables and it would be silly to leave them for another migration.
--     3.1 needs a column grant as well as a policy, because notes has a
--     scoping column — the object key of the file — that no WITH CHECK can
--     protect. And 3.13 is an INSERT policy that simply lost its campus
--     predicate in a refactor, so there is no repointing involved: the row
--     was never bounded in the first place.
-- ═══════════════════════════════════════════════════════════════════════

-- 3.1 · notes. Was:
--         using (uploader_id = ( SELECT auth.uid() ))
--         with check (uploader_id = ( SELECT auth.uid() ))
--       The insert policy is `uploader_id = auth.uid() and
--       is_enrolled(course_id)` (0006), so a student could upload a note to
--       their own class and then repoint course_id at any other course —
--       publishing a file into a room full of people they have never met.
drop policy if exists "uploaders can manage own notes" on public.notes;

create policy "uploaders can manage own notes"
  on public.notes for update
  to authenticated
  using (uploader_id = ( SELECT auth.uid() ))
  with check (
    uploader_id = ( SELECT auth.uid() )
    and public.is_enrolled(course_id)
  );

--        And pinning course_id is only half of it, because notes has a
--        second scoping column that the policy above cannot reach.
--
--        `storage_path` is the object key of the uploaded file, and 0012's
--        notes-bucket read policy is written as a join onto it:
--
--          bucket_id = 'notes' and (
--            (storage.foldername(name))[1] = auth.uid()::text
--            or exists (select 1 from public.notes n
--                       where n.storage_path = storage.objects.name
--                         and public.is_enrolled(n.course_id)))
--
--        There is no check that the object sits in the note uploader's own
--        folder — the same omission section 1 has just closed on
--        chat-uploads — but here the policy is not the place to fix it,
--        because the notes bucket has a legitimate second reader (the whole
--        class) and the row that names the file is a row the uploader
--        writes. So: upload one throwaway PDF to your own class, then
--        UPDATE your own row's storage_path to a classmate's object key.
--        The row stays yours, the course stays yours, every predicate in
--        the update policy above still passes — and the file you named is
--        now readable by you and by every student enrolled in your course.
--        A private ART200 study guide becomes a CHEM101 handout.
--
--        A policy cannot see which columns an UPDATE touched, so this is
--        the privilege system's job, the way 0029 fixed enrollments and
--        0034 fixed profiles: revoke the table-wide UPDATE and grant back
--        only what a student actually edits.
--
--        What they actually edit is `tags`, and only tags — updateNoteTags
--        in src/lib/notes.ts and mobile/src/lib/notes.ts both send
--        `{ tags }` alone, and they are the only update calls against this
--        table on either client. `title` and `description` are granted with
--        it because they are the note's own display copy, written at insert
--        and safe to correct afterwards; a typo in a title should not need
--        a re-upload.
--
--        Withheld, and each for its own reason:
--          storage_path   — the whole finding. Which file this row unlocks
--                           is decided at upload and never again.
--          file_name      — the name the download is saved under. Repointed
--                           alongside storage_path it is what makes a
--                           borrowed file look like your own.
--          course_id      — which class may read it. The policy above pins
--                           it to one the uploader is enrolled in; the
--                           grant is the backstop that holds even if that
--                           policy is ever loosened.
--          uploader_id    — the row's owner and the delete policy's whole
--                           predicate.
--          file_size,
--          mime_type      — facts about the object, recorded by the upload.
--                           Free-text mime_type is what the client renders
--                           the row's icon from; there is no reason to let
--                           it drift from the file.
--          download_count — a tally. It moves only through
--                           increment_note_download (0010), a SECURITY
--                           DEFINER function that runs as its owner and is
--                           therefore unaffected by this revoke.
--          id, created_at — identity and history.
revoke update on public.notes from authenticated;
grant update (title, description, tags) on public.notes to authenticated;

comment on column public.notes.storage_path is
  'Object key in the `notes` bucket, stored verbatim with no bucket prefix. 0012''s bucket read policy joins storage.objects.name onto this column, which makes it a read grant and not just a pointer: whoever this row names, this row''s course can read. Immutable to the uploader since 0039 — it is absent from the authenticated column grant — because before that a student could repoint their own row at a classmate''s private file and publish it to their own class.';

-- 3.2 · channel_members. Was:
--         using (user_id = ( SELECT auth.uid() ))
--         with check (user_id = ( SELECT auth.uid() ))
--       channel_id was free, so a student could take their membership row
--       in a channel they had joined and point it at any other channel —
--       including the course and club rooms that 0012 went out of its way
--       to stop them self-inserting into, and channels at other campuses.
--       Join one open room, become a member of anything.
--
--       Note what this does NOT re-assert: 0012's insert predicate, which
--       requires `kind in ('campus','topic')`. Re-asserting that here would
--       lock every student out of muting or marking read in their own
--       COURSE rooms, since those rows are created by trigger and would
--       fail the check on every ordinary update. `is_channel_member` on the
--       new row is the predicate that actually holds for a legitimate edit
--       and fails for a repoint: it is answered from the pre-statement
--       snapshot, so pointing at a channel you are not already in reads
--       false.
drop policy if exists "members can update own membership" on public.channel_members;

create policy "members can update own membership"
  on public.channel_members for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (
    user_id = ( SELECT auth.uid() )
    and public.is_channel_member(channel_id)
  );

-- 3.3 · dm_participants. Was:
--         using (user_id = ( SELECT auth.uid() ))
--         with check (user_id = ( SELECT auth.uid() ))
--       This is the worst of the group. dm_participants has no INSERT
--       policy at all — rows exist only because create_dm_thread and the
--       group RPCs put them there — but thread_id was writable, so any
--       student could take the participant row from a thread of their own
--       and repoint it at an arbitrary dm_threads id, making themselves a
--       participant in a stranger's conversation and unlocking every
--       is_dm_participant() check in the schema behind it. The clients only
--       ever write last_read_at here.
drop policy if exists "participants can update own read state" on public.dm_participants;

create policy "participants can update own read state"
  on public.dm_participants for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (
    user_id = ( SELECT auth.uid() )
    and public.is_dm_participant(thread_id)
  );

-- 3.4 · board_posts. Was:
--         using (author_id = ( SELECT auth.uid() ))
--         with check (author_id = ( SELECT auth.uid() ))
--       university_id was free, so a student could post to their own board
--       and then edit the row onto another university's board — the one
--       thing the board's whole design is meant to prevent. The insert
--       policy already says `university_id = current_university_id()`.
drop policy if exists "authors edit their own posts" on public.board_posts;

create policy "authors edit their own posts"
  on public.board_posts for update
  to authenticated
  using (author_id = ( SELECT auth.uid() ))
  with check (
    author_id = ( SELECT auth.uid() )
    and university_id = public.current_university_id()
  );

-- 3.5 · study_buddy_optins. Was:
--         using (user_id = ( SELECT auth.uid() ))
--         with check (user_id = ( SELECT auth.uid() ))
--       course_id was free against an insert policy of `user_id =
--       auth.uid() and is_enrolled(course_id)` (0030), so a student could
--       raise their hand in their own class and then move the row into any
--       other course's study-buddy list. Both clients reach this row
--       through an upsert, whose conflict path already had to satisfy the
--       insert check, so nothing changes for them.
drop policy if exists "students edit their own note" on public.study_buddy_optins;

create policy "students edit their own note"
  on public.study_buddy_optins for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (
    user_id = ( SELECT auth.uid() )
    and public.is_enrolled(course_id)
  );

-- 3.6 · availability_votes. Was:
--         using (user_id = ( SELECT auth.uid() ))
--         with check (user_id = ( SELECT auth.uid() ))
--       The scoping column here is slot_id, and it was free: an answer
--       given in your own room could be moved onto a slot belonging to a
--       poll in a channel you are not a member of. Re-asserts the
--       membership half of the insert policy (0033).
--
--       Deliberately NOT re-asserting `p.closed_at is null`. The insert
--       policy has it, and the upsert path both clients use is therefore
--       already bound by it; adding it to the update would additionally
--       stop a plain UPDATE changing an answer after a poll closes, which
--       is a product decision and not a security one. Left as it is.
drop policy if exists "students change their own answer" on public.availability_votes;

create policy "students change their own answer"
  on public.availability_votes for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (
    user_id = ( SELECT auth.uid() )
    and exists (
      select 1 from public.availability_slots s
      join public.availability_polls p on p.id = s.poll_id
      where s.id = availability_votes.slot_id
        and public.is_channel_member(p.channel_id)
    )
  );

-- 3.7 · polls. Was:
--         using (creator_id = ( SELECT auth.uid() ))
--         with check (creator_id = ( SELECT auth.uid() ))
--       channel_id free. polls has no insert policy — create_poll is a
--       definer RPC that checks membership — but the update policy let a
--       creator move a finished poll, and the message stream it belongs
--       to, into a room they are not in.
drop policy if exists "creators can close their polls" on public.polls;

create policy "creators can close their polls"
  on public.polls for update
  to authenticated
  using (creator_id = ( SELECT auth.uid() ))
  with check (
    creator_id = ( SELECT auth.uid() )
    and public.is_channel_member(channel_id)
  );

-- 3.8 · availability_polls. Was:
--         using (creator_id = ( SELECT auth.uid() ))
--         with check (creator_id = ( SELECT auth.uid() ))
--       Same shape as 3.7, same free channel_id. The mobile client also
--       writes event_id through this policy when a poll turns into an
--       event; that keeps working, since the creator is a member.
drop policy if exists "creators close their polls" on public.availability_polls;

create policy "creators close their polls"
  on public.availability_polls for update
  to authenticated
  using (creator_id = ( SELECT auth.uid() ))
  with check (
    creator_id = ( SELECT auth.uid() )
    and public.is_channel_member(channel_id)
  );

-- 3.9 · decks. Was:
--         using (created_by = ( SELECT auth.uid() ))
--       — and no WITH CHECK, so USING is reused as the check and course_id
--       is free. The insert policy is `created_by = auth.uid() and
--       is_enrolled(course_id)` (0024). A deck could be renamed into
--       another course's deck list.
drop policy if exists "deck creators can rename their decks" on public.decks;

create policy "deck creators can rename their decks"
  on public.decks for update
  to authenticated
  using (created_by = ( SELECT auth.uid() ))
  with check (
    created_by = ( SELECT auth.uid() )
    and public.is_enrolled(course_id)
  );

-- 3.10 · cards. Same missing WITH CHECK, and deck_id free: a card could be
--        edited into any deck in the database, including decks in courses
--        the author has nothing to do with.
drop policy if exists "card authors can edit their cards" on public.cards;

create policy "card authors can edit their cards"
  on public.cards for update
  to authenticated
  using (created_by = ( SELECT auth.uid() ))
  with check (
    created_by = ( SELECT auth.uid() )
    and exists (
      select 1 from public.decks d
      where d.id = cards.deck_id and public.is_enrolled(d.course_id)
    )
  );

-- 3.11 · course_calendar_items. Same missing WITH CHECK, course_id free.
--        This one writes to a calendar every classmate reads and every
--        reminder sweep fires off, so a repointed row puts a fake exam on
--        the shared calendar of a class the author is not in. Re-asserts
--        the enrollment predicate the insert policy uses (0018).
drop policy if exists "authors can edit their calendar items" on public.course_calendar_items;

create policy "authors can edit their calendar items"
  on public.course_calendar_items for update
  to authenticated
  using (created_by = ( SELECT auth.uid() ))
  with check (
    created_by = ( SELECT auth.uid() )
    and exists (
      select 1 from public.enrollments e
      where e.course_id = course_calendar_items.course_id
        and e.user_id = ( SELECT auth.uid() )
    )
  );

-- 3.12 · events. The sweep above went table by table and this one was
--        missed, which is awkward, because it is 3.4 exactly: 0012 rewrote
--        the update policy to add the club-officer check and carried
--        forward only `creator_id = auth.uid()` beside it —
--
--          using (creator_id = ( SELECT auth.uid() ))
--          with check (creator_id = ( SELECT auth.uid() )
--                      and (club_id is null or is_club_officer(club_id)))
--
--        — while the insert policy immediately above it in the same file
--        says `university_id = current_university_id()`. So a student
--        creates a perfectly ordinary meetup on their own campus and then
--        moves it onto another university's events feed, where nobody at
--        that school can trace it back to a campus they can see. Same
--        consequence as the board_posts hole in 3.4, on a surface with a
--        date and a location on it.
--
--        Worth knowing why this one has not been noticed: when an UPDATE
--        carries a WHERE clause — which everything through PostgREST does —
--        Postgres also requires the new row to satisfy the table's SELECT
--        policies, and `events are visible within own university` (0006)
--        catches the repoint by accident. An unfiltered UPDATE does not
--        need SELECT rights and sails straight through. Leaning on that is
--        leaning on a coincidence between two policies written years apart
--        for different reasons; the check belongs in the policy that is
--        supposed to be enforcing it.
--
--        The club predicate is restated unchanged. course_id is left free
--        on purpose: the insert policy has never constrained it either, an
--        event may legitimately name a course the creator is not enrolled
--        in (that is how a study session advertises for classmates), and
--        the campus check now bounds which courses are reachable at all.
drop policy if exists "creators can update own events" on public.events;

create policy "creators can update own events"
  on public.events for update
  to authenticated
  using (creator_id = ( SELECT auth.uid() ))
  with check (
    creator_id = ( SELECT auth.uid() )
    and university_id = public.current_university_id()
    and (club_id is null or public.is_club_officer(club_id))
  );

-- 3.13 · event_rsvps, and this one is not a repoint — it is an outright
--        missing predicate, on the insert as well as the update.
--
--        0006 wrote a single FOR ALL policy:
--
--          using (user_id = auth.uid())
--          with check (user_id = auth.uid()
--                      and exists (select 1 from events e
--                                  where e.id = event_id
--                                    and e.university_id = current_university_id()))
--
--        0036 split it into separate insert / update / delete policies so
--        it would stop answering SELECT as well, which was the right call —
--        but the campus half of the WITH CHECK did not come across to
--        either write policy. Both are now `user_id = ( SELECT auth.uid() )`
--        and nothing else, so a student can RSVP 'going' to any event in
--        the database by id: another university's meetup, a private club
--        session at a school they have never been to. Their name and handle
--        then appear in that event's attendee list, which 0006's read policy
--        shows to everyone on that campus, and send_event_reminders (0027)
--        starts pushing them the reminders for it.
--
--        Note that the SELECT policy 0036 wrote is why this is worse than
--        the rest of section 3 rather than merely equal to it: `user_id =
--        ( SELECT auth.uid() ) or (event is on my campus)` means your own
--        rows are always visible to you, so the new row stays readable and
--        the accidental protection described in 3.12 never engages.
--
--        Both policies get 0006's predicate back, verbatim. The delete
--        policy is left alone — withdrawing an RSVP you should never have
--        been able to make is not something to stand in the way of, and the
--        row is keyed to you either way.
drop policy if exists "students add their own rsvp" on public.event_rsvps;

create policy "students add their own rsvp"
  on public.event_rsvps for insert
  to authenticated
  with check (
    user_id = ( SELECT auth.uid() )
    and exists (
      select 1 from public.events e
      where e.id = event_rsvps.event_id
        and e.university_id = public.current_university_id()
    )
  );

drop policy if exists "students change their own rsvp" on public.event_rsvps;

create policy "students change their own rsvp"
  on public.event_rsvps for update
  to authenticated
  using (user_id = ( SELECT auth.uid() ))
  with check (
    user_id = ( SELECT auth.uid() )
    and exists (
      select 1 from public.events e
      where e.id = event_rsvps.event_id
        and e.university_id = public.current_university_id()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 4 · A moderator could rewrite the report they were triaging.
--
--     `moderators triage the queue` is a whole-row UPDATE. 0038 correctly
--     bound it to the moderator's own campus, but it still says nothing
--     about columns, and `authenticated` holds the default table-wide
--     UPDATE privilege on reports — so a moderator could edit the
--     reporter's words, change the category, repoint message_id at some
--     other message, or move reporter_id onto a different student. Nobody
--     has done that. It should not be possible: the queue's authority
--     rests on the report being the reporter's account of what happened,
--     unaltered by the person judging it.
--
--     Narrowed the way 0034 narrowed profiles — a column-scoped grant, so
--     the privilege system enforces it rather than a policy predicate that
--     cannot see which columns an UPDATE touched. `status` is the entire
--     triage surface: open → reviewed | dismissed, and back, which is what
--     both clients already send and all they send (`setStatus` in
--     src/lib/moderation.ts updates `{ status }` alone).
--
--     The row-level policy is restated unchanged from 0038 so that the
--     rule and its reason sit together. It still does the work the grant
--     cannot: which ROWS a moderator may touch at all.
-- ═══════════════════════════════════════════════════════════════════════

revoke update on public.reports from authenticated;
grant update (status) on public.reports to authenticated;

comment on column public.reports.status is
  'Triage state: open → reviewed | dismissed, and reversible in both directions. The only column a moderator may write — 0039 revoked the table-wide UPDATE from authenticated and granted this column alone, so the reporter''s reason, the named message and the reporter''s own identity are immutable to the person triaging them.';

drop policy if exists "moderators triage the queue" on public.reports;

create policy "moderators triage the queue"
  on public.reports for update
  to authenticated
  using (
    public.is_moderator()
    and exists (
      select 1 from public.profiles p
      where p.id = reports.reporter_id
        and p.university_id = public.current_university_id()
    )
  )
  with check (
    public.is_moderator()
    and exists (
      select 1 from public.profiles p
      where p.id = reports.reporter_id
        and p.university_id = public.current_university_id()
    )
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 5 · Two notification triggers never learned about blocking.
--
--     0019 introduced blocks with a promise the app repeats in four
--     places: the person you blocked cannot reach you. Four of the six
--     person-to-person notification paths honour it — notify_dm_message
--     (0019/0028), notify_mentions (0019), notify_note_thanks (0026) and
--     notify_club_announcement (0028) all end in
--     `not public.is_blocked_either(...)`. Two do not, and both are ways
--     for someone you have blocked to put their name and 140 characters of
--     their choosing on your phone:
--
--       notify_thread_reply (0007) — replying to your message. The most
--         direct route of the two, and the oldest.
--       notify_course_calendar_item (0018) — adding an item to a shared
--         class calendar fans a notification out to every classmate,
--         blocked or not, with the item title as the body.
--
--     Both get the same predicate the other four use, and nothing else.
--
--     Checked and deliberately left alone: notify_schedule_event (0007),
--     send_event_reminders (0027), send_calendar_reminders (0032),
--     send_weekly_digest (0024) and send_weekly_recap (0034). None of
--     those has a second person in it — they are the database telling you
--     something about your own data — so there is no block to honour.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.notify_thread_reply()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  parent_author uuid;
begin
  if new.parent_id is null then
    return new;
  end if;
  select author_id into parent_author from public.messages where id = new.parent_id;
  if parent_author is null or parent_author = new.author_id then
    return new;
  end if;
  -- A block silences the reply notification in both directions, the same
  -- way it silences a DM, a mention, a thanks and a club post.
  if public.is_blocked_either(parent_author, new.author_id) then
    return new;
  end if;

  insert into public.notifications (user_id, kind, title, body, link)
  select parent_author, 'thread_reply',
         pr.display_name || ' replied to your message',
         left(new.content, 140),
         '/channels/' || new.channel_id || '?thread=' || new.parent_id
  from public.profiles pr where pr.id = new.author_id;
  return new;
end;
$$;

comment on function public.notify_thread_reply() is
  'Tells the parent message''s author that someone replied in their thread. Silent across a block in either direction (added 0039 — it was the one person-to-person trigger that never checked). Trigger-only: not callable over RPC.';

revoke execute on function public.notify_thread_reply() from public, anon, authenticated;

create or replace function public.notify_course_calendar_item()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_code text;
begin
  if new.source <> 'manual' then
    return new; -- syllabus imports announce themselves once, in-app
  end if;
  select c.code into v_code from public.courses c where c.id = new.course_id;
  insert into public.notifications (user_id, kind, title, body, link)
  select e.user_id, 'course_calendar',
         v_code || ': ' || new.title,
         case new.kind
           when 'exam' then 'New exam on the class calendar'
           when 'quiz' then 'New quiz on the class calendar'
           when 'assignment' then 'New assignment on the class calendar'
           else 'New date on the class calendar'
         end,
         '/courses/' || new.course_id
  from public.enrollments e
  where e.course_id = new.course_id
    and e.user_id <> coalesce(new.created_by, '00000000-0000-0000-0000-000000000000')
    -- Added 0039. A shared calendar is still a person putting their words
    -- in front of you. When created_by is null (a deleted author) the
    -- helper finds no row and this stays true, so the fan-out is unchanged.
    and not public.is_blocked_either(e.user_id, new.created_by);
  return new;
end;
$$;

comment on function public.notify_course_calendar_item() is
  'Tells the class that a classmate hand-added a date. Syllabus imports stay quiet (they announce themselves once, in-app), the author never notifies themselves, and since 0039 it skips anyone on either side of a block. Trigger-only: not callable over RPC.';

revoke execute on function public.notify_course_calendar_item() from public, anon, authenticated;

-- ═══════════════════════════════════════════════════════════════════════
-- 6 · Muting a room has never stopped the phone buzzing.
--
--     channel_members.muted has existed since 0004 and both clients write
--     it — the channel list has a mute toggle, and mobile has one in the
--     room header. Nothing on the server has ever read it. A student who
--     mutes a busy course room still gets pushed for every reply to their
--     message and every @mention in it, which is the exact thing they just
--     asked to stop.
--
--     Two places have to honour it, because 0035 split delivery in two:
--     the per-notification trigger that pushes immediately, and the
--     five-minute digest sweep that carries what the trigger deferred.
--
--     Scope is the delicate part. Muting a room must silence that room and
--     nothing else — not a DM, not a reminder, not a club post, not the
--     Sunday recap. Notifications carry no channel_id column, so the room
--     is recovered from the link, and only for the kinds that are actually
--     channel-derived: 'thread_reply' and 'mention' both link to
--     '/channels/<uuid>', and 'channel' is included because it is in the
--     kind constraint and would link the same way if anything ever raised
--     it. Every other kind returns false without looking at anything.
--
--     Fails open, in the style of in_quiet_hours: a link that does not
--     parse, a null link, an unfamiliar kind — all of them mean "not
--     muted". A bug in this function must never be the reason somebody
--     misses a message.
--
--     A muted notification has to be marked settled rather than left
--     deferred. The inbox still receives it — muting a room is not leaving
--     it — but it must not resurface in the digest an hour later, which is
--     what leaving pushed_at null would cause.
--
--     Marking it settled is NOT the same as marking it delivered, and
--     that distinction is the whole of 6.1 below. 0035 writes `pushed_at
--     := now()` for a kind the student has opted out of, and the obvious
--     thing to do here was copy it. It is wrong, for both of them:
--     pushed_at feeds the two-minute coalesce probe further down the same
--     function, so a row stamped now() without a push having happened
--     tells the next notification that the phone buzzed a moment ago. Mute
--     one busy course room and the next DM, the next due-date reminder,
--     the next anything is silently held back for two minutes — the mute
--     leaking out of the room it was set in, which is the one thing
--     section 6 says it must never do.
--
--     So a settled-but-never-pushed row is stamped '-infinity' instead: a
--     real timestamptz, so `pushed_at is null` stops matching it and the
--     digest lets it alone, but a moment that can never be inside any
--     recent window, so the coalesce probe cannot mistake it for a
--     delivery. The probe also names it explicitly rather than relying on
--     the arithmetic working out, because a reader should not have to
--     derive that.
--
--     The opted-out branch inherited from 0035 is changed to the same
--     sentinel in the same breath. It is the identical bug — opt out of
--     'thanks' and your DMs go quiet for two minutes — and fixing the mute
--     branch alone would leave the function writing two different meanings
--     into one column three lines apart.
-- ═══════════════════════════════════════════════════════════════════════

create or replace function public.push_muted_channel(
  p_user_id uuid,
  p_kind text,
  p_link text
)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_channel uuid;
begin
  -- Channel-derived kinds only. Muting a room must not silence a direct
  -- message, a due-date reminder, a club post or a weekly recap.
  if p_kind is null or p_kind not in ('thread_reply', 'mention', 'channel') then
    return false;
  end if;
  if p_link is null then
    return false;
  end if;

  begin
    v_channel := substring(p_link from '^/channels/([0-9a-fA-F-]{36})')::uuid;
  exception when others then
    return false; -- an odd link must never be the reason a push is dropped
  end;

  if v_channel is null then
    return false;
  end if;

  return exists (
    select 1 from public.channel_members cm
    where cm.channel_id = v_channel
      and cm.user_id = p_user_id
      and cm.muted
  );
end;
$$;

comment on function public.push_muted_channel(uuid, text, text) is
  'Has this student muted the room this notification came out of? Answers only for channel-derived kinds (thread_reply, mention, channel), reading the channel id out of the notification link, and returns false for everything else so that muting a room can never silence a DM or a reminder. Fails open on anything unexpected. SECURITY DEFINER over channel_members and deliberately NOT executable by authenticated — like is_blocked_either since 0037, it answers for arbitrary user ids and would otherwise let anyone probe who has muted what.';

revoke execute on function public.push_muted_channel(uuid, text, text)
  from public, anon, authenticated;

-- 6.1 · pushed_at grows a third state. Null still means deferred and a
--       real timestamp still means delivered; '-infinity' means settled
--       without a delivery — the student asked not to be told, so there is
--       nothing to carry forward and nothing to coalesce against.
comment on column public.notifications.pushed_at is
  'Three states, all read by the push path and by nothing else. Null: deferred — the student is inside quiet hours or a push went out moments ago — and the digest sweep will carry it. A real timestamp: this row was handed to a device at that moment. ''-infinity'' (added 0039): settled without a delivery, because the student had opted out of the kind or muted the room it came from. The sentinel exists so that "we are done with this row" and "the phone just buzzed" stop being the same value: the digest skips it because it is not null, and the two-minute coalesce probe ignores it because it is not recent.';

-- The push trigger, unchanged from 0035 except for the mute check and the
-- sentinel described above.
create or replace function public.push_notification()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_profile public.profiles;
  v_recent timestamptz;
  v_messages jsonb;
begin
  select * into v_profile from public.profiles where id = new.user_id;
  if not found then
    return new;
  end if;

  -- Per-kind opt-out: the inbox still gets it, the phone does not, and it
  -- is not deferred either — an opted-out kind is simply never pushed.
  -- Settled, not delivered: see 6.1. Was now() from 0035 until 0039.
  if coalesce(v_profile.notification_prefs ->> new.kind, 'on') = 'off' then
    new.pushed_at := '-infinity'::timestamptz;
    return new;
  end if;

  -- Muted room: same treatment as an opted-out kind. Settled rather than
  -- deferred, so the digest does not deliver in an hour what the student
  -- asked not to be told about at all — and settled rather than delivered,
  -- so muting one room cannot hold back the next DM.
  if public.push_muted_channel(new.user_id, new.kind, new.link) then
    new.pushed_at := '-infinity'::timestamptz;
    return new;
  end if;

  -- Quiet hours: leave it deferred so the morning digest carries it.
  if public.in_quiet_hours(v_profile.quiet_hours, now()) then
    return new;
  end if;

  -- Coalesce: one buzz per two minutes. Anything closer rides the digest.
  -- Only real deliveries count. A '-infinity' row was settled without ever
  -- reaching a device, and would otherwise let a muted room or an
  -- opted-out kind silence everything else for two minutes. The sentinel
  -- could never win a max() against a real timestamp anyway, but that is
  -- arithmetic and this is the rule, so it is written down.
  select max(n.pushed_at) into v_recent
  from public.notifications n
  where n.user_id = new.user_id
    and n.pushed_at is not null
    and n.pushed_at > '-infinity'::timestamptz;

  if v_recent is not null and v_recent > now() - interval '2 minutes' then
    return new;
  end if;

  select jsonb_agg(jsonb_build_object(
    'to', pt.token,
    'title', new.title,
    'body', coalesce(new.body, ''),
    'data', jsonb_build_object('link', coalesce(new.link, '')),
    'sound', 'default'
  ))
  into v_messages
  from public.push_tokens pt
  where pt.user_id = new.user_id;

  if v_messages is not null then
    perform net.http_post(
      url := 'https://exp.host/--/api/v2/push/send',
      headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
      body := v_messages
    );
  end if;

  new.pushed_at := now();
  return new;
end;
$$;

comment on function public.push_notification() is
  'BEFORE INSERT on notifications: decides whether this one reaches a device now, rides the digest, or never pushes at all. Honours the per-kind opt-out, a muted channel (0039), quiet hours, and a two-minute coalesce window. Writes pushed_at on NEW, which is why it runs BEFORE — a real timestamp when a device was actually asked, and the ''-infinity'' sentinel when the row is settled without a push, so that an opt-out or a mute can never be read back as a recent delivery and coalesce away somebody''s DM. Trigger-only: not callable over RPC.';

revoke execute on function public.push_notification() from public, anon, authenticated;

-- The digest sweep, unchanged from 0035 except for the mute handling. The
-- trigger above already settles muted rows on the way in, so in ordinary
-- operation there is nothing here to do — this is for a row deferred by an
-- older code path, or by a mute set after the notification landed, which
-- must not be swept up and delivered as part of somebody's pile.
--
-- Filtering such a row out of the aggregate is not enough, and this is the
-- second half of the same mistake as 6.1. The statement that clears
-- pushed_at lives inside the loop body, and the loop only has a body to run
-- for students who produced an aggregate row. A student whose entire
-- deferred pile is muted produces none — the filter removed every row they
-- had — so they are never visited, their rows keep pushed_at null forever,
-- and they accumulate in notifications_deferred_idx (0035), a partial index
-- whose whole premise is that `pushed_at is null` is a transient state.
-- Every five minutes the sweep re-reads them, re-decides to skip them, and
-- leaves them exactly where they were.
--
-- So they are settled first, in one statement, before the loop can form its
-- groups. That both empties the index and takes them out of the `pushed_at
-- is null` set the aggregate reads, which is why the aggregate below no
-- longer needs a mute predicate of its own: one rule, evaluated once per
-- row instead of twice. It also keeps the blanket UPDATE at the bottom of
-- the loop honest — that statement stamps now() on everything still null
-- for the student it just pushed to, and a muted row has no business
-- collecting a delivery timestamp on the back of somebody else's digest.
create or replace function public.send_push_digests()
returns void
language plpgsql security definer set search_path = public
as $$
declare
  r record;
  v_messages jsonb;
  v_title text;
  v_body text;
begin
  -- Settle anything from a muted room before the loop sees it. Not bounded
  -- to the last 24 hours: the point is to leave the deferred index empty,
  -- and an older row is exactly the one that has been stuck longest.
  update public.notifications n
  set pushed_at = '-infinity'::timestamptz
  where n.pushed_at is null
    and public.push_muted_channel(n.user_id, n.kind, n.link);

  for r in
    select n.user_id,
           count(*) as pending,
           min(n.title) as sample_title,
           max(n.created_at) as latest
    from public.notifications n
    join public.profiles p on p.id = n.user_id
    where n.pushed_at is null
      and n.created_at > now() - interval '24 hours'
      and not public.in_quiet_hours(p.quiet_hours, now())
      and coalesce(p.notification_prefs ->> n.kind, 'on') <> 'off'
    group by n.user_id
    having max(n.created_at) < now() - interval '90 seconds'
  loop
    if r.pending = 1 then
      v_title := r.sample_title;
      v_body := 'While you were away.';
    else
      v_title := r.pending || ' new notifications';
      v_body := 'Including: ' || r.sample_title;
    end if;

    select jsonb_agg(jsonb_build_object(
      'to', pt.token,
      'title', v_title,
      'body', v_body,
      'data', jsonb_build_object('link', '/notifications'),
      'sound', 'default'
    ))
    into v_messages
    from public.push_tokens pt
    where pt.user_id = r.user_id;

    if v_messages is not null then
      perform net.http_post(
        url := 'https://exp.host/--/api/v2/push/send',
        headers := '{"Content-Type": "application/json", "Accept": "application/json"}'::jsonb,
        body := v_messages
      );
    end if;

    update public.notifications
    set pushed_at = now()
    where user_id = r.user_id and pushed_at is null;
  end loop;
end;
$$;

comment on function public.send_push_digests() is
  'The five-minute sweep behind huddl-push-digests: one push per student for the pile of notifications the trigger deferred. Skips students inside quiet hours and kinds they have opted out of. Since 0039 it first settles any still-deferred notification from a muted channel to the ''-infinity'' sentinel, which keeps it out of the digest and out of notifications_deferred_idx — a student whose whole pile is muted never enters the loop, so nothing inside the loop can ever clear their rows. Cron-only: not executable by any client role.';

revoke execute on function public.send_push_digests() from public, anon, authenticated;

comment on column public.channel_members.muted is
  'The student has muted this room. Read by the push path since 0039 — push_muted_channel drops the device push for thread replies and mentions raised in this channel, while the in-app inbox still receives them, because muting a room is not leaving it. Before 0039 nothing on the server read this column and a muted room buzzed exactly like any other.';
