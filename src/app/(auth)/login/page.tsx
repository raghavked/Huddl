import type { Metadata } from "next";
import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient, isSupabaseConfigured } from "@/lib/supabase/server";
import { LoginForm } from "@/features/auth/login-form";

export const metadata: Metadata = {
  title: "Log in",
};

/** Only allow same-origin path redirects (never protocol-relative URLs). */
function safePath(path: string | undefined): string | null {
  if (path && path.startsWith("/") && !path.startsWith("//")) return path;
  return null;
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const params = await searchParams;
  const next = safePath(params.next);

  if (isSupabaseConfigured()) {
    const supabase = await createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (user) redirect(next ?? "/home");
  }

  return (
    <div className="rounded-card border border-border bg-surface p-6">
      <h1 className="text-xl font-bold tracking-tight">Welcome back</h1>
      <p className="mt-1 text-sm text-muted">
        Log in with your university email.
      </p>
      <LoginForm next={next ?? "/home"} initialError={params.error ?? null} />
      <p className="mt-6 text-center text-sm text-muted">
        New here?{" "}
        <Link
          href="/signup"
          className="font-semibold text-brand hover:underline"
        >
          Create an account
        </Link>
      </p>
    </div>
  );
}
