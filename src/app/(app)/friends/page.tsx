import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { FriendsList } from "@/features/people/friends-list";
import { getCurrentUser } from "@/lib/auth";
import { listFriendships } from "@/lib/friends";
import { createClient } from "@/lib/supabase/server";

export const metadata: Metadata = { title: "Friends" };

/**
 * The Friends screen. One query fetches every edge the viewer is on, both
 * pendings and accepted, with the other person embedded; the client list
 * does the splitting into Requests, Sent and Friends with the same pure
 * helper the tests hold still, and owns every optimistic write after that.
 *
 * A load failure throws its warm FriendsError to the route error boundary,
 * which offers a real Try again rather than an empty screen pretending the
 * list is empty.
 */
export default async function FriendsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const rows = await listFriendships({
    client: supabase,
    userId: user.userId,
  });

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <FriendsList initial={rows} userId={user.userId} />
    </div>
  );
}
