"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  Download,
  File as FileGeneric,
  FileImage,
  FileSpreadsheet,
  FileText,
  Loader2,
  Presentation,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { NoteUpload } from "@/features/notes/note-upload";
import { createClient } from "@/lib/supabase/client";
import { formatFileSize, formatMessageTime } from "@/lib/utils";
import type { Note, Profile } from "@/lib/types";

export type NoteWithUploader = Note & { uploader: Profile | null };

const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic"]);
const SHEET_EXTENSIONS = new Set(["xls", "xlsx", "csv"]);
const SLIDE_EXTENSIONS = new Set(["ppt", "pptx", "key"]);
const DOC_EXTENSIONS = new Set(["pdf", "doc", "docx", "txt", "md", "rtf"]);

function fileTypeIcon(mime: string | null, fileName: string): LucideIcon {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mime?.startsWith("image/") || IMAGE_EXTENSIONS.has(ext)) return FileImage;
  if (mime?.includes("spreadsheet") || mime === "text/csv" || SHEET_EXTENSIONS.has(ext)) {
    return FileSpreadsheet;
  }
  if (mime?.includes("presentation") || SLIDE_EXTENSIONS.has(ext)) {
    return Presentation;
  }
  if (mime === "application/pdf" || mime?.startsWith("text/") || DOC_EXTENSIONS.has(ext)) {
    return FileText;
  }
  return FileGeneric;
}

/**
 * Notes tab of a course page: upload affordance + the shared-notes list.
 * The server page passes the RLS-scoped notes; uploads are shown optimistically
 * (merged by id once router.refresh() brings the server copy back).
 */
export function NotesSection({
  courseId,
  currentUser,
  notes,
}: {
  courseId: string;
  currentUser: Profile;
  notes: NoteWithUploader[];
}) {
  const router = useRouter();
  const [extraNotes, setExtraNotes] = useState<NoteWithUploader[]>([]);
  const [removedIds, setRemovedIds] = useState<string[]>([]);
  const [downloadingId, setDownloadingId] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [announcement, setAnnouncement] = useState("");

  const visible = useMemo(() => {
    const known = new Set(notes.map((note) => note.id));
    const removed = new Set(removedIds);
    return [...extraNotes.filter((note) => !known.has(note.id)), ...notes].filter(
      (note) => !removed.has(note.id)
    );
  }, [notes, extraNotes, removedIds]);

  function handleUploaded(note: Note) {
    setExtraNotes((prev) => [{ ...note, uploader: currentUser }, ...prev]);
    setAnnouncement(`"${note.title}" was shared with the class.`);
    router.refresh();
  }

  async function handleDownload(note: NoteWithUploader) {
    setError(null);
    setDownloadingId(note.id);
    try {
      const supabase = createClient();
      const { data, error: urlError } = await supabase.storage
        .from("notes")
        .createSignedUrl(note.storage_path, 60, { download: note.file_name });
      if (urlError || !data?.signedUrl) {
        throw urlError ?? new Error("No signed URL returned");
      }
      // The signed URL carries a content-disposition: attachment, so this
      // triggers a download without navigating away.
      const link = document.createElement("a");
      link.href = data.signedUrl;
      link.rel = "noopener";
      document.body.append(link);
      link.click();
      link.remove();
    } catch {
      setError("Couldn't prepare that download. Please try again.");
    } finally {
      setDownloadingId(null);
    }
  }

  async function handleDelete(note: NoteWithUploader) {
    setError(null);
    setDeletingId(note.id);
    const supabase = createClient();
    // Best effort on the file itself — if it's already gone we still want the
    // row removed. RLS limits both calls to the uploader's own note.
    await supabase.storage.from("notes").remove([note.storage_path]);
    const { error: deleteError } = await supabase
      .from("notes")
      .delete()
      .eq("id", note.id)
      .eq("uploader_id", currentUser.id);
    setDeletingId(null);
    if (deleteError) {
      setError("Couldn't delete that note. Please try again.");
      return;
    }
    setConfirmingId(null);
    setRemovedIds((prev) => [...prev, note.id]);
    setAnnouncement(`"${note.title}" was deleted.`);
    router.refresh();
  }

  return (
    <div>
      <NoteUpload
        courseId={courseId}
        userId={currentUser.id}
        onUploaded={handleUploaded}
      />

      <p aria-live="polite" className="sr-only">
        {announcement}
      </p>

      {error ? (
        <p
          role="alert"
          className="mt-4 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          icon={FileText}
          title="No notes yet"
          description="Be the first to share lecture notes, study guides or slides with your classmates."
        />
      ) : (
        <ul className="mt-4 space-y-2">
          {visible.map((note) => {
            const TypeIcon = fileTypeIcon(note.mime_type, note.file_name);
            const mine = note.uploader_id === currentUser.id;
            const uploaderName = note.uploader?.display_name ?? "Classmate";
            return (
              <li
                key={note.id}
                className="flex items-start gap-3 rounded-card border border-border bg-surface p-4"
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-full bg-accent-soft"
                  title={note.file_name}
                >
                  <TypeIcon className="size-5 text-accent" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="truncate text-sm font-semibold">{note.title}</p>
                  {note.description ? (
                    <p className="mt-0.5 line-clamp-2 text-sm text-muted">
                      {note.description}
                    </p>
                  ) : null}
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-muted">
                    <Avatar
                      name={uploaderName}
                      src={note.uploader?.avatar_url}
                      size="xs"
                    />
                    <span className="font-medium text-foreground">
                      {mine ? "You" : uploaderName}
                    </span>
                    <span aria-hidden>·</span>
                    <span>{formatFileSize(note.file_size)}</span>
                    <span aria-hidden>·</span>
                    <span>{formatMessageTime(note.created_at)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  {confirmingId === note.id ? (
                    <>
                      <span className="text-xs font-medium text-muted">
                        Delete?
                      </span>
                      <button
                        type="button"
                        onClick={() => handleDelete(note)}
                        disabled={deletingId === note.id}
                        className="inline-flex items-center gap-1 rounded-full bg-danger px-3 py-1.5 text-xs font-semibold text-white transition-opacity hover:opacity-90 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                      >
                        {deletingId === note.id ? (
                          <Loader2
                            className="size-3.5 animate-spin"
                            aria-hidden
                          />
                        ) : null}
                        Yes
                      </button>
                      <button
                        type="button"
                        onClick={() => setConfirmingId(null)}
                        disabled={deletingId === note.id}
                        aria-label="Keep this note"
                        className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </>
                  ) : (
                    <>
                      <button
                        type="button"
                        onClick={() => handleDownload(note)}
                        disabled={downloadingId === note.id}
                        aria-label={`Download ${note.title}`}
                        title="Download"
                        className="rounded-full p-2 text-muted transition-colors hover:bg-brand-soft hover:text-brand-strong disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        {downloadingId === note.id ? (
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                        ) : (
                          <Download className="size-4" aria-hidden />
                        )}
                      </button>
                      {mine ? (
                        <button
                          type="button"
                          onClick={() => {
                            setError(null);
                            setConfirmingId(note.id);
                          }}
                          aria-label={`Delete ${note.title}`}
                          title="Delete"
                          className="rounded-full p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      ) : null}
                    </>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
