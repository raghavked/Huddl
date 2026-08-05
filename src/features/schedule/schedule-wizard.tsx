"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  BookOpen,
  Camera,
  Check,
  CheckCircle2,
  Cpu,
  Hash,
  ImagePlus,
  Loader2,
  Lock,
  Plus,
  ScanLine,
  Search,
  ShieldCheck,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Course } from "@/lib/types";
import { extractCourseCodes, matchToCourses } from "@/features/schedule/ocr";

type Step = "privacy" | "photo" | "review" | "store" | "done";
type OcrPhase = "idle" | "working" | "done" | "error";

const STEP_ORDER: Record<Exclude<Step, "done">, number> = {
  privacy: 1,
  photo: 2,
  review: 3,
  store: 4,
};
const STEP_LABELS = ["Privacy", "Your schedule", "Your courses", "Finish"];

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

function StepIndicator({ step }: { step: Exclude<Step, "done"> }) {
  const current = STEP_ORDER[step];
  return (
    <div className="mb-5">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted">
        Step {current} of 4 · {STEP_LABELS[current - 1]}
      </p>
      <div className="mt-2 flex gap-1.5" aria-hidden>
        {STEP_LABELS.map((label, i) => (
          <span
            key={label}
            className={cn(
              "h-1 flex-1 rounded-full transition-colors",
              i < current ? "bg-brand" : "bg-surface-3"
            )}
          />
        ))}
      </div>
    </div>
  );
}

function fileExtension(file: File): string {
  if (file.name.includes(".")) {
    const ext = file.name.split(".").pop()!.toLowerCase();
    if (/^[a-z0-9]{1,5}$/.test(ext)) return ext === "jpeg" ? "jpg" : ext;
  }
  const mime = file.type.split("/").pop()?.toLowerCase() ?? "";
  if (/^[a-z0-9]{1,5}$/.test(mime)) return mime === "jpeg" ? "jpg" : mime;
  return "png";
}

/**
 * Schedule-image course setup: explicit privacy consent → pick/shoot an image
 * → on-device OCR with tesseract.js → confirm matched courses (plus manual
 * search/add) → choose whether to store the image at all → write the upload
 * record, its audit events (which the DB turns into notifications) and the
 * enrollments.
 */
