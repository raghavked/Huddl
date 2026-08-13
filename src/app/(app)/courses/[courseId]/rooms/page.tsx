import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { ChevronRight, Home, MessageSquare } from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import { PageHeader, cardClasses } from "@/components/ui";
import { CreateRoomForm, JoinRoomButton } from "@/features/study/rooms";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { Channel, Course } from "@/lib/types";

export const metadata: Metadata = { title: "Rooms" };

type RoomRow = Pick<Channel, "id" | "name" | "is_main">;

/**
 * A course's rooms: the main chat for the whole class plus side rooms
 * (lectures, study groups, …). Enrolled classmates only; everyone else
 * lands on the course page's join door.
 */
export default async function CourseRoomsPage({
  params,
}: {
  params: Promise<{ courseId: string }>;
}) {
  const [{ courseId }, user] = await Promise.all([params, getCurrentUser()]);
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data: courseRow } = await supabase
    .from("courses")
    .select("id, code, title")
    .eq("id", courseId)
    .maybeSingle();
  const course = courseRow as Pick<Course, "id" | "code" | "title"> | null;
  if (!course) notFound();

  const [{ data: enrollment }, { data: roomRows }, { data: memberRows }] =
    await Promise.all([
      supabase
        .from("enrollments")
        .select("id")
        .eq("course_id", course.id)
        .eq("user_id", user.userId)
        .maybeSingle(),
      supabase
        .from("channels")
        .select("id, name, is_main")
        .eq("course_id", course.id)
        .order("is_main", { ascending: false })
        .order("name", { ascending: true }),
      supabase
        .from("channel_members")
        .select("channel_id")
        .eq("user_id", user.userId),
    ]);

  // Rooms are for classmates; the course page has the join door.
  if (!enrollment) redirect(`/courses/${course.id}`);

  const rooms = (roomRows ?? []) as RoomRow[];
  const joined = new Set(
    ((memberRows ?? []) as { channel_id: string }[]).map(
      (row) => row.channel_id
    )
  );

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref={`/courses/${course.id}`}
        backLabel={course.code}
        title={`${course.code} rooms`}
        description="One main chat for the whole class, plus side rooms for everything else."
      />

      {rooms.length === 0 ? (
        <div className="mt-6 rounded-card border border-dashed border-border">
          <EmptyState
            icon={Home}
            title="No rooms yet"
            description="The course chat opens up as classmates add this class. Or start a room below."
          />
        </div>
      ) : (
        <ul className="mt-6 flex flex-col gap-2.5">
          {rooms.map((room) => {
            const isJoined = joined.has(room.id);
            const title = room.is_main ? "Course chat" : room.name;
            const RoomIcon = room.is_main ? Home : MessageSquare;
            const inner = (
              <>
                <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                  <RoomIcon className="size-5" aria-hidden />
                </span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-sm font-semibold">
                    {title}
                  </span>
                  {room.is_main ? (
                    <span className="block truncate text-xs text-muted">
                      Where the whole class lands
                    </span>
                  ) : null}
                </span>
              </>
            );
            return (
              <li key={room.id}>
                {isJoined ? (
                  <Link
                    href={`/channels/${room.id}`}
                    aria-label={`Open ${title}`}
                    className={cardClasses({
                      padding: "none",
                      interactive: true,
                      className: "flex items-center gap-3 px-4 py-3",
                    })}
                  >
                    {inner}
                    <ChevronRight
                      className="size-4 shrink-0 text-muted"
                      aria-hidden
                    />
                  </Link>
                ) : (
                  <div
                    className={cardClasses({
                      padding: "none",
                      className: "flex items-center gap-3 px-4 py-3",
                    })}
                  >
                    {inner}
                    <JoinRoomButton
                      channelId={room.id}
                      roomName={title}
                      userId={user.userId}
                    />
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <CreateRoomForm courseId={course.id} />
    </div>
  );
}
