import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import {
  looksLikeCanvasHost,
  normalizeCanvasBaseUrl,
  type CanvasUser,
} from "@/lib/canvas/api";

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST { baseUrl, accessToken } — verify the token against Canvas
 * (`GET /api/v1/users/self`) and store the connection for the signed-in user.
 * RLS on canvas_connections scopes the row to its owner.
 */
export async function POST(request: Request) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("You need to be signed in.", 401);

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid request body.", 400);
  }
  const { baseUrl, accessToken } = (body ?? {}) as {
    baseUrl?: unknown;
    accessToken?: unknown;
  };
  if (typeof baseUrl !== "string" || typeof accessToken !== "string") {
    return jsonError("A Canvas URL and an access token are both required.", 400);
  }

  const base = normalizeCanvasBaseUrl(baseUrl);
  if (!base) {
    return jsonError(
      "Enter a valid https Canvas URL, like https://canvas.university.edu.",
      400
    );
  }
  if (!looksLikeCanvasHost(base)) {
    return jsonError(
      "That doesn't look like a Canvas address — it usually contains “canvas” or “instructure”, like https://canvas.university.edu.",
      400
    );
  }

  const token = accessToken.trim();
  if (!token) return jsonError("Paste the access token Canvas generated.", 400);

  let res: Response;
  try {
    res = await fetch(`${base}/api/v1/users/self`, {
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      cache: "no-store",
      signal: AbortSignal.timeout(12_000),
    });
  } catch {
    return jsonError(
      "Couldn't reach that Canvas server. Double-check the URL and try again.",
      502
    );
  }

  if (res.status === 401) {
    return jsonError(
      "Canvas rejected that access token. Generate a new token and try again.",
      401
    );
  }
  if (!res.ok) {
    return jsonError(
      `Canvas returned an unexpected response (HTTP ${res.status}). Check the URL and try again.`,
      502
    );
  }

  let canvasUser: CanvasUser | null = null;
  try {
    canvasUser = (await res.json()) as CanvasUser;
  } catch {
    canvasUser = null;
  }
  if (!canvasUser || typeof canvasUser.id !== "number") {
    return jsonError(
      "That URL responded, but not like a Canvas API. Make sure it's your school's Canvas address.",
      502
    );
  }

  const { error } = await supabase.from("canvas_connections").upsert(
    {
      user_id: user.id,
      base_url: base,
      access_token: token,
      last_synced_at: null,
      sync_status: "never",
      sync_error: null,
    },
    { onConflict: "user_id" }
  );
  if (error) {
    return jsonError("Couldn't save the connection. Please try again.", 500);
  }

  return NextResponse.json({
    ok: true,
    userName: canvasUser.name ?? "Canvas user",
    baseUrl: base,
  });
}

/** DELETE — remove the signed-in user's Canvas connection (and stored token). */
export async function DELETE() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return jsonError("You need to be signed in.", 401);

  const { error } = await supabase
    .from("canvas_connections")
    .delete()
    .eq("user_id", user.id);
  if (error) {
    return jsonError("Couldn't disconnect Canvas. Please try again.", 500);
  }

  return NextResponse.json({ ok: true });
}
