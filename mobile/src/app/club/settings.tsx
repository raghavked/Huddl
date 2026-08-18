import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Mug } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  SectionLabel,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { type ClubRole } from "@/lib/club-announcements";
import { toPrivacy, type ClubPrivacy } from "@/lib/club-invites";
import { tapSuccess } from "@/lib/haptics";
import { roomTitle } from "@/lib/room-identity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Looking after a club: the door the phone was missing.
 *
 * Officers and the owner edit the name, the category and the description; the
 * owner alone can disband. Those are not new rules: migration 0009 already
 * enforces them (`is_club_officer` for the update, an owner row for the
 * delete) and the web app draws the same two affordances on the club page.
 * We check the role on mount rather than letting a write bounce, so a member
 * who wandered in through a deep link gets a sentence instead of a
 * permissions error.
 *
 * What this screen deliberately leaves alone: the slug. The club's chat
 * channel was named `club-<slug>` when the club was founded and nothing
 * renames it afterwards, so a rename here changes the club's page and not the
 * room people are already talking in. The caption under the name field says
 * so out loud, because a rename that silently moved the chat would be worse
 * than one that doesn't.
 *
 * It also doesn't hand over the presidency or promote officers (the roster
 * on the club page manages roles now), and it doesn't offer "leave club",
 * which lives on the club page where it always has.
 */

/** Minimal local row shape. The web app's types live outside this tsconfig. */
type ClubCategory =
  | "academic"
  | "professional"
  | "cultural"
  | "sports"
  | "social"
  | "service"
  | "other";

const CATEGORIES: readonly ClubCategory[] = [
  "academic",
  "professional",
  "cultural",
  "sports",
  "social",
  "service",
  "other",
];

type ClubRow = {
  id: string;
  name: string;
  description: string | null;
  category: ClubCategory;
  privacy: ClubPrivacy;
};

type Status = "loading" | "error" | "notFound" | "ready";

/* The door policy. Migration 0069 wired the join policy to it, so this is
   the row that decides whether the club page shows Join at all. The exact
   words are shared with the web app, letter for letter. */
const PRIVACY_OPTIONS: readonly {
  value: ClubPrivacy;
  label: string;
  hint: string;
}[] = [
  {
    value: "open",
    label: "Open",
    hint: "Anyone at your campus can join.",
  },
  {
    value: "invite",
    label: "Invite only",
    hint: "New members join by invitation from an officer.",
  },
];

/* The same window the web's updateClub action enforces. The founding form on
   this phone is stricter (60), but a club named on the web can be longer than
   that and an editor has no business truncating a name it didn't choose. */
const NAME_MIN = 3;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 500;

/** "academic" -> "Academic". Every category is a single word. */
function categoryLabel(category: ClubCategory): string {
  return category.charAt(0).toUpperCase() + category.slice(1);
}

/** Anything unexpected in the column reads as the default the DB uses. */
function toCategory(raw: unknown): ClubCategory {
  return CATEGORIES.includes(raw as ClubCategory)
    ? (raw as ClubCategory)
    : "other";
}

/** Narrow `club_members.role`; anything unexpected reads as no role at all. */
function toRole(raw: unknown): ClubRole | null {
  if (raw === "member" || raw === "officer" || raw === "owner") return raw;
  return null;
}

/**
 * Who may edit the details: the client-side twin of `is_club_officer`, the
 * function behind the "officers can update their club" policy.
 */
function canEditClub(role: ClubRole | null): boolean {
  return role === "officer" || role === "owner";
}

/**
 * Who may disband: the twin of the delete policy, which wants an owner row
 * and nothing less. An officer with a grudge can't take the club down.
 */
function canDisbandClub(role: ClubRole | null): boolean {
  return role === "owner";
}

/**
 * The two-door picker: one bordered row per policy, label and hint together,
 * so the choice is read as a sentence and not decoded from a pill. The same
 * rows as the founding form, because the door is the same door.
 */
