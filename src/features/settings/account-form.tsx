"use client";

import { useId, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Camera, Check, Loader2, Trash2 } from "lucide-react";
import { Avatar } from "@/components/avatar";
import {
  Button,
  Card,
  FieldError,
  Hint,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { clearAvatarFolder } from "@/lib/avatar-storage";
import { IMAGE_ACCEPT_ATTR, isAcceptedImageType } from "@/lib/image-types";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import type { Profile } from "@/lib/types";

const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
/**
 * A profile photo has to clear two bars: a type from `lib/image-types` and
 * this size. Both are enforced again on the bucket by migration 0044. See
 * that file for why the type list names formats instead of saying "image/*",
 * and why it matters more here than anywhere else (avatars is the one public
 * bucket).
 */
const MAX_AVATAR_BYTES = 5 * 1024 * 1024;
const MAX_BIO_LENGTH = 280;

function ErrorLine({ id, message }: { id: string; message: string }) {
  return (
    <FieldError id={id} className="flex items-center gap-1">
      <AlertCircle className="size-3.5 shrink-0" aria-hidden />
      {message}
    </FieldError>
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
  const [removing, setRemoving] = useState(false);
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
    if (!isAcceptedImageType(file.type)) {
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
      // Sweep the folder now that the profile points at the new key. Every
      // upload here writes a fresh timestamped name, so without this the
      // previous photo (and the one before that) stay live at their own
      // public URLs forever. Last, and deliberately not fatal: the student's
      // new picture is already set, and a sweep that failed is retried by the
      // next change or by Remove.
      void clearAvatarFolder(supabase, profile.id, path).catch(
        () => undefined
      );
      router.refresh();
    } finally {
      setUploading(false);
    }
  }

  /**
   * Take the photo down: the file, then the link to it, in that order.
   *
   * There was no way to do this on the web at all. The only way to stop
   * showing a photo was to upload a different one, which left the first still
   * sitting at a public URL. The Privacy Policy says removing a photo deletes
   * the file rather than just the link; this is the browser half of making
   * that true.
   */
  async function handleRemovePhoto() {
    if (removing || uploading) return;
    setErrors((e) => ({ ...e, avatar: undefined }));
    setRemoving(true);
    try {
      const supabase = createClient();
      try {
        await clearAvatarFolder(supabase, profile.id);
      } catch {
        setErrors((e) => ({
          ...e,
          avatar: "Couldn't remove your photo. Please try again.",
        }));
        return;
      }
      const { error } = await supabase
        .from("profiles")
        .update({ avatar_url: null })
        .eq("id", profile.id);
      if (error) {
        // The file is gone; the profile is the half still pointing at it.
        setErrors((e) => ({
          ...e,
          avatar:
            "Your photo is deleted, but your profile still points at it. Give Remove another tap.",
        }));
        return;
      }
      setAvatarUrl(null);
      router.refresh();
    } finally {
      setRemoving(false);
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
          setErrors({ handle: "That handle is already taken. Try another." });
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
    <form
      onSubmit={handleSubmit}
      aria-label="Account settings"
      noValidate
      className="space-y-6"
    >
      {/* Photo */}
      <Card className="animate-fade-up">
        <h2 className="text-sm font-semibold">Profile photo</h2>
        <div className="mt-4 flex items-center gap-4">
          <Avatar
            name={displayName || profile.display_name}
            src={avatarUrl}
            size="xl"
          />
          <div className="flex flex-col items-start gap-1.5">
            <input
              ref={fileInputRef}
              id={`${uid}-avatar`}
              type="file"
              accept={IMAGE_ACCEPT_ATTR}
              aria-label="Choose a profile photo"
              className="sr-only"
              onChange={handleAvatarChange}
              disabled={uploading}
            />
            <Button
              variant="secondary"
              onClick={() => fileInputRef.current?.click()}
              disabled={uploading}
            >
              {uploading ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <Camera className="size-4" aria-hidden />
              )}
              {uploading ? "Uploading…" : "Change photo"}
            </Button>
            {avatarUrl ? (
              <Button
                variant="ghost"
                onClick={handleRemovePhoto}
                disabled={uploading || removing}
              >
                {removing ? (
                  <Loader2 className="size-4 animate-spin" aria-hidden />
                ) : (
                  <Trash2 className="size-4" aria-hidden />
                )}
                {removing ? "Removing…" : "Remove photo"}
              </Button>
            ) : null}
            <Hint>JPG or PNG, up to 5 MB.</Hint>
            {errors.avatar ? (
              <ErrorLine id={`${uid}-avatar-error`} message={errors.avatar} />
            ) : null}
          </div>
        </div>
      </Card>

      {/* Identity */}
      <Card>
        <h2 className="text-sm font-semibold">About you</h2>
        <div className="mt-4 grid gap-5 sm:grid-cols-2">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-name`}>Display name</Label>
            <Input
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
            />
            {errors.displayName ? (
              <ErrorLine id={`${uid}-name-error`} message={errors.displayName} />
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-handle`}>Handle</Label>
            <div className="relative">
              <span
                aria-hidden
                className="pointer-events-none absolute inset-y-0 left-3.5 flex items-center text-sm text-muted"
              >
                @
              </span>
              <Input
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
                className="pl-8"
              />
            </div>
            {errors.handle ? (
              <ErrorLine id={`${uid}-handle-error`} message={errors.handle} />
            ) : (
              <Hint id={`${uid}-handle-help`}>
                3–24 characters: lowercase letters, numbers, underscores.
              </Hint>
            )}
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-major`}>
              Major <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Input
              id={`${uid}-major`}
              type="text"
              value={major}
              onChange={(e) => setMajor(e.target.value)}
              maxLength={80}
              placeholder="e.g. Computer Science"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor={`${uid}-year`}>
              Graduation year{" "}
              <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Input
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
            />
            {errors.gradYear ? (
              <ErrorLine id={`${uid}-year-error`} message={errors.gradYear} />
            ) : null}
          </div>
          <div className="flex flex-col gap-1.5 sm:col-span-2">
            <Label htmlFor={`${uid}-bio`}>
              Bio <span className="font-normal text-muted">(optional)</span>
            </Label>
            <Textarea
              id={`${uid}-bio`}
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, MAX_BIO_LENGTH))}
              rows={3}
              maxLength={MAX_BIO_LENGTH}
              placeholder="A line or two about you: clubs, interests, what you're studying."
              aria-describedby={`${uid}-bio-count`}
            />
            <Hint id={`${uid}-bio-count`} aria-live="polite">
              {bio.length}/{MAX_BIO_LENGTH}
            </Hint>
          </div>
        </div>
        <p className="mt-5 border-t border-border pt-4 text-xs text-muted">
          Signed in as {email} · {universityName}. Your school email can&apos;t
          be changed.
        </p>
      </Card>

      {/* Visibility */}
      <Card>
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
                "absolute top-1 size-5 rounded-full bg-on-solid shadow-soft transition-[left]",
                isPublic ? "left-6" : "left-1"
              )}
            />
          </button>
        </div>
      </Card>

      {errors.form ? (
        <div
          role="alert"
          className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger"
        >
          <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
          {errors.form}
        </div>
      ) : null}

      <div className="flex items-center gap-3">
        <Button type="submit" disabled={saving}>
          {saving ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : null}
          {saving ? "Saving…" : "Save changes"}
        </Button>
        <span aria-live="polite">
          {saved ? (
            <span className="inline-flex items-center gap-1 text-sm font-semibold text-success">
              <Check className="size-4" aria-hidden />
              Saved
            </span>
          ) : null}
        </span>
      </div>
    </form>
  );
}
