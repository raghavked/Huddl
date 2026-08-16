import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import type { ReactNode } from "react";
import {
  Pressable,
  RefreshControl,
  ScrollView,
  Switch,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Card,
  EmptyState,
  SectionLabel,
  Skeleton,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import {
  DM_PRIVACY_OPTIONS,
  usePrivacyPrefs,
  type DmPrivacy,
  type PrivacyPrefs,
} from "@/hooks/use-privacy-prefs";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Privacy: the three controls a student can actually reach, and a plain
   account of what campus can and can't see about them.

   This screen is meant to reassure, not to administrate. Two switches, a
   picker, one sentence each saying what the current setting means, then prose:
   the things classmates can see, the things nobody can, and the two places a
   student would go next. No counters, no percentages, no dashboard.

   Every sentence on this screen is a claim about a student's safety, so it
   has to be checkable against the code, not merely comforting. Two used not
   to be: a Read receipts switch that wrote a column nothing consulted (see
   `hooks/use-privacy-prefs.ts` for why it was removed rather than left
   inert), and "turn off Public profile and you leave the people directory
   altogether", which was never how `is_public` worked.

   That standard is why the DM picker's copy spends as many words on what it
   does NOT do as on what it does. Migration 0040 binds the setting to the
   moment a thread is created and nowhere else, so a student who reads
   "Nobody new" and expects silence would be reading a promise the database
   never made. Saying "the ones you're already in carry on" up front is
   cheaper than the surprise. */

/* ----------------------------- the switch ---------------------------- */

type PrivacyToggle = {
  /** Only the boolean preferences belong here; the picker is its own row. */
  key: "shareTyping";
  icon: keyof typeof Feather.glyphMap;
  label: string;
  /** States the reciprocity in one sentence. Both halves, every time. */
  caption: string;
};

const TOGGLES: PrivacyToggle[] = [
  {
    key: "shareTyping",
    icon: "edit-3",
    label: "Typing indicators",
    caption:
      "Turn this off and nobody sees you composing a message. You stop seeing them, too.",
  },
];

/* The presence switch writes `profiles.share_last_seen`, a column
   `use-privacy-prefs` doesn't carry (the erase-on-off behaviour is the
   server's, not a cached preference), so it's its own row under the same
   card rather than a second TOGGLES entry. Word for word with the web
   privacy page. */
const PRESENCE_LABEL = "Share when you're active";
const PRESENCE_CAPTION =
  'Classmates see "Active now" under your name while this is on. Turn it off and Hearth erases what it kept, right away.';

/* ----------------------------- the picker ---------------------------- */

/**
 * The three values of `profiles.dm_privacy`, said in a student's words.
 *
 * A `Record` rather than a list so a fourth value added to {@link DmPrivacy}
 * fails the typecheck here instead of quietly rendering nothing; the order
 * they're offered in is `DM_PRIVACY_OPTIONS`, widest first.
 */
const DM_OPTIONS: Record<
  DmPrivacy,
  { icon: keyof typeof Feather.glyphMap; label: string; caption: string }
> = {
  campus: {
    icon: "globe",
    label: "Anyone on campus",
    caption:
      "Anyone who can find your profile can start a conversation. This is how Hearth starts out.",
  },
  classmates: {
    icon: "book-open",
    label: "People in my classes",
    caption:
      "Only someone you share a course with: one you're in now, or one you took a term ago.",
  },
  nobody: {
    icon: "lock",
    label: "Nobody new",
    caption:
      "No new conversations. The ones you're already in carry on as they are.",
  },
};

/**
 * What the chosen option means, in one sentence under the card.
 *
 * Pure, like {@link sharingSentence}, and deliberately silent about who gets
 * told what: on 'classmates' the refusal a stranger sees is the same vague
 * line everyone else gets, because naming the reason would leak which of
 * their courses you aren't in.
 */
function dmSentence(value: DmPrivacy): string {
  switch (value) {
    case "campus":
      return "Anyone at your university can open a thread with you, which is what Hearth has always done. Narrowing it later never closes a conversation you're already in.";
    case "classmates":
      return "Someone who shares a course with you can start a thread or add you to a group chat. Everyone else is told you aren't taking new messages, and nothing more than that: not which classes you're in, and not that they were refused by name.";
    case "nobody":
      return "Nobody new can open a thread with you or add you to a group chat. You can still start one with anyone you like, and everything you're already in keeps running.";
  }
}

/**
 * What the current setting actually means, in one sentence under the card.
 * Pure: it takes the preferences and nothing else, so the copy can be read
 * (and changed) without chasing state around the screen.
 */
/* Word for word with src/app/(app)/settings/privacy/page.tsx. The two used to
   disagree on both halves: the on-state here described what turning it off
   would do rather than what it currently does, and the web off-state left out
   notifications. `share_typing` is read by exactly one thing, hooks/use-typing.ts,
   so "notify exactly the same" is a claim the code actually keeps. */
function sharingSentence(prefs: PrivacyPrefs): string {
  if (prefs.shareTyping) {
    return "It's on, which is how Hearth starts out: classmates can tell when you're composing a message, and you can tell the same about them.";
  }
  return "It's off. Nobody sees you composing, and you won't see them composing either. Your messages still send, arrive and notify exactly the same.";
}

/* ------------------------------- pieces ------------------------------ */

/** Icon tile + label + caption + a switch, in the push-settings idiom. */
function SwitchRow({
  icon,
  label,
  caption,
  first,
  value,
  onValueChange,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  caption: string;
  first: boolean;
  value: boolean;
  onValueChange: (next: boolean) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
      }}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.control,
          backgroundColor: value ? theme.brandSoft : theme.surface2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather
          name={icon}
          size={16}
          color={value ? theme.brand : theme.muted}
        />
      </View>
      <View style={{ flex: 1, gap: space.hair }}>
        <AppText variant="bodySemi">{label}</AppText>
        <AppText variant="caption" muted>
          {caption}
        </AppText>
      </View>
      <Switch
        accessibilityLabel={label}
        value={value}
        onValueChange={onValueChange}
        trackColor={{ false: theme.surface3, true: theme.brand }}
        thumbColor={theme.onSolid}
        ios_backgroundColor={theme.surface3}
      />
    </View>
  );
}

