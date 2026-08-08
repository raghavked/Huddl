"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  CircleAlert,
  Download,
  File as FileGeneric,
  FileImage,
  FileSpreadsheet,
  FileText,
  Heart,
  Loader2,
  Presentation,
  Trash2,
  X,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { EmptyState } from "@/components/empty-state";
import { NotesScene } from "@/components/illustrations";
import { buttonClasses, cardClasses } from "@/components/ui";
import { NoteUpload } from "@/features/notes/note-upload";
import { createClient } from "@/lib/supabase/client";
import { cn, formatFileSize, formatMessageTime } from "@/lib/utils";
import type { Note, Profile } from "@/lib/types";

export type NoteWithUploader = Note & { uploader: Profile | null };

/** Per-note gratitude: how many classmates said thanks, and whether I did. */
type ThanksEntry = { count: number; mine: boolean };

const NO_THANKS: ThanksEntry = { count: 0, mine: false };

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

  // Gratitude on the visible notes (migration 0026): one query, reduced to
  // {count, mine} per note. Keyed on the id set so toggles don't refetch.
  const [thanks, setThanks] = useState<Record<string, ThanksEntry>>({});
  const thanksInFlight = useRef<Set<string>>(new Set());
  const visibleIdsKey = useMemo(
    () => visible.map((note) => note.id).sort().join(","),
    [visible]
  );

  useEffect(() => {
    if (visibleIdsKey === "") {
      setThanks({});
      return;
    }
    let cancelled = false;
    const supabase = createClient();
    void supabase
      .from("note_thanks")
      .select("note_id, user_id")
      .in("note_id", visibleIdsKey.split(","))
      .then(({ data, error: fetchError }) => {
        // Best effort — a hiccup keeps whatever we already had.
        if (cancelled || fetchError) return;
        const reduced: Record<string, ThanksEntry> = {};
        for (const row of (data ?? []) as { note_id: string; user_id: string }[]) {
          const current = reduced[row.note_id] ?? NO_THANKS;
          reduced[row.note_id] = {
            count: current.count + 1,
            mine: current.mine || row.user_id === currentUser.id,
          };
        }
        setThanks(reduced);
      });
    return () => {
      cancelled = true;
    };
  }, [visibleIdsKey, currentUser.id]);

  /** Give thanks, or take it back — optimistic either way, rolled back on
   *  failure. The uploader hears about it through the server-side trigger. */
  async function toggleThanks(note: NoteWithUploader) {
    // You can't thank yourself — the server agrees, so don't even try.
    if (note.uploader_id === currentUser.id) return;
    if (thanksInFlight.current.has(note.id)) return;
    thanksInFlight.current.add(note.id);
    const previous = thanks[note.id] ?? NO_THANKS;
    const giving = !previous.mine;
    setError(null);
    setThanks((prev) => ({
      ...prev,
      [note.id]: giving
        ? { count: previous.count + 1, mine: true }
        : { count: Math.max(previous.count - 1, 0), mine: false },
    }));
    const supabase = createClient();
    try {
      if (giving) {
        const { error: insertError } = await supabase
          .from("note_thanks")
          .insert({ note_id: note.id, user_id: currentUser.id });
        // Already thanked from another tab? The heart is right as drawn.
        if (insertError && insertError.code !== "23505") throw insertError;
      } else {
        const { error: deleteError } = await supabase
          .from("note_thanks")
          .delete()
          .eq("note_id", note.id)
          .eq("user_id", currentUser.id);
        if (deleteError) throw deleteError;
      }
      setAnnouncement(
        giving
          ? `Thanks sent for "${note.title}".`
          : `Thanks taken back for "${note.title}".`
      );
    } catch {
      setThanks((prev) => ({ ...prev, [note.id]: previous }));
      setError(
        giving
          ? "Your thanks didn't make it through — give it another try."
          : "Couldn't take that back just now — give it another try."
      );
    } finally {
      thanksInFlight.current.delete(note.id);
    }
  }

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
          className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      {visible.length === 0 ? (
        <EmptyState
          illustration={<NotesScene />}
          icon={FileText}
          title="No notes yet"
          description="Be the first to share lecture notes, study guides or slides with your classmates."
        />
      ) : (
        <ul className="mt-4 flex flex-col gap-2.5">
          {visible.map((note) => {
            const TypeIcon = fileTypeIcon(note.mime_type, note.file_name);
            const mine = note.uploader_id === currentUser.id;
            const uploaderName = note.uploader?.display_name ?? "Classmate";
            const thanksEntry = thanks[note.id] ?? NO_THANKS;
            return (
              <li
                key={note.id}
                className={cardClasses({
                  padding: "sm",
                  className: "flex items-start gap-3",
                })}
              >
                <span
                  className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand"
                  title={note.file_name}
                >
                  <TypeIcon className="size-5" aria-hidden />
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
                        className={buttonClasses({
                          variant: "danger",
                          size: "sm",
                        })}
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
                      {mine ? (
                        /* Your own notes: the warmth just shows — you can't
                           thank yourself, and the server agrees. */
                        <span
                          className="flex items-center gap-1 p-2 text-xs font-semibold text-muted"
                          aria-hidden={thanksEntry.count === 0}
                          title={
                            thanksEntry.count > 0
                              ? thanksEntry.count === 1
                                ? "1 classmate said thanks"
                                : `${thanksEntry.count} classmates said thanks`
                              : undefined
                          }
                        >
                          <Heart className="size-4" aria-hidden />
                          {thanksEntry.count > 0 ? (
                            <>
                              <span aria-hidden>{thanksEntry.count}</span>
                              <span className="sr-only">
                                {thanksEntry.count === 1
                                  ? "1 classmate said thanks"
                                  : `${thanksEntry.count} classmates said thanks`}
                              </span>
                            </>
                          ) : null}
                        </span>
                      ) : (
                        <button
                          type="button"
                          onClick={() => void toggleThanks(note)}
                          aria-pressed={thanksEntry.mine}
                          aria-label={
                            thanksEntry.mine
                              ? `Take back your thanks for ${note.title}`
                              : `Say thanks for ${note.title}`
                          }
                          title={thanksEntry.mine ? "Take back your thanks" : "Say thanks"}
                          className={cn(
                            "flex items-center gap-1 rounded-full p-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                            thanksEntry.mine
                              ? "bg-brand-soft text-brand"
                              : "text-muted hover:bg-brand-soft hover:text-brand-ink"
                          )}
                        >
                          <Heart
                            className="size-4"
                            fill={thanksEntry.mine ? "currentColor" : "none"}
                            aria-hidden
                          />
                          {thanksEntry.count > 0 ? (
                            <span
                              className={
                                thanksEntry.mine ? "text-brand-ink" : undefined
                              }
                            >
                              {thanksEntry.count}
                            </span>
                          ) : null}
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => handleDownload(note)}
                        disabled={downloadingId === note.id}
                        aria-label={`Download ${note.title}`}
                        title="Download"
                        className="rounded-full p-2 text-muted transition-colors hover:bg-brand-soft hover:text-brand-ink disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
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
