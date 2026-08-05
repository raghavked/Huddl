import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { isValidPhone, normalizePhone } from "@/lib/utils";
import { getVerifier, sha256Hex, StubVerifier } from "@/lib/phone/provider";

const CODE_TTL_MS = 10 * 60 * 1000; // codes are valid for 10 minutes

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status });
}

/**
 * POST { phone } — begin phone verification for the signed-in user.
 * Stub mode (default): generate a 6-digit code, store its sha256 in
 * phone_verifications, and return it as devCode so the dev UI can show it.
 * Twilio mode: Twilio sends the SMS and holds the code; we store a marker row
 * (code_hash = 'twilio') so /api/phone/check knows which path to take.
 * RLS scopes phone_verifications rows to their owner.
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
  const { phone } = (body ?? {}) as { phone?: unknown };
  if (typeof phone !== "string" || !isValidPhone(phone)) {
    return jsonError(
      "Enter a valid phone number, like (415) 555-0123 or +14155550123.",
      400
    );
  }
  const normalized = normalizePhone(phone);
  const expiresAt = new Date(Date.now() + CODE_TTL_MS).toISOString();
  const verifier = getVerifier();

  if (verifier instanceof StubVerifier) {
    const { devCode } = await verifier.start(normalized);
    if (!devCode) {
      return jsonError("Couldn't generate a verification code.", 500);
    }
    const { error } = await supabase.from("phone_verifications").insert({
      user_id: user.id,
      phone: normalized,
      code_hash: sha256Hex(devCode),
      expires_at: expiresAt,
    });
    if (error) {
      return jsonError("Couldn't start verification. Please try again.", 500);
    }
    // Dev mode only: surface the code so the flow is testable without SMS.
    return NextResponse.json({ ok: true, devCode });
  }

  try {
    await verifier.start(normalized);
  } catch {
    return jsonError(
      "We couldn't send a verification text right now. Please try again in a minute.",
      502
    );
  }
  const { error } = await supabase.from("phone_verifications").insert({
    user_id: user.id,
    phone: normalized,
    code_hash: "twilio",
    expires_at: expiresAt,
  });
  if (error) {
    return jsonError("Couldn't start verification. Please try again.", 500);
  }
  return NextResponse.json({ ok: true });
}