/**
 * One option of the DM picker: the SwitchRow's shape with a trailing check
 * instead of a switch, in `Sheet.Row`'s picker idiom: the mark on the
 * trailing edge *and* `accessibilityState`, never the state spelled into the
 * label.
 */
function OptionRow({
  icon,
  label,
  caption,
  first,
  selected,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  caption: string;
  first: boolean;
  selected: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="radio"
      // The caption is the difference between the three, so it's said too.
      accessibilityLabel={`${label}. ${caption}`}
      accessibilityState={{ selected }}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.control,
          backgroundColor: selected ? theme.brandSoft : theme.surface2,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather
          name={icon}
          size={16}
          color={selected ? theme.brand : theme.muted}
        />
      </View>
      <View style={{ flex: 1, gap: space.hair }}>
        <AppText variant="bodySemi">{label}</AppText>
        <AppText variant="caption" muted>
          {caption}
        </AppText>
      </View>
      {/* Kept in the layout unselected so choosing doesn't shuffle the text
          beside it by 18px. */}
      <View style={{ width: 18, alignItems: "center" }}>
        {selected ? (
          <Feather name="check" size={18} color={theme.brand} />
        ) : null}
      </View>
    </Pressable>
  );
}

/**
 * The ghost of a row, for the beat before the profile lands. `trailing` is
 * which control sits on the right: a switch is a wide pill, a picker's
 * check is a small mark.
 */
