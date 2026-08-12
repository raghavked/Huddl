import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useState } from "react";
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
import { usePrivacyPrefs, type PrivacyPrefs } from "@/hooks/use-privacy-prefs";
import { useTheme } from "@/hooks/use-theme";

/* Privacy — the reciprocal signal you can switch off, and a plain account of
   what campus can and can't see about you.

   This screen is meant to reassure, not to administrate. A switch, one
   sentence saying what it currently means, and then prose: the things
   classmates can see, the things nobody can, and the two places a student
   would go next. No counters, no percentages, no dashboard.

   Every sentence on this screen is a claim about a student's safety, so it
   has to be checkable against the code, not merely comforting. Two used not
   to be: a Read receipts switch that wrote a column nothing consulted (see
   `hooks/use-privacy-prefs.ts` for why it was removed rather than left
   inert), and "turn off Public profile and you leave the people directory
   altogether", which was never how `is_public` worked. */

/* ----------------------------- the switch ---------------------------- */

type PrivacyToggle = {
  key: keyof PrivacyPrefs;
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
      "Turn this off and nobody sees you composing a message — and you stop seeing them, too.",
  },
];

/**
 * What the current setting actually means, in one sentence under the card.
 * Pure — it takes the preferences and nothing else, so the copy can be read
 * (and changed) without chasing state around the screen.
 */
function sharingSentence(prefs: PrivacyPrefs): string {
  if (prefs.shareTyping) {
    return "It's on, which is how Huddl starts out. Switching it off changes that one line and nothing else — your messages still send, arrive and notify exactly the same.";
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

/** The ghost of a SwitchRow, for the beat before the profile lands. */
function SwitchRowSkeleton({ first }: { first: boolean }) {
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
      <Skeleton width={44} height={26} radius={radius.full} />
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
  const { prefs, loading, error, saveError, setPref, refresh } =
    usePrivacyPrefs();

  const [refreshing, setRefreshing] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  /* The switches are read from a shared cache, so a pull here is the one way
     to make this screen ask the row again. */
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void refresh().finally(() => setRefreshing(false));
  }, [refresh]);

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
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
        One signal you can switch off, and a straight account of everything
        else.
      </AppText>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
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
                    <SwitchRowSkeleton key={toggle.key} first={index === 0} />
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
            </Card>

            {loading ? null : (
              <AppText variant="caption" muted style={{ marginTop: space.room }}>
                {sharingSentence(prefs)}
              </AppText>
            )}
            {saveError ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginTop: space.snug }}
              >
                {saveError}
              </AppText>
            ) : null}
          </>
        )}

        {/* Static reassurance — it stands even when the row above didn't
            load, so it lives outside the error branch. */}
        <SectionLabel text="What campus sees" />

        <Card style={{ gap: space.close }}>
          <Fact icon="user" tint={theme.brand}>
            Your profile: your name, handle, photo, major, year, and bio. Turn
            off Public profile in Account and classmates see only your handle
            and your photo — you stay listed in the people directory either
            way.
          </Fact>
          <Fact icon="image" tint={theme.brand}>
            Your profile photo, which is served from a public link — anyone
            who has that link can open it without signing in. Removing it in
            Account deletes the file.
          </Fact>
          <Fact icon="message-square" tint={theme.brand}>
            What you post in a room, to the people in that room. A course chat
            reaches classmates who added the same course, and nobody else.
          </Fact>
          <Fact icon="clock" tint={theme.brand}>
            That you're studying, while a focus session is running — your
            name, your class and your note, to your whole campus. It leaves
            the list the moment you stand up.
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
            conversation — a rule enforced in the database, not a promise in a
            policy.
          </Fact>
          <Fact icon="book" tint={theme.accent}>
            Your grades and your notes. Huddl never connects to your
            university's systems, so there's no transcript here to leak, and
            what you write for yourself stays yours.
          </Fact>
          <Fact icon="check-circle" tint={theme.accent}>
            Whether you've read a message. Huddl has no read receipts: no
            screen tells anyone you've opened theirs.
          </Fact>
          <Fact icon="slash" tint={theme.accent}>
            Who you've blocked. They were never told, they never will be, and
            there's no way for anyone to ask.
          </Fact>
        </Card>

        <AppText variant="caption" muted style={{ marginTop: space.room }}>
          Apart from your profile photo, nothing on Huddl is reachable from
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
