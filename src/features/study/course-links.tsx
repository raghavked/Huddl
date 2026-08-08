"use client";

import { useState } from "react";
import {
  Book,
  CircleAlert,
  ExternalLink,
  FileText,
  HelpCircle,
  Link2,
  Loader2,
  Plus,
  PlusCircle,
  Trash2,
  Video,
  X,
  type LucideIcon,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Button,
  Card,
  FieldError,
  Input,
  Label,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* Pinned course links — the syllabus, the textbook, wherever class lives.
   Any classmate pins one; authors can take their own down. Mirrors the
   native course links screen, kind chips and all. */

export type CourseLinkKind =
  | "syllabus"
  | "textbook"
  | "office_hours"
  | "lecture"
  | "other";

/** Serializable row shape the course page passes down. */
export type CourseLinkRow = {
  id: string;
  kind: CourseLinkKind;
  title: string;
  url: string;
  added_by: string | null;
  created_at: string;
  author: { display_name: string } | null;
};

export const COURSE_LINK_SELECT =
  "id, kind, title, url, added_by, created_at, author:profiles(display_name)";

const KINDS: CourseLinkKind[] = [
  "syllabus",
  "textbook",
  "office_hours",
  "lecture",
  "other",
];

const KIND_LABEL: Record<CourseLinkKind, string> = {
  syllabus: "Syllabus",
  textbook: "Textbook",
  office_hours: "Office hours",
  lecture: "Lecture",
  other: "Other",
};

const KIND_ICON: Record<CourseLinkKind, LucideIcon> = {
  syllabus: FileText,
  textbook: Book,
  office_hours: HelpCircle,
  lecture: Video,
  other: Link2,
};

const KIND_ORDER: Record<CourseLinkKind, number> = {
  syllabus: 0,
  textbook: 1,
  office_hours: 2,
  lecture: 3,
  other: 4,
};

/** Quiet chip palette: the syllabus glows ember-clay, references lean sage,
    the rest stay neutral — same recipe as the calendar's kind chips. */
function kindChipClasses(kind: CourseLinkKind): string {
  switch (kind) {
    case "syllabus":
      return "bg-brand-soft text-brand-ink";
    case "textbook":
    case "lecture":
      return "bg-accent-soft text-accent";
    default:
      return "bg-surface-2 text-muted";
  }
}

/** "https://canvas.ucdavis.edu/courses/1" -> "canvas.ucdavis.edu". */
function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  return (match?.[1] ?? "").replace(/^www\./i, "").toLowerCase();
}

/** Grouped-list order: syllabus first, then references, newest last. */
function sortLinks(rows: CourseLinkRow[]): CourseLinkRow[] {
  return [...rows].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.created_at.localeCompare(b.created_at)
  );
}

