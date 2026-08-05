"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

const INPUT_CLASS =
  "w-full rounded-lg border border-border bg-background px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted focus:border-brand focus:ring-2 focus:ring-brand/25";

const GRAD_YEARS = [2026, 2027, 2028, 2029, 2030, 2031, 2032];
const BIO_MAX = 280;

export function OnboardingForm({ profile }: { profile: Profile }) {
  const router = useRouter();
  const [major, setMajor] = useState(profile.major ?? "");
  const [gradYear, setGradYear] = useState(
    profile.grad_year ? String(profile.grad_year) : ""
  );
  const [bio, setBio] = useState(profile.bio ?? "");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (pending) return;
    setPending(true);
    setError(null);

    const supabase = createClient();
    const { error: updateError } = await supabase
      .from("profiles")
      .update({
        major: major.trim() || null,
        grad_year: gradYear ? Number(gradYear) : null,
        bio: bio.trim() || null,
      })
      .eq("id", profile.id);

    if (updateError) {
      setPending(false);
      setError("Couldn't save your profile. Please try again.");
      return;
    }

    router.push("/setup");
    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" noValidate>
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-lg bg-danger/10 px-3 py-2.5 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="space-y-1.5">
        <label htmlFor="onboarding-major" className="block text-sm font-medium">
          Major
        </label>
        <input
          id="onboarding-major"
          name="major"
          type="text"
          maxLength={80}
          value={major}
          onChange={(e) => setMajor(e.target.value)}
          placeholder="e.g. Computer Science"
          className={INPUT_CLASS}
        />
      </div>

      <div className="space-y-1.5">
        <label
          htmlFor="onboarding-grad-year"
          className="block text-sm font-medium"
        >
          Graduation year
        </label>
        <select
          id="onboarding-grad-year"
          name="grad_year"
          value={gradYear}
          onChange={(e) => setGradYear(e.target.value)}
          className={INPUT_CLASS}
        >
          <option value="">Select a year</option>
          {GRAD_YEARS.map((year) => (
            <option key={year} value={year}>
              Class of {year}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <div className="flex items-baseline justify-between">
          <label htmlFor="onboarding-bio" className="block text-sm font-medium">
            Bio
          </label>
          <span className="text-xs text-muted" aria-hidden>
            {bio.length}/{BIO_MAX}
          </span>
        </div>
        <textarea
          id="onboarding-bio"
          name="bio"
          rows={3}
          maxLength={BIO_MAX}
          value={bio}
          onChange={(e) => setBio(e.target.value)}
          placeholder="Clubs, hobbies, what you're studying — anything classmates should know."
          className={`${INPUT_CLASS} resize-none`}
        />
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <button
          type="submit"
          disabled={pending}
          className="flex w-full items-center justify-center gap-2 rounded-full bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:cursor-not-allowed disabled:opacity-60"
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {pending ? "Saving…" : "Save and continue"}
          {pending ? null : <ArrowRight className="size-4" aria-hidden />}
        </button>
        <Link
          href="/setup"
          className="rounded-full px-4 py-2 text-center text-sm font-medium text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          Skip for now
        </Link>
      </div>
    </form>
  );
}
