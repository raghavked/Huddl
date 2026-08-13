import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Field } from "@/components/ui";
import { radius, space, type Palette } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

/* Minimal local row shape: the web app's types live outside this tsconfig. */

type LinkKind = "syllabus" | "textbook" | "office_hours" | "lecture" | "other";

type LinkRow = {
  id: string;
  kind: LinkKind;
  title: string;
  url: string;
  added_by: string | null;
  created_at: string;
  author: { display_name: string } | null;
};

const LINK_SELECT =
  "id, kind, title, url, added_by, created_at, author:profiles(display_name)";

const KINDS: LinkKind[] = [
  "syllabus",
  "textbook",
  "office_hours",
  "lecture",
  "other",
];

const KIND_LABEL: Record<LinkKind, string> = {
  syllabus: "Syllabus",
  textbook: "Textbook",
  office_hours: "Office hours",
  lecture: "Lecture",
  other: "Other",
};

const KIND_ICON: Record<LinkKind, FeatherName> = {
  syllabus: "file-text",
  textbook: "book",
  office_hours: "help-circle",
  lecture: "video",
  other: "link",
};

const KIND_ORDER: Record<LinkKind, number> = {
  syllabus: 0,
  textbook: 1,
  office_hours: 2,
  lecture: 3,
  other: 4,
};

/** Quiet chip palette: the syllabus glows ember-clay, references lean sage,
    the rest stay neutral. Same recipe as the calendar's kind chips. */
function kindColors(kind: LinkKind, theme: Palette): { bg: string; fg: string } {
  switch (kind) {
    case "syllabus":
      return { bg: theme.brandSoft, fg: theme.brandInk };
    case "textbook":
    case "lecture":
      return { bg: theme.accentSoft, fg: theme.accent };
    default:
      return { bg: theme.surface2, fg: theme.muted };
  }
}

function KindChip({ kind }: { kind: LinkKind }) {
  const theme = useTheme();
  const colors = kindColors(kind, theme);
  return (
    <View
      style={{
        paddingHorizontal: space.cosy,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: colors.bg,
      }}
    >
      <AppText
        variant="label"
        style={{ color: colors.fg, fontSize: 11, lineHeight: 14 }}
      >
        {KIND_LABEL[kind]}
      </AppText>
    </View>
  );
}

/** "https://canvas.ucdavis.edu/courses/1" -> "canvas.ucdavis.edu". */
function hostOf(url: string): string {
  const match = /^https?:\/\/([^/?#]+)/i.exec(url.trim());
  return (match?.[1] ?? "").replace(/^www\./i, "").toLowerCase();
}

/** Grouped-list order: syllabus first, then references, newest last. */
function sortLinks(rows: LinkRow[]): LinkRow[] {
  return [...rows].sort(
    (a, b) =>
      KIND_ORDER[a.kind] - KIND_ORDER[b.kind] ||
      a.created_at.localeCompare(b.created_at)
  );
}

function BackChevron({ onPress }: { onPress: () => void }) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Back"
      onPress={onPress}
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
  );
}

function CenteredState({
  icon,
  title,
  message,
  children,
}: {
  icon: FeatherName;
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.room,
        padding: space.rest,
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
        <Feather name={icon} size={22} color={theme.brand} />
      </View>
      <AppText variant="title">{title}</AppText>
      <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
        {message}
      </AppText>
      {children}
    </View>
  );
}