function RowSkeleton({
  first,
  trailing,
}: {
  first: boolean;
  trailing: "switch" | "check";
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 44,
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.close,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
      }}
    >
      <Skeleton width={32} height={32} radius={radius.control} />
      <View style={{ flex: 1, gap: space.snug }}>
        <Skeleton width="46%" height={13} radius={radius.full} />
        <Skeleton width="86%" height={10} radius={radius.full} />
      </View>
      {trailing === "switch" ? (
        <Skeleton width={44} height={26} radius={radius.full} />
      ) : (
        <Skeleton width={18} height={18} radius={radius.full} />
      )}
    </View>
  );
}

/** One line of the "what campus can see" prose, with a small leading mark. */
function Fact({
  icon,
  tint,
  children,
}: {
  icon: keyof typeof Feather.glyphMap;
  tint: string;
  children: ReactNode;
}) {
  return (
    <View style={{ flexDirection: "row", gap: space.room }}>
      {/* Off the ladder on purpose: 3px drops the 14px glyph onto the
          cap-height of the 15/21 body line beside it. An optical nudge, not
          a spacing decision. */}
      <Feather name={icon} size={14} color={tint} style={{ marginTop: 3 }} />
      <AppText variant="body" style={{ flex: 1 }}>
        {children}
      </AppText>
    </View>
  );
}