export function ScheduleWizard({
  userId,
  universityId,
  termId,
  termName,
}: {
  userId: string;
  universityId: string;
  termId: string | null;
  termName: string | null;
}) {
  const [step, setStep] = useState<Step>("privacy");

  // Catalog, fetched once in the background so it's ready by the OCR step.
  const coursesPromiseRef = useRef<Promise<Course[]> | null>(null);
  const [courses, setCourses] = useState<Course[]>([]);

  // Image + OCR state.
  const fileInputRef = useRef<HTMLInputElement>(null);
  const cameraInputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [ocrPhase, setOcrPhase] = useState<OcrPhase>("idle");
  const [ocrProgress, setOcrProgress] = useState(0);
  const [ocrStatus, setOcrStatus] = useState("");

  // Course selection state. `pool` is every course we show a checkbox for
  // (OCR matches + ones the user added); `selectedIds` tracks the checks.
  const [pool, setPool] = useState<Course[]>([]);
  const [selectedIds, setSelectedIds] = useState<Record<string, boolean>>({});
  const [unmatched, setUnmatched] = useState<string[]>([]);
  const [addingCode, setAddingCode] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  // Storage choice + final commit.
  const [storeImage, setStoreImage] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [confirmedCourses, setConfirmedCourses] = useState<Course[]>([]);
  const [didStore, setDidStore] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const supabase = createClient();
    const promise = (async () => {
      const { data } = await supabase
        .from("courses")
        .select("*")
        .eq("university_id", universityId)
        .order("code");
      const list = (data ?? []) as Course[];
      setCourses(list);
      return list;
    })();
    coursesPromiseRef.current = promise;
  }, [universityId]);

  useEffect(() => {
    return () => {
      if (previewUrl) URL.revokeObjectURL(previewUrl);
    };
  }, [previewUrl]);

  const selectedCourses = useMemo(
    () => pool.filter((c) => selectedIds[c.id]),
    [pool, selectedIds]
  );

  const searchResults = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const poolIds = new Set(pool.map((c) => c.id));
    return courses
      .filter(
        (c) =>
          !poolIds.has(c.id) &&
          (c.code.toLowerCase().includes(q) || c.title.toLowerCase().includes(q))
      )
      .slice(0, 20);
  }, [query, courses, pool]);

  function handleFileChosen(chosen: File | null) {
    if (!chosen) return;
    if (!chosen.type.startsWith("image/")) {
      setError("That file isn't an image. Try a photo or screenshot.");
      return;
    }
    setError(null);
    setFile(chosen);
    setPreviewUrl((old) => {
      if (old) URL.revokeObjectURL(old);
      return URL.createObjectURL(chosen);
    });
    setOcrPhase("idle");
    setOcrProgress(0);
    setPool([]);
    setSelectedIds({});
    setUnmatched([]);
  }

  async function runOcr() {
    if (!file) return;
    setError(null);
    setOcrPhase("working");
    setOcrProgress(0);
    setOcrStatus("Warming up the on-device reader…");
    try {
      const { createWorker } = await import("tesseract.js");
      const worker = await createWorker("eng", undefined, {
        logger: (m) => {
          if (m.status === "recognizing text") {
            setOcrStatus("Reading your schedule…");
            setOcrProgress(m.progress);
          } else {
            setOcrStatus("Warming up the on-device reader…");
          }
        },
      });
      const { data } = await worker.recognize(file);
      await worker.terminate();

      const codes = extractCourseCodes(data.text ?? "");
      const catalog = coursesPromiseRef.current
        ? await coursesPromiseRef.current
        : [];
      const { matched, unmatched: misses } = matchToCourses(codes, catalog);
      setPool(matched);
      setSelectedIds(Object.fromEntries(matched.map((c) => [c.id, true])));
      setUnmatched(misses);
      setOcrPhase("done");
      setStep("review");
    } catch {
      setOcrPhase("error");
      setError(
        "Couldn't read that image. Try a sharper photo, or continue and pick your courses by hand."
      );
    }
  }

  function skipToReview() {
    setError(null);
    setPool([]);
    setSelectedIds({});
    setUnmatched([]);
    setOcrPhase("done");
    setStep("review");
  }

  function addToPool(course: Course) {
    setPool((p) => (p.some((c) => c.id === course.id) ? p : [...p, course]));
    setSelectedIds((s) => ({ ...s, [course.id]: true }));
  }

  async function addCourseFromCode(code: string) {
    setAddingCode(code);
    setError(null);
    const supabase = createClient();
    try {
      let course: Course | null = null;
      const { data: inserted, error: insertError } = await supabase
        .from("courses")
        .insert({
          university_id: universityId,
          term_id: termId,
          code,
          title: code,
        })
        .select("*")
        .single();
      if (insertError) {
        // Most likely a duplicate (someone at your school added it since we
        // fetched the catalog) — fall back to looking it up.
        const { data: existing } = await supabase
          .from("courses")
          .select("*")
          .eq("university_id", universityId)
          .eq("code", code)
          .limit(1)
          .maybeSingle();
        course = (existing as Course | null) ?? null;
      } else {
        course = inserted as Course;
      }
      if (!course) {
        setError(`Couldn't add ${code}. Please try again.`);
        return;
      }
      setCourses((list) =>
        list.some((c) => c.id === course!.id) ? list : [...list, course!]
      );
      addToPool(course);
      setUnmatched((u) => u.filter((c) => c !== code));
    } catch {
      setError(`Couldn't add ${code}. Please try again.`);
    } finally {
      setAddingCode(null);
    }
  }

  async function confirm() {
    if (selectedCourses.length === 0 || !file) return;
    setConfirming(true);
    setError(null);
    const supabase = createClient();
    try {
      // 1. The upload record itself. storage_path stays '' unless the user
      //    opted in to storing the image.
      const { data: upload, error: uploadError } = await supabase
        .from("schedule_uploads")
        .insert({
          user_id: userId,
          storage_path: "",
          status: "confirmed",
          ocr_summary: {
            courses: selectedCourses.map((c) => ({
              code: c.code,
              title: c.title,
            })),
          },
        })
        .select("id")
        .single();
      if (uploadError || !upload) throw uploadError ?? new Error("no upload");
      const uploadId = upload.id as string;

      // 2. Audit trail — each event insert fires a DB trigger that writes a
      //    notification, so the privacy receipts are guaranteed server-side.
      const { error: processedError } = await supabase
        .from("schedule_upload_events")
        .insert({
          upload_id: uploadId,
          event_type: "processed_on_device",
          detail:
            "OCR ran entirely in your browser — the image itself never left your device.",
        });
      if (processedError) throw processedError;

      // 3. Optional storage, only when explicitly enabled.
      if (storeImage) {
        const path = `${userId}/${uploadId}.${fileExtension(file)}`;
        const { error: storageError } = await supabase.storage
          .from("schedules")
          .upload(path, file, { contentType: file.type || undefined });
        if (storageError) throw storageError;
        const { error: pathError } = await supabase
          .from("schedule_uploads")
          .update({ storage_path: path })
          .eq("id", uploadId);
        if (pathError) throw pathError;
        const { error: eventsError } = await supabase
          .from("schedule_upload_events")
          .insert([
            {
              upload_id: uploadId,
              event_type: "uploaded",
              detail: "Schedule image uploaded to your private folder.",
            },
            {
              upload_id: uploadId,
              event_type: "stored",
              detail:
                "Stored at your request. Only you can open it, and every access is logged.",
            },
          ]);
        if (eventsError) throw eventsError;
      }

      // 4. The confirmation receipt, listing exactly what was joined.
      const codeList = selectedCourses.map((c) => c.code).join(", ");
      const { error: confirmedError } = await supabase
        .from("schedule_upload_events")
        .insert({
          upload_id: uploadId,
          event_type: "courses_confirmed",
          detail: `You confirmed ${selectedCourses.length} course${
            selectedCourses.length === 1 ? "" : "s"
          }: ${codeList}`,
        });
      if (confirmedError) throw confirmedError;

      // 5. Enrollments — the DB trigger drops the user into each course
      //    channel. Ignore courses they already joined another way.
      const { error: enrollError } = await supabase.from("enrollments").upsert(
        selectedCourses.map((c) => ({
          user_id: userId,
          course_id: c.id,
          source: "schedule_image" as const,
        })),
        { onConflict: "user_id,course_id", ignoreDuplicates: true }
      );
      if (enrollError) throw enrollError;

      setConfirmedCourses(selectedCourses);
      setDidStore(storeImage);
      setStep("done");
    } catch {
      setError(
        "Something went wrong while saving. Nothing was stored without your say-so — please try again."
      );
    } finally {
      setConfirming(false);
    }
  }

  // ---------------------------------------------------------------- privacy
  if (step === "privacy") {
    return (
      <div>
        <StepIndicator step="privacy" />
        <section
          aria-label="How your schedule image is handled"
          className="rounded-card border border-border bg-surface p-5"
        >
          <div className="flex items-center gap-3">
            <span className="flex size-11 shrink-0 items-center justify-center rounded-full bg-accent-soft">
              <ShieldCheck className="size-5 text-accent" aria-hidden />
            </span>
            <h2 className="text-lg font-semibold">
              Your schedule stays on your device
            </h2>
          </div>
          <ul className="mt-4 space-y-3 text-sm">
            <li className="flex gap-2.5">
              <Cpu className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="font-medium">Read on-device.</span> The text
                reader downloads into your browser and scans the image right
                here. The photo is never sent to Huddl to be processed.
              </span>
            </li>
            <li className="flex gap-2.5">
              <Lock className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
              <span>
                <span className="font-medium">Nothing uploads by default.</span>{" "}
                Your image is only stored if you flip on &ldquo;Store my
                schedule image&rdquo; at the last step — and you can delete it
                anytime from Settings → Privacy.
              </span>
            </li>
            <li className="flex gap-2.5">
              <ShieldCheck
                className="mt-0.5 size-4 shrink-0 text-accent"
                aria-hidden
              />
              <span>
                <span className="font-medium">Every touch is receipted.</span>{" "}
                Processing, storing, accessing or deleting your image writes an
                audit event, and each one notifies you — guaranteed by the
                database, not app code.
              </span>
            </li>
          </ul>
          <button
            type="button"
            onClick={() => setStep("photo")}
            className={cn(primaryBtn, "mt-5 w-full")}
          >
            <Check className="size-4" aria-hidden />
            I understand — continue
          </button>
          <p className="mt-3 text-center text-xs text-muted">
            Prefer not to use a photo?{" "}
            <Link
              href="/setup/manual"
              className="font-medium text-brand hover:text-brand-strong"
            >
              Pick courses manually
            </Link>
          </p>
        </section>
      </div>
    );
  }

  // ------------------------------------------------------------------ photo
  if (step === "photo") {
    const working = ocrPhase === "working";
    return (
      <div>
        <StepIndicator step="photo" />
        <section
          aria-label="Choose a schedule image"
          className="rounded-card border border-border bg-surface p-5"
        >
          <h2 className="font-semibold">Add a photo of your schedule</h2>
          <p className="mt-1 text-sm text-muted">
            A screenshot of your registration page or a photo of a printed
            schedule both work great.
          </p>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
          />
          <input
            ref={cameraInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            className="sr-only"
            tabIndex={-1}
            aria-hidden
            onChange={(e) => handleFileChosen(e.target.files?.[0] ?? null)}
          />

          {previewUrl ? (
            <div className="mt-4">
              {/* eslint-disable-next-line @next/next/no-img-element -- local blob preview */}
              <img
                src={previewUrl}
                alt="Preview of your selected schedule"
                className="max-h-80 w-full rounded-lg border border-border bg-surface-2 object-contain"
              />
              <p className="mt-2 truncate text-xs text-muted">
                {file?.name || "Selected image"} · stays on this device until
                you say otherwise
              </p>
            </div>
          ) : null}

          <div className="mt-4 flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              disabled={working}
              onClick={() => fileInputRef.current?.click()}
              className={cn(previewUrl ? outlineBtn : primaryBtn, "flex-1")}
            >
              <ImagePlus className="size-4" aria-hidden />
              {previewUrl ? "Choose a different image" : "Choose an image"}
            </button>
            <button
              type="button"
              disabled={working}
              onClick={() => cameraInputRef.current?.click()}
              className={cn(outlineBtn, "flex-1")}
            >
              <Camera className="size-4" aria-hidden />
              Take a photo
            </button>
          </div>

          {working ? (
            <div className="mt-4" aria-live="polite">
              <div className="flex items-center gap-2 text-sm font-medium">
                <Loader2 className="size-4 animate-spin text-brand" aria-hidden />
                {ocrStatus}
              </div>
              <div
                role="progressbar"
                aria-label="Reading progress"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={Math.round(ocrProgress * 100)}
                className="mt-2 h-2 overflow-hidden rounded-full bg-surface-2"
              >
                <div
                  className="h-full rounded-full bg-brand transition-[width] duration-200"
                  style={{ width: `${Math.round(ocrProgress * 100)}%` }}
                />
              </div>
              <p className="mt-2 text-xs text-muted">
                Happening entirely on your device — nothing is uploading.
              </p>
            </div>
          ) : null}

          {error ? (
            <div className="mt-4">
              <ErrorAlert message={error} />
            </div>
          ) : null}

          <div className="mt-5 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={working}
              onClick={() => setStep("privacy")}
              className={cn(outlineBtn, "sm:order-first")}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </button>
            <div className="flex flex-col gap-2 sm:flex-row">
              {ocrPhase === "error" ? (
                <button
                  type="button"
                  onClick={skipToReview}
                  className={outlineBtn}
                >
                  Continue without scanning
                </button>
              ) : null}
              <button
                type="button"
                disabled={!file || working}
                onClick={runOcr}
                className={primaryBtn}
              >
                {working ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <ScanLine className="size-4" aria-hidden />
                )}
                {working ? "Reading…" : "Read my schedule"}
              </button>
            </div>
          </div>
        </section>
      </div>
    );
  }

  // ----------------------------------------------------------------- review
  if (step === "review") {
    const nothingFound = pool.length === 0 && unmatched.length === 0;
    return (
      <div>
        <StepIndicator step="review" />
        <div className="space-y-4">
          <section
            aria-label="Suggested courses"
            className="rounded-card border border-border bg-surface p-5"
          >
            <h2 className="font-semibold">
              {nothingFound
                ? "No course codes spotted"
                : "Here's what we spotted"}
            </h2>
            <p className="mt-1 text-sm text-muted">
              {nothingFound
                ? "No worries — search your school's catalog below to pick your courses."
                : "Uncheck anything that's wrong, and add anything we missed."}
            </p>

            {pool.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {pool.map((course) => (
                  <li key={course.id}>
                    <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 transition-colors hover:bg-surface-2 has-[:checked]:border-brand/50 has-[:checked]:bg-brand-soft/40">
                      <input
                        type="checkbox"
                        checked={Boolean(selectedIds[course.id])}
                        onChange={(e) =>
                          setSelectedIds((s) => ({
                            ...s,
                            [course.id]: e.target.checked,
                          }))
                        }
                        className="size-4 shrink-0 accent-brand"
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm font-medium">
                          {course.code}
                        </span>
                        {course.title !== course.code ? (
                          <span className="block truncate text-xs text-muted">
                            {course.title}
                          </span>
                        ) : null}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            ) : null}

            {unmatched.length > 0 ? (
              <div className="mt-4">
                <h3 className="text-sm font-semibold">
                  Also spotted — not in the catalog yet
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  Add one and you&apos;ll create its course
                  {termName ? ` for ${termName}` : ""} so classmates can find
                  it too.
                </p>
                <ul className="mt-2 flex flex-wrap gap-2">
                  {unmatched.map((code) => (
                    <li key={code}>
                      <button
                        type="button"
                        disabled={addingCode !== null}
                        onClick={() => addCourseFromCode(code)}
                        className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-border bg-surface-2 px-3 py-1.5 text-xs font-semibold transition-colors hover:border-brand/60 hover:text-brand-strong disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        {addingCode === code ? (
                          <Loader2 className="size-3.5 animate-spin" aria-hidden />
                        ) : (
                          <Plus className="size-3.5" aria-hidden />
                        )}
                        {code}
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </section>

          <section
            aria-label="Search the course catalog"
            className="rounded-card border border-border bg-surface p-5"
          >
            <label htmlFor="course-search" className="text-sm font-semibold">
              Add more courses
            </label>
            <div className="relative mt-2">
              <Search
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted"
                aria-hidden
              />
              <input
                id="course-search"
                type="search"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search by code or title, e.g. CS 101"
                className={cn(inputCls, "pl-9")}
              />
            </div>
            {query.trim() ? (
              searchResults.length > 0 ? (
                <ul className="mt-3 space-y-2">
                  {searchResults.map((course) => (
                    <li key={course.id}>
                      <button
                        type="button"
                        onClick={() => {
                          addToPool(course);
                          setQuery("");
                        }}
                        className="flex w-full items-center gap-3 rounded-lg border border-border bg-surface px-3 py-2.5 text-left transition-colors hover:bg-surface-2 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                      >
                        <Plus className="size-4 shrink-0 text-brand" aria-hidden />
                        <span className="min-w-0">
                          <span className="block truncate text-sm font-medium">
                            {course.code}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            {course.title}
                          </span>
                        </span>
                      </button>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-muted">
                  Nothing matching &ldquo;{query.trim()}&rdquo; — you can add it
                  from the{" "}
                  <Link
                    href="/setup/manual"
                    className="font-medium text-brand hover:text-brand-strong"
                  >
                    manual picker
                  </Link>
                  .
                </p>
              )
            ) : null}
          </section>

          {error ? <ErrorAlert message={error} /> : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              onClick={() => setStep("photo")}
              className={outlineBtn}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </button>
            <button
              type="button"
              disabled={selectedCourses.length === 0}
              onClick={() => setStep("store")}
              className={primaryBtn}
            >
              Continue with {selectedCourses.length}{" "}
              {selectedCourses.length === 1 ? "course" : "courses"}
              <ArrowRight className="size-4" aria-hidden />
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------ store
  if (step === "store") {
    return (
      <div>
        <StepIndicator step="store" />
        <div className="space-y-4">
          <section
            aria-label="Courses you're about to join"
            className="rounded-card border border-border bg-surface p-5"
          >
            <h2 className="font-semibold">You&apos;re joining</h2>
            <ul className="mt-3 divide-y divide-border overflow-hidden rounded-lg border border-border">
              {selectedCourses.map((course) => (
                <li
                  key={course.id}
                  className="flex items-center gap-3 bg-surface px-3 py-2.5"
                >
                  <Hash className="size-4 shrink-0 text-muted" aria-hidden />
                  <div className="min-w-0">
                    <p className="truncate text-sm font-medium">{course.code}</p>
                    {course.title !== course.code ? (
                      <p className="truncate text-xs text-muted">
                        {course.title}
                      </p>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          </section>

          <section
            aria-label="Storage choice"
            className="rounded-card border border-border bg-surface p-5"
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <p id="store-toggle-label" className="font-semibold">
                  Store my schedule image
                </p>
                <p id="store-toggle-hint" className="mt-1 text-sm text-muted">
                  {storeImage
                    ? "Your image will be kept in your private folder. Only you can open it, every access is logged and notifies you, and you can delete it anytime in Settings → Privacy."
                    : "Off by default. Your image is discarded after this step — only the course list you confirmed is saved."}
                </p>
              </div>
              <button
                type="button"
                role="switch"
                aria-checked={storeImage}
                aria-labelledby="store-toggle-label"
                aria-describedby="store-toggle-hint"
                disabled={confirming}
                onClick={() => setStoreImage((v) => !v)}
                className={cn(
                  "relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  storeImage ? "bg-brand" : "bg-surface-3"
                )}
              >
                <span
                  aria-hidden
                  className={cn(
                    "absolute top-1 size-5 rounded-full bg-white shadow transition-[left]",
                    storeImage ? "left-6" : "left-1"
                  )}
                />
              </button>
            </div>
          </section>

          {error ? <ErrorAlert message={error} /> : null}

          <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
            <button
              type="button"
              disabled={confirming}
              onClick={() => setStep("review")}
              className={outlineBtn}
            >
              <ArrowLeft className="size-4" aria-hidden />
              Back
            </button>
            <button
              type="button"
              disabled={confirming}
              onClick={confirm}
              className={primaryBtn}
            >
              {confirming ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Check className="size-4" aria-hidden />
              )}
              {confirming
                ? "Joining channels…"
                : `Confirm and join ${selectedCourses.length} ${
                    selectedCourses.length === 1 ? "channel" : "channels"
                  }`}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // ------------------------------------------------------------------- done
  return (
    <section
      aria-label="Setup complete"
      className="rounded-card border border-border bg-surface p-6 text-center"
    >
      <span className="mx-auto flex size-14 items-center justify-center rounded-full bg-brand-soft">
        <CheckCircle2 className="size-7 text-brand-strong" aria-hidden />
      </span>
      <h2 className="mt-4 text-xl font-bold">
        You&apos;re in {confirmedCourses.length}{" "}
        {confirmedCourses.length === 1 ? "course channel" : "course channels"}
      </h2>
      <p className="mt-1 text-sm text-muted">
        Your classmates are already in there — go say hi.
      </p>
      <ul className="mx-auto mt-4 flex max-w-md flex-wrap justify-center gap-2">
        {confirmedCourses.map((course) => (
          <li
            key={course.id}
            className="inline-flex items-center gap-1 rounded-full bg-brand-soft px-3 py-1 text-xs font-semibold text-brand-strong"
          >
            <Hash className="size-3" aria-hidden />
            {course.code}
          </li>
        ))}
      </ul>
      <div className="mx-auto mt-5 flex max-w-md items-start gap-2.5 rounded-lg bg-accent-soft px-4 py-3 text-left text-sm">
        <ShieldCheck className="mt-0.5 size-4 shrink-0 text-accent" aria-hidden />
        <p>
          You&apos;ll see a privacy receipt in your notifications for everything
          that just happened
          {didStore
            ? " — including the store you asked for. Manage or delete the image anytime in Settings → Privacy."
            : ". Your image was processed on-device and never stored."}
        </p>
      </div>
      <div className="mt-6 flex flex-col justify-center gap-2 sm:flex-row">
        <Link href="/channels" className={primaryBtn}>
          Go to your channels
          <ArrowRight className="size-4" aria-hidden />
        </Link>
        <Link href="/settings/privacy" className={outlineBtn}>
          <ShieldCheck className="size-4" aria-hidden />
          View privacy dashboard
        </Link>
      </div>
      <p className="mt-4">
        <Link
          href="/notifications"
          className="text-sm font-medium text-muted transition-colors hover:text-foreground"
        >
          <BookOpen className="mr-1 inline size-3.5" aria-hidden />
          See your privacy receipts
        </Link>
      </p>
    </section>
  );
}
