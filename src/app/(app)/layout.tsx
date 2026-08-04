import { redirect } from "next/navigation";
import { AppNav } from "@/components/app-nav";
import { TopBar } from "@/components/top-bar";
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
        <div className="max-w-md rounded-card border border-border bg-surface p-6 text-center">
          <h1 className="text-lg font-bold">Huddl needs a backend</h1>
          <p className="mt-2 text-sm text-muted">
            Copy <code>.env.example</code> to <code>.env.local</code> and fill
            in your Supabase project URL and publishable key, then restart the
            dev server. Migrations live in <code>supabase/migrations/</code>.
          </p>
        </div>
      </main>
    );
  }

  const user = await getCurrentUser();
  if (!user) {
    redirect("/login");
  }

  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);

  return (
    <div className="min-h-dvh">
      <TopBar user={user} unreadCount={count ?? 0} />
      <main className="pb-20 md:pb-6 md:pl-56">{children}</main>
      <AppNav />
    </div>
  );
}
