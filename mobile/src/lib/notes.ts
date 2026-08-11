import type { DocumentPickerAsset } from "expo-document-picker";
import { supabase } from "@/lib/supabase";

/* Shared course notes: storage + table helpers, mirroring the web app's
   conventions exactly (src/features/notes/note-upload.tsx and migrations
   0006/0008/0012):
   - bucket "notes", object key `<uploaderId>/<random>-<sanitized name>`
     (RLS requires the first folder to be auth.uid())
   - table public.notes with storage_path / file_name / file_size / mime_type
   - reads via short-lived signed URLs.

   Migration 0032 added notes.tags — see the tags block below. */

export const NOTES_BUCKET = "notes";

/** Same cap as the web uploader (note-upload.tsx). */
export const MAX_NOTE_BYTES = 25 * 1024 * 1024;

/* ────────────────────────────── note tags ──────────────────────────────
   0032 added `notes.tags text[]` with a before-insert/update trigger that
   trims, lowercases, drops anything shorter than 2 or longer than 24
   characters, dedupes, and keeps the first five. Nothing here re-implements
   that: we send what the student typed and read the saved row back, so the
   screen settles on the database's answer instead of guessing at it. The
   constants exist so a composer can cap the picker and the text field
   politely — not so it can pre-normalize. */

/** The trigger keeps the first five tags; don't let a student pick a sixth. */
export const MAX_NOTE_TAGS = 5;

/** A tag survives the trigger at 2–24 characters once trimmed. */
export const MIN_NOTE_TAG_LENGTH = 2;
export const MAX_NOTE_TAG_LENGTH = 24;

/**
 * A starter vocabulary for the composer to offer as Chips — the words a class
 * actually files notes under. Not a whitelist: "discussion 2" or "orgo" are
 * just as welcome, so keep the free-text field next to the chips.
 */
export const SUGGESTED_TAGS: readonly string[] = [
  "lecture",
  "midterm",
  "final",
  "lab",
  "problem set",
  "cheatsheet",
  "reading",
];

/** Same allow-list as the web uploader — parity, not a security boundary. */
const ACCEPTED_EXTENSIONS: readonly string[] = [
  "pdf",
  "doc",
  "docx",
  "ppt",
  "pptx",
  "xls",
  "xlsx",
  "csv",
  "txt",
  "md",
  "rtf",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "heic",
];

/* Minimal local row shapes — the web app's types live outside this tsconfig. */

export type NoteUploader = {
  id: string;
  display_name: string;
  avatar_url: string | null;
};

export type NoteRow = {
  id: string;
  course_id: string;
  uploader_id: string;
  title: string;
  description: string | null;
  storage_path: string;
  file_name: string;
  file_size: number;
  mime_type: string | null;
  /**
   * Lowercase, deduped, at most five — whatever the trigger settled on, never
   * whatever was sent. Always an array; empty is the common case.
   */
  tags: string[];
  created_at: string;
  uploader: NoteUploader | null;
};

/** One tag in use on a course's notes, and how many notes wear it. */
export type CourseTag = {
  tag: string;
  count: number;
};

const NOTE_SELECT =
  "id, course_id, uploader_id, title, description, storage_path, file_name, file_size, mime_type, tags, created_at, uploader:profiles(id, display_name, avatar_url)";

/** Warm, user-facing failures — safe to show as-is. */
export class NotesError extends Error {}

/** "1.2 MB" — same buckets as the web's formatFileSize. */
export function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/** Keep the original name readable but safe for a storage key (web parity). */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "");
  return (cleaned || "file").slice(-100);
}

/** The web uses crypto.randomUUID(); Hermes may not have it, so fall back. */
function randomKey(): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === "function") {
    return cryptoObj.randomUUID();
  }
  return [
    Date.now().toString(36),
    Math.random().toString(36).slice(2, 10),
    Math.random().toString(36).slice(2, 10),
  ].join("-");
}

/** All notes for a course, newest first, with uploader profiles attached. */
export async function listNotes(courseId: string): Promise<NoteRow[]> {
  const { data, error } = await supabase
    .from("notes")
    .select(NOTE_SELECT)
    .eq("course_id", courseId)
    .order("created_at", { ascending: false });
  if (error) {
    throw new NotesError("We couldn't load the notes for this course.");
  }
  const rows: unknown = data ?? [];
  if (!Array.isArray(rows)) return [];
  return rows.map(toNoteRow);
}

