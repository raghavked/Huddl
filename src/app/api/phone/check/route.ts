import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidPhone, normalizePhone } from "@/lib/utils";
import { getVerifier, sha256Hex } from "@/lib/phone/provider";

const MAX_ATTEMPTS = 5;

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST { phone, code } — confirm a verification code. Looks up the newest
 * unexpired, unverified phone_verifications row for this user+phone with
 * attempts remaining. Stub rows are checked by sha256 comparison; rows marked
 * 'twilio' are checked against Twilio Verify. Success stamps verified_at and
 * writes phone + phone_verified_at onto the profile (the trust badge).
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
  const { phone, code } = (body ?? {}) as { phone?: unknown; code?: unknown };
  if (typeof phone !== "string" || !isValidPhone(phone)) {
    return jsonError("Enter a valid phone number.", 400);
  }
  const trimmedCode = typeof code === "string" ? code.trim() : "";
  if (!/^\d{6}$/.test(trimmedCode)) {
    return jsonError("Enter the 6-digit code from your text message.", 400);
  }
  const normalized = normalizePhone(phone);

  const { data: row } = await supabase
    .from("phone_verifications")
    .select("id, code_hash, attempts")
    .eq("user_id", user.id)
    .eq("phone", normalized)
    .is("verified_at", null)
    .gt("expires_at", new Date().toISOString())
    .lt("attempts", MAX_ATTEMPTS)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  if (!row) {
    return jsonError(
      "That code has expired or had too many attempts. Request a new one.",
      400
    );
  }

  let approved = false;
  if (row.code_hash === "twilio") {
    try {
      approved = await getVerifier().check(normalized, trimmedCode);
    } catch {
      approved = false;
    }
  } else {
    approved = sha256Hex(trimmedCode) === row.code_hash;
  }

  if (!approved) {
    const attempts = row.attempts + 1;
    await supabase
      .from("phone_verifications")
      .update({ attempts })
      .eq("id", row.id);
    const remaining = MAX_ATTEMPTS - attempts;
    return jsonError(
      remaining > 0
        ? `That code didn't match. ${remaining} ${
            remaining === 1 ? "attempt" : "attempts"
          } left.`
        : "That code didn't match and you're out of attempts. Request a new code.",
      400
    );
  }

  const now = new Date().toISOString();
  await supabase
    .from("phone_verifications")
    .update({ verified_at: now })
    .eq("id", row.id);
  const { error: profileError } = await supabase
    .from("profiles")
    .update({ phone: normalized, phone_verified_at: now })
    .eq("id", user.id);
  if (profileError) {
    return jsonError(
      "Your code was right, but we couldn't update your profile. Please try again.",
      500
    );
  }

  return NextResponse.json({ ok: true });
}
