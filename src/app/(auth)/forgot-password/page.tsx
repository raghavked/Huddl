import type { Metadata } from "next";
import Link from "next/link";
import { ForgotPasswordForm } from "@/features/auth/forgot-password-form";

export const metadata: Metadata = {
  title: "Forgot password",
};

/**
 * The door for a student who can't get in.
 *
 * Two things this page deliberately does not do. It doesn't bounce a
 * signed-in student to /home the way login and signup do, because a recovery
 * link signs you in before you've set the new password and that guard would
 * throw people out of the middle of the flow they're already in. And it doesn't
 * check whether the address exists: the whole flow is designed so that this
 * page can't be used to find out who is on Huddl. See the form for the copy
 * that keeps that promise.
 *
 * `error` arrives from auth/confirm/route.ts when a reset link has already
 * expired; `email` is carried over from the login form so nobody types their
 * address twice.
 */
export default async function ForgotPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ email?: string; error?: string }>;
}) {
  const params = await searchParams;

  return (
    <div className="animate-fade-up">
      <ForgotPasswordForm
        initialEmail={(params.email ?? "").slice(0, 254)}
        initialError={params.error ?? null}
      />
      <p className="mt-6 text-center text-sm text-muted">
        Never had an account?{" "}
        <Link
          href="/signup"
          className="font-semibold text-brand hover:underline"
        >
          Join your campus
        </Link>
      </p>
    </div>
  );
}
