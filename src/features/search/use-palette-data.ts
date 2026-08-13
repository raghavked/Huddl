"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import type { Channel, ChannelKind, Course, Profile } from "@/lib/types";

/**
 * Slim channel shape the palette renders: the browser-side mirror of the
 * home page's channel_members → channels → courses join.
 */
export type PaletteChannel = {
  id: string;
  kind: ChannelKind;
  name: string;
  slug: string;
  courseCode: string | null;
  courseTitle: string | null;
};

export type PalettePerson = {
  id: string;
  handle: string;
  /**
   * What to call them: their display name, or just their handle when their
   * profile is private. The palette both renders and searches this string,
   * so a withheld name is neither shown nor findable here.
   */
  displayName: string;
  avatarUrl: string | null;
};

type ChannelJoinRow = {
  channel:
    | (Pick<Channel, "id" | "kind" | "name" | "slug"> & {
        course: Pick<Course, "id" | "code" | "title"> | null;
      })
    | null;
};

type PersonRow = Pick<
  Profile,
  "id" | "handle" | "display_name" | "avatar_url" | "is_public"
>;

/* Campus channels first, then courses, then clubs and topics, the same
   priority the home page reads in. */
const KIND_ORDER: Record<ChannelKind, number> = {
  campus: 0,
  course: 1,
  club: 2,
  topic: 3,
};

/**
 * Lazily loads the viewer's channels and campus classmates the first time the
 * palette opens (`enabled` flips true), then keeps them for the session.
 * Failures are silent: the dynamic sections just stay empty while the static
 * "Go to" links keep working.
 */
export function usePaletteData(enabled: boolean): {
  channels: PaletteChannel[];
  people: PalettePerson[];
} {
  const [channels, setChannels] = useState<PaletteChannel[]>([]);
  const [people, setPeople] = useState<PalettePerson[]>([]);
  const startedRef = useRef(false);

  useEffect(() => {
    if (!enabled || startedRef.current) return;
    startedRef.current = true;
    let cancelled = false;

    (async () => {
      try {
        const supabase = createClient();
        const { data: auth } = await supabase.auth.getUser();
        const userId = auth.user?.id;
        if (!userId) return;

        const channelsPromise = supabase
          .from("channel_members")
          .select(
            "channel:channels(id, kind, name, slug, course:courses(id, code, title))"
          )
          .eq("user_id", userId);

        // People are campus-scoped, so read the viewer's university first.
        const peoplePromise = (async (): Promise<PersonRow[]> => {
          const { data: me } = await supabase
            .from("profiles")
            .select("university_id")
            .eq("id", userId)
            .maybeSingle();
          const universityId = (me as { university_id: string } | null)
            ?.university_id;
          if (!universityId) return [];
          // `is_public` comes along because nothing in the database withholds
          // a private student's name. The profiles SELECT policy is
          // campus-scoped only, so the redaction below is the whole of it.
          const { data } = await supabase
            .from("profiles")
            .select("id, handle, display_name, avatar_url, is_public")
            .eq("university_id", universityId)
            .order("display_name", { ascending: true })
            .limit(40);
          return (data ?? []) as unknown as PersonRow[];
        })();

        const [channelsRes, personRows] = await Promise.all([
          channelsPromise,
          peoplePromise,
        ]);
        if (cancelled) return;

        const nextChannels = (
          (channelsRes.data ?? []) as unknown as ChannelJoinRow[]
        )
          .map((row) => row.channel)
          .filter((c): c is NonNullable<ChannelJoinRow["channel"]> =>
            Boolean(c)
          )
          .map(
            (c): PaletteChannel => ({
              id: c.id,
              kind: c.kind,
              name: c.name,
              slug: c.slug,
              courseCode: c.course?.code ?? null,
              courseTitle: c.course?.title ?? null,
            })
          )
          .sort(
            (a, b) =>
              KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
              (a.courseCode ?? a.slug).localeCompare(b.courseCode ?? b.slug)
          );

        setChannels(nextChannels);
        setPeople(
          personRows.map(
            (p): PalettePerson => ({
              id: p.id,
              handle: p.handle,
              // A private classmate is only ever their handle to us, the same
              // way the board, the people directory and the group-DM picker
              // read them. You always see yourself in full.
              displayName:
                p.is_public || p.id === userId
                  ? p.display_name || p.handle
                  : p.handle,
              avatarUrl: p.avatar_url,
            })
          )
        );
      } catch {
        // Supabase unreachable or not configured; leave the sections empty.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { channels, people };
}
