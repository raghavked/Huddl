"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle,
  CheckCircle2,
  Eye,
  EyeOff,
  Loader2,
} from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { University } from "@/lib/types";

const INPUT_CLASS =
  "w-full rounded-2xl border border-border bg-background px-4 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/25";

export function SignupForm() {
  const router = useRouter();
  const [displayName, setDisplayName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  // null = still loading (or fetch failed) — in that case we don't gate on the
  // client and let the DB trigger be the backstop.
  const [universities, setUniversities] = useState<University[] | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDomainError, setIsDomainError] = useState(false);
  const [accountExists, setAccountExists] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const supabase = createClient();
    supabase
      .from("universities")
      .select("*")
      .order("name")
      .then(({ data, error: fetchError }) => {
        if (cancelled || fetchError || !data) return;
        setUniversities(data as University[]);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const domain = useMemo(() => {
    const at = email.lastIndexOf("@");
    if (at === -1) return null;
    const d = email.slice(at + 1).trim().toLowerCase();
    return d.includes(".") && !d.endsWith(".") ? d : null;
  }, [email]);

  const matched = useMemo(() => {
    if (!domain || !universities) return null;
    return (
      universities.find((u) => u.email_domain.toLowerCase() === domain) ?? null
    );
  }, [domain, universities]);

  const unsupportedDomain = Boolean(
    domain && universities && universities.length > 0 && !matched
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setError(null);
    setIsDomainError(false);
    setAccountExists(false);

    if (unsupportedDomain && domain) {
      setIsDomainError(true);
      setError(
        `Huddl isn't at ${domain} yet — sign up with an email from a supported school.`
      );
      return;
    }

    setPending(true);
    const supabase = createClient();
    const { data, error: signUpError } = await supabase.auth.signUp({
      email: email.trim(),
      password,
      options: {
        emailRedirectTo: `${location.origin}/auth/confirm`,
        data: { display_name: displayName.trim() },
      },
    });

    if (signUpError) {
      setPending(false);
      if (/database error saving new user/i.test(signUpError.message)) {
        // The DB trigger rejects unknown email domains with this generic error.
        setIsDomainError(true);
        setError(
          domain
            ? `Huddl isn't at ${domain} yet. We're adding new schools all the time — check back soon.`
            : "Huddl isn't at your school yet. We're adding new schools all the time — check back soon."
        );
      } else if (/already registered/i.test(signUpError.message)) {
        setAccountExists(true);
      } else {
        setError(signUpError.message);
      }
      return;
    }

    // With email confirmation on, signing up an existing confirmed address
    // returns an obfuscated user with no identities instead of an error.
    if (data.user && data.user.identities && data.user.identities.length === 0) {
      setPending(false);
      setAccountExists(true);
      return;
    }

    router.push(`/verify?email=${encodeURIComponent(email.trim())}`);
  }

  return (
    <form onSubmit={handleSubmit} className="mt-5 space-y-4" noValidate>
      {error ? (
        <div
          role="alert"
          className="space-y-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          <p className="flex items-start gap-2">
            <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
            {error}
          </p>
          {isDomainError && universities && universities.length > 0 ? (
            <div className="pl-6 text-foreground">
              <p className="font-medium">Huddl is currently at:</p>
              <ul className="mt-1 space-y-0.5 text-muted">
                {universities.map((u) => (
                  <li key={u.id}>
                    {u.name}{" "}
                    <span className="text-xs">(@{u.email_domain})</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}

      {accountExists ? (
        <p
          role="alert"
          className="rounded-lg bg-accent-soft px-3 py-2.5 text-sm text-accent"
        >
          Looks like you already have an account with that email.{" "}
          <Link
            href="/login"
            className="font-semibold underline underline-offset-2"
          >
            Log in instead
          </Link>
          .
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="signup-name" className="block text-sm font-medium">
          Display name
        </label>
        <input
          id="signup-name"
          name="name"
          type="text"
          autoComplete="name"
          required
          maxLength={60}
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Ada Lovelace"
          className={INPUT_CLASS}
        />
        <p className="text-xs text-muted">
          How classmates will see you around campus.
        </p>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-email" className="block text-sm font-medium">
          University email
        </label>
        <input
          id="signup-email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@school.edu"
          aria-describedby="signup-email-hint"
          aria-invalid={unsupportedDomain || undefined}
          className={INPUT_CLASS}
        />
        <div id="signup-email-hint" aria-live="polite" className="min-h-5">
          {matched ? (
            <p className="flex items-center gap-1.5 text-sm text-success">
              <CheckCircle2 className="size-4 shrink-0" aria-hidden />
              You&apos;ll join {matched.name} ({matched.short_name})
            </p>
          ) : unsupportedDomain ? (
            <p className="flex items-start gap-1.5 text-sm text-danger">
              <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
              <span>
                Huddl isn&apos;t at <strong>{domain}</strong> yet.
              </span>
            </p>
          ) : (
            <p className="text-xs text-muted">
              Use your .edu address — we match it to your school.
            </p>
          )}
        </div>
      </div>

      <div className="space-y-1.5">
        <label htmlFor="signup-password" className="block text-sm font-medium">
          Password
        </label>
        <div className="relative">
          <input
            id="signup-password"
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            required
            minLength={8}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            placeholder="At least 8 characters"
            aria-describedby="signup-password-hint"
            className={`${INPUT_CLASS} pr-10`}
          />
          <button
            type="button"
            onClick={() => setShowPassword((v) => !v)}
            aria-label={showPassword ? "Hide password" : "Show password"}
            className="absolute inset-y-0 right-0 flex items-center px-3 text-muted transition-colors hover:text-foreground"
          >
            {showPassword ? (
              <EyeOff className="size-4" aria-hidden />
            ) : (
              <Eye className="size-4" aria-hidden />
            )}
          </button>
        </div>
        <p id="signup-password-hint" className="text-xs text-muted">
          At least 8 characters.
        </p>
      </div>

      <button
        type="submit"
        disabled={
          pending ||
          !displayName.trim() ||
          !email.trim() ||
          password.length < 8 ||
          unsupportedDomain
        }
        className="flex w-full items-center justify-center gap-2 rounded-full bg-brand-gradient px-4 py-3 text-sm font-bold text-white shadow-glow transition-transform hover:scale-[1.02] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60 disabled:hover:scale-100"
      >
        {pending ? <Loader2 className="size-4 animate-spin" aria-hidden /> : null}
        {pending ? "Creating your account…" : "Create account"}
      </button>

      <p className="text-center text-xs text-muted">
        We&apos;ll email you a confirmation link to verify your student status.
      </p>
    </form>
  );
}
