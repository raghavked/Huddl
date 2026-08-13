"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { BookOpen, Loader2, PartyPopper, Trash2 } from "lucide-react";
import {
  Button,
  FieldError,
  Hint,
  Input,
  Label,
  Select,
  Textarea,
  buttonClasses,
} from "@/components/ui";
import {
  deleteEvent,
  updateEvent,
  type EventFields,
} from "@/features/events/actions";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { CampusEvent, EventKind } from "@/lib/types";

export interface CourseOption {
  id: string;
  code: string;
  title: string;
}

const KIND_OPTIONS: readonly {
  value: EventKind;
  label: string;
  hint: string;
  icon: typeof BookOpen;
}[] = [
  {
    value: "study_session",
    label: "Study session",
    hint: "Grind through a class together",
    icon: BookOpen,
  },
  {
    value: "meetup",
    label: "Meetup",
    hint: "Hang out, no syllabus required",
    icon: PartyPopper,
  },
];

/** ISO timestamp -> value for a datetime-local input, in the viewer's zone. */
function toLocalInput(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(
    d.getDate()
  )}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

/**
 * Create + edit form for study sessions and meetups.
 *
 * Create mode (no `event` prop): inserts the events row directly with the
 * browser client (RLS: creator at own university), auto-RSVPs the creator
 * "going", then redirects to the new event. Edit mode (`event` provided):
 * saves through the updateEvent server action and returns to the event page.
 */
