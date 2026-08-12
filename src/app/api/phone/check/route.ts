import { NextResponse } from "next/server";
import { createClient, createServiceClient } from "@/lib/supabase/server";
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
 * 'twilio' are checked against Twilio Verify. Success writes
 * phone_verified_at onto the profile (the trust badge) and then stamps
 * verified_at on the verification row.
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

  // Everything this route WRITES goes through the service client: the badge
  // (profiles.phone_verified_at, held back from the profiles grant by 0039)
  // and, since 0045, the verification row itself — attempts and verified_at.
  // A student who can write that row can choose their own code_hash and mint
  // the badge on a number no text was ever sent to. Created before the first
  // write so a project with no service key says so instead of half-finishing.
  let admin;
  try {
    admin = createServiceClient();
  } catch {
    return jsonError(
      "Phone verification is temporarily unavailable. Please try again later.",
      503
    );
  }

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
    await admin
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
  // This route is "the verification flow" that 0039's grant reserves
  // phone_verified_at for, so it is the one place the badge gets written.
  const { error: profileError } = await admin
    .from("profiles")
    .update({ phone_verified_at: now })
    .eq("id", user.id);
  if (profileError) {
    return jsonError(
      "Your code was right, but we couldn't update your profile. Please try again.",
      500
    );
  }

  // The verified number stays in phone_verifications (owner-only). profiles
  // only gets the badge timestamp — the number is never on the public row.
  // Stamped last, after the badge is on: any failure above has to leave the
  // row unverified, or the correct code is spent and every retry reads as
  // expired.
  await admin
    .from("phone_verifications")
    .update({ verified_at: now })
    .eq("id", row.id);

  return NextResponse.json({ ok: true });
}
