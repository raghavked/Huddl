"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { EventKind, RsvpStatus } from "@/lib/types";

const RSVP_STATUSES: readonly RsvpStatus[] = ["going", "maybe", "declined"];
const EVENT_KINDS: readonly EventKind[] = ["study_session", "meetup"];

export type EventActionResult = { error?: string };

/** Editable fields shared by the create form and updateEvent. */
export interface EventFields {
  kind: EventKind;
  title: string;
  description: string;
  location: string;
  /** ISO timestamp. */
  starts_at: string;
  /** ISO timestamp, or null for open-ended events. */
  ends_at: string | null;
  capacity: number | null;
  course_id: string | null;
}

function revalidateEvent(eventId: string) {
  revalidatePath("/events");
  revalidatePath(`/events/${eventId}`);
}

/** Shared validation for create (client mirrors it) and update. */
function validateFields(fields: EventFields): string | null {
  if (!EVENT_KINDS.includes(fields.kind)) return "Pick a valid event type.";
  const title = fields.title.trim();
  if (title.length < 3) return "Event titles need at least 3 characters.";
  if (title.length > 120) return "Event titles can be at most 120 characters.";
  if (fields.description.trim().length > 2000) {
    return "Descriptions can be at most 2,000 characters.";
  }
  if (fields.location.trim().length > 200) {
    return "Locations can be at most 200 characters.";
  }
  const starts = new Date(fields.starts_at);
  if (Number.isNaN(starts.getTime())) return "Pick a valid start time.";
  if (fields.ends_at) {
    const ends = new Date(fields.ends_at);
    if (Number.isNaN(ends.getTime())) return "Pick a valid end time.";
    if (ends <= starts) return "The end time must be after the start time.";
  }
  if (fields.capacity !== null) {
    if (!Number.isInteger(fields.capacity) || fields.capacity < 1) {
      return "Capacity must be a whole number of at least 1.";
    }
    if (fields.capacity > 10000) return "Capacity can be at most 10,000.";
  }
  return null;
}

/**
 * Set (or change) the signed-in user's RSVP. Upserts the event_rsvps row;
 * RLS restricts writes to the user's own row at their own university. A new
 * "going" is refused once the event is at capacity (people already going can
 * keep their spot or step back).
 */
export async function rsvp(
  eventId: string,
  status: RsvpStatus
): Promise<EventActionResult> {
  if (!RSVP_STATUSES.includes(status)) return { error: "Pick a valid RSVP." };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "You need to be signed in to RSVP." };

  if (status === "going") {
    const { data: event } = await supabase
      .from("events")
      .select("capacity")
      .eq("id", eventId)
      .maybeSingle();
    if (!event) return { error: "This event no longer exists." };

    const capacity = (event as { capacity: number | null }).capacity;
    if (capacity !== null) {
      // Count everyone else who's going; re-confirming your own spot is fine.
      const { count } = await supabase
        .from("event_rsvps")
        .select("user_id", { count: "exact", head: true })
        .eq("event_id", eventId)
        .eq("status", "going")
        .neq("user_id", user.id);
      if ((count ?? 0) >= capacity) {
        return {
          error: `This event is full. All ${capacity} spots are taken. You can still RSVP "maybe" in case one opens up.`,
        };
      }
    }
  }

  const { error } = await supabase
    .from("event_rsvps")
    .upsert(
      { event_id: eventId, user_id: user.id, status },
      { onConflict: "event_id,user_id" }
    );
  if (error) return { error: "Couldn't save your RSVP. Please try again." };

  revalidateEvent(eventId);
  return {};
}

/**
 * Edit an event. RLS only lets the creator through, so a silent no-op update
 * (zero rows) means someone else tried, so surface that as an error.
 */
export async function updateEvent(
  eventId: string,
  fields: EventFields
): Promise<EventActionResult> {
  const invalid = validateFields(fields);
  if (invalid) return { error: invalid };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .update({
      kind: fields.kind,
      title: fields.title.trim(),
      description: fields.description.trim() || null,
      location: fields.location.trim() || null,
      starts_at: fields.starts_at,
      ends_at: fields.ends_at,
      capacity: fields.capacity,
      course_id: fields.course_id,
    })
    .eq("id", eventId)
    .select("id");

  if (error) return { error: "Couldn't save changes. Please try again." };
  if (!data || data.length === 0) {
    return { error: "Only the host can edit this event." };
  }
  revalidateEvent(eventId);
  return {};
}

/**
 * Delete an event (RLS: creator only). RSVPs cascade in the database.
 * Redirects to /events on success.
 */
export async function deleteEvent(eventId: string): Promise<EventActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("events")
    .delete()
    .eq("id", eventId)
    .select("id");

  if (error) return { error: "Couldn't delete this event. Please try again." };
  if (!data || data.length === 0) {
    return { error: "Only the host can delete this event." };
  }
  revalidatePath("/events");
  redirect("/events");
}
