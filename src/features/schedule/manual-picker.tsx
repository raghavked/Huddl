"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  Hash,
  Loader2,
  Plus,
  Search,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Course } from "@/lib/types";
import { normalizeCourseCode } from "@/features/schedule/ocr";

const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const outlineBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";
const inputCls =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60";

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

/**
 * Manual course picker: search + checkbox list of the current term's catalog,
 * an inline "add a course" form for anything missing, then one confirm that
 * writes enrollments (source 'manual') — the DB trigger handles channels.
 */
export function ManualPicker({
  userId,
  universityId,
  termId,
  termName,
  initialCourses,
  enrolledCourseIds,
}: {
  userId: string;
  universityId: string;
  termId: string | null;
  termName: string | null;
  initialCourses: Course[];
  enrolledCourseIds: string[];
}) {
  const router = useRouter();

  const [courses, setCourses] = useState<Course[]>(initialCourses);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [query, setQuery] = useState("");

  const [addOpen, setAddOpen] = useState(false);
  const [addCode, setAddCode] = useState("");
  const [addTitle, setAddTitle] = useState("");
  const [addPending, setAddPending] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [joined, setJoined] = useState<Course[] | null>(null);

  const enrolled = useMemo(() => new Set(enrolledCourseIds), [enrolledCourseIds]);

  const selectedCourses = useMemo(
    () => courses.filter((c) => selectedIds[c.id] && !enrolled.has(c.id)),
    [courses, selectedIds, enrolled]
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return courses;
    return courses.filter(
      (c) =>
        c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q)
    );
  }, [courses, query]);

  async function handleAddCourse(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const code = addCode.trim();
    if (!code) return;
    const title = addTitle.trim() || code;

    // Already in the catalog? Just select it.
    const existing = courses.find(
      (c) => normalizeCourseCode(c.code) === normalizeCourseCode(code)
    );
    if (existing) {
      setSelectedIds((s) => ({ ...s, [existing.id]: true }));
      setAddOpen(false);
      setAddCode("");
      setAddTitle("");
      setAddError(null);
      return;
    }

    setAddPending(true);
    setAddError(null);
    const supabase = createClient();
    try {
      let course: Course | null = null;
      const { data: inserted, error: insertError } = await supabase
        .from("courses")
        .insert({ university_id: universityId, term_id: termId, code, title })
        .select("*")
        .single();
      if (insertError) {
        // Probably created by a classmate moments ago — look it up instead.
        const { data: found } = await supabase
          .from("courses")
          .select("*")
          .eq("university_id", universityId)
          .eq("code", code)
          .limit(1)
          .maybeSingle();
        course = (found as Course | null) ?? null;
      } else {
        course = inserted as Course;
      }
      if (!course) {
        setAddError("Couldn't add that course. Please try again.");
        return;
      }
      setCourses((list) =>
        list.some((c) => c.id === course!.id) ? list : [course!, ...list]
      );
      setSelectedIds((s) => ({ ...s, [course!.id]: true }));
      setAddOpen(false);
      setAddCode("");
      setAddTitle("");
    } catch {
      setAddError("Couldn't add that course. Please try again.");
    } finally {
      setAddPending(false);
    }
  }

  async function handleConfirm() {
    if (selectedCourses.length === 0) return;
    setSaving(true);
    setError(null);
    const supabase = createClient();
    try {
      const { error: enrollError } = await supabase.from("enrollments").upsert(
        selectedCourses.map((c) => ({
          user_id: userId,
          course_id: c.id,
          source: "manual" as const,
        })),
        { onConflict: "user_id,course_id", ignoreDuplicates: true }
      );
      if (enrollError) throw enrollError;
      setJoined(selectedCourses);
      router.refresh();
    } catch {
      setError("Couldn't save your courses. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  // ------------------------------------------------------------- success
  if (joined) {
    return (
      <section
        aria-label="Courses joined"
        className="rounded-card border border-border bg-surface p-6 text-center"
      >
        <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft">
          <CheckCircle2 className="size-7 text-brand-strong" aria-hidden />
        </span>
        <h2 className="mt-4 text-xl font-bold">
          You&apos;re in {joined.length}{" "}
          {joined.length === 1 ? "course channel" : "course channels"}
        </h2>
        <p className="mt-1 text-sm text-muted">
          Your classmates are already in there — go say hi.
        </p>
        <ul className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
          {joined.map((course) => (
            <li
              key={course.id}
              className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-strong"
            >
              <Hash className="size-3" aria-hidden />
              {course.code}
            </li>
          ))}
        </ul>
        <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
          <Link href="/channels" className={primaryBtn}>
            Go to your channels
            <ArrowRight className="size-4" aria-hidden />
          </Link>
          <button
            type="button"
            onClick={() => {
              setJoined(null);
              setSelectedIds({});
            }}
            className={outlineBtn}
          >
            Add more courses
          </button>
        </div>
      </section>
    );
  }

  // --------------------------------------------------------------- picker
  return (
    <div className="space-y-4">
      <section
        aria-label="Course catalog"
        className="rounded-card border border-border bg-surface p-5"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            {termName ? `Courses · ${termName}` : "Courses"}
          </h2>
          <button
            type="button"
            onClick={() => {
              setAddOpen((open) => !open);
              setAddError(null);
            }}
            aria-expanded={addOpen}
            className="inline-flex items-center gap-1.5 rounded-lg px-2 py-1 text-sm font-semibold text-brand transition-colors hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            {addOpen ? (
              <X className="size-4" aria-hidden />
            ) : (
              <Plus className="size-4" aria-hidden />
            )}
            {addOpen ? "Close" : "Add a course"}
          </button>
        </div>

        {addOpen ? (
          <form
            onSubmit={handleAddCourse}
            className="mt-3 rounded-lg border border-border bg-surface-2 p-3"
          >
            <p className="text-xs text-muted">
              Can&apos;t find your class? Add it
              {termName ? ` to the ${termName} catalog` : " to the catalog"} —
              you&apos;ll be its first member and classmates can join after
              you.
            </p>
            <div className="mt-3 grid gap-3 sm:grid-cols-[10rem_1fr]">
              <div>
                <label
                  htmlFor="new-course-code"
                  className="block text-sm font-medium"
                >
                  Code
                </label>
                <input
                  id="new-course-code"
                  type="text"
                  required
                  disabled={addPending}
                  value={addCode}
                  onChange={(e) => setAddCode(e.target.value)}
                  placeholder="CS 101"
                  autoCapitalize="characters"
                  autoCorrect="off"
                  spellCheck={false}
                  className={cn(inputCls, "mt-1.5")}
                />
              </div>
              <div>
                <label
                  htmlFor="new-course-title"
                  className="block text-sm font-medium"
                >
                  Title{" "}
                  <span className="font-normal text-muted">(optional)</span>
                </label>
                <input
                  id="new-course-title"
                  type="text"
                  disabled={addPending}
                  value={addTitle}
                  onChange={(e) => setAddTitle(e.target.value)}
                  placeholder="Intro to Computer Science"
                  className={cn(inputCls, "mt-1.5")}
                />
              </div>
            </div>
            {addError ? (
              <div className="mt-3">
                <ErrorAlert message={addError} />
              </div>
            ) : null}
            <button
              type="submit"
              disabled={addPending || !addCode.trim()}
              className={cn(primaryBtn, "mt-3")}
            >
              {addPending ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="size-4" aria-hidden />
              )}
              Add course
            </button>
          </form>
        ) : null}

        <div className="relative mt-4">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
            aria-hidden
          />
          <label htmlFor="manual-course-search" className="sr-only">
            Search courses
          </label>
          <input
            id="manual-course-search"
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by code or title"
            className={cn(inputCls, "pl-9")}
          />
        </div>

        {courses.length === 0 && !addOpen ? (
          <EmptyState
            icon={BookOpen}
            title="No courses in the catalog yet"
            description="Be the first — add a course and its chat channel opens up for everyone in it."
            action={
              <button
                type="button"
                onClick={() => setAddOpen(true)}
                className={primaryBtn}
              >
                <Plus className="size-4" aria-hidden />
                Add a course
              </button>
            }
          />
        ) : filtered.length === 0 ? (
          <p className="mt-4 text-sm text-muted">
            Nothing matching &ldquo;{query.trim()}&rdquo; — try another search,
            or add it with &ldquo;Add a course&rdquo; above.
          </p>
        ) : (
          <ul
            aria-label="Course list"
            className="mt-4 max-h-96 space-y-2 overflow-y-auto pr-1"
          >
            {filtered.map((course) => {
              const isEnrolled = enrolled.has(course.id);
              return (
                <li key={course.id}>
                  <label
                    className={cn(
                      "flex items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors",
                      isEnrolled
                        ? "opacity-70"
                        : "cursor-pointer hover:bg-surface-2 has-[:checked]:border-brand/50 has-[:checked]:bg-brand-soft/40"
                    )}
                  >
                    <input
                      type="checkbox"
                      checked={isEnrolled || Boolean(selectedIds[course.id])}
                      disabled={isEnrolled}
                      onChange={(e) =>
                        setSelectedIds((s) => ({
                          ...s,
                          [course.id]: e.target.checked,
                        }))
                      }
                      className="size-4 shrink-0 accent-brand"
                    />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-sm font-medium">
                        {course.code}
                      </span>
                      {course.title !== course.code ? (
                        <span className="block truncate text-xs text-muted">
                          {course.title}
                        </span>
                      ) : null}
                    </span>
                    {isEnrolled ? (
                      <span className="inline-flex shrink-0 items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[11px] font-semibold text-success">
                        <Check className="size-3" aria-hidden />
                        Joined
                      </span>
                    ) : null}
                  </label>
                </li>
              );
            })}
          </ul>
        )}
      </section>

      {error ? <ErrorAlert message={error} /> : null}

      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-end">
        <button
          type="button"
          disabled={saving || selectedCourses.length === 0}
          onClick={handleConfirm}
          className={primaryBtn}
        >
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Check className="size-4" aria-hidden />
          )}
          {saving
            ? "Joining channels…"
            : selectedCourses.length === 0
              ? "Select courses to join"
              : `Join ${selectedCourses.length} ${
                  selectedCourses.length === 1 ? "channel" : "channels"
                }`}
        </button>
      </div>
    </div>
  );
}
