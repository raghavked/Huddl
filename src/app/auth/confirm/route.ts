import { NextResponse } from "next/server";
import type { EmailOtpType } from "@supabase/supabase-js";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";

/**
 * Email-confirmation landing. Supabase confirmation emails link here either with
 * `token_hash` + `type` (OTP verification) or with `code` (PKCE flow, the
 * default for hosted Supabase auth). Either path signs the user in (sets the
 * session cookies) and we hand them straight to onboarding.
 */
export async function GET(request: Request) {
  const url = new URL(request.url);
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type") as EmailOtpType | null;
  const code = url.searchParams.get("code");

  const loginWithError = (message: string) =>
    NextResponse.redirect(
      new URL(`/login?error=${encodeURIComponent(message)}`, url.origin)
    );

  if (!isSupabaseConfigured() || (!code && (!tokenHash || !type))) {
    return loginWithError(
      "That confirmation link is invalid. Try logging in, or sign up again to get a new one."
    );
  }

  const supabase = await createClient();

  const { error } =
    tokenHash && type
      ? await supabase.auth.verifyOtp({ type, token_hash: tokenHash })
      : await supabase.auth.exchangeCodeForSession(code as string);

  if (error) {
    return loginWithError(
      "That confirmation link has expired or was already used. Log in with your email and password to request a fresh one."
    );
  }

  return NextResponse.redirect(new URL("/onboarding", url.origin));
}
