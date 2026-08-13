"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { AlertCircle, ArrowRight, Loader2 } from "lucide-react";
import {
  Button,
  buttonClasses,
  Input,
  Label,
  Select,
  Textarea,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type { Profile } from "@/lib/types";

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
        // Signup told them creating an account is agreeing to the terms;
        // this records when that agreement was made.
        accepted_terms_at: new Date().toISOString(),
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
    <form
      onSubmit={handleSubmit}
      aria-label="About you"
      className="flex flex-col gap-5"
      noValidate
    >
      {error ? (
        <p
          role="alert"
          className="flex items-start gap-2 rounded-xl bg-danger/10 px-3.5 py-2.5 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {error}
        </p>
      ) : null}

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboarding-major">Major</Label>
        <Input
          id="onboarding-major"
          name="major"
          type="text"
          maxLength={80}
          value={major}
          onChange={(e) => setMajor(e.target.value)}
          placeholder="e.g. Computer Science"
        />
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="onboarding-grad-year">Graduation year</Label>
        <Select
          id="onboarding-grad-year"
          name="grad_year"
          value={gradYear}
          onChange={(e) => setGradYear(e.target.value)}
        >
          <option value="">Select a year</option>
          {GRAD_YEARS.map((year) => (
            <option key={year} value={year}>
              Class of {year}
            </option>
          ))}
        </Select>
      </div>

      <div className="flex flex-col gap-1.5">
        <div className="flex items-baseline justify-between">
          <Label htmlFor="onboarding-bio">Bio</Label>
          <span
            id="onboarding-bio-count"
            aria-live="polite"
            className="text-xs text-muted"
          >
            {bio.length}/{BIO_MAX}
          </span>
        </div>
        <Textarea
          id="onboarding-bio"
          name="bio"
          rows={3}
          maxLength={BIO_MAX}
          value={bio}
          aria-describedby="onboarding-bio-count"
          onChange={(e) => setBio(e.target.value)}
          placeholder="Clubs, hobbies, what you're studying: anything classmates should know."
          className="resize-none"
        />
      </div>

      <div className="flex flex-col gap-2 pt-1">
        <Button type="submit" size="lg" className="w-full" disabled={pending}>
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {pending ? "Saving…" : "Save and continue"}
          {pending ? null : <ArrowRight className="size-4" aria-hidden />}
        </Button>
        <Link
          href="/setup"
          className={buttonClasses({ variant: "ghost", className: "w-full" })}
        >
          Skip for now
        </Link>
      </div>
    </form>
  );
}
