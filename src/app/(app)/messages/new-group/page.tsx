import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui";
import { GroupComposer } from "@/features/dm/group-composer";
import { getCurrentUser } from "@/lib/auth";

export const metadata: Metadata = { title: "Start a group" };

/**
 * The group composer: a name, a campus people picker, and the create call.
 * Everything interactive lives in GroupComposer — the page only resolves who
 * is asking, since a group may only hold classmates from their university.
 */
export default async function NewGroupPage() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        title="Start a group"
        description={`Name it, pick your people, and everyone lands in the same chat. Groups hold 3 to 16 students from ${user.university.short_name}.`}
        backHref="/messages"
        backLabel="Messages"
      />

      <GroupComposer userId={user.userId} />
    </div>
  );
}
