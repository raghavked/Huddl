-- ═══════════════════════════════════════════════════════════════════════
-- The notes bucket accepted anything under 25 MB.
--
-- 0044 gave every bucket a size limit and gave avatars and chat-uploads a
-- type allow-list, but left notes with a ceiling and nothing else. Its own
-- comment said the extension list in the clients was "parity, not a security
-- boundary", which was accurate and is the problem: both clients check the
-- extension in the file picker, and a direct call to the storage API skips
-- the picker entirely.
--
-- So the bucket that holds the one thing students upload from strangers on
-- their campus would take an executable, a .zip, or an SVG. An SVG served
-- from storage is a script, which is exactly why 0044 kept it out of the
-- other two buckets.
--
-- This also backs a promise the documents now make. The Terms say we act on
-- copyright notices and the Guidelines say what a note is for; a bucket that
-- takes arbitrary binaries makes both harder to mean.
--
-- The list is generated from mobile/src/lib/note-types.ts, which is now the
-- single table both clients and this migration are written from. Sixteen
-- distinct types covering documents, slides, spreadsheets, plain text and
-- photographs of a whiteboard. No archives, nothing executable, no SVG.
--
-- ONE BEHAVIOURAL DEPENDENCY, and it ships in the same change: both
-- uploaders used to fall back to "application/octet-stream" whenever the OS
-- gave them no type, which happens routinely for .md and for .heic on some
-- Android builds. Against this list that fallback is a rejection of a
-- perfectly good file. Both now derive the type from the extension instead.
-- Applying this migration without those client changes would break uploads.
-- ═══════════════════════════════════════════════════════════════════════

update storage.buckets
set allowed_mime_types = array[
      'application/msword',
      'application/pdf',
      'application/rtf',
      'application/vnd.ms-excel',
      'application/vnd.ms-powerpoint',
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      'image/gif',
      'image/heic',
      'image/jpeg',
      'image/png',
      'image/webp',
      'text/csv',
      'text/markdown',
      'text/plain'
    ]
where id = 'notes';

-- `schedules` still has no writer in either client. Leaving it size-only
-- rather than guessing at a list for a feature that has not been built:
-- an empty bucket with a 10 MB ceiling and no grants is not reachable, and
-- inventing types now would just be a comment pretending to be a control.