export function EventForm({
  universityId,
  userId,
  courses,
  event,
  club,
}: {
  universityId: string;
  userId: string;
  courses: CourseOption[];
  /** When set, the form edits this event instead of creating one. */
  event?: CampusEvent;
  /** Club hosting the event (create via /events/new?club=…, or shown on edit). */
  club?: { id: string; name: string } | null;
}) {
  const router = useRouter();
  const isEdit = Boolean(event);

  const [kind, setKind] = useState<EventKind>(
    event?.kind ?? (club ? "meetup" : "study_session")
  );
  const [title, setTitle] = useState(event?.title ?? "");
  const [description, setDescription] = useState(event?.description ?? "");
  const [location, setLocation] = useState(event?.location ?? "");
  const [startsLocal, setStartsLocal] = useState(() =>
    event ? toLocalInput(event.starts_at) : ""
  );
  const [endsLocal, setEndsLocal] = useState(() =>
    event?.ends_at ? toLocalInput(event.ends_at) : ""
  );
  const [capacity, setCapacity] = useState(
    event?.capacity != null ? String(event.capacity) : ""
  );
  const [courseId, setCourseId] = useState(event?.course_id ?? "");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [isPending, startTransition] = useTransition();
  const busy = submitting || isPending;

  function buildFields(): EventFields | { invalid: string } {
    const trimmedTitle = title.trim();
    if (trimmedTitle.length < 3) {
      return { invalid: "Give your event a title of at least 3 characters." };
    }
    if (!startsLocal) return { invalid: "Pick a start time." };
    const starts = new Date(startsLocal);
    if (Number.isNaN(starts.getTime())) {
      return { invalid: "That start time doesn't look right." };
    }
    let endsIso: string | null = null;
    if (endsLocal) {
      const ends = new Date(endsLocal);
      if (Number.isNaN(ends.getTime())) {
        return { invalid: "That end time doesn't look right." };
      }
      if (ends <= starts) {
        return { invalid: "The end time must be after the start time." };
      }
      endsIso = ends.toISOString();
    }
    let capacityNum: number | null = null;
    if (capacity.trim()) {
      const n = Number(capacity);
      if (!Number.isInteger(n) || n < 1) {
        return { invalid: "Capacity must be a whole number of at least 1." };
      }
      if (n > 10000) return { invalid: "Capacity can be at most 10,000." };
      capacityNum = n;
    }
    return {
      kind,
      title: trimmedTitle,
      description,
      location,
      starts_at: starts.toISOString(),
      ends_at: endsIso,
      capacity: capacityNum,
      course_id: courseId || null,
    };
  }

  async function handleCreate(fields: EventFields) {
    setSubmitting(true);
    const supabase = createClient();
    const { data, error: insertError } = await supabase
      .from("events")
      .insert({
        university_id: universityId,
        creator_id: userId,
        club_id: club?.id ?? null,
        course_id: fields.course_id,
        kind: fields.kind,
        title: fields.title,
        description: fields.description.trim() || null,
        location: fields.location.trim() || null,
        starts_at: fields.starts_at,
        ends_at: fields.ends_at,
        capacity: fields.capacity,
      })
      .select("id")
      .single();

    if (insertError || !data) {
      setSubmitting(false);
      setError("That didn't save. Give it another go.");
      return;
    }

    // The host is going to their own event, and a failure here is non-fatal.
    // They can tap "Going" on the event page.
    await supabase
      .from("event_rsvps")
      .insert({ event_id: data.id, user_id: userId, status: "going" });

    router.push(`/events/${data.id}`);
    router.refresh();
  }

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setError(null);
    const fields = buildFields();
    if ("invalid" in fields) {
      setError(fields.invalid);
      return;
    }
    if (isEdit && event) {
      startTransition(async () => {
        const result = await updateEvent(event.id, fields);
        if (result.error) {
          setError(result.error);
        } else {
          router.replace(`/events/${event.id}`);
          router.refresh();
        }
      });
    } else {
      void handleCreate(fields);
    }
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label={isEdit ? "Edit event" : "Plan an event"}
      className="flex flex-col gap-5"
      noValidate
    >
      <fieldset>
        <legend className="text-sm font-semibold">Event type</legend>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {KIND_OPTIONS.map(({ value, label, hint, icon: Icon }) => {
            const active = kind === value;
            return (
              <button
                key={value}
                type="button"
                aria-pressed={active}
                onClick={() => setKind(value)}
                className={cn(
                  "flex flex-col items-start gap-1 rounded-xl border p-3 text-left transition-all focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                  active
                    ? "border-brand bg-brand-soft shadow-soft"
                    : "border-border bg-surface hover:border-brand/25 hover:bg-surface-2"
                )}
              >
                <span
                  className={cn(
                    "inline-flex items-center gap-1.5 text-sm font-semibold",
                    active && "text-brand-ink"
                  )}
                >
                  <Icon className="size-4" aria-hidden />
                  {label}
                </span>
                <span className="text-xs text-muted">{hint}</span>
              </button>
            );
          })}
        </div>
      </fieldset>

      {club ? (
        <p className="rounded-xl bg-surface-2 px-3.5 py-2.5 text-xs text-muted">
          Hosted by{" "}
          <span className="font-semibold text-foreground">{club.name}</span>
          {isEdit ? null : ". It'll show on the club page too."}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-title">Title</Label>
        <Input
          id="event-title"
          type="text"
          required
          maxLength={120}
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          placeholder={
            kind === "study_session"
              ? "Midterm review: bring your problem sets"
              : "Trivia night at the union"
          }
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-starts">Starts</Label>
          <Input
            id="event-starts"
            type="datetime-local"
            required
            value={startsLocal}
            onChange={(e) => setStartsLocal(e.target.value)}
            suppressHydrationWarning
          />
        </div>
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-ends">
            Ends <span className="font-normal text-muted">(optional)</span>
          </Label>
          <Input
            id="event-ends"
            type="datetime-local"
            value={endsLocal}
            onChange={(e) => setEndsLocal(e.target.value)}
            suppressHydrationWarning
          />
        </div>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-location">
          Location <span className="font-normal text-muted">(optional)</span>
        </Label>
        <Input
          id="event-location"
          type="text"
          maxLength={200}
          value={location}
          onChange={(e) => setLocation(e.target.value)}
          placeholder="Library 3rd floor, room 301"
        />
      </div>

      <div className="grid gap-5 sm:grid-cols-2">
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="event-capacity">
            Capacity <span className="font-normal text-muted">(optional)</span>
          </Label>
          <Input
            id="event-capacity"
            type="number"
            min={1}
            max={10000}
            step={1}
            inputMode="numeric"
            value={capacity}
            onChange={(e) => setCapacity(e.target.value)}
            placeholder="No limit"
          />
          <Hint>New &ldquo;going&rdquo; RSVPs stop once it&apos;s full.</Hint>
        </div>
        {courses.length > 0 ? (
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="event-course">
              Course <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Select
              id="event-course"
              value={courseId}
              onChange={(e) => setCourseId(e.target.value)}
            >
              <option value="">No course, campus-wide</option>
              {courses.map((course) => (
                <option key={course.id} value={course.id}>
                  {course.code} · {course.title}
                </option>
              ))}
            </Select>
            {kind === "study_session" ? (
              <Hint>Tie it to a course so classmates can spot it.</Hint>
            ) : null}
          </div>
        ) : null}
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="event-description">
          Description <span className="font-normal text-muted">(optional)</span>
        </Label>
        <Textarea
          id="event-description"
          rows={4}
          maxLength={2000}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What should people know before showing up?"
        />
      </div>

      {error ? <FieldError className="text-sm">{error}</FieldError> : null}

      <div className="flex items-center justify-end gap-2">
        {isEdit && event ? (
          <Link
            href={`/events/${event.id}`}
            className={buttonClasses({ variant: "secondary" })}
          >
            Cancel
          </Link>
        ) : null}
        <Button type="submit" disabled={busy}>
          {busy ? (
            <>
              <Loader2 className="size-4 animate-spin" aria-hidden />
              {isEdit ? "Saving…" : "Creating…"}
            </>
          ) : isEdit ? (
            "Save changes"
          ) : (
            "Create event"
          )}
        </Button>
      </div>
    </form>
  );
}

/** Host-only: inline confirm, then deleteEvent (which redirects to /events). */
export function DeleteEventButton({ eventId }: { eventId: string }) {
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  if (!confirming) {
    return (
      <div>
        <Button
          variant="danger-ghost"
          size="sm"
          onClick={() => {
            setError(null);
            setConfirming(true);
          }}
        >
          <Trash2 className="size-4" aria-hidden />
          Delete event
        </Button>
        {error ? (
          <p role="alert" className="mt-2 text-xs font-medium text-danger">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-card border border-border bg-surface-2 p-3 shadow-soft">
      <p className="text-sm">
        Delete this event for everyone? RSVPs go with it, and this can&apos;t
        be undone.
      </p>
      <div className="flex gap-2">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => setConfirming(false)}
          disabled={isPending}
        >
          Cancel
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => {
            startTransition(async () => {
              const result = await deleteEvent(eventId);
              // On success the server action redirects to /events.
              if (result?.error) {
                setError(result.error);
                setConfirming(false);
              }
            });
          }}
          disabled={isPending}
        >
          {isPending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Trash2 className="size-4" aria-hidden />
          )}
          Delete
        </Button>
      </div>
    </div>
  );
}
