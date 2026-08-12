-- Huddl schema: give the storage buckets the limits the clients have always
-- pretended were there.
--
-- Every uploader in both apps checks a size and a type before it calls
-- storage: 5 MB for an avatar, 10 MB for a chat photo, 25 MB for a note, and
-- an extension list for notes that says of itself, in the source, "parity,
-- not a security boundary". It is right about that. All four buckets were
-- created with `file_size_limit` and `allowed_mime_types` both null, so the
-- server accepted whatever was sent, and a check that runs only in the client
-- is a suggestion.
--
-- Two things follow from that, one boring and one not.
--
-- The boring one is cost. Nothing stopped a student POSTing a two-gigabyte
-- file into their own avatar folder, as many times as they liked. The insert
-- policy checks the folder, which is the right question about *where*, and no
-- question at all about *how big*.
--
-- The other one is `avatars`, which is the one public bucket — it has to be,
-- because a profile photo is fetched by URL with no session. The web
-- uploader's type check is `file.type.startsWith("image/")`, and
-- `image/svg+xml` passes it. An SVG is a document: it can carry a <script>
-- element, and opening its public URL directly runs that script in the
-- storage domain's origin. No Huddl session lives on that origin, so this is
-- not a route to somebody's account — it is a way to host an executable page,
-- and a convincing phishing form, on infrastructure that answers to our
-- project. That is worth closing on its own.
--
-- The lists below are deliberately generous, because the failure mode of
-- being too strict here is a student who cannot upload their own face and has
-- no idea why. Every writer in both clients was traced first:
--   web avatar        `file.type`, gated on startsWith("image/")
--   native avatar     always "image/jpeg"
--   web chat          `file.type`, from accept="image/*"
--   native chat       `asset.mimeType ?? "image/jpeg"` from the photo picker
-- so a broad raster-image list breaks none of them. `image/svg+xml` is the
-- one omission, and it is the point of the exercise.

-- ═══════════════════════════════════════════════════════════════════════
-- 1 · Pictures of people and pictures in chat: raster images, and not SVG.
-- ═══════════════════════════════════════════════════════════════════════

update storage.buckets
set file_size_limit = 5 * 1024 * 1024,
    allowed_mime_types = array[
      'image/jpeg', 'image/pjpeg', 'image/png', 'image/webp',
      'image/gif', 'image/heic', 'image/heif', 'image/avif',
      'image/bmp', 'image/tiff'
    ]
where id = 'avatars';

update storage.buckets
set file_size_limit = 10 * 1024 * 1024,
    allowed_mime_types = array[
      'image/jpeg', 'image/pjpeg', 'image/png', 'image/webp',
      'image/gif', 'image/heic', 'image/heif', 'image/avif',
      'image/bmp', 'image/tiff'
    ]
where id = 'chat-uploads';

-- ═══════════════════════════════════════════════════════════════════════
-- 2 · Notes and schedules: a ceiling, but no type list.
--
--     Not an oversight. Both note uploaders fall back to
--     'application/octet-stream' when the browser or the OS does not report a
--     type, which is common for the coursework formats this bucket exists to
--     hold. A type allow-list would reject those uploads, and the student
--     would read "couldn't upload that" about a perfectly ordinary .docx.
--
--     The trade is acceptable because neither bucket is public: both are
--     read through short-lived signed URLs, so nothing here can be handed
--     round as a link the way an avatar can. And an object stored as
--     octet-stream is served as octet-stream, which browsers download rather
--     than render — the download is the safe outcome.
--
--     `schedules` has no writer in either client today; the size limit is
--     there so that whoever adds one inherits a ceiling instead of having to
--     remember one.
-- ═══════════════════════════════════════════════════════════════════════

update storage.buckets
set file_size_limit = 25 * 1024 * 1024
where id = 'notes';

update storage.buckets
set file_size_limit = 10 * 1024 * 1024
where id = 'schedules';