/**
 * Every tag in use on this course's notes, with a count each — busiest first,
 * alphabetical within a tie. That ordering is what makes a filter bar useful:
 * "lecture (18)" sits where the eye lands, and the long tail stays stable
 * between refreshes instead of shuffling.
 *
 * One query. The tallying happens on the phone (see {@link tallyTags}) because
 * a course's notes number in the dozens, not the thousands, and a `select
 * tags` is cheaper than teaching the database a new RPC.
 *
 * A course with no tagged notes returns an empty array, not an error — the
 * filter bar simply doesn't appear yet.
 *
 * @throws {NotesError} With copy that's ready to render.
 */
export async function fetchCourseTags(courseId: string): Promise<CourseTag[]> {
  const { data, error } = await supabase
    .from("notes")
    .select("tags")
    .eq("course_id", courseId);
  if (error) {
    throw new NotesError("We couldn't load the tags for this course.");
  }
  const rows: unknown = data ?? [];
  if (!Array.isArray(rows)) return [];

  const lists: string[][] = [];
  for (const row of rows) {
    if (typeof row !== "object" || row === null) continue;
    lists.push(toTagList((row as Record<string, unknown>)["tags"]));
  }
  return tallyTags(lists);
}

/**
 * Short-lived (60s) signed URL for a note file — open it right away.
 * `filePath` is the notes row's storage_path.
 */
export async function getSignedUrl(filePath: string): Promise<string> {
  const { data, error } = await supabase.storage
    .from(NOTES_BUCKET)
    .createSignedUrl(filePath, 60);
  if (error || !data?.signedUrl) {
    throw new NotesError("Couldn't prepare that file. Give it another try.");
  }
  return data.signedUrl;
}

/**
 * Upload a picked document and insert its notes row, using the web's exact
 * path convention (`<userId>/<random>-<name>`). Rolls the file back if the
 * row insert fails. Throws NotesError with a warm message on any failure.
 *
 * `tags` goes to the database exactly as typed — the trigger does the
 * trimming, lowercasing and capping, and the returned row carries the result.
 */
export async function uploadNote({
  courseId,
  userId,
  file,
  title,
  description,
  tags,
}: {
  courseId: string;
  userId: string;
  /** From expo-document-picker's getDocumentAsync (copyToCacheDirectory). */
  file: DocumentPickerAsset;
  title: string;
  description?: string;
  /** What the student typed or tapped. Normalized server-side; omit for none. */
  tags?: readonly string[];
}): Promise<NoteRow> {
  const cleanTitle = title.trim().slice(0, 120);
  if (!cleanTitle) {
    throw new NotesError("Give your note a title first.");
  }
  if (!ACCEPTED_EXTENSIONS.includes(fileExtension(file.name))) {
    throw new NotesError(
      "That file type isn't supported. Share a document, slides, spreadsheet or image."
    );
  }
  if (typeof file.size === "number" && file.size > MAX_NOTE_BYTES) {
    throw new NotesError(
      `That file is ${formatFileSize(file.size)} — the limit is 25 MB.`
    );
  }

  // Read the picked file off disk. copyToCacheDirectory means the uri is a
  // local file:// path our own app can always read.
  let bytes: ArrayBuffer;
  try {
    const response = await fetch(file.uri);
    bytes = await response.arrayBuffer();
  } catch {
    throw new NotesError("We couldn't read that file. Try picking it again.");
  }
  if (bytes.byteLength === 0) {
    throw new NotesError("That file looks empty. Try picking it again.");
  }
  if (bytes.byteLength > MAX_NOTE_BYTES) {
    throw new NotesError(
      `That file is ${formatFileSize(bytes.byteLength)} — the limit is 25 MB.`
    );
  }

  const storagePath = `${userId}/${randomKey()}-${sanitizeFileName(file.name)}`;
  const mimeType = file.mimeType ?? null;

  const { error: uploadError } = await supabase.storage
    .from(NOTES_BUCKET)
    .upload(storagePath, bytes, {
      contentType: mimeType ?? "application/octet-stream",
      upsert: false,
    });
  if (uploadError) {
    throw new NotesError(
      "Upload didn't make it. Check your connection and try again."
    );
  }

  const { data: note, error: insertError } = await supabase
    .from("notes")
    .insert({
      course_id: courseId,
      uploader_id: userId,
      title: cleanTitle,
      description: description?.trim().slice(0, 500) || null,
      storage_path: storagePath,
      file_name: file.name,
      file_size: bytes.byteLength,
      mime_type: mimeType,
      tags: tags ? [...tags] : [],
    })
    .select(NOTE_SELECT)
    .single();

  if (insertError || !note) {
    // Roll back the orphaned file so storage stays tidy (web parity).
    await supabase.storage.from(NOTES_BUCKET).remove([storagePath]);
    throw new NotesError("Couldn't save your note. Please try again.");
  }
  return toNoteRow(note);
}

