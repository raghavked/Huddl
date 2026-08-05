"use client";

import { useEffect, useId, useRef, useState } from "react";
import { CircleAlert, Loader2, Paperclip, Upload, X } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn, formatFileSize } from "@/lib/utils";
import type { Note } from "@/lib/types";

const MAX_FILE_BYTES = 25 * 1024 * 1024;

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

const ACCEPT_ATTR = ACCEPTED_EXTENSIONS.map((ext) => `.${ext}`).join(",");

const INPUT_CLASSES =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/25";

/** Keep the original name readable but safe for a storage key. */
function sanitizeFileName(name: string): string {
  const cleaned = name
    .replace(/[^a-zA-Z0-9._-]+/g, "-")
    .replace(/-{2,}/g, "-")
    .replace(/^[-.]+/, "");
  return (cleaned || "file").slice(-100);
}

function fileExtension(name: string): string {
  return name.split(".").pop()?.toLowerCase() ?? "";
}

/**
 * Collapsed "Share your notes" affordance that expands into the upload form.
 * Uploads to the notes bucket under the uploader's folder, then inserts the
 * notes row (rolling the file back if the insert fails).
 */
export function NoteUpload({
  courseId,
  userId,
  onUploaded,
}: {
  courseId: string;
  userId: string;
  onUploaded: (note: Note) => void;
}) {
  const formId = useId();
  const titleRef = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open) titleRef.current?.focus();
  }, [open]);

  function close() {
    setTitle("");
    setDescription("");
    setFile(null);
    setError(null);
    setOpen(false);
  }

  function handleFileChange(event: React.ChangeEvent<HTMLInputElement>) {
    const selected = event.target.files?.[0] ?? null;
    setFile(selected);
    setError(null);
    if (selected && !title.trim()) {
      const base = selected.name
        .replace(/\.[^.]+$/, "")
        .replace(/[-_]+/g, " ")
        .trim();
      if (base) setTitle(base.slice(0, 120));
    }
  }

  function validate(): string | null {
    if (!title.trim()) return "Give your note a title.";
    if (!file) return "Choose a file to share.";
    if (file.size > MAX_FILE_BYTES) {
      return `That file is ${formatFileSize(file.size)} — the limit is 25 MB.`;
    }
    if (!ACCEPTED_EXTENSIONS.includes(fileExtension(file.name))) {
      return "That file type isn't supported. Share a document, slides, spreadsheet or image.";
    }
    return null;
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const problem = validate();
    if (problem) {
      setError(problem);
      return;
    }
    if (!file) return;

    setPending(true);
    setError(null);
    const supabase = createClient();
    const storagePath = `${userId}/${crypto.randomUUID()}-${sanitizeFileName(
      file.name
    )}`;

    const { error: uploadError } = await supabase.storage
      .from("notes")
      .upload(storagePath, file, {
        contentType: file.type || "application/octet-stream",
        upsert: false,
      });
    if (uploadError) {
      setError("Upload failed. Check your connection and try again.");
      setPending(false);
      return;
    }

    const { data: note, error: insertError } = await supabase
      .from("notes")
      .insert({
        course_id: courseId,
        uploader_id: userId,
        title: title.trim().slice(0, 120),
        description: description.trim().slice(0, 500) || null,
        storage_path: storagePath,
        file_name: file.name,
        file_size: file.size,
        mime_type: file.type || null,
      })
      .select("*")
      .single();

    if (insertError || !note) {
      // Roll back the orphaned file so storage stays tidy.
      await supabase.storage.from("notes").remove([storagePath]);
      setError("Couldn't save your note. Please try again.");
      setPending(false);
      return;
    }

    onUploaded(note as Note);
    setPending(false);
    close();
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-expanded={false}
        className="flex w-full items-center gap-3 rounded-card border border-dashed border-border bg-surface p-4 text-left transition-colors hover:border-brand/60 hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <span className="flex size-10 shrink-0 items-center justify-center rounded-full bg-brand-soft">
          <Upload className="size-5 text-brand-strong" aria-hidden />
        </span>
        <span className="min-w-0">
          <span className="block text-sm font-semibold">Share your notes</span>
          <span className="mt-0.5 block text-xs text-muted">
            Docs, slides, spreadsheets or photos — up to 25 MB.
          </span>
        </span>
      </button>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Share a note"
      className="rounded-card border border-border bg-surface p-4"
    >
      <div className="flex items-center justify-between gap-2">
        <h2 className="text-sm font-bold">Share a note</h2>
        <button
          type="button"
          onClick={close}
          disabled={pending}
          aria-label="Close the note form"
          className="rounded-full p-1.5 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          <X className="size-4" aria-hidden />
        </button>
      </div>

      <div className="mt-3 space-y-3">
        <div>
          <label htmlFor={`${formId}-title`} className="block text-sm font-medium">
            Title
          </label>
          <input
            ref={titleRef}
            id={`${formId}-title`}
            type="text"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
            maxLength={120}
            required
            placeholder="Week 5 lecture notes"
            className={cn("mt-1", INPUT_CLASSES)}
          />
        </div>

        <div>
          <label
            htmlFor={`${formId}-description`}
            className="block text-sm font-medium"
          >
            Description <span className="font-normal text-muted">(optional)</span>
          </label>
          <textarea
            id={`${formId}-description`}
            value={description}
            onChange={(event) => setDescription(event.target.value)}
            rows={2}
            maxLength={500}
            placeholder="What's covered, which lecture, anything classmates should know…"
            className={cn("mt-1 resize-none", INPUT_CLASSES)}
          />
        </div>

        <div>
          <label htmlFor={`${formId}-file`} className="block text-sm font-medium">
            File
          </label>
          <input
            id={`${formId}-file`}
            type="file"
            accept={ACCEPT_ATTR}
            onChange={handleFileChange}
            required
            aria-describedby={`${formId}-file-hint`}
            className="mt-1 block w-full rounded-lg text-sm text-muted file:mr-3 file:rounded-full file:border-0 file:bg-brand-soft file:px-3.5 file:py-2 file:text-sm file:font-semibold file:text-brand-strong hover:file:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          />
          <p id={`${formId}-file-hint`} className="mt-1.5 text-xs text-muted">
            {file ? (
              <>
                <Paperclip
                  className="mr-1 inline size-3.5 align-[-2px]"
                  aria-hidden
                />
                {file.name} · {formatFileSize(file.size)}
              </>
            ) : (
              "PDF, Word, PowerPoint, Excel, text or image files up to 25 MB."
            )}
          </p>
        </div>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="mt-4 flex justify-end gap-2">
        <button
          type="button"
          onClick={close}
          disabled={pending}
          className="rounded-full px-4 py-2 text-sm font-semibold text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Cancel
        </button>
        <button
          type="submit"
          disabled={pending}
          className="inline-flex items-center gap-2 rounded-full bg-brand px-4 py-2 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Upload className="size-4" aria-hidden />
          )}
          {pending ? "Sharing…" : "Share note"}
        </button>
      </div>
    </form>
  );
}
