import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { NotificationList } from "@/features/notifications/notification-list";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { AppNotification } from "@/lib/types";

export const metadata: Metadata = { title: "Notifications" };

/**
 * Notification inbox. Rows are written exclusively by database triggers (DMs,
 * thread replies, schedule-privacy audit events, …); this page just reads the
 * viewer's 50 most recent and hands them to the live client list.
 */
export default async function NotificationsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("notifications")
    .select("*")
    .eq("user_id", user.userId)
    .order("created_at", { ascending: false })
    .limit(50);

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <NotificationList
        initial={(data ?? []) as AppNotification[]}
        userId={user.userId}
      />
    </div>
  );
}