export function CourseLinks({
  courseId,
  userId,
  initialLinks,
}: {
  courseId: string;
  userId: string;
  initialLinks: CourseLinkRow[];
}) {
  const [links, setLinks] = useState<CourseLinkRow[]>(() =>
    sortLinks(initialLinks)
  );
  const [actionError, setActionError] = useState<string | null>(null);
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  // The add-a-link form, tucked behind a button until needed.
  const [formOpen, setFormOpen] = useState(false);
  const [kind, setKind] = useState<CourseLinkKind>("syllabus");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  /* ------------------------ author remove ------------------------ */

  async function deleteLink(link: CourseLinkRow) {
    setActionError(null);
    setDeletingId(link.id);
    const before = links;
    // Optimistic: the pin comes off now, and goes back up if the write fails.
    setLinks((prev) => prev.filter((row) => row.id !== link.id));
    const supabase = createClient();
    const { error } = await supabase
      .from("course_links")
      .delete()
      .eq("id", link.id);
    setDeletingId(null);
    setConfirmingId(null);
    if (error) {
      setLinks(before);
      setActionError("Couldn't remove that link just now. Give it another try.");
    }
  }

  /* -------------------------- add a link -------------------------- */

  function resetForm() {
    setFormOpen(false);
    setKind("syllabus");
    setTitle("");
    setUrl("");
    setTitleError(null);
    setUrlError(null);
    setAddError(null);
  }

  const trimmedTitle = title.trim();
  const trimmedUrl = url.trim();

  async function handleAdd() {
    if (adding) return;
    let bad = false;
    if (trimmedTitle.length === 0) {
      setTitleError("Give the link a short name.");
      bad = true;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setUrlError("Links start with http:// or https://");
      bad = true;
    }
    if (bad) return;
    setAddError(null);
    setAdding(true);
    const supabase = createClient();
    const { data, error } = await supabase
      .from("course_links")
      .insert({
        course_id: courseId,
        added_by: userId,
        kind,
        title: trimmedTitle,
        url: trimmedUrl,
      })
      .select(COURSE_LINK_SELECT)
      .single();
    setAdding(false);
    if (error || !data) {
      setAddError(
        error?.code === "42501"
          ? "Links are pinned by classmates — add this course to your classes first."
          : "We couldn't pin that link just now. Give it another try."
      );
      return;
    }
    setLinks((prev) => sortLinks([...prev, data as unknown as CourseLinkRow]));
    setTitle("");
    setUrl("");
  }

  /* ---------------------------- render ---------------------------- */

  return (
    <section aria-label="Course links">
      <h2 className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
        Links
      </h2>

      {actionError ? (
        <p
          role="alert"
          className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
          {actionError}
        </p>
      ) : null}

      {links.length === 0 ? (
        <div className="mt-3 rounded-card border border-dashed border-border">
          <EmptyState
            icon={Link2}
            title="No links yet"
            description="Pin the syllabus, the textbook, wherever office hours live — the class will thank you."
            className="py-8"
          />
        </div>
      ) : (
        <ul className="mt-3 flex flex-col gap-2.5">
          {links.map((link) => {
            const Icon = KIND_ICON[link.kind];
            const mine = link.added_by === userId;
            const addedBy = mine
              ? "You"
              : link.author?.display_name ?? "A classmate";
            const host = hostOf(link.url);
            return (
              <li
                key={link.id}
                className={cardClasses({
                  padding: "none",
                  className: "flex items-center gap-2 py-3 pl-4 pr-2",
                })}
              >
                <a
                  href={link.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label={`Open ${link.title}, added by ${addedBy}`}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-xl focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <Icon className="size-5" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-2">
                      <span className="min-w-0 truncate text-sm font-semibold">
                        {link.title}
                      </span>
                      <span
                        className={cn(
                          "inline-flex shrink-0 items-center rounded-full px-2 py-0.5 text-[11px] font-semibold",
                          kindChipClasses(link.kind)
                        )}
                      >
                        {KIND_LABEL[link.kind]}
                      </span>
                    </span>
                    <span className="mt-0.5 block truncate text-xs text-muted">
                      {host ? `${host} · ` : ""}Added by {addedBy}
                    </span>
                  </span>
                  <ExternalLink
                    className="size-4 shrink-0 text-muted"
                    aria-hidden
                  />
                </a>
                {mine ? (
                  confirmingId === link.id ? (
                    <span className="flex shrink-0 items-center gap-1">
                      <span className="text-xs font-medium text-muted">
                        Remove for the class?
                      </span>
                      <button
                        type="button"
                        onClick={() => void deleteLink(link)}
                        disabled={deletingId === link.id}
                        className={buttonClasses({
                          variant: "danger",
                          size: "sm",
                        })}
                      >
                        {deletingId === link.id ? (
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
                        disabled={deletingId === link.id}
                        aria-label="Keep this link"
                        className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        <X className="size-4" aria-hidden />
                      </button>
                    </span>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setActionError(null);
                        setConfirmingId(link.id);
                      }}
                      aria-label={`Remove ${link.title} from the course page`}
                      title="Remove"
                      className="shrink-0 rounded-full p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                    >
                      <Trash2 className="size-4" aria-hidden />
                    </button>
                  )
                ) : null}
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-3">
        {formOpen ? (
          <Card className="animate-fade-up">
            <div className="flex items-center justify-between gap-2">
              <h3 className="flex items-center gap-2 font-bold tracking-tight">
                <PlusCircle className="size-4 text-brand" aria-hidden />
                Add a link
              </h3>
              <button
                type="button"
                onClick={resetForm}
                disabled={adding}
                aria-label="Close the link form"
                className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
              >
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 text-sm text-muted">
              Anything the class keeps hunting for — pin it once and it&apos;s
              here for everyone.
            </p>
            <div
              className="mt-3 flex flex-wrap gap-2"
              role="group"
              aria-label="What kind of link is it?"
            >
              {KINDS.map((option) => {
                const active = kind === option;
                return (
                  <button
                    key={option}
                    type="button"
                    disabled={adding}
                    aria-pressed={active}
                    aria-label={`Mark this link as ${KIND_LABEL[option]}`}
                    onClick={() => setKind(option)}
                    className={cn(
                      "rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                      active
                        ? "border-brand bg-brand-soft text-brand-ink"
                        : "border-border bg-surface text-muted hover:text-foreground"
                    )}
                  >
                    {KIND_LABEL[option]}
                  </button>
                );
              })}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                void handleAdd();
              }}
            >
              <div className="mt-4">
                <Label htmlFor="link-title">Title</Label>
                <Input
                  id="link-title"
                  value={title}
                  onChange={(e) => {
                    setTitle(e.target.value);
                    if (titleError) setTitleError(null);
                    if (addError) setAddError(null);
                  }}
                  placeholder="Course syllabus"
                  maxLength={120}
                  disabled={adding}
                  aria-describedby={titleError ? "link-title-error" : undefined}
                  className="mt-1.5"
                />
                {titleError ? (
                  <FieldError id="link-title-error" className="mt-1.5">
                    {titleError}
                  </FieldError>
                ) : null}
              </div>
              <div className="mt-3">
                <Label htmlFor="link-url">URL</Label>
                <Input
                  id="link-url"
                  type="url"
                  inputMode="url"
                  autoComplete="off"
                  value={url}
                  onChange={(e) => {
                    setUrl(e.target.value);
                    if (urlError) setUrlError(null);
                    if (addError) setAddError(null);
                  }}
                  placeholder="https://canvas.ucdavis.edu/…"
                  maxLength={2000}
                  disabled={adding}
                  aria-describedby={urlError ? "link-url-error" : undefined}
                  className="mt-1.5"
                />
                {urlError ? (
                  <FieldError id="link-url-error" className="mt-1.5">
                    {urlError}
                  </FieldError>
                ) : null}
              </div>
              {addError ? (
                <p role="alert" className="mt-3 text-xs font-medium text-danger">
                  {addError}
                </p>
              ) : null}
              <Button
                type="submit"
                size="sm"
                className="mt-4"
                disabled={
                  adding ||
                  trimmedTitle.length === 0 ||
                  trimmedUrl.length === 0
                }
              >
                {adding ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : (
                  <Plus className="size-3.5" aria-hidden />
                )}
                Pin it for the class
              </Button>
            </form>
          </Card>
        ) : (
          <Button variant="secondary" size="sm" onClick={() => setFormOpen(true)}>
            <Plus className="size-3.5" aria-hidden />
            Add a link
          </Button>
        )}
      </div>
    </section>
  );
}
