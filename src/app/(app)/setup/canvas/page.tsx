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
  title: "Connect Canvas",
  description:
    "Link your Canvas account to auto-join a chat channel for every course.",
};

export default async function CanvasSetupPage() {
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
        backHref="/setup"
        backLabel="Setup"
        title="Connect Canvas"
        description={`Pull in your ${user.university.short_name} courses and land straight in a chat channel for each one.`}
      />
      <div className="mt-8 animate-fade-up">
        <CanvasConnect
          connection={(data as CanvasConnectionSummary | null) ?? null}
        />
      </div>
    </div>
  );
}
