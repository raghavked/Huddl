import Feather from "@expo/vector-icons/Feather";
import * as ImagePicker from "expo-image-picker";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { AppText, Button, Card, Chip, Field } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Same rules as the web account form — one brand, one validation story. */
const HANDLE_RE = /^[a-z0-9_]{3,24}$/;
const MAX_BIO_LENGTH = 280;

/* Interests: 0034's normalize trigger trims, lowercases, dedupes and keeps
   the first eight, dropping anything outside 2–28 characters. We hold the
   same line up front so a word never disappears on the way to the server —
   but we still send exactly what the student typed and settle on their
   spelling until the next load. */
const MAX_INTERESTS = 8;
const MIN_INTEREST_LENGTH = 2;
const MAX_INTEREST_LENGTH = 28;
const MAX_LOOKING_FOR_LENGTH = 140;

/** A campus-flavoured starting vocabulary — tap one, or type your own. */
const INTEREST_SUGGESTIONS = [
  "study spots",
  "live music",
  "intramurals",
  "cooking",
  "hiking",
  "gaming",
  "film",
  "volunteering",
] as const;

type AccountRow = {
  display_name: string;
  handle: string;
  major: string | null;
  grad_year: number | null;
  bio: string | null;
  avatar_url: string | null;
  is_public: boolean;
  interests: string[] | null;
  looking_for: string | null;
  university: { short_name: string } | null;
};

/** How two interests are compared before the trigger has seen either. */
function interestKey(interest: string): string {
  return interest.trim().toLowerCase();
}

function hasInterest(list: readonly string[], interest: string): boolean {
  const key = interestKey(interest);
  return list.some((existing) => interestKey(existing) === key);
}

type FieldErrors = {
  displayName?: string;
  handle?: string;
  gradYear?: string;
  form?: string;
};

/**
 * A field's error, said as part of the field rather than only drawn in red
 * beside it. `Field` puts its own `label` on the input and lets a passed
 * `accessibilityLabel` win, so this is where the two get spoken together.
 */
function fieldLabel(label: string, error?: string | null): string {
  return error ? `${label}. ${error}` : label;
}

