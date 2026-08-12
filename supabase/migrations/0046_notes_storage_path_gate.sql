-- Huddl schema: the hole 0039 closed for chat photos is still open for notes.
--
-- 0039's finding was that `chat-uploads` let any signed-in student read any
-- object, and the fix had two halves: a message you can see has to name the
-- object, AND the object has to sit in that message's own author's folder.
-- The second half is the one that does the work, because `attachment_path` is
-- a plain writable column — without it, a student could name somebody else's
-- object key in a message of their own and read it.
--
-- `notes` has the same two moving parts and only the first half of the fix:
--
--   read:   bucket_id = 'notes' AND (your own folder
--                                    OR a notes row names this object
--                                       and you are enrolled in its course)
--   insert: uploader_id = auth.uid() AND is_enrolled(course_id)
--
-- Nothing anywhere says the object has to be in the uploader's folder, and
-- nothing constrains `storage_path` on the way in. So:
--
--   1. Mallory enrols herself in any course — enrolment is self-service, and
--      `is_enrolled` asks about her own row.
--   2. She inserts a note: uploader_id herself, course_id that class,
--      storage_path 'alice-uuid/alices-private-notes.pdf'. Both halves of the
--      insert policy are satisfied, because neither is about the path.
--   3. The read policy now matches that object for her — and for everyone
--      else in the course.
--
-- She has published a classmate's private file to a class, and can download
-- it herself. Coursework is arguably the more sensitive of the two buckets.
--
-- Fixed the same way, in both places, because either alone would leave
-- something wrong. The insert gate stops the bogus row being written at all,
-- which is what keeps a fabricated note from appearing in a course listing
-- with a download that fails. The read gate is what makes the object
-- unreachable regardless — including for any row written before today.
--
-- 0039 already took `storage_path` out of the notes UPDATE grant (that grant
-- is title, description, tags), so there is no update path to close here.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · You may only file a note that points at your own upload.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "classmates can share notes" on public.notes;

create policy "classmates can share notes"
  on public.notes for insert
  to authenticated
  with check (
    uploader_id = ( SELECT auth.uid() )
    and public.is_enrolled(course_id)
    -- The path has to be inside your own folder, which is the same thing the
    -- bucket's own insert policy requires of the upload itself. Without this
    -- the row can name any object in the bucket.
    and (storage.foldername(storage_path))[1] = ( SELECT auth.uid() )::text
  );

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · A note file opens only if the note that names it really owns it.
-- ═══════════════════════════════════════════════════════════════════════

drop policy if exists "classmates can read note files" on storage.objects;

create policy "classmates can read note files"
  on storage.objects for select
  to authenticated
  using (
    bucket_id = 'notes'
    and (
      -- Your own upload. First, because the object exists before the note row
      -- does and outlives a share that failed halfway.
      (storage.foldername(name))[1] = ( SELECT auth.uid() )::text
      -- A note in a class you are in, whose uploader owns the file.
      or exists (
        select 1 from public.notes n
        where n.storage_path = storage.objects.name
          and (storage.foldername(n.storage_path))[1] = n.uploader_id::text
          and public.is_enrolled(n.course_id)
      )
    )
  );

comment on column public.notes.storage_path is
  'Key of the file in the private `notes` bucket, always `<uploader_id>/<name>`. Both the insert policy and the bucket''s read policy check that first folder against the uploader since 0046: the column is client-supplied, so without that check a student could file a note pointing at a classmate''s object and publish it to a whole course. Not in the authenticated UPDATE grant (0039), so it cannot be repointed after the fact.';
