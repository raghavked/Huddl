import { redirect } from "next/navigation";
import { Sidebar } from "@/components/shell/sidebar";
import { MobileTopBar } from "@/components/shell/mobile-top-bar";
import { MobileDock } from "@/components/shell/mobile-dock";
import { CommandPalette } from "@/features/search/command-palette";
import { Card } from "@/components/ui";
import { getCurrentUser } from "@/lib/auth";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

export default async function AppLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  if (!isSupabaseConfigured()) {
    return (
      <main className="flex min-h-dvh items-center justify-center p-6">
        <Card padding="lg" className="max-w-md text-center">
          <h1 className="text-lg font-bold">Huddl needs a backend</h1>
          <p className="mt-2 text-sm text-muted">
            Copy <code>.env.example</code> to <code>.env.local</code> and fill
            in your Supabase project URL and publishable key, then restart the
            dev server. Migrations live in <code>supabase/migrations/</code>.
          </p>
        </Card>
      </main>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const [notificationsRes, unreadDmsRes] = await Promise.all([
    supabase
      .from("notifications")
      .select("id", { count: "exact", head: true })
      .is("read_at", null),
    supabase.rpc("unread_dm_thread_count"),
  ]);
  const unreadCount = notificationsRes.count ?? 0;
  // Failure-tolerant: a missing migration or RPC error just means no badge.
  const unreadDms =
    typeof unreadDmsRes.data === "number" ? unreadDmsRes.data : 0;

  return (
    <div className="min-h-dvh md:pl-64">
      {/* Ambient wash behind everything — subtle, token-built. */}
      <div
        aria-hidden
        className="pointer-events-none fixed inset-x-0 top-0 -z-10 h-72 bg-linear-to-b from-brand/[0.05] via-transparent to-transparent"
      />
      <MobileTopBar user={user} unreadCount={unreadCount} />
      <main className="pb-28 md:pb-10">{children}</main>
      <MobileDock unreadDms={unreadDms} />
      <Sidebar user={user} unreadCount={unreadCount} unreadDms={unreadDms} />
      <CommandPalette />
    </div>
  );
}
