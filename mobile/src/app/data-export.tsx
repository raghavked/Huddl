import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useState } from "react";
import { Pressable, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Shoebox } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  EmptyState,
  SectionLabel,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  exportedAt,
  ExportError,
  exportFileName,
  requestExport,
  saveAndShare,
  summarize,
  type DataExport,
  type PreparedExport,
  type SummaryKey,
  type SummaryLine,
} from "@/lib/data-export";
import { tapSuccess } from "@/lib/haptics";

/* Your data — everything Huddl holds that's yours, in one file you can take
   with you. The screen explains before it does anything: what's in the file,
   what stays behind, and only then a button.

   Preparing is deliberately a tap rather than something that happens on
   arrival. Gathering a semester of messages is real work for the server, and
   a student who wandered in to read the explanation shouldn't set it off. */

type Phase = "idle" | "working" | "ready" | "error";

/** One icon per countable line, so the list reads at a glance. */
const ICONS: Record<SummaryKey, keyof typeof Feather.glyphMap> = {
  messages: "message-square",
  direct_messages: "send",
  courses: "book-open",
  notes: "file-text",
  focus_sessions: "clock",
  grade_entries: "percent",
  calendar_checkoffs: "check-circle",
  board_posts: "clipboard",
  events_created: "calendar",
};

/** A line in "What's in it": an icon and a counted sentence. */
type ExportLine = {
  key: string;
  icon: keyof typeof Feather.glyphMap;
  label: string;
};

/**
 * The two safety records migration 0037 added to `export_my_data()`: who
 * you've blocked, and what you've reported. The Privacy Policy says both are
 * kept about you, so an export that lists everything else and stays quiet
 * about these two is the document contradicting itself.
 *
 * These two really belong in `LINE_SPECS` in `@/lib/data-export`, beside the
 * other nine, so the web export screen picks them up for free. They sit here
 * because the change that added them couldn't touch that file; fold them in
 * whenever you're next in there, and delete this block.
 */
const SAFETY_SPECS: readonly {
  key: string;
  field: string;
  icon: keyof typeof Feather.glyphMap;
  one: string;
  many: string;
}[] = [
  {
    key: "blocked",
    field: "blocked",
    icon: "slash",
    one: "person you've blocked",
    many: "people you've blocked",
  },
  {
    key: "reports_filed",
    field: "reports_filed",
    icon: "flag",
    one: "report you've filed",
    many: "reports you've filed",
  },
];

/**
 * Every line the "What's in it" card draws: `summarize()`'s nine, then the
 * two safety records. Empty categories are dropped on both halves, the same
 * way `summarize()` drops them — a first-week student sees the two things
 * they have, not eleven things they don't.
 */
function exportLines(lines: SummaryLine[], data: DataExport): ExportLine[] {
  const rows: ExportLine[] = lines.map((line) => ({
    key: line.key,
    icon: ICONS[line.key],
    label: line.label,
  }));
  for (const spec of SAFETY_SPECS) {
    const value = data[spec.field];
    const count = Array.isArray(value) ? value.length : 0;
    if (count < 1) continue;
    rows.push({
      key: spec.key,
      icon: spec.icon,
      label: `${count} ${count === 1 ? spec.one : spec.many}`,
    });
  }
  return rows;
}

/** "about 84 KB" — a rough, honest size for the thing they're about to take. */
function sizeLabel(json: string): string {
  const kb = json.length / 1024;
  if (kb < 1) return `${json.length} characters`;
  if (kb < 1024) return `about ${Math.round(kb)} KB`;
  return `about ${(kb / 1024).toFixed(1)} MB`;
}