/**
 * Replace a note's tags. Only the uploader may do this — 0006's "uploaders can
 * manage own notes" policy scopes the UPDATE to `uploader_id = auth.uid()`, so
 * a classmate's attempt updates nothing rather than erroring.
 *
 * Pass the whole set every time, not a delta: `[]` clears the note's tags.
 * The saved row comes back so the screen can settle on the normalized tags —
 * "  Midterm 2 " went out, `midterm 2` comes home, and a duplicate or a
 * one-letter typo quietly vanishes. Safe to run optimistically: show the tags
 * as typed, then replace them with `row.tags` when this resolves, and roll
 * back to the old set if it throws.
 *
 * @param noteId The `notes.id` being retagged.
 * @param tags   What the student typed or tapped, in their order.
 * @returns The full note row as the database now has it.
 * @throws {NotesError} With copy that's ready to render.
 */
export async function setNoteTags(
  noteId: string,
  tags: readonly string[]
): Promise<NoteRow> {
  const { data, error } = await supabase
    .from("notes")
    .update({ tags: [...tags] })
    .eq("id", noteId)
    .select(NOTE_SELECT)
    .maybeSingle();
  if (error) {
    throw new NotesError("Those tags didn't save. Give it another try.");
  }
  // Zero rows updated isn't an error to PostgREST — it means the policy didn't
  // match: someone else shared this note, or it's been taken down since.
  if (!data) {
    throw new NotesError("Only whoever shared this note can change its tags.");
  }
  return toNoteRow(data);
}

/* ─────────────────── narrowing + pure helpers (no I/O) ─────────────────── */

/**
 * Shape one PostgREST row into a NoteRow. The client is untyped and two fields
 * want care: `uploader` comes back as an object OR a one-element array
 * depending on how PostgREST resolves the embed, and `tags` is an array only
 * because a column default says so. Everything else the table declares NOT
 * NULL, so it travels as-is.
 */
function toNoteRow(row: unknown): NoteRow {
  const record: Record<string, unknown> =
    typeof row === "object" && row !== null
      ? (row as Record<string, unknown>)
      : {};
  const embedded = record["uploader"];
  const profile: unknown = Array.isArray(embedded) ? embedded[0] : embedded;
  return {
    ...(record as unknown as NoteRow),
    tags: toTagList(record["tags"]),
    uploader:
      typeof profile === "object" && profile !== null
        ? (profile as NoteUploader)
        : null,
  };
}

/** A text[] off the wire, with the nulls and non-strings dropped. */
function toTagList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const out: string[] = [];
  for (const tag of value) {
    if (typeof tag === "string" && tag.length > 0) out.push(tag);
  }
  return out;
}

/**
 * Count how many notes wear each tag: busiest first, alphabetical within a
 * tie. Pure — hand it the tag arrays of any set of notes, including ones a
 * screen already has in state, and no second round trip is needed.
 *
 * A note counts once per tag even if its array somehow repeats one, so the
 * count is always "notes", never "mentions".
 */
export function tallyTags(
  noteTags: readonly (readonly string[])[]
): CourseTag[] {
  const counts = new Map<string, number>();
  for (const tags of noteTags) {
    const seen = new Set<string>();
    for (const tag of tags) {
      if (seen.has(tag)) continue;
      seen.add(tag);
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
  }
  return Array.from(counts, ([tag, count]) => ({ tag, count })).sort(
    byCountThenName
  );
}

/* Plain `<` rather than localeCompare: tags land lowercased by the trigger,
   and a comparison that doesn't depend on the engine's locale data keeps the
   filter bar in the same order on every phone. */
function byCountThenName(a: CourseTag, b: CourseTag): number {
  if (a.count !== b.count) return b.count - a.count;
  if (a.tag === b.tag) return 0;
  return a.tag < b.tag ? -1 : 1;
}
