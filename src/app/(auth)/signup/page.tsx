import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { Card } from "@/components/ui";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { SignupForm } from "@/features/auth/signup-form";

export const metadata: Metadata = {
  title: "Sign up",
};

export default async function SignupPage() {
  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect("/home");
  }

  return (
    <div className="animate-fade-up">
      <Card padding="lg">
        <h1 className="text-2xl font-bold tracking-tight">Join your campus</h1>
        <p className="mt-1.5 text-sm text-muted">
          Sign up with your university email. That&apos;s how we know
          you&apos;re a student.
        </p>
        <SignupForm />
        <p className="mt-4 text-center text-xs text-muted">
          By creating an account you agree to our{" "}
          <Link
            href="/legal/terms"
            className="font-semibold text-brand hover:underline"
          >
            Terms of Service
          </Link>{" "}
          and{" "}
          <Link
            href="/legal/privacy"
            className="font-semibold text-brand hover:underline"
          >
            Privacy Policy
          </Link>
          , and confirm you are 16 or older.
        </p>
      </Card>
      <p className="mt-6 text-center text-sm text-muted">
        Already on Huddl?{" "}
        <Link href="/login" className="font-semibold text-brand hover:underline">
          Log in
        </Link>
      </p>
    </div>
  );
}
