import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { CampusEvent } from "@/lib/types";

type IcsEvent = Pick<
  CampusEvent,
  "id" | "title" | "description" | "location" | "starts_at" | "ends_at"
>;

const ONE_HOUR_MS = 60 * 60 * 1000;

/** Escape text values per RFC 5545 §3.3.11: backslash, semicolon, comma, newline. */
function escapeIcsText(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/;/g, "\\;")
    .replace(/,/g, "\\,")
    .replace(/\r\n|\r|\n/g, "\\n");
}

/** UTC basic date-time format: 20260805T173000Z. */
function toIcsUtc(date: Date): string {
  return date.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}

/**
 * Fold a content line at 75 octets per RFC 5545 §3.1 (continuations start
 * with a single space). Multi-byte characters are never split.
 */
function foldLine(line: string): string {
  const encoder = new TextEncoder();
  if (encoder.encode(line).length <= 75) return line;
  const parts: string[] = [];
  let current = "";
  let octets = 0;
  for (const char of line) {
    const size = encoder.encode(char).length;
    // 74, not 75: continuation lines spend one octet on the leading space.
    if (octets + size > 74) {
      parts.push(current);
      current = " "; // continuation lines start with a single space
      octets = 1;
    }
    current += char;
    octets += size;
  }
  parts.push(current);
  return parts.join("\r\n");
}

/**
 * GET: download the event as an .ics file ("Add to calendar"). Auth'd via
 * the session client, so RLS decides whether this event is visible at all.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ eventId: string }> }
) {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json(
      { error: "You need to be signed in." },
      { status: 401 }
    );
  }

  const { eventId } = await params;
  const supabase = await createClient();
  const { data: eventRow } = await supabase
    .from("events")
    .select("id, title, description, location, starts_at, ends_at")
    .eq("id", eventId)
    .maybeSingle();
  if (!eventRow) {
    return NextResponse.json(
      { error: "Event not found." },
      { status: 404 }
    );
  }
  const event = eventRow as IcsEvent;

  const start = new Date(event.starts_at);
  const end = event.ends_at
    ? new Date(event.ends_at)
    : new Date(start.getTime() + ONE_HOUR_MS);

  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Hearth//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${event.id}@hearth`,
    `DTSTAMP:${toIcsUtc(new Date())}`,
    `DTSTART:${toIcsUtc(start)}`,
    `DTEND:${toIcsUtc(end)}`,
    `SUMMARY:${escapeIcsText(event.title)}`,
  ];
  if (event.description) {
    lines.push(`DESCRIPTION:${escapeIcsText(event.description)}`);
  }
  if (event.location) {
    lines.push(`LOCATION:${escapeIcsText(event.location)}`);
  }
  lines.push("END:VEVENT", "END:VCALENDAR");

  const ics = lines.map(foldLine).join("\r\n") + "\r\n";

  return new NextResponse(ics, {
    headers: {
      "Content-Type": "text/calendar; charset=utf-8",
      "Content-Disposition": 'attachment; filename="hearth-event.ics"',
      "Cache-Control": "no-store",
    },
  });
}