export default function AccountScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const email = session?.user.email ?? null;

  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [missing, setMissing] = useState(false);
  const [universityName, setUniversityName] = useState<string | null>(null);

  const [displayName, setDisplayName] = useState("");
  const [handle, setHandle] = useState("");
  const [major, setMajor] = useState("");
  const [gradYear, setGradYear] = useState("");
  const [bio, setBio] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);

  const [interests, setInterests] = useState<string[]>([]);
  const [interestDraft, setInterestDraft] = useState("");
  const [interestHint, setInterestHint] = useState<string | null>(null);
  const [lookingFor, setLookingFor] = useState("");

  // The photo flow gets its own quiet corner of state.
  const [photoBusy, setPhotoBusy] = useState<"upload" | "remove" | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});

  const savedTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(
    () => () => {
      if (savedTimer.current) clearTimeout(savedTimer.current);
    },
    []
  );

  const load = useCallback(async () => {
    if (!userId) {
      setLoading(false);
      return;
    }
    setLoading(true);
    setLoadError(null);
    setMissing(false);
    const { data, error } = await supabase
      .from("profiles")
      .select(
        "display_name, handle, major, grad_year, bio, avatar_url, is_public, interests, looking_for, university:universities(short_name)"
      )
      .eq("id", userId)
      .maybeSingle();
    setLoading(false);
    if (error) {
      setLoadError("We couldn't load your profile right now.");
      return;
    }
    const row = data as unknown as AccountRow | null;
    if (!row) {
      setMissing(true);
      return;
    }
    setDisplayName(row.display_name);
    setHandle(row.handle);
    setMajor(row.major ?? "");
    setGradYear(row.grad_year ? String(row.grad_year) : "");
    setBio(row.bio ?? "");
    setIsPublic(row.is_public);
    setAvatarUrl(row.avatar_url);
    // text[] comes back as an array, but a null column and a stray non-string
    // both cost nothing to guard against.
    setInterests(
      Array.isArray(row.interests)
        ? row.interests.filter(
            (entry): entry is string =>
              typeof entry === "string" && entry.trim().length > 0
          )
        : []
    );
    setInterestDraft("");
    setInterestHint(null);
    setLookingFor(row.looking_for ?? "");
    setUniversityName(row.university?.short_name ?? null);
  }, [userId]);

  /** Pick a square photo, push it to the public avatars bucket, save the URL. */
  const handleChangePhoto = useCallback(async () => {
    if (!userId || photoBusy) return;
    setPhotoError(null);
    let asset: ImagePicker.ImagePickerAsset | null = null;
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: "images",
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });
      if (result.canceled) return;
      asset = result.assets[0] ?? null;
    } catch {
      setPhotoError("Couldn't open your photos. Give it another try.");
      return;
    }
    if (!asset) return;
    setPhotoBusy("upload");
    try {
      const buffer = await (await fetch(asset.uri)).arrayBuffer();
      const path = `${userId}/avatar.jpg`;
      const { error: uploadError } = await supabase.storage
        .from("avatars")
        .upload(path, buffer, { contentType: "image/jpeg", upsert: true });
      if (uploadError) throw uploadError;
      // Same path every time — the ?v= stamp is what busts stale caches.
      const { data } = supabase.storage.from("avatars").getPublicUrl(path);
      const url = `${data.publicUrl}?v=${Date.now()}`;
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ avatar_url: url })
        .eq("id", userId);
      if (updateError) throw updateError;
      setAvatarUrl(url);
    } catch {
      setPhotoError("Couldn't update your photo. Give it another try.");
    } finally {
      setPhotoBusy(null);
    }
  }, [userId, photoBusy]);

  /**
   * Back to initials — the file goes, not just the link to it.
   *
   * The avatars bucket is public-read (migration 0008), so clearing
   * `avatar_url` alone would take the photo off the profile and leave the
   * file sitting at a URL anyone who saved it can still open, with no login.
   * The object has to go first; only then is "Remove photo" true.
   *
   * Deleting an object that isn't there is not an error, so a second tap
   * after a half-failure just finishes the job.
   */
  const handleRemovePhoto = useCallback(async () => {
    if (!userId || photoBusy) return;
    setPhotoError(null);
    setPhotoBusy("remove");

    const { error: fileError } = await supabase.storage
      .from("avatars")
      .remove([`${userId}/avatar.jpg`]);
    if (fileError) {
      setPhotoBusy(null);
      setPhotoError("Couldn't remove your photo. Give it another try.");
      return;
    }

    const { error } = await supabase
      .from("profiles")
      .update({ avatar_url: null })
      .eq("id", userId);
    setPhotoBusy(null);
    if (error) {
      // The file is gone; the profile is the half still pointing at it.
      setPhotoError(
        "Your photo file is deleted, but your profile still points at it. Give Remove another tap."
      );
      return;
    }
    setAvatarUrl(null);
  }, [userId, photoBusy]);

  useEffect(() => {
    void load();
  }, [load]);

  /* --------------------------- interest chips --------------------------- */

  /** Put a word on. Shared by the add-field and the suggestion chips. */
  const addInterest = useCallback(
    (raw: string) => {
      const typed = raw.trim();
      if (typed.length === 0) return false;
      if (typed.length < MIN_INTEREST_LENGTH) {
        setInterestHint(
          `Interests need at least ${MIN_INTEREST_LENGTH} characters.`
        );
        return false;
      }
      if (hasInterest(interests, typed)) {
        setInterestHint(`"${typed}" is already on there.`);
        return false;
      }
      if (interests.length >= MAX_INTERESTS) {
        setInterestHint(
          `That's ${MAX_INTERESTS} — take one off to add another.`
        );
        return false;
      }
      setInterests([...interests, typed]);
      setInterestHint(null);
      return true;
    },
    [interests]
  );

  const commitInterestDraft = useCallback(() => {
    if (addInterest(interestDraft)) setInterestDraft("");
  }, [addInterest, interestDraft]);

  const removeInterest = useCallback((interest: string) => {
    setInterestHint(null);
    setInterests((current) =>
      current.filter((existing) => interestKey(existing) !== interestKey(interest))
    );
  }, []);

  const openSuggestions = INTEREST_SUGGESTIONS.filter(
    (suggestion) => !hasInterest(interests, suggestion)
  );

  /* What this switch actually does, said once and used twice — the visible
     caption and the label the switch speaks are the same sentence.

     It is NOT "appear in the people directory". The profiles SELECT policy
     is campus-scoped and says nothing about `is_public` (0012), so a private
     student is still listed; every surface that draws a person redacts them
     down to a handle instead. Saying otherwise told students they'd
     disappeared when they hadn't. */
  const publicProfileCaption = `Classmates${
    universityName ? ` at ${universityName}` : ""
  } see your name, major, year, bio and interests. Turn it off and they see only your handle and your photo — either way you stay listed in the people directory.`;

  /** Mirrors the web account form's save: same validation, same update set. */
  const handleSave = useCallback(async () => {
    if (!userId || saving) return;
    const next: FieldErrors = {};

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

    /* A word still sitting in the add-field is one they meant to keep, so it
       goes in with the rest rather than vanishing on save. */
    const pending = interestDraft.trim();
    const nextInterests =
      pending.length >= MIN_INTEREST_LENGTH &&
      !hasInterest(interests, pending) &&
      interests.length < MAX_INTERESTS
        ? [...interests, pending]
        : interests;

    setErrors({});
    setSaving(true);
    setSaved(false);
    const { error } = await supabase
      .from("profiles")
      .update({
        display_name: name,
        handle: h,
        major: major.trim() || null,
        grad_year: year,
        bio: bio.trim() || null,
        is_public: isPublic,
        // 0034's trigger trims, lowercases and dedupes — send what they typed.
        interests: nextInterests,
        looking_for: lookingFor.trim() || null,
      })
      .eq("id", userId);
    setSaving(false);
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
    if (nextInterests !== interests) {
      setInterests(nextInterests);
      setInterestDraft("");
      setInterestHint(null);
    }
    setSaved(true);
    if (savedTimer.current) clearTimeout(savedTimer.current);
    savedTimer.current = setTimeout(() => setSaved(false), 2500);
  }, [
    userId,
    saving,
    displayName,
    handle,
    gradYear,
    major,
    bio,
    isPublic,
    interests,
    interestDraft,
    lookingFor,
  ]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View style={{ paddingHorizontal: space.gutter }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back"
          onPress={() => router.back()}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 44,
            height: 44,
            marginLeft: -10,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            name="chevron-left"
            size={26}
            color={theme.foreground}
          />
        </Pressable>

        <AppText
          variant="display"
          accessibilityRole="header"
          style={{ marginTop: space.hair, marginBottom: space.card }}
        >
          Account
        </AppText>
      </View>

      {loading ? (
        <View style={{ paddingHorizontal: space.gutter }}>
          <Card style={{ alignItems: "center", paddingVertical: space.rest }}>
            <ActivityIndicator
              accessibilityLabel="Loading your profile"
              color={theme.brand}
            />
          </Card>
        </View>
      ) : loadError ? (
        <View style={{ paddingHorizontal: space.gutter }}>
          <Card
            accessibilityLiveRegion="polite"
            style={{ alignItems: "center", gap: space.room, paddingVertical: space.chapter }}
          >
            <AppText variant="bodySemi" accessibilityRole="header">
              Something went sideways
            </AppText>
            <AppText variant="caption" muted style={{ textAlign: "center" }}>
              {loadError}
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => void load()}
            />
          </Card>
        </View>
      ) : missing ? (
        <View style={{ paddingHorizontal: space.gutter }}>
          <Card style={{ alignItems: "center", gap: space.snug, paddingVertical: space.chapter }}>
            <AppText variant="bodySemi" accessibilityRole="header">
              We couldn't find your profile
            </AppText>
            <AppText variant="caption" muted style={{ textAlign: "center" }}>
              Try signing out and back in — that usually clears it up.
            </AppText>
          </Card>
        </View>
      ) : (
        <KeyboardAvoidingView
          style={{ flex: 1 }}
          behavior={Platform.OS === "ios" ? "padding" : undefined}
        >
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingHorizontal: space.gutter,
              paddingBottom: insets.bottom + space.rest,
              gap: space.card,
            }}
            keyboardDismissMode="on-drag"
            keyboardShouldPersistTaps="handled"
          >
            <Card style={{ gap: space.close }}>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.card,
                }}
              >
                <Avatar
                  url={avatarUrl}
                  name={displayName || "You"}
                  size={56}
                />
                <View style={{ flex: 1, gap: space.tight }}>
                  <AppText variant="title" accessibilityRole="header">
                    Your photo
                  </AppText>
                  <AppText variant="caption" muted>
                    {avatarUrl
                      ? "Classmates see this next to your name."
                      : "Right now classmates see your initials."}
                  </AppText>
                </View>
              </View>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.cosy,
                  flexWrap: "wrap",
                }}
              >
                <Button
                  label={photoBusy === "upload" ? "Uploading…" : "Change photo"}
                  variant="secondary"
                  size="sm"
                  pending={photoBusy === "upload"}
                  disabled={photoBusy !== null}
                  accessibilityState={{
                    disabled: photoBusy !== null,
                    busy: photoBusy === "upload",
                  }}
                  icon={
                    <Feather name="camera" size={14} color={theme.foreground} />
                  }
                  onPress={() => void handleChangePhoto()}
                />
                {avatarUrl ? (
                  <Button
                    label={photoBusy === "remove" ? "Removing…" : "Remove photo"}
                    variant="ghost"
                    size="sm"
                    pending={photoBusy === "remove"}
                    disabled={photoBusy !== null}
                    accessibilityState={{
                      disabled: photoBusy !== null,
                      busy: photoBusy === "remove",
                    }}
                    onPress={() => void handleRemovePhoto()}
                  />
                ) : null}
              </View>
              {/* Said here, at the moment she chooses one, because it is the
                  one thing on Huddl that leaves the campus: the avatars
                  bucket is public-read. Removing the photo now deletes the
                  file, so the second sentence is a fact, not a comfort. */}
              <AppText variant="caption" muted>
                A photo is served from a public link, so anyone who has that
                link can open it without signing in. Remove it and the file
                goes too.
              </AppText>
              {photoError ? (
                <AppText
                  variant="caption"
                  accessibilityLiveRegion="polite"
                  style={{ color: theme.danger }}
                >
                  {photoError}
                </AppText>
              ) : null}
            </Card>

            <Card style={{ gap: space.close }}>
              <AppText variant="title" accessibilityRole="header">
                About you
              </AppText>
              <Field
                label="Display name"
                accessibilityLabel={fieldLabel(
                  "Display name",
                  errors.displayName
                )}
                value={displayName}
                onChangeText={setDisplayName}
                maxLength={60}
                autoComplete="name"
                error={errors.displayName ?? null}
              />
              <View style={{ gap: space.snug }}>
                <Field
                  label="Handle"
                  accessibilityLabel={fieldLabel(
                    "Handle",
                    errors.handle ??
                      "3 to 24 characters: lowercase letters, numbers, underscores."
                  )}
                  value={handle}
                  onChangeText={(t) =>
                    setHandle(t.toLowerCase().replace(/\s/g, ""))
                  }
                  maxLength={24}
                  autoCapitalize="none"
                  autoCorrect={false}
                  spellCheck={false}
                  error={errors.handle ?? null}
                />
                {!errors.handle ? (
                  <AppText variant="caption" muted>
                    3–24 characters: lowercase letters, numbers, underscores.
                  </AppText>
                ) : null}
              </View>
              <Field
                label="Major (optional)"
                value={major}
                onChangeText={setMajor}
                maxLength={80}
                placeholder="e.g. Computer Science"
              />
              <Field
                label="Graduation year (optional)"
                accessibilityLabel={fieldLabel(
                  "Graduation year, optional",
                  errors.gradYear
                )}
                value={gradYear}
                onChangeText={setGradYear}
                keyboardType="number-pad"
                maxLength={4}
                placeholder="2027"
                error={errors.gradYear ?? null}
              />
              <View style={{ gap: space.snug }}>
                <Field
                  label="Bio (optional)"
                  value={bio}
                  onChangeText={(t) => setBio(t.slice(0, MAX_BIO_LENGTH))}
                  maxLength={MAX_BIO_LENGTH}
                  multiline
                  placeholder="A line or two about you — clubs, interests, what you're studying."
                  style={{ minHeight: 88, textAlignVertical: "top" }}
                />
                <AppText
                  variant="caption"
                  muted
                  accessibilityLabel={`${bio.length} of ${MAX_BIO_LENGTH} characters used`}
                >
                  {bio.length}/{MAX_BIO_LENGTH}
                </AppText>
              </View>
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                  paddingTop: space.close,
                }}
              >
                <AppText variant="caption" muted>
                  Signed in as {email ?? "your school email"}
                  {universityName ? ` · ${universityName}` : ""}. Your school
                  email can't be changed.
                </AppText>
              </View>
            </Card>

            <Card style={{ gap: space.close }}>
              <View style={{ gap: space.tight }}>
                <AppText variant="title" accessibilityRole="header">
                  What you're into
                </AppText>
                <AppText variant="caption" muted>
                  Up to eight things. They sit on your profile so classmates
                  can spot the overlap.
                </AppText>
              </View>

              {interests.length > 0 ? (
                <View
                  style={{ flexDirection: "row", flexWrap: "wrap", gap: space.cosy }}
                >
                  {interests.map((interest) => (
                    <Chip
                      key={interestKey(interest)}
                      label={interest}
                      tone="brand"
                      size="md"
                      icon="x"
                      selected
                      onPress={() => removeInterest(interest)}
                      accessibilityLabel={`Remove ${interest}`}
                    />
                  ))}
                </View>
              ) : null}

              <View
                style={{
                  flexDirection: "row",
                  alignItems: "flex-end",
                  gap: space.cosy,
                }}
              >
                <View style={{ flex: 1 }}>
                  <Field
                    label="Add an interest"
                    accessibilityLabel={fieldLabel(
                      "Add an interest",
                      interestHint
                    )}
                    value={interestDraft}
                    onChangeText={(text) => {
                      setInterestDraft(text);
                      if (interestHint) setInterestHint(null);
                    }}
                    placeholder="board games"
                    maxLength={MAX_INTEREST_LENGTH}
                    autoCapitalize="none"
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={commitInterestDraft}
                  />
                </View>
                <Button
                  label="Add"
                  variant="secondary"
                  size="sm"
                  disabled={interestDraft.trim().length === 0}
                  accessibilityLabel="Add this interest"
                  accessibilityState={{
                    disabled: interestDraft.trim().length === 0,
                  }}
                  onPress={commitInterestDraft}
                />
              </View>

              {/* One line that carries both the running count and whatever
                  went wrong, and says itself either way as chips come and go. */}
              {interestHint ? (
                <AppText
                  variant="caption"
                  accessibilityLiveRegion="polite"
                  style={{ color: theme.warning }}
                >
                  {interestHint}
                </AppText>
              ) : (
                <AppText
                  variant="caption"
                  muted
                  accessibilityLiveRegion="polite"
                >
                  {interests.length === 0
                    ? `Optional, and up to ${MAX_INTERESTS}.`
                    : `${interests.length} of ${MAX_INTERESTS} — tap one to take it off.`}
                </AppText>
              )}

              {openSuggestions.length > 0 ? (
                /* Faded rather than gone at the cap: the word may still be
                   true of them, it just can't fit until something comes off.
                   The fade is the only thing saying so on screen, so the line
                   above says it in words too. */
                <View
                  style={{
                    gap: space.cosy,
                    opacity: interests.length >= MAX_INTERESTS ? 0.5 : 1,
                  }}
                >
                  <AppText variant="caption" muted>
                    {interests.length >= MAX_INTERESTS
                      ? "Or start from one of these — take one off first"
                      : "Or start from one of these"}
                  </AppText>
                  <View
                    style={{ flexDirection: "row", flexWrap: "wrap", gap: space.cosy }}
                  >
                    {openSuggestions.map((suggestion) => (
                      <Chip
                        key={suggestion}
                        label={suggestion}
                        size="md"
                        onPress={() => addInterest(suggestion)}
                        accessibilityLabel={`Add ${suggestion}`}
                      />
                    ))}
                  </View>
                </View>
              ) : null}

              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: theme.border,
                  paddingTop: space.card,
                  gap: space.snug,
                }}
              >
                <Field
                  label="Looking for (optional)"
                  value={lookingFor}
                  onChangeText={(text) =>
                    setLookingFor(text.slice(0, MAX_LOOKING_FOR_LENGTH))
                  }
                  maxLength={MAX_LOOKING_FOR_LENGTH}
                  placeholder="A lab partner for BIS 2A"
                  returnKeyType="done"
                />
                <AppText
                  variant="caption"
                  muted
                  accessibilityLabel={
                    lookingFor.trim().length === 0
                      ? undefined
                      : `${lookingFor.length} of ${MAX_LOOKING_FOR_LENGTH} characters used`
                  }
                >
                  {lookingFor.trim().length === 0
                    ? "One line near the top of your profile — people to run with, a study group for the midterm, a ride home for break."
                    : `${lookingFor.length}/${MAX_LOOKING_FOR_LENGTH}`}
                </AppText>
              </View>
            </Card>

            <Card
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.close,
              }}
            >
              {/* The switch carries the whole row: hiding the words here and
                  putting them on the control is what makes it read as one
                  setting instead of a heading, a caption and a toggle. */}
              <View
                accessibilityElementsHidden
                importantForAccessibility="no-hide-descendants"
                style={{ flex: 1, gap: space.tight }}
              >
                <AppText variant="title">Public profile</AppText>
                <AppText variant="caption" muted>
                  {publicProfileCaption}
                </AppText>
              </View>
              <Switch
                accessibilityRole="switch"
                accessibilityLabel={`Public profile. ${publicProfileCaption}`}
                accessibilityState={{ checked: isPublic }}
                value={isPublic}
                onValueChange={setIsPublic}
                trackColor={{ false: theme.surface3, true: theme.brand }}
                thumbColor={theme.onSolid}
                ios_backgroundColor={theme.surface3}
              />
            </Card>

            {errors.form ? (
              <View
                accessible
                accessibilityLiveRegion="polite"
                accessibilityLabel={errors.form}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.cosy,
                  paddingHorizontal: space.close,
                  paddingVertical: space.room,
                  borderRadius: radius.control,
                  backgroundColor: theme.surface2,
                }}
              >
                <Feather
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  name="alert-circle"
                  size={14}
                  color={theme.danger}
                />
                <AppText
                  variant="caption"
                  style={{ color: theme.danger, flex: 1 }}
                >
                  {errors.form}
                </AppText>
              </View>
            ) : null}

            <View
              style={{ flexDirection: "row", alignItems: "center", gap: space.close }}
            >
              <Button
                label={saving ? "Saving…" : "Save changes"}
                pending={saving}
                accessibilityState={{ busy: saving, disabled: saving }}
                onPress={() => void handleSave()}
              />
              {saved ? (
                <View
                  accessible
                  accessibilityLiveRegion="polite"
                  accessibilityLabel="Saved"
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.tight,
                  }}
                >
                  <Feather
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    name="check"
                    size={16}
                    color={theme.success}
                  />
                  <AppText
                    variant="bodySemi"
                    style={{ color: theme.success }}
                  >
                    Saved
                  </AppText>
                </View>
              ) : null}
            </View>
          </ScrollView>
        </KeyboardAvoidingView>
      )}
    </View>
  );
}
