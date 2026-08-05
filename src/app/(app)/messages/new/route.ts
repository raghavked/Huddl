import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * GET /messages/new?to=<userId> — start (or resume) a 1:1 DM and land in it.
 * Links like "Message" buttons on profiles point here; the create_dm_thread
 * RPC is idempotent, so repeat visits reuse the existing thread. Failures
 * bounce back to /messages with an error code the list page turns into copy.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const to = url.searchParams.get("to");

  const redirectTo = (path: string) =>
    NextResponse.redirect(new URL(path, url.origin), { status: 303 });

  if (!to || !UUID_RE.test(to)) {
    return redirectTo("/messages?error=invalid");
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return redirectTo("/login");
  if (user.id === to) return redirectTo("/messages?error=self");

  const { data: threadId, error } = await supabase.rpc("create_dm_thread", {
    other_user: to,
  });

  if (error || !threadId) {
    const message = error?.message ?? "";
    if (message.includes("yourself")) return redirectTo("/messages?error=self");
    if (message.includes("No such user")) {
      return redirectTo("/messages?error=no-user");
    }
    return redirectTo("/messages?error=failed");
  }

  return redirectTo(`/messages/${threadId}`);
}