/** Icon + label + chevron, for the two places a reader goes next. */
function LinkRow({
  icon,
  label,
  caption,
  first,
  onPress,
}: {
  icon: keyof typeof Feather.glyphMap;
  label: string;
  caption: string;
  first: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      style={({ pressed }) => ({
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.room,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <View
        style={{
          width: 32,
          height: 32,
          borderRadius: radius.control,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={16} color={theme.brand} />
      </View>
      <View style={{ flex: 1, gap: space.hair }}>
        <AppText variant="bodySemi">{label}</AppText>
        <AppText variant="caption" muted>
          {caption}
        </AppText>
      </View>
      <Feather name="chevron-right" size={18} color={theme.muted} />
    </Pressable>
  );
}

/* ------------------------------- screen ------------------------------ */

export default function PrivacySettingsScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { prefs, loading, error, saveError, setPref, refresh } =
    usePrivacyPrefs();

  const [refreshing, setRefreshing] = useState(false);

  /* Presence sharing, straight off the profile row. Null while the read is
     still out; the switch renders a skeleton rather than a guess. */
  const [sharePresence, setSharePresence] = useState<boolean | null>(null);
  const [presenceLoadFailed, setPresenceLoadFailed] = useState(false);
  const [presenceSaveError, setPresenceSaveError] = useState<string | null>(
    null
  );

  const loadPresence = useCallback(async () => {
    if (!userId) return;
    const { data, error: queryError } = await supabase
      .from("profiles")
      .select("share_last_seen")
      .eq("id", userId)
      .maybeSingle();
    if (queryError || !data) {
      setPresenceLoadFailed(true);
      return;
    }
    setPresenceLoadFailed(false);
    setSharePresence(
      (data as { share_last_seen: boolean }).share_last_seen === true
    );
  }, [userId]);

  useEffect(() => {
    void loadPresence();
  }, [loadPresence]);

  /* Optimistic, like the other switch: flip first, write, flip back with a
     line under the card if the write bounced. Turning it off is the erase:
     the server clears last_seen_at the moment the column goes false. */
  const setPresenceSharing = useCallback(
    async (next: boolean) => {
      if (!userId) return;
      setPresenceSaveError(null);
      setSharePresence(next);
      const { error: updateError } = await supabase
        .from("profiles")
        .update({ share_last_seen: next })
        .eq("id", userId);
      if (updateError) {
        setSharePresence(!next);
        setPresenceSaveError("That didn't save just now. Give it another tap.");
      }
    },
    [userId]
  );

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  /* The switches are read from a shared cache, so a pull here is the one way
     to make this screen ask the row again. */
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void Promise.all([refresh(), loadPresence()]).finally(() =>
      setRefreshing(false)
    );
  }, [refresh, loadPresence]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
        paddingHorizontal: space.gutter,
      }}
    >
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Back"
        onPress={goBack}
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
        <Feather name="chevron-left" size={26} color={theme.foreground} />
      </Pressable>

      <AppText variant="display" style={{ marginTop: space.hair }}>
        Privacy
      </AppText>
      <AppText variant="caption" muted style={{ marginTop: space.tight, marginBottom: space.cosy }}>
        Three things you can set, and a straight account of everything else.
      </AppText>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + space.rest }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
      >
        <SectionLabel text="What you share" first />

        {error ? (
          /* One failure, one retry: both controls read the same row, so
             there is nothing to show for either until it lands. */
          <EmptyState
            icon="cloud-off"
            title="We couldn't reach your settings"
            body={error}
            action={{ label: "Try again", onPress: () => void refresh() }}
          />
        ) : (
          <>
            <Card padded={false}>
              {loading
                ? TOGGLES.map((toggle, index) => (
                    <RowSkeleton
                      key={toggle.key}
                      first={index === 0}
                      trailing="switch"
                    />
                  ))
                : TOGGLES.map((toggle, index) => (
                    <SwitchRow
                      key={toggle.key}
                      icon={toggle.icon}
                      label={toggle.label}
                      caption={toggle.caption}
                      first={index === 0}
                      value={prefs[toggle.key]}
                      onValueChange={(next) =>
                        void setPref(toggle.key, next)
                      }
                    />
                  ))}
              {/* Presence rides in the same card but off its own column;
                  see PRESENCE_LABEL above for why it isn't a TOGGLES entry. */}
              {loading || (sharePresence === null && !presenceLoadFailed) ? (
                <RowSkeleton first={false} trailing="switch" />
              ) : sharePresence === null ? null : (
                <SwitchRow
                  icon="activity"
                  label={PRESENCE_LABEL}
                  caption={PRESENCE_CAPTION}
                  first={false}
                  value={sharePresence}
                  onValueChange={(next) => void setPresenceSharing(next)}
                />
              )}
            </Card>

            {loading ? null : (
              <AppText variant="caption" muted style={{ marginTop: space.room }}>
                {sharingSentence(prefs)}
              </AppText>
            )}
            {saveError?.key === "shareTyping" ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginTop: space.snug }}
              >
                {saveError.message}
              </AppText>
            ) : null}
            {presenceLoadFailed && sharePresence === null ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginTop: space.snug }}
              >
                We couldn't load your activity sharing setting. Pull down to
                try again.
              </AppText>
            ) : null}
            {presenceSaveError ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginTop: space.snug }}
              >
                {presenceSaveError}
              </AppText>
            ) : null}

            <SectionLabel text="Who can message you" />

            <Card padded={false}>
              <View
                accessibilityRole="radiogroup"
                accessibilityLabel="Who can start a conversation with you"
              >
                {loading
                  ? DM_PRIVACY_OPTIONS.map((value, index) => (
                      <RowSkeleton
                        key={value}
                        first={index === 0}
                        trailing="check"
                      />
                    ))
                  : DM_PRIVACY_OPTIONS.map((value, index) => (
                      <OptionRow
                        key={value}
                        icon={DM_OPTIONS[value].icon}
                        label={DM_OPTIONS[value].label}
                        caption={DM_OPTIONS[value].caption}
                        first={index === 0}
                        selected={prefs.dmPrivacy === value}
                        /* Re-picking the current option would spend a write
                           to change nothing, and a failed one would put a
                           red line under a setting that never moved. */
                        onPress={() => {
                          if (prefs.dmPrivacy === value) return;
                          void setPref("dmPrivacy", value);
                        }}
                      />
                    ))}
              </View>
            </Card>

            {loading ? null : (
              <AppText variant="caption" muted style={{ marginTop: space.room }}>
                {dmSentence(prefs.dmPrivacy)}
              </AppText>
            )}
            {saveError?.key === "dmPrivacy" ? (
              <AppText
                variant="caption"
                accessibilityLiveRegion="polite"
                style={{ color: theme.danger, marginTop: space.snug }}
              >
                {saveError.message}
              </AppText>
            ) : null}

            {/* The three things the setting deliberately does NOT do. They
                hold at every value, so they sit outside `dmSentence`. They
                are the whole reason this control can be shipped honestly.
                Each one is a line of migration 0040. */}
            <Card style={{ gap: space.close, marginTop: space.card }}>
              <Fact icon="message-circle" tint={theme.accent}>
                A conversation you're already in keeps working whatever you
                pick. Its messages arrive, you can reply, and anyone you've
                messaged before can write in that thread again.
              </Fact>
              <Fact icon="users" tint={theme.accent}>
                A group chat counts as a new conversation (same inbox, same
                notification), so someone who can't start a DM with you can't
                add you to a group either. Nobody is ever removed from a group
                they're already in.
              </Fact>
              <Fact icon="slash" tint={theme.accent}>
                Blocking is the heavier, separate thing. It refuses even a
                thread that already exists, and it wins over whatever you set
                here.
              </Fact>
            </Card>
          </>
        )}

        {/* Static reassurance: it stands even when the row above didn't
            load, so it lives outside the error branch. */}
        <SectionLabel text="What campus sees" />

        <Card style={{ gap: space.close }}>
          <Fact icon="user" tint={theme.brand}>
            Your profile: your name, handle, photo, major, year, and bio. Turn
            off Public profile in Account and classmates see only your handle
            and your photo. You stay listed in the people directory either
            way.
          </Fact>
          <Fact icon="image" tint={theme.brand}>
            Your profile photo, which is served from a public link. Anyone
            who has that link can open it without signing in. Removing it in
            Account deletes the file.
          </Fact>
          <Fact icon="message-square" tint={theme.brand}>
            What you post in a room, to the people in that room. A course chat
            reaches classmates who added the same course, and nobody else.
          </Fact>
          <Fact icon="clock" tint={theme.brand}>
            That you're studying, while a focus session is running: your
            name, your class and your note, to your whole campus. It leaves
            the list the moment you stand up, and you can pick "just me" when
            you start one to keep it off the list entirely.
          </Fact>
        </Card>

        <SectionLabel text="What stays yours" />

        <Card style={{ gap: space.close }}>
          <Fact icon="mail" tint={theme.accent}>
            Your email address. It proves you're a student here and does
            nothing else.
          </Fact>
          <Fact icon="lock" tint={theme.accent}>
            Your direct messages. They're readable only by the people in the
            conversation, a rule enforced in the database, not a promise in a
            policy.
          </Fact>
          <Fact icon="book" tint={theme.accent}>
            Your grades and your notes. Hearth never connects to your
            university's systems, so there's no transcript here to leak, and
            what you write for yourself stays yours.
          </Fact>
          <Fact icon="check-circle" tint={theme.accent}>
            Whether you've read a message. Hearth has no read receipts: no
            screen tells anyone you've opened theirs.
          </Fact>
          <Fact icon="slash" tint={theme.accent}>
            Who you've blocked. They were never told, they never will be, and
            there's no way for anyone to ask.
          </Fact>
        </Card>

        <AppText variant="caption" muted style={{ marginTop: space.room }}>
          Apart from your profile photo, nothing on Hearth is reachable from
          the wider internet. Your university never gets a copy, and none of
          it is ever sold.
        </AppText>

        <Card padded={false} style={{ marginTop: space.chapter }}>
          <LinkRow
            icon="slash"
            label="Blocked people"
            caption="Everyone you've quietly put out of reach."
            first
            onPress={() => router.push("/blocked")}
          />
          <LinkRow
            icon="file-text"
            label="Privacy policy"
            caption="The long version, in plain sentences."
            first={false}
            onPress={() => router.push("/legal/privacy")}
          />
        </Card>
      </ScrollView>
    </View>
  );
}
