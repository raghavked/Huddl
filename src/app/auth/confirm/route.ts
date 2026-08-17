import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { safeNextPath } from "@/lib/safe-next";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Email-confirmation landing. Supabase confirmation emails link here either with
 * `token_hash` + `type` (OTP verification) or with `code` (PKCE flow, the
 * default for hosted Supabase auth). Either path signs the student in (sets the
 * session cookies); where they land afterwards is the interesting part.
 *
 * A brand-new account goes to /confirmed, which tells an app signup to head
 * back to the app and hands a web signup (now holding fresh session cookies)
 * the door into onboarding; the link cannot tell those two journeys apart, so
 * the landing page speaks to both. A student coming back through a
 * password-reset email is not new, and dropping them into signup's ending
 * would be nonsense, so the reset email sends `?next=/reset-password` and we
 * honour it. `type=recovery` is the same signal from the OTP flow, where the
 * link carries no `next` of its own, and it lands in the same place.
 *
 * `next` is a path on this origin or it is nothing: the validation here is a
 * copy of `auth/callback/route.ts`, deliberately, because an open redirect on
 * an auth route is how a phished student ends up typing a new password into
 * someone else's page.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");
  const nextParam = url.searchParams.get("next");
  const next = safeNextPath(nextParam);

  // Recovery has its own dead end: telling someone whose reset link expired to
  // "log in to request a fresh one" is exactly the thing they can't do.
  const isRecovery = type === "recovery" || next === "/reset-password";

  const bounceWithError = (path: string, message: string) =>
    NextResponse.redirect(
      new URL(`${path}?error=${encodeURIComponent(message)}`, url.origin)
    );

  const linkFailed = (message: string) =>
    isRecovery
      ? bounceWithError(
          "/forgot-password",
          "That reset link has expired or was already used. Enter your email and we'll send a fresh one."
        )
      : bounceWithError("/login", message);

  if (!isSupabaseConfigured() || (!code && (!tokenHash || !type))) {
    return linkFailed(
      "That confirmation link is invalid. Try logging in, or sign up again to get a new one."
    );
  }

  const supabase = await createClient();

  const { error } =
    tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : await supabase.auth.exchangeCodeForSession(code as string);

  if (error) {
    return linkFailed(
      "That confirmation link has expired or was already used. Log in with your email and password to request a fresh one."
    );
  }

  return NextResponse.redirect(
    new URL(next ?? (isRecovery ? "/reset-password" : "/confirmed"), url.origin)
  );
}