/** "3:14 PM" in the student's own locale and clock. */
function timeLabel(at: Date): string {
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function SummaryRow({ line, first }: { line: ExportLine; first: boolean }) {
  const theme = useTheme();
  return (
    <View
      style={{
        minHeight: 52,
        flexDirection: "row",
        alignItems: "center",
        gap: space.close,
        paddingHorizontal: space.card,
        paddingVertical: space.room,
        borderTopWidth: first ? 0 : 1,
        borderTopColor: theme.border,
      }}
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
        <Feather name={line.icon} size={16} color={theme.brand} />
      </View>
      <AppText variant="bodySemi" style={{ flex: 1 }}>
        {line.label}
      </AppText>
    </View>
  );
}

export default function DataExportScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();

  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);
  const [lines, setLines] = useState<SummaryLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sharing, setSharing] = useState(false);
  const [shareNote, setShareNote] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/settings");
  }, []);

  const prepare = useCallback(async () => {
    setPhase("working");
    setError(null);
    setShareNote(null);
    setShowRaw(false);
    try {
      const result = await requestExport();
      setPrepared(result);
      setLines(summarize(result.data));
      setPhase("ready");
      // A completion moment, and one a student waited for.
      tapSuccess();
    } catch (err) {
      setPrepared(null);
      setLines([]);
      setError(
        err instanceof ExportError
          ? err.message
          : "We couldn't gather your data just now. Check your connection and give it another go."
      );
      setPhase("error");
    }
  }, []);

  /* Handing it over. Anything the share sheet can't do ends with the JSON on
     screen instead — there is always a way to get the data out of here. */
  const handleShare = useCallback(async () => {
    if (!prepared || sharing) return;
    setSharing(true);
    setShareNote(null);
    const at = exportedAt(prepared.data) ?? new Date();
    const outcome = await saveAndShare(prepared.json, at);
    setSharing(false);
    if (outcome === "too-large") {
      setShowRaw(true);
      setShareNote(
        "That's a lot of data to hand off in one piece, so it's down below instead — press and hold to select all of it."
      );
    } else if (outcome === "unavailable") {
      setShowRaw(true);
      setShareNote(
        "This device didn't offer anywhere to send it, so it's down below instead — press and hold to select all of it."
      );
    }
  }, [prepared, sharing]);

  const preparedAt = prepared ? exportedAt(prepared.data) : null;
  const fileName = exportFileName(preparedAt ?? new Date());
  const rows = prepared ? exportLines(lines, prepared.data) : [];

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
        Your data
      </AppText>

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
        showsVerticalScrollIndicator={false}
      >
        <AppText variant="body" muted style={{ marginTop: space.snug }}>
          This is your copy of everything Huddl holds that's yours — your
          profile, your classes, the messages and notes you've written, your
          focus sessions and grades, and the safety records: who you've
          blocked and what you've reported. Things you shared stay in the
          rooms you shared them in, and records that belong to someone else,
          including anyone who has blocked or reported you, aren't in here.
        </AppText>

        {phase === "ready" && prepared ? (
          <>
            <SectionLabel text="What's in it" />

            {rows.length > 0 ? (
              <Card padded={false}>
                {rows.map((line, index) => (
                  <SummaryRow
                    key={line.key}
                    line={line}
                    first={index === 0}
                  />
                ))}
              </Card>
            ) : (
              /* A nested empty inside a screen that already has content, so
                 it takes the small tile rather than a second illustration. */
              <EmptyState
                compact
                icon="file-text"
                title="Not much in it yet"
                body="Your profile and settings are in there, and not a lot else. The file works the same either way."
              />
            )}

            <AppText variant="caption" muted style={{ marginTop: space.room }}>
              {fileName} · {sizeLabel(prepared.json)}
              {preparedAt ? ` · prepared at ${timeLabel(preparedAt)}` : ""}
            </AppText>

            <View style={{ marginTop: space.card, gap: space.room }}>
              <Button
                label="Save or share"
                pending={sharing}
                icon={
                  <Feather name="share" size={16} color={theme.brandFg} />
                }
                onPress={() => void handleShare()}
              />
              <Button
                label={showRaw ? "Hide the raw file" : "Show the raw file"}
                variant="secondary"
                onPress={() => setShowRaw((open) => !open)}
              />
            </View>

            {shareNote ? (
              <AppText
                variant="caption"
                style={{ color: theme.warning, marginTop: space.room }}
              >
                {shareNote}
              </AppText>
            ) : null}

            {showRaw ? (
              <Card style={{ marginTop: space.close, gap: space.cosy }}>
                <AppText variant="caption" muted>
                  Press and hold to select all of it.
                </AppText>
                {/* Nested on purpose: the file can run to thousands of lines
                    and shouldn't push the closing note off the screen. */}
                <ScrollView
                  style={{ maxHeight: 300 }}
                  nestedScrollEnabled
                  showsVerticalScrollIndicator
                >
                  <AppText variant="caption" selectable>
                    {prepared.json}
                  </AppText>
                </ScrollView>
              </Card>
            ) : null}
          </>
        ) : phase === "error" ? (
          <Card
            style={{
              marginTop: space.gutter,
              alignItems: "center",
              gap: space.room,
              paddingVertical: space.chapter,
            }}
          >
            <Feather name="cloud-off" size={26} color={theme.muted} />
            <AppText variant="bodySemi">Something went sideways</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 280 }}
            >
              {error}
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => void prepare()}
            />
          </Card>
        ) : (
          <View style={{ marginTop: space.gutter, gap: space.room }}>
            {/* The box your things keep in until you ask for them back. It
                sits above the one button on the screen rather than inside an
                EmptyState — this is the primary action, not a consolation. */}
            <View style={{ alignItems: "center", paddingVertical: space.cosy }}>
              <Shoebox
                size={96}
                color={theme.muted}
                softColor={theme.surface2}
              />
            </View>
            <Button
              label={phase === "working" ? "Gathering it up" : "Prepare my data"}
              pending={phase === "working"}
              onPress={() => void prepare()}
            />
            {phase === "working" ? (
              // Honest, not reassuring: this really can take a few seconds.
              <AppText variant="caption" muted style={{ textAlign: "center" }}>
                A semester of messages takes a moment to gather. Stay here and
                it'll land.
              </AppText>
            ) : (
              <AppText variant="caption" muted style={{ textAlign: "center" }}>
                Nothing goes anywhere until you send it somewhere yourself.
              </AppText>
            )}
          </View>
        )}

        {/* The companion action, mentioned once and left alone. */}
        <AppText variant="caption" muted style={{ marginTop: space.rest }}>
          Leaving is the other half of this. Whenever you want Huddl to hold
          none of it, Delete account sits at the bottom of Settings.
        </AppText>
      </ScrollView>
    </View>
  );
}