function PrivacyPicker({
  value,
  disabled,
  onChange,
}: {
  value: ClubPrivacy;
  disabled: boolean;
  onChange: (next: ClubPrivacy) => void;
}) {
  const theme = useTheme();
  return (
    <View style={{ gap: space.snug }}>
      <AppText variant="label">Who can join</AppText>
      <View style={{ gap: space.cosy }}>
        {PRIVACY_OPTIONS.map((option) => {
          const selected = value === option.value;
          return (
            <Pressable
              key={option.value}
              accessibilityRole="radio"
              accessibilityState={{ selected, disabled }}
              accessibilityLabel={`${option.label}. ${option.hint}`}
              onPress={() => {
                if (!disabled) onChange(option.value);
              }}
              style={({ pressed }) => ({
                flexDirection: "row",
                alignItems: "center",
                gap: space.close,
                minHeight: 56,
                paddingHorizontal: space.card,
                paddingVertical: space.room,
                borderRadius: radius.control,
                borderWidth: 1,
                borderColor: selected ? theme.brandInk : theme.border,
                backgroundColor: selected ? theme.brandSoft : theme.surface,
                opacity: pressed ? 0.7 : 1,
              })}
            >
              <Feather
                name={option.value === "open" ? "unlock" : "lock"}
                size={16}
                color={selected ? theme.brandInk : theme.muted}
              />
              <View style={{ flex: 1, gap: space.hair }}>
                <AppText
                  variant="bodySemi"
                  style={selected ? { color: theme.brandInk } : undefined}
                >
                  {option.label}
                </AppText>
                <AppText variant="caption" muted>
                  {option.hint}
                </AppText>
              </View>
              {selected ? (
                <Feather name="check" size={16} color={theme.brandInk} />
              ) : null}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
}

export default function ClubSettingsScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  // Just the id. The name, category and description are read fresh here, so
  // the form can never open onto a stale copy of what it's about to save.
  const { clubId } = useLocalSearchParams<{ clubId?: string }>();
  const id = clubId ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [club, setClub] = useState<ClubRow | null>(null);
  const [role, setRole] = useState<ClubRole | null>(null);
  const [memberCount, setMemberCount] = useState(0);
  const [channel, setChannel] = useState<{
    name: string | null;
    slug: string;
  } | null>(null);

  const [name, setName] = useState("");
  const [category, setCategory] = useState<ClubCategory>("other");
  const [privacy, setPrivacy] = useState<ClubPrivacy>("open");
  const [description, setDescription] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [disbandError, setDisbandError] = useState<string | null>(null);
  const [disbanding, setDisbanding] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (id) router.replace(`/club/${id}`);
    else router.replace("/(tabs)/clubs");
  }, [router, id]);

  const load = useCallback(async () => {
    if (!userId) return;
    if (!id) {
      setStatus("ready");
      return;
    }
    try {
      const [clubRes, roleRes, countRes, channelRes] = await Promise.all([
        supabase
          .from("clubs")
          .select("id, name, description, category, privacy")
          .eq("id", id)
          .maybeSingle(),
        supabase
          .from("club_members")
          .select("role")
          .eq("club_id", id)
          .eq("user_id", userId)
          .maybeSingle(),
        // Head-only count. The disband warning says how many people this
        // costs, and that number is the whole point of saying it.
        supabase
          .from("club_members")
          .select("user_id", { count: "exact", head: true })
          .eq("club_id", id),
        supabase
          .from("channels")
          .select("name, slug")
          .eq("club_id", id)
          .maybeSingle(),
      ]);
      if (clubRes.error || roleRes.error) {
        setStatus("error");
        return;
      }
      const row = clubRes.data as unknown as {
        id: string;
        name: string;
        description: string | null;
        category: unknown;
        privacy: unknown;
      } | null;
      // RLS hides other campuses' clubs, so "not found" covers both cases,
      // including a club somebody else disbanded while this was open.
      if (!row) {
        setStatus("notFound");
        return;
      }
      const loaded: ClubRow = {
        id: row.id,
        name: row.name,
        description: row.description,
        category: toCategory(row.category),
        privacy: toPrivacy(row.privacy),
      };
      setClub(loaded);
      setName(loaded.name);
      setCategory(loaded.category);
      setPrivacy(loaded.privacy);
      setDescription(loaded.description ?? "");
      setRole(toRole((roleRes.data as { role?: unknown } | null)?.role));
      setMemberCount(countRes.count ?? 0);
      setChannel(
        (channelRes.data as unknown as {
          name: string | null;
          slug: string;
        } | null) ?? null
      );
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [id, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const handleSave = useCallback(async () => {
    if (!club || saving || disbanding) return;

    const cleanName = name.trim();
    if (cleanName.length < NAME_MIN) {
      setFormError(`Club names need at least ${NAME_MIN} characters.`);
      return;
    }
    if (cleanName.length > NAME_MAX) {
      setFormError(`Club names stop at ${NAME_MAX} characters. Trim it a bit.`);
      return;
    }

    setFormError(null);
    setSaving(true);
    // The slug isn't in the update, so a rename can't collide with another
    // club's chat channel and the unique index never comes into it.
    const { data, error } = await supabase
      .from("clubs")
      .update({
        name: cleanName,
        category,
        privacy,
        description: description.trim() || null,
      })
      .eq("id", club.id)
      .select("id");
    setSaving(false);

    if (error) {
      setFormError("We couldn't save your changes. Give it another try.");
      return;
    }
    // No rows back means RLS turned it down: your role changed under you.
    if (!data || data.length === 0) {
      setFormError(
        "Only officers can change these details. Check with the owner if that's a surprise."
      );
      return;
    }

    // A completion moment. The club page refetches on focus, so the new name
    // waiting there is the receipt, so no confirmation screen is needed.
    tapSuccess();
    goBack();
  }, [club, saving, disbanding, name, category, privacy, description, goBack]);

  const doDisband = useCallback(async () => {
    if (!club || disbanding) return;
    setDisbandError(null);
    setDisbanding(true);
    const { data, error } = await supabase
      .from("clubs")
      .delete()
      .eq("id", club.id)
      .select("id");
    setDisbanding(false);

    if (error) {
      setDisbandError(
        "We couldn't disband the club just now. Give it another try."
      );
      return;
    }
    if (!data || data.length === 0) {
      setDisbandError("Only the club's owner can disband it.");
      return;
    }

    /* Going back would land on the club page, and there's no club there any
       more, so pop past it to the clubs list instead. */
    router.dismissTo("/(tabs)/clubs");
  }, [club, disbanding, router]);

  const confirmDisband = useCallback(() => {
    if (!club) return;
    Alert.alert(
      `Disband ${club.name}?`,
      "Everything goes at once: the roster, the club chat and what's been said in it, the announcements, and any events the club is hosting. There's no undo and no way to bring it back.",
      [
        { text: "Keep the club", style: "cancel" },
        {
          text: "Disband",
          style: "destructive",
          onPress: () => void doDisband(),
        },
      ]
    );
  }, [club, doDisband]);

  // Deep links land here directly, so signed-out visitors get a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const backChevron = (
    <View style={{ paddingHorizontal: space.close }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={goBack}
        hitSlop={8}
        style={({ pressed }) => ({
          width: 44,
          height: 44,
          alignItems: "center",
          justifyContent: "center",
          opacity: pressed ? 0.6 : 1,
        })}
      >
        <Feather name="chevron-left" size={26} color={theme.foreground} />
      </Pressable>
    </View>
  );

  const scaffold = (children: React.ReactNode) => (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + space.close }}>
        {backChevron}
        {children}
      </View>
    </KeyboardAvoidingView>
  );

  /* -------------------------- before the form -------------------------- */

  // Only reachable from a stray deep link. The club page always passes the
  // id. Say what's missing rather than pretending the club is closed.
  if (!id) {
    return scaffold(
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: space.gutter,
        }}
      >
        <EmptyState
          illustration={Mug}
          title="Which club is this for?"
          body="We lost track of the club along the way. Open it from your clubs and tap the gear again."
          action={{ label: "Back to your clubs", onPress: goBack }}
        />
      </View>
    );
  }

  if (status === "loading") {
    return scaffold(
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: space.close,
          // Offsets the 44px chevron row above, so the block reads centred in
          // the screen rather than in what's left of it. Same as the composer.
          paddingBottom: 60,
        }}
      >
        <ActivityIndicator size="large" color={theme.brand} />
        <AppText variant="caption" muted>
          Opening club settings…
        </AppText>
      </View>
    );
  }

  if (status === "error") {
    return scaffold(
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: space.room,
          paddingHorizontal: space.rest,
          paddingBottom: 60,
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.control,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="wifi-off" size={22} color={theme.brand} />
        </View>
        <AppText variant="title">Something hiccuped</AppText>
        <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
          We couldn't load this club's settings. Check your connection and give
          it another go.
        </AppText>
        <Button
          label="Try again"
          variant="soft"
          size="sm"
          onPress={() => {
            setStatus("loading");
            void load();
          }}
        />
      </View>
    );
  }

  if (status === "notFound" || !club) {
    return scaffold(
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: space.room,
          paddingHorizontal: space.rest,
          paddingBottom: 60,
        }}
      >
        <View
          style={{
            width: 52,
            height: 52,
            borderRadius: radius.control,
            backgroundColor: theme.brandSoft,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name="users" size={22} color={theme.brand} />
        </View>
        <AppText variant="title">Club not available</AppText>
        <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
          This club doesn't exist anymore, or it belongs to another campus.
        </AppText>
        <Button
          label="Back to clubs"
          variant="soft"
          size="sm"
          onPress={() => router.replace("/(tabs)/clubs")}
        />
      </View>
    );
  }

  // A member, or nobody at all, following a link they shouldn't have. An
  // explanation and a way out, never a raw permissions error.
  if (!canEditClub(role)) {
    return scaffold(
      <View
        style={{
          flex: 1,
          justifyContent: "center",
          paddingHorizontal: space.gutter,
        }}
      >
        <EmptyState
          illustration={Mug}
          title={
            role === null
              ? "You're not in this club yet"
              : "Officers look after the details"
          }
          body={
            role === null
              ? "Join the club first. Its officers are the ones who keep the name and description up to date."
              : "Only officers and the owner can change the club's name, category or description. If something's out of date, nudge one of them in the club chat."
          }
          action={{ label: "Back to the club", onPress: goBack }}
        />
      </View>
    );
  }

  /* ------------------------------ the form ----------------------------- */

  const busy = saving || disbanding;
  const dirty =
    name.trim() !== club.name ||
    category !== club.category ||
    privacy !== club.privacy ||
    description.trim() !== (club.description ?? "");

  return scaffold(
    <ScrollView
      style={{ flex: 1 }}
      contentContainerStyle={{
        paddingHorizontal: space.gutter,
        paddingBottom: insets.bottom + space.rest,
        gap: space.card,
      }}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      showsVerticalScrollIndicator={false}
    >
      <View style={{ gap: space.snug }}>
        <AppText variant="display">Club settings</AppText>
        <AppText variant="caption" muted>
          {club.name}. Everyone on campus sees these on its page.
        </AppText>
      </View>

      <View style={{ gap: space.snug }}>
        <Field
          label="Club name"
          value={name}
          onChangeText={setName}
          placeholder="Astronomy Society"
          maxLength={NAME_MAX}
          editable={!busy}
        />
        <AppText variant="caption" muted>
          {channel
            ? `The club chat keeps its name: ${roomTitle(channel.name, channel.slug)} stays where it is.`
            : "Renaming the club doesn't rename its chat channel."}
        </AppText>
      </View>

      <View style={{ gap: space.snug }}>
        <AppText variant="label">Category</AppText>
        <View
          style={{ flexDirection: "row", flexWrap: "wrap", gap: space.cosy }}
        >
          {CATEGORIES.map((option) => (
            <Chip
              key={option}
              label={categoryLabel(option)}
              tone="brand"
              size="md"
              selected={category === option}
              onPress={() => {
                if (!busy) setCategory(option);
              }}
            />
          ))}
        </View>
      </View>

      <PrivacyPicker value={privacy} disabled={busy} onChange={setPrivacy} />

      <Field
        label="Description (optional)"
        value={description}
        onChangeText={setDescription}
        placeholder="What's your club about? Who should join?"
        maxLength={DESCRIPTION_MAX}
        multiline
        editable={!busy}
        style={{ minHeight: 88, textAlignVertical: "top" }}
      />

      {formError ? (
        <AppText
          variant="caption"
          accessibilityLiveRegion="polite"
          style={{ color: theme.danger }}
        >
          {formError}
        </AppText>
      ) : null}

      <Button
        label={saving ? "Saving…" : "Save changes"}
        pending={saving}
        disabled={!dirty || disbanding}
        icon={<Feather name="check" size={16} color={theme.brandFg} />}
        onPress={() => void handleSave()}
        style={{ marginTop: space.tight }}
      />

      {/* Disbanding is the owner's alone, and it takes the whole club with
          it, so it sits under its own heading, well below Save. */}
      {canDisbandClub(role) ? (
        <>
          <SectionLabel text="Disbanding" />
          <Card style={{ gap: space.close }}>
            <AppText variant="title">Disband this club</AppText>
            <AppText muted>
              It comes off the club list for everyone. The roster, the club
              chat and everything said in it, the announcements board, and any
              events the club is hosting all go with it.
            </AppText>
            <AppText variant="caption" muted>
              {memberCount === 1
                ? "You're the only one in it right now."
                : `${memberCount} students are in it right now.`}
            </AppText>
            {disbandError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger }}
              >
                {disbandError}
              </AppText>
            ) : null}
            <Button
              label={disbanding ? "Disbanding…" : "Disband club"}
              variant="danger"
              size="sm"
              pending={disbanding}
              disabled={saving}
              icon={<Feather name="trash-2" size={14} color={theme.onSolid} />}
              onPress={confirmDisband}
              style={{ alignSelf: "flex-start" }}
            />
          </Card>
        </>
      ) : null}
    </ScrollView>
  );
}