export default function CourseLinksScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const { courseId, courseCode } = useLocalSearchParams<{
    courseId?: string;
    courseCode?: string;
  }>();
  const id = courseId ?? "";

  const [links, setLinks] = useState<LinkRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Opening or removing a pinned link.
  const [actionError, setActionError] = useState<string | null>(null);

  // The add-a-link form.
  const [kind, setKind] = useState<LinkKind>("syllabus");
  const [title, setTitle] = useState("");
  const [url, setUrl] = useState("");
  const [titleError, setTitleError] = useState<string | null>(null);
  const [urlError, setUrlError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, [router]);

  const load = useCallback(async () => {
    if (!userId || !id) return;
    const { data, error: loadError } = await supabase
      .from("course_links")
      .select(LINK_SELECT)
      .eq("course_id", id)
      .order("created_at", { ascending: true });
    if (loadError) {
      setError("We couldn't load the links. Pull down to try again.");
      return;
    }
    setError(null);
    setLinks(sortLinks((data ?? []) as unknown as LinkRow[]));
  }, [userId, id]);

  useEffect(() => {
    if (!userId) return;
    void load().finally(() => setLoading(false));
  }, [userId, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setActionError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const handleOpen = useCallback(async (link: LinkRow) => {
    setActionError(null);
    try {
      await Linking.openURL(link.url);
    } catch {
      setActionError(
        "That link wouldn't open. It may be mistyped, so try it in your browser."
      );
    }
  }, []);

  /** Authors only: long-press a pin to take it down. Optimistic, with undo
      on failure. */
  const handleLongPress = useCallback(
    (link: LinkRow) => {
      if (!userId || link.added_by !== userId) return;
      Alert.alert(
        "Remove this link?",
        `"${link.title}" comes off the course page for everyone.`,
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              const previous = links;
              setActionError(null);
              setLinks((current) => current.filter((l) => l.id !== link.id));
              void supabase
                .from("course_links")
                .delete()
                .eq("id", link.id)
                .then(({ error: deleteError }) => {
                  if (deleteError) {
                    setLinks(previous);
                    setActionError(
                      "Couldn't remove that link just now. Give it another try."
                    );
                  }
                });
            },
          },
        ]
      );
    },
    [userId, links]
  );

  const trimmedTitle = title.trim();
  const trimmedUrl = url.trim();

  const handleAdd = useCallback(async () => {
    if (!userId || !id || adding) return;
    let bad = false;
    if (trimmedTitle.length === 0) {
      setTitleError("Give the link a short name.");
      bad = true;
    }
    if (!/^https?:\/\//i.test(trimmedUrl)) {
      setUrlError("Links start with http:// or https://");
      bad = true;
    }
    if (bad) return;
    setAddError(null);
    setAdding(true);
    const { data, error: insertError } = await supabase
      .from("course_links")
      .insert({
        course_id: id,
        added_by: userId,
        kind,
        title: trimmedTitle,
        url: trimmedUrl,
      })
      .select(LINK_SELECT)
      .single();
    setAdding(false);
    if (insertError || !data) {
      setAddError(
        insertError?.code === "42501"
          ? "Links are pinned by classmates. Add this course to your classes first."
          : "We couldn't pin that link just now. Give it another try."
      );
      return;
    }
    setLinks((current) =>
      sortLinks([...current, data as unknown as LinkRow])
    );
    setTitle("");
    setUrl("");
  }, [userId, id, adding, trimmedTitle, trimmedUrl, kind]);

  // Deep links land here directly, so a signed-out visitor gets a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  /* --------------------------- scaffold states --------------------------- */

  const scaffold = (children: React.ReactNode) => (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View style={{ paddingHorizontal: space.close }}>
        <BackChevron onPress={goBack} />
      </View>
      {children}
    </View>
  );

  if (!id) {
    return scaffold(
      <CenteredState
        icon="book-open"
        title="Course not available"
        message="We couldn't tell which course this is. Head back and try again from the course page."
      >
        <Button label="Back" variant="soft" size="sm" onPress={goBack} />
      </CenteredState>
    );
  }

  if (loading) {
    return scaffold(
      <View
        style={{
          flex: 1,
          alignItems: "center",
          justifyContent: "center",
          gap: space.close,
        }}
      >
        <ActivityIndicator size="large" color={theme.brand} />
        <AppText variant="caption" muted>
          Gathering the links…
        </AppText>
      </View>
    );
  }

  if (error && links.length === 0) {
    return scaffold(
      <CenteredState
        icon="wifi-off"
        title="Something hiccuped"
        message="We couldn't load this course's links. Check your connection and give it another go."
      >
        <Button
          label="Try again"
          variant="soft"
          size="sm"
          onPress={() => {
            setLoading(true);
            void load().finally(() => setLoading(false));
          }}
        />
      </CenteredState>
    );
  }

  /* ------------------------------ the links ------------------------------ */

  return scaffold(
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        data={links}
        keyExtractor={(link) => link.id}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={theme.brand}
            colors={[theme.brand]}
          />
        }
        ListHeaderComponent={
          <View style={{ gap: space.tight, marginBottom: space.card }}>
            <AppText variant="display">
              {courseCode ? `${courseCode} links` : "Course links"}
            </AppText>
            <AppText variant="caption" muted>
              The syllabus, the textbook, office hours: pinned by classmates,
              for classmates. Long-press one of yours to remove it.
            </AppText>
            {error ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginTop: space.tight }}
              >
                {error}
              </AppText>
            ) : null}
            {actionError ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginTop: space.tight }}
              >
                {actionError}
              </AppText>
            ) : null}
          </View>
        }
        ListEmptyComponent={
          <Card
            style={{
              alignItems: "center",
              gap: space.snug,
              paddingVertical: space.chapter,
              borderStyle: "dashed",
              marginBottom: space.room,
            }}
          >
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.full,
                backgroundColor: theme.brandSoft,
                alignItems: "center",
                justifyContent: "center",
                marginBottom: space.hair,
              }}
            >
              <Feather name="link" size={18} color={theme.brand} />
            </View>
            <AppText variant="bodySemi">No links yet</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              Pin the syllabus, the textbook, wherever office hours live. The
              class will thank you.
            </AppText>
          </Card>
        }
        renderItem={({ item }) => {
          const mine = item.added_by === userId;
          const addedBy = mine
            ? "You"
            : item.author?.display_name ?? "A classmate";
          const host = hostOf(item.url);
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.title}, added by ${addedBy}`}
              accessibilityHint={
                mine ? "Long press to remove this link" : undefined
              }
              onPress={() => void handleOpen(item)}
              onLongPress={() => handleLongPress(item)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.7 : 1,
                marginBottom: space.room,
              })}
            >
              <Card
                padded={false}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.close,
                  padding: space.close,
                  minHeight: 64,
                }}
              >
                <View
                  style={{
                    width: 40,
                    height: 40,
                    borderRadius: radius.control,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                  }}
                >
                  <Feather
                    name={KIND_ICON[item.kind]}
                    size={18}
                    color={theme.brand}
                  />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: space.tight }}>
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.snug,
                    }}
                  >
                    <AppText
                      variant="bodySemi"
                      numberOfLines={1}
                      style={{ flexShrink: 1 }}
                    >
                      {item.title}
                    </AppText>
                    <KindChip kind={item.kind} />
                  </View>
                  <AppText variant="caption" muted numberOfLines={1}>
                    {host ? `${host} · ` : ""}Added by {addedBy}
                  </AppText>
                </View>
                <Feather name="external-link" size={16} color={theme.muted} />
              </Card>
            </Pressable>
          );
        }}
        ListFooterComponent={
          <Card style={{ marginTop: space.cosy, gap: space.close }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
              }}
            >
              <Feather name="plus-circle" size={16} color={theme.brand} />
              <AppText variant="title">Add a link</AppText>
            </View>
            <AppText variant="caption" muted>
              Anything the class keeps hunting for: pin it once and it's here
              for everyone.
            </AppText>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.cosy,
              }}
            >
              {KINDS.map((option) => {
                const active = kind === option;
                return (
                  <Pressable
                    key={option}
                    accessibilityRole="button"
                    accessibilityLabel={`Mark this link as ${KIND_LABEL[option]}`}
                    accessibilityState={{ selected: active }}
                    disabled={adding}
                    onPress={() => setKind(option)}
                    hitSlop={6}
                    style={({ pressed }) => ({
                      paddingHorizontal: space.close,
                      paddingVertical: space.cosy,
                      borderRadius: radius.full,
                      borderWidth: 1,
                      borderColor: active ? theme.brand : theme.border,
                      backgroundColor: active ? theme.brandSoft : theme.surface,
                      opacity: pressed ? 0.7 : 1,
                    })}
                  >
                    <AppText
                      variant="label"
                      style={{ color: active ? theme.brandInk : theme.muted }}
                    >
                      {KIND_LABEL[option]}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            <Field
              label="Title"
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                if (titleError) setTitleError(null);
                if (addError) setAddError(null);
              }}
              placeholder="Course syllabus"
              maxLength={120}
              editable={!adding}
              error={titleError}
            />
            <Field
              label="URL"
              value={url}
              onChangeText={(text) => {
                setUrl(text);
                if (urlError) setUrlError(null);
                if (addError) setAddError(null);
              }}
              placeholder="https://canvas.ucdavis.edu/…"
              maxLength={2000}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              editable={!adding}
              error={urlError}
            />
            {addError ? (
              <AppText variant="caption" style={{ color: theme.danger }}>
                {addError}
              </AppText>
            ) : null}
            <Button
              label="Pin it for the class"
              pending={adding}
              disabled={adding || trimmedTitle.length === 0 || trimmedUrl.length === 0}
              icon={<Feather name="plus" size={16} color={theme.brandFg} />}
              onPress={() => void handleAdd()}
              style={{ alignSelf: "flex-start" }}
            />
          </Card>
        }
      />
    </KeyboardAvoidingView>
  );
}
