"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  Camera,
  Check,
  Loader2,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_BIO_LENGTH = 280;

const inputBase =
  "w-full rounded-lg border border-border bg-surface px-3 py-2.5 text-sm outline-none transition-colors placeholder:text-muted/70 focus:border-brand focus:ring-2 focus:ring-brand/25 disabled:opacity-60";
const inputCls = cn("mt-1.5", inputBase);
const labelCls = "block text-sm font-medium";
const helpCls = "mt-1 text-xs text-muted";
const primaryBtn =
  "inline-flex items-center justify-center gap-2 rounded-lg bg-brand px-4 py-2.5 text-sm font-semibold text-brand-fg transition-colors hover:bg-brand-strong disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand";

function FieldError({ id, message }: { id: string; message: string }) {
  return (
    <p id={id} role="alert" className="mt-1 flex items-center gap-1 text-xs text-danger">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      {message}
    </p>
  );
}

export function AccountForm({
  profile,
  email,
  universityName,
}: {
  profile: Profile;
  email: string;
  universityName: string;
}) {
  const router = useRouter();
  const uid = useId();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [displayName, setDisplayName] = useState(profile.display_name);
  const [handle, setHandle] = useState(profile.handle);
  const [major, setMajor] = useState(profile.major ?? "");
  const [gradYear, setGradYear] = useState(
    profile.grad_year ? String(profile.grad_year) : ""
  );
  const [bio, setBio] = useState(profile.bio ?? "");
  const [isPublic, setIsPublic] = useState(profile.is_public);
  const [avatarUrl, setAvatarUrl] = useState(profile.avatar_url);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [errors, setErrors] = useState<{
    displayName?: string;
    handle?: string;
    gradYear?: string;
    avatar?: string;
    form?: string;
  }>({});

  async function handleAvatarChange(
    event: React.ChangeEvent<HTMLInputElement>
  ) {
    const file = event.target.files?.[0];
    event.target.value = ""; // allow picking the same file again
    if (!file) return;
    if (!file.type.startsWith("image/")) {
      setErrors((e) => ({ ...e, avatar: "Choose an image file (JPG or PNG)." }));
      return;
    }
    if (file.size > MAX_AVATAR_BYTES) {
      setErrors((e) => ({ ...e, avatar: "Photos need to be under 5 MB." }));
      return;
    }
    setErrors((e) => ({ ...e, avatar: undefined }));
    setUploading(true);
    try {
      const supabase = createClient();
      const path = `${profile.id}/avatar-${Date.now()}.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, file, { contentType: file.type, cacheControl: "3600" });
      if (uploadError) {
        setErrors((e) => ({
          ...e,
          avatar: "Couldn't upload that photo. Please try again.",
        }));
        return;
      }
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const { error: profileError } = await supabase
        .from("profiles")
        .update({ avatar_url: data.publicUrl })
        .eq("id", profile.id);
      if (profileError) {
        setErrors((e) => ({
          ...e,
          avatar: "Uploaded, but couldn't save it to your profile. Try again.",
        }));
        return;
      }
      setAvatarUrl(data.publicUrl);
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next: typeof errors = {};

    const name = displayName.trim();
    if (!name) next.displayName = "Add a display name.";

    const h = handle.trim().toLowerCase();
    if (!HANDLE_RE.test(h)) {
      next.handle =
        "Handles are 3–24 characters: lowercase letters, numbers and underscores.";
    }

    let year: number | null = null;
    if (gradYear.trim()) {
      year = Number(gradYear.trim());
      if (!Number.isInteger(year) || year < 1950 || year > 2100) {
        next.gradYear = "Enter a 4-digit year, like 2027.";
      }
    }

    if (Object.values(next).some(Boolean)) {
      setErrors(next);
      return;
    }

    setErrors({});
    setSaving(true);
    setSaved(false);
    try {
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        .update({
          display_name: name,
          handle: h,
          major: major.trim() || null,
          grad_year: year,
          bio: bio.trim() || null,
          is_public: isPublic,
        })
        .eq("id", profile.id);
      if (error) {
        if (error.code === "23505") {
          setErrors({ handle: "That handle is already taken — try another." });
        } else if (error.code === "23514") {
          setErrors({
            handle:
              "Handles are 3–24 characters: lowercase letters, numbers and underscores.",
          });
        } else {
          setErrors({ form: "Couldn't save your changes. Please try again." });
        }
        return;
      }
      setHandle(h);
      setSaved(true);
      router.refresh();
      window.setTimeout(() => setSaved(false), 2500);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="space-y-6">
      {/* Photo */}
      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">Profile photo</h2>
        <div className="mt-3 flex items-center gap-4">
          <Avatar name={displayName || profile.display_name} src={avatarUrl} size="xl" />
          <div>
            <input
              ref={fileInputRef}
              id={`${uid}-avatar`}
              type="file"
              accept="image/*"
              className="sr-only"
              onChange={handleAvatarChange}
              disabled={uploading}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
              className="inline-flex items-center justify-center gap-2 rounded-lg border border-border bg-surface px-4 py-2.5 text-sm font-semibold transition-colors hover:bg-surface-2 disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Camera className="size-4" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Change photo"}
            </button>
            <p className={helpCls}>JPG or PNG, up to 5 MB.</p>
            {errors.avatar ? (
              <FieldError id={`${uid}-avatar-error`} message={errors.avatar} />
            ) : null}
          </div>
        </div>
      </section>

      {/* Identity */}
      <section className="rounded-card border border-border bg-surface p-5">
        <h2 className="text-sm font-semibold">About you</h2>
        <div className="mt-3 grid gap-4 sm:grid-cols-2">
          <div>
            <label htmlFor={`${uid}-name`} className={labelCls}>
              Display name
            </label>
            <input
              id={`${uid}-name`}
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              maxLength={60}
              required
              autoComplete="name"
              aria-invalid={errors.displayName ? true : undefined}
              aria-describedby={
                errors.displayName ? `${uid}-name-error` : undefined
              }
              className={inputCls}
            />
            {errors.displayName ? (
              <FieldError id={`${uid}-name-error`} message={errors.displayName} />
            ) : null}
          </div>
          <div>
            <label htmlFor={`${uid}-handle`} className={labelCls}>
              Handle
            </label>
            <div className="relative mt-1.5">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-sm text-muted"
              >
                @
              </span>
              <input
                id={`${uid}-handle`}
                type="text"
                value={handle}
                onChange={(e) =>
                  setHandle(e.target.value.toLowerCase().replace(/\s/g, ""))
                }
                maxLength={24}
                required
                autoComplete="username"
                autoCapitalize="none"
                spellCheck={false}
                aria-invalid={errors.handle ? true : undefined}
                aria-describedby={
                  errors.handle ? `${uid}-handle-error` : `${uid}-handle-help`
                }
                className={cn(inputBase, "pl-8")}
              />
            </div>
            {errors.handle ? (
              <FieldError id={`${uid}-handle-error`} message={errors.handle} />
            ) : (
              <p id={`${uid}-handle-help`} className={helpCls}>
                3–24 characters: lowercase letters, numbers, underscores.
              </p>
            )}
          </div>
          <div>
            <label htmlFor={`${uid}-major`} className={labelCls}>
              Major <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={`${uid}-major`}
              type="text"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              maxLength={80}
              placeholder="e.g. Computer Science"
              className={inputCls}
            />
          </div>
          <div>
            <label htmlFor={`${uid}-year`} className={labelCls}>
              Graduation year{" "}
              <span className="font-normal text-muted">(optional)</span>
            </label>
            <input
              id={`${uid}-year`}
              type="number"
              inputMode="numeric"
              min={1950}
              max={2100}
              value={gradYear}
              onChange={(e) => setGradYear(e.target.value)}
              placeholder="2027"
              aria-invalid={errors.gradYear ? true : undefined}
              aria-describedby={
                errors.gradYear ? `${uid}-year-error` : undefined
              }
              className={inputCls}
            />
            {errors.gradYear ? (
              <FieldError id={`${uid}-year-error`} message={errors.gradYear} />
            ) : null}
          </div>
          <div className="sm:col-span-2">
            <label htmlFor={`${uid}-bio`} className={labelCls}>
              Bio <span className="font-normal text-muted">(optional)</span>
            </label>
            <textarea
              id={`${uid}-bio`}
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO_LENGTH))}
              rows={3}
              maxLength={MAX_BIO_LENGTH}
              placeholder="A line or two about you — clubs, interests, what you're studying."
              aria-describedby={`${uid}-bio-count`}
              className={cn(inputCls, "resize-y")}
            />
            <p id={`${uid}-bio-count`} className={helpCls} aria-live="polite">
              {bio.length}/{MAX_BIO_LENGTH}
            </p>
          </div>
        </div>
        <p className="mt-4 border-t border-border pt-3 text-xs text-muted">
          Signed in as {email} · {universityName}. Your school email can&apos;t
          be changed.
        </p>
      </section>

      {/* Visibility */}
      <section className="rounded-card border border-border bg-surface p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h2 id={`${uid}-public-label`} className="text-sm font-semibold">
              Public profile
            </h2>
            <p id={`${uid}-public-help`} className="mt-1 text-xs text-muted">
              Appear in the people directory and let classmates at{" "}
              {universityName} view your profile.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={isPublic}
            aria-labelledby={`${uid}-public-label`}
            aria-describedby={`${uid}-public-help`}
            onClick={() => setIsPublic((v) => !v)}
            className={cn(
              "relative h-7 w-12 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              isPublic ? "bg-brand" : "bg-surface-3"
            )}
          >
            <span
              aria-hidden
              className={cn(
                "absolute top-1 size-5 rounded-full bg-white shadow transition-[left]",
                isPublic ? "left-6" : "left-1"
              )}
            />
          </button>
        </div>
      </section>

      {errors.form ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-lg border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {errors.form}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <button type="submit" disabled={saving} className={primaryBtn}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {saving ? "Saving…" : "Save changes"}
        </button>
        <span aria-live="polite">
          {saved ? (
            <span className="inline-flex items-center gap-1 text-sm font-medium text-success">
              <Check className="size-4" aria-hidden />
              Saved
            </span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
