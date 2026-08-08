import type { DocumentPickerAsset } from "expo-document-picker";
import { supabase } from "@/lib/supabase";

/* Shared course notes: storage + table helpers, mirroring the web app's
   conventions exactly (src/features/notes/note-upload.tsx and migrations
   0006/0008/0012):
   - bucket "notes", object key `<uploaderId>/<random>-<sanitized name>`
     (RLS requires the first folder to be auth.uid())
   - table public.notes with storage_path / file_name / file_size / mime_type
   - reads via short-lived signed URLs. */

export const NOTES_BUCKET = "notes";

/** Same cap as the web uploader (note-upload.tsx). */
export const MAX_NOTE_BYTES = 25 * 1024 * 1024;

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
  created_at: string;
  uploader: NoteUploader | null;
};

const NOTE_SELECT =
  "id, course_id, uploader_id, title, description, storage_path, file_name, file_size, mime_type, created_at, uploader:profiles(id, display_name, avatar_url)";

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
  return (data ?? []) as unknown as NoteRow[];
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
 */
export async function uploadNote({
  courseId,
  userId,
  file,
  title,
  description,
}: {
  courseId: string;
  userId: string;
  /** From expo-document-picker's getDocumentAsync (copyToCacheDirectory). */
  file: DocumentPickerAsset;
  title: string;
  description?: string;
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
    })
    .select(NOTE_SELECT)
    .single();

  if (insertError || !note) {
    // Roll back the orphaned file so storage stays tidy (web parity).
    await supabase.storage.from(NOTES_BUCKET).remove([storagePath]);
    throw new NotesError("Couldn't save your note. Please try again.");
  }
  return note as unknown as NoteRow;
}
