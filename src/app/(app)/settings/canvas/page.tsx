import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import {
  CanvasConnect,
  type CanvasConnectionSummary,
} from "@/features/canvas/canvas-connect";

export const metadata: Metadata = {
  title: "Canvas connection",
  description: "Manage your Canvas by Instructure connection and course sync.",
};

export default async function CanvasSettingsPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  const supabase = await createClient();
  const { data } = await supabase
    .from("canvas_connections")
    .select("base_url, last_synced_at, sync_status, sync_error, created_at")
    .eq("user_id", user.userId)
    .maybeSingle();

  return (
    <div className="mx-auto max-w-3xl px-4 py-6">
      <Link
        href="/settings"
        className="inline-flex items-center gap-1.5 rounded text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
      >
        <ArrowLeft className="size-4" aria-hidden />
        Settings
      </Link>
      <header className="mt-3">
        <h1 className="text-2xl font-bold tracking-tight">Canvas connection</h1>
        <p className="mt-1 text-sm text-muted">
          Re-sync to pull in newly added Canvas courses, or disconnect to
          delete your stored token. To leave a class you dropped, use the drop
          button on that course in your Courses list.
        </p>
      </header>
      <div className="mt-6">
        <CanvasConnect
          connection={(data as CanvasConnectionSummary | null) ?? null}
        />
      </div>
    </div>
  );
}
