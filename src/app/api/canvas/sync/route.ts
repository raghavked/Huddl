import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  activeCoursesUrl,
  mapCanvasCourse,
  MAX_COURSE_PAGES,
  parseLinkHeader,
  type CanvasCourse,
  type MappedCanvasCourse,
} from "@/lib/canvas/api";
import type { CanvasConnection } from "@/lib/types";

/**
 * POST — pull the user's active Canvas courses (all pages, capped), find or
 * create matching `courses` rows, and upsert `enrollments`. The DB trigger on
 * enrollments creates the course channel + membership, so a successful sync
 * lands the student straight into their course chats.
 *
 * Everything is written with the user's session client — RLS scopes courses
 * to their university and enrollments to themselves.
 */
export async function POST() {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "You need to be signed in." }, { status: 401 });
  }

  const supabase = await createClient();
  const { data: connectionRow } = await supabase
    .from("canvas_connections")
    .select("base_url, access_token")
    .eq("user_id", user.userId)
    .maybeSingle();
  const connection = connectionRow as Pick<
    CanvasConnection,
    "base_url" | "access_token"
  > | null;
  if (!connection) {
    return NextResponse.json(
      { error: "Connect your Canvas account before syncing." },
      { status: 400 }
    );
  }

  const failSync = async (message: string, status: number) => {
    await supabase
      .from("canvas_connections")
      .update({ sync_status: "error", sync_error: message })
      .eq("user_id", user.userId);
    return NextResponse.json({ error: message }, { status });
  };

  // 1. Fetch every page of active courses (Link rel="next"), capped.
  const rawCourses: CanvasCourse[] = [];
  let nextUrl: string | undefined = activeCoursesUrl(connection.base_url);
  for (let page = 0; page < MAX_COURSE_PAGES && nextUrl; page++) {
    let res: Response;
    try {
      res = await fetch(nextUrl, {
        headers: {
          Authorization: `Bearer ${connection.access_token}`,
          Accept: "application/json",
        },
        cache: "no-store",
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      return failSync(
        "Couldn't reach your Canvas server. Try again in a moment.",
        502
      );
    }
    if (res.status === 401) {
      return failSync(
        "Canvas rejected your access token — it may have expired or been revoked. Reconnect with a new token.",
        401
      );
    }
    if (!res.ok) {
      return failSync(
        `Canvas returned an unexpected response (HTTP ${res.status}).`,
        502
      );
    }
    let batch: unknown;
    try {
      batch = await res.json();
    } catch {
      batch = null;
    }
    if (!Array.isArray(batch)) {
      return failSync("Canvas sent back a response we couldn't read.", 502);
    }
    rawCourses.push(...(batch as CanvasCourse[]));
    nextUrl = parseLinkHeader(res.headers.get("link")).next;
  }

  // 2. Keep only importable courses, deduped by Canvas course id.
  const seen = new Set<number>();
  const mapped: MappedCanvasCourse[] = [];
  for (const raw of rawCourses) {
    const m = mapCanvasCourse(raw);
    if (m && !seen.has(m.canvas_course_id)) {
      seen.add(m.canvas_course_id);
      mapped.push(m);
    }
  }

  // 3. Current term for the user's university, if one is flagged.
  const { data: term } = await supabase
    .from("terms")
    .select("id")
    .eq("university_id", user.university.id)
    .eq("is_current", true)
    .limit(1)
    .maybeSingle();
  const termId: string | null = term?.id ?? null;

  const findByCode = async (code: string): Promise<string | null> => {
    let query = supabase
      .from("courses")
      .select("id")
      .eq("university_id", user.university.id)
      .eq("code", code);
    query = termId ? query.eq("term_id", termId) : query.is("term_id", null);
    const { data } = await query.limit(1).maybeSingle();
    return data?.id ?? null;
  };

  // 4. Find-or-insert each course: canvas_course_id first, then
  //    (university, term, code), then insert.
  const courseIds: string[] = [];
  const enrolled: { code: string; title: string }[] = [];
  for (const course of mapped) {
    let courseId: string | null = null;

    const { data: byCanvasId } = await supabase
      .from("courses")
      .select("id")
      .eq("university_id", user.university.id)
      .eq("canvas_course_id", course.canvas_course_id)
      .limit(1)
      .maybeSingle();
    courseId = byCanvasId?.id ?? null;

    if (!courseId) courseId = await findByCode(course.code);

    if (!courseId) {
      const { data: inserted, error: insertError } = await supabase
        .from("courses")
        .insert({
          university_id: user.university.id,
          term_id: termId,
          code: course.code,
          title: course.title,
          canvas_course_id: course.canvas_course_id,
        })
        .select("id")
        .single();
      if (insertError) {
        // 23505: a classmate synced the same course concurrently — reuse theirs.
        courseId =
          insertError.code === "23505" ? await findByCode(course.code) : null;
      } else {
        courseId = inserted.id;
      }
    }

    if (courseId) {
      courseIds.push(courseId);
      enrolled.push({ code: course.code, title: course.title });
    }
  }

  // 5. Upsert enrollments; the on-insert trigger joins the course channels.
  if (courseIds.length > 0) {
    const { error: enrollError } = await supabase.from("enrollments").upsert(
      courseIds.map((course_id) => ({
        user_id: user.userId,
        course_id,
        source: "canvas" as const,
      })),
      { onConflict: "user_id,course_id", ignoreDuplicates: true }
    );
    if (enrollError) {
      return failSync(
        "Your courses came through, but enrolling you failed. Please try again.",
        500
      );
    }
  }

  await supabase
    .from("canvas_connections")
    .update({
      last_synced_at: new Date().toISOString(),
      sync_status: "ok",
      sync_error: null,
    })
    .eq("user_id", user.userId);

  return NextResponse.json({
    ok: true,
    coursesSynced: enrolled.length,
    enrolled,
  });
}
