/* What a course note is allowed to be, as one table.
 *
 * There are three places that have to agree about this and until now only two
 * of them existed. Each client kept its own extension list for the file
 * picker, and the storage bucket accepted anything under 25 MB, so the
 * "allow-list" was a suggestion that a direct API call walked straight past.
 * Migration 0049 puts the same set on the bucket, which makes this table the
 * thing both halves are generated from rather than two lists that drift.
 *
 * It also fixes the reason the bucket could not be locked down before. Both
 * uploaders fell back to "application/octet-stream" whenever the OS did not
 * hand them a type, which happens routinely for .md and for .heic on some
 * Android builds. Against a MIME allow-list that fallback is a rejection of a
 * perfectly good file, so the type is derived from the extension instead.
 *
 * The web copy is src/lib/note-types.ts and must match. A test enforces it.
 */

/**
 * Extension to content type, for every kind of file a note can be.
 *
 * Coursework, in other words: documents, slides, spreadsheets, plain text and
 * photographs of a whiteboard. Deliberately no archives and nothing
 * executable. A .zip of a lecture series is a reasonable thing to want and an
 * unreasonable thing to accept from a stranger on your campus.
 *
 * SVG is absent on purpose, the same reason migration 0044 keeps it out of
 * the avatar and chat buckets: an SVG served from storage is a script.
 */
export const NOTE_CONTENT_TYPES: Readonly<Record<string, string>> = {
  pdf: "application/pdf",
  doc: "application/msword",
  docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  ppt: "application/vnd.ms-powerpoint",
  pptx: "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  xls: "application/vnd.ms-excel",
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv",
  txt: "text/plain",
  md: "text/markdown",
  rtf: "application/rtf",
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  heic: "image/heic",
};

/** The extensions the file picker offers, derived so the two cannot disagree. */
export const ACCEPTED_NOTE_EXTENSIONS: readonly string[] =
  Object.keys(NOTE_CONTENT_TYPES);

/**
 * Every distinct content type, which is what the bucket's `allowed_mime_types`
 * has to hold. Sorted so the migration and this list can be eyeballed against
 * each other.
 */
export const ACCEPTED_NOTE_CONTENT_TYPES: readonly string[] = [
  ...new Set(Object.values(NOTE_CONTENT_TYPES)),
].sort();

/** The lowercased extension of a filename, or "" when it has none. */
export function noteExtension(fileName: string): string {
  const at = fileName.lastIndexOf(".");
  if (at <= 0 || at === fileName.length - 1) return "";
  return fileName.slice(at + 1).toLowerCase();
}

/** Whether this filename is one a note can be. */
export function isAcceptedNote(fileName: string): boolean {
  return noteExtension(fileName) in NOTE_CONTENT_TYPES;
}

/**
 * The content type to upload a note under.
 *
 * The extension wins over whatever the OS said. That is deliberate: a picker
 * that reports "application/octet-stream" for a .md file is not telling us
 * anything, and a picker that reports "image/jpeg" for a file named .png is
 * telling us something wrong. The extension is what both clients already
 * validate against, so it is the thing the bucket should be asked about.
 *
 * @returns A type from {@link NOTE_CONTENT_TYPES}, or null when the extension
 *   is not one we accept. Null means do not upload; the caller already refused
 *   the file for the same reason.
 */
export function noteContentType(fileName: string): string | null {
  return NOTE_CONTENT_TYPES[noteExtension(fileName)] ?? null;
}
