"use client";

import { useState } from "react";
import { Clock, Loader2, MapPin, UserRound, type LucideIcon } from "lucide-react";
import { Button, Card, Input, Label, cardClasses } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";

/** Serializable details the course page passes down. */
export type CourseDetailsData = {
  instructor: string | null;
  meeting_info: string | null;
  location: string | null;
};

/**
 * Classmate-kept course facts: instructor, meeting times, location. Any
 * enrolled classmate can edit; writes go through the enrollment-guarded
 * update_course_details RPC. Saves are optimistic and roll back on failure.
 */
export function CourseDetails({
  courseId,
  initialDetails,
}: {
  courseId: string;
  initialDetails: CourseDetailsData;
}) {
  const [details, setDetails] = useState<CourseDetailsData>(initialDetails);
  const [editing, setEditing] = useState(false);
  const [draftInstructor, setDraftInstructor] = useState("");
  const [draftMeeting, setDraftMeeting] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openEditor() {
    setDraftInstructor(details.instructor ?? "");
    setDraftMeeting(details.meeting_info ?? "");
    setDraftLocation(details.location ?? "");
    setError(null);
    setEditing(true);
  }

  async function handleSave() {
    if (saving) return;
    const next: CourseDetailsData = {
      instructor: draftInstructor.trim() || null,
      meeting_info: draftMeeting.trim() || null,
      location: draftLocation.trim() || null,
    };
    const previous = details;
    setError(null);
    setSaving(true);
    // Optimistic: the card updates right away; a failure rolls it back.
    setDetails(next);
    setEditing(false);
    const supabase = createClient();
    const { error: rpcError } = await supabase.rpc("update_course_details", {
      p_course_id: courseId,
      p_instructor: next.instructor,
      p_meeting_info: next.meeting_info,
      p_location: next.location,
    });
    setSaving(false);
    if (rpcError) {
      setDetails(previous);
      setError(
        rpcError.message.includes("join the course")
          ? "Details are kept by classmates. Add this course to your classes first."
          : "Couldn't save those details just now. Give it another try."
      );
    }
  }

  const rows: { key: string; icon: LucideIcon; value: string }[] = [];
  if (details.instructor) {
    rows.push({ key: "instructor", icon: UserRound, value: details.instructor });
  }
  if (details.meeting_info) {
    rows.push({ key: "meeting", icon: Clock, value: details.meeting_info });
  }
  if (details.location) {
    rows.push({ key: "location", icon: MapPin, value: details.location });
  }

  return (
    <section aria-label="Course details">
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
          Course details
        </h2>
        {!editing ? (
          <button
            type="button"
            onClick={openEditor}
            className="rounded-full text-xs font-semibold text-accent transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
          >
            Edit
          </button>
        ) : null}
      </div>

      {editing ? (
        <Card className="mt-3 animate-fade-up">
          <form
            onSubmit={(e) => {
              e.preventDefault();
              void handleSave();
            }}
          >
            <div>
              <Label htmlFor="details-instructor">Instructor</Label>
              <Input
                id="details-instructor"
                value={draftInstructor}
                onChange={(e) => setDraftInstructor(e.target.value)}
                placeholder="Prof. Alvarez"
                maxLength={120}
                disabled={saving}
                className="mt-1.5"
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="details-meeting">Meeting times</Label>
              <Input
                id="details-meeting"
                value={draftMeeting}
                onChange={(e) => setDraftMeeting(e.target.value)}
                placeholder="MWF 10:00–10:50 AM"
                maxLength={120}
                disabled={saving}
                className="mt-1.5"
              />
            </div>
            <div className="mt-3">
              <Label htmlFor="details-location">Location</Label>
              <Input
                id="details-location"
                value={draftLocation}
                onChange={(e) => setDraftLocation(e.target.value)}
                placeholder="Wellman 106"
                maxLength={120}
                disabled={saving}
                className="mt-1.5"
              />
            </div>
            <div className="mt-4 flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={saving}
                onClick={() => {
                  setEditing(false);
                  setError(null);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" size="sm" disabled={saving}>
                {saving ? (
                  <Loader2 className="size-3.5 animate-spin" aria-hidden />
                ) : null}
                Save details
              </Button>
            </div>
          </form>
        </Card>
      ) : rows.length > 0 ? (
        <ul
          className={cardClasses({
            padding: "none",
            className: "mt-3 divide-y divide-border",
          })}
        >
          {rows.map(({ key, icon: Icon, value }) => (
            <li key={key} className="flex items-center gap-3 px-4 py-3">
              <Icon className="size-4 shrink-0 text-brand" aria-hidden />
              <span className="min-w-0 flex-1 text-sm font-medium">{value}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="mt-3 rounded-card border border-dashed border-border px-4 py-5 text-center">
          <p className="mx-auto max-w-sm text-sm text-muted">
            Who teaches it, when it meets, where: fill it in for the class.
          </p>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-2 text-xs font-medium text-danger">
          {error}
        </p>
      ) : null}
      <p className="mt-2 px-1 text-xs text-muted">
        Kept up by the class. Anyone enrolled can edit.
      </p>
    </section>
  );
}
