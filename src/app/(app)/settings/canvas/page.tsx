import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
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
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        eyebrow="Settings"
        title="Canvas connection"
        description="Re-sync to pull in newly added Canvas courses, or disconnect to delete your stored token. To leave a class you dropped, use the drop button on that course in your Courses list."
        backHref="/settings"
        backLabel="Settings"
      />
      <div className="mt-8">
        <CanvasConnect
          connection={(data as CanvasConnectionSummary | null) ?? null}
        />
      </div>
    </div>
  );
}
