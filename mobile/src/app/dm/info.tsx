import Feather from "@expo/vector-icons/Feather";
import { router, useLocalSearchParams } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
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
import {
  addToGroupThread,
  fetchThread,
  fetchThreadPeople,
  GROUP_MAX_PEOPLE,
  GROUP_TITLE_MAX,
  GroupDmError,
  leaveGroupThread,
  renameGroupThread,
  threadDisplay,
  type GroupThreadRow,
  type ThreadPerson,
} from "@/lib/group-dm";
import { tapSuccess } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";
import { CampusPeoplePicker } from "./new";

/* The group's own page: who's in it, what it's called, and the two things
   only a member can do — add someone else, or slip out. A 1:1 thread has
   none of that, so it never gets to stay here. */

/** The same order fetchThreadPeople returns, so an optimistic add lands right. */
function sortPeople(people: ThreadPerson[]): ThreadPerson[] {
  return [...people].sort(
    (a, b) =>
      a.display_name.localeCompare(b.display_name) ||
      a.handle.localeCompare(b.handle)
  );
}

function MemberRow({
  person,
  isMe,
}: {
  person: ThreadPerson;
  isMe: boolean;
}) {
  const theme = useTheme();
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Open ${person.display_name}'s profile`}
      onPress={() => router.push(`/u/${person.handle}`)}
      style={({ pressed }) => ({
        opacity: pressed ? 0.85 : 1,
        marginBottom: 10,
      })}
    >
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          paddingHorizontal: 14,
          paddingVertical: 12,
          minHeight: 68,
        }}
      >
        <Avatar url={person.avatar_url} name={person.display_name} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {person.display_name}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            @{person.handle}
          </AppText>
        </View>
        {isMe ? <Chip label="You" tone="accent" /> : null}
        <Feather name="chevron-right" size={16} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

export default function GroupInfoScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const params = useLocalSearchParams<{ threadId: string }>();
  const threadId = typeof params.threadId === "string" ? params.threadId : "";

  const [thread, setThread] = useState<GroupThreadRow | null>(null);
  const [people, setPeople] = useState<ThreadPerson[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notFound, setNotFound] = useState(false);

  // Everything below is a write in flight, or the warm note left by one
  // that didn't land.
  const [rowError, setRowError] = useState<string | null>(null);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState("");
  const [renaming, setRenaming] = useState(false);
  const [adding, setAdding] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (threadId) router.replace(`/dm/${threadId}`);
    else router.replace("/(tabs)/messages");
  }, [threadId]);

  const load = useCallback(async () => {
    if (!userId || !threadId) return;
    setLoading(true);
    setError(null);
    setNotFound(false);
    try {
      const row = await fetchThread(threadId);
      // RLS hides threads you're not in, so "gone" and "not yours" look alike.
      if (!row) {
        setNotFound(true);
        return;
      }
      setThread(row);
      // A 1:1 has no group page — the guard below sends it home.
      if (!row.is_group) return;
      const roster = await fetchThreadPeople(threadId);
      setPeople(roster);
      setTitleDraft(row.title ?? "");
    } catch (err) {
      setError(
        err instanceof GroupDmError
          ? err.message
          : "We couldn't load this group right now."
      );
    } finally {
      setLoading(false);
    }
  }, [threadId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Pull-to-refresh: the roster again, without stealing the whole screen
      or touching a name you're part-way through typing. */
  const handleRefresh = useCallback(async () => {
    if (!threadId || refreshing) return;
    setRefreshing(true);
    try {
      const row = await fetchThread(threadId);
      if (!row) {
        setNotFound(true);
        return;
      }
      setThread(row);
      if (!row.is_group) return;
      setPeople(await fetchThreadPeople(threadId));
      setError(null);
    } catch {
      setRowError("We couldn't refresh the group just now.");
    } finally {
      setRefreshing(false);
    }
  }, [threadId, refreshing]);

  // 1:1 threads never reach this screen.
  const notAGroup = thread !== null && !thread.is_group;
  useEffect(() => {
    if (notAGroup) goBack();
  }, [notAGroup, goBack]);

  /* ------------------------------ rename ------------------------------ */

  const startRename = useCallback(() => {
    setRowError(null);
    setTitleDraft(thread?.title ?? "");
    setEditingTitle(true);
  }, [thread]);

  const cancelRename = useCallback(() => {
    setTitleDraft(thread?.title ?? "");
    setEditingTitle(false);
    setRowError(null);
  }, [thread]);

  const handleRename = useCallback(async () => {
    if (!thread || renaming) return;
    const next = titleDraft.trim();
    if (next === (thread.title ?? "")) {
      setEditingTitle(false);
      return;
    }
    const previous = thread.title;
    setRowError(null);
    setRenaming(true);
    // Optimistic: the new name is up before the round trip finishes.
    setThread({ ...thread, title: next });
    try {
      const saved = await renameGroupThread(thread.id, titleDraft);
      setThread((current) =>
        current ? { ...current, title: saved } : current
      );
      setEditingTitle(false);
      tapSuccess();
    } catch (err) {
      setThread((current) =>
        current ? { ...current, title: previous } : current
      );
      setTitleDraft(previous ?? "");
      setRowError(
        err instanceof GroupDmError
          ? err.message
          : "We couldn't rename the group just now. Try again."
      );
    } finally {
      setRenaming(false);
    }
  }, [thread, titleDraft, renaming]);

  /* ---------------------------- add people ---------------------------- */

  const handleAdd = useCallback(
    async (person: ThreadPerson) => {
      if (!thread || addingId) return;
      const previous = people;
      setRowError(null);
      setAddingId(person.id);
      setPeople(sortPeople([...people, person]));
      try {
        await addToGroupThread(thread.id, person.id);
        tapSuccess();
      } catch (err) {
        setPeople(previous);
        setRowError(
          err instanceof GroupDmError
            ? err.message
            : `We couldn't add ${person.display_name} just now. Try again.`
        );
      } finally {
        setAddingId(null);
      }
    },
    [thread, people, addingId]
  );

  const pickToAdd = useCallback(
    (person: ThreadPerson) => {
      void handleAdd(person);
    },
    [handleAdd]
  );

  /* ------------------------------ leaving ----------------------------- */

  const handleLeave = useCallback(async () => {
    if (!threadId || leaving) return;
    setRowError(null);
    setLeaving(true);
    try {
      await leaveGroupThread(threadId);
      router.replace("/(tabs)/messages");
    } catch (err) {
      setRowError(
        err instanceof GroupDmError
          ? err.message
          : "We couldn't leave that group just now. Try again."
      );
      setLeaving(false);
    }
  }, [threadId, leaving]);

  const confirmLeave = useCallback(() => {
    Alert.alert("Leave this group?", "You'll stop getting its messages.", [
      { text: "Stay", style: "cancel" },
      {
        text: "Leave",
        style: "destructive",
        onPress: () => void handleLeave(),
      },
    ]);
  }, [handleLeave]);

  /* ------------------------------ render ------------------------------ */

  const display = thread
    ? threadDisplay(thread, people, userId)
    : { title: "Group", subtitle: null };
  const memberIds = useMemo(
    () => new Set(people.map((person) => person.id)),
    [people]
  );
  const full = people.length >= GROUP_MAX_PEOPLE;

  const backButton = (
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
  );

  const errorNote = rowError ? (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        paddingHorizontal: 12,
        paddingVertical: 8,
        borderRadius: radius.control,
        backgroundColor: theme.surface2,
      }}
    >
      <Feather name="alert-circle" size={14} color={theme.danger} />
      <AppText variant="caption" style={{ color: theme.danger, flex: 1 }}>
        {rowError}
      </AppText>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Dismiss error"
        onPress={() => setRowError(null)}
        hitSlop={16}
      >
        <Feather name="x" size={14} color={theme.muted} />
      </Pressable>
    </View>
  ) : null;

  // "Add people" takes over the screen rather than nesting a second list
  // inside this one — the keyboard and the search box both need the room.
  if (adding && thread) {
    return (
      <KeyboardAvoidingView
        style={{ flex: 1, backgroundColor: theme.background }}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View
          style={{
            flex: 1,
            paddingTop: insets.top + space.close,
            paddingHorizontal: 20,
          }}
        >
          <View
            style={{ flexDirection: "row", alignItems: "center", gap: 6 }}
          >
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Done adding people"
              onPress={() => {
                setAdding(false);
                setRowError(null);
              }}
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
              <Feather name="x" size={22} color={theme.foreground} />
            </Pressable>
            <AppText variant="title" numberOfLines={1} style={{ flex: 1 }}>
              Add people
            </AppText>
            <Chip
              label={`${people.length} of ${GROUP_MAX_PEOPLE}`}
              tone={full ? "brand" : "neutral"}
            />
          </View>

          {errorNote ? (
            <View style={{ marginTop: 10 }}>{errorNote}</View>
          ) : null}

          <View style={{ flex: 1, marginTop: 12 }}>
            {full ? (
              <EmptyState
                icon="users"
                title="This group is full at 16"
                body="Someone has to leave before another classmate can join."
              />
            ) : (
              <CampusPeoplePicker
                label="Search your campus"
                placeholder="Name or handle"
                excludeIds={memberIds}
                onPick={pickToAdd}
                pendingId={addingId}
                autoFocus
                paddingBottom={insets.bottom + space.chapter}
                header={
                  <AppText variant="caption" muted style={{ marginBottom: 12 }}>
                    Everyone in {display.title} is on your campus — that's the
                    only rule. Tap someone to add them right away.
                  </AppText>
                }
              />
            )}
          </View>
        </View>
      </KeyboardAvoidingView>
    );
  }

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View
        style={{
          flex: 1,
          paddingTop: insets.top + space.close,
          paddingHorizontal: 20,
        }}
      >
        {backButton}

        {loading ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
              paddingBottom: 80,
            }}
          >
            <ActivityIndicator size="large" color={theme.brand} />
            <AppText variant="caption" muted>
              Opening the group…
            </AppText>
          </View>
        ) : notFound ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              paddingBottom: 80,
            }}
          >
            <Feather name="users" size={28} color={theme.muted} />
            <AppText variant="bodySemi">We couldn't find that group</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 280 }}
            >
              You may have left it, or the link didn't point anywhere. Head
              back and pick a chat from your list.
            </AppText>
            <Button
              label="Back to messages"
              variant="soft"
              size="sm"
              onPress={() => router.replace("/(tabs)/messages")}
            />
          </View>
        ) : error ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 10,
              paddingBottom: 80,
            }}
          >
            <Feather name="cloud-off" size={28} color={theme.muted} />
            <AppText variant="bodySemi">Something went sideways</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 280 }}
            >
              {error} Check your connection and give it another go.
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => void load()}
            />
          </View>
        ) : notAGroup || !thread ? (
          // The guard already fired; hold a calm frame while it lands.
          <View style={{ flex: 1 }} />
        ) : (
          <ScrollView
            style={{ flex: 1 }}
            contentContainerStyle={{
              paddingBottom: insets.bottom + space.rest,
            }}
            showsVerticalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            keyboardDismissMode="on-drag"
            refreshControl={
              <RefreshControl
                refreshing={refreshing}
                onRefresh={() => void handleRefresh()}
                tintColor={theme.brand}
                colors={[theme.brand]}
              />
            }
          >
            {editingTitle ? (
              <View style={{ gap: 10, marginTop: 2 }}>
                <Field
                  label="Group name"
                  value={titleDraft}
                  onChangeText={setTitleDraft}
                  placeholder="ECS 36A study crew"
                  maxLength={GROUP_TITLE_MAX}
                  autoFocus
                  editable={!renaming}
                />
                <View style={{ flexDirection: "row", gap: 8 }}>
                  <Button
                    label="Save name"
                    size="sm"
                    pending={renaming}
                    onPress={() => void handleRename()}
                  />
                  <Button
                    label="Cancel"
                    variant="secondary"
                    size="sm"
                    disabled={renaming}
                    onPress={cancelRename}
                  />
                </View>
              </View>
            ) : (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 8,
                  marginTop: 2,
                }}
              >
                <View style={{ flex: 1 }}>
                  <AppText variant="display" numberOfLines={2}>
                    {display.title}
                  </AppText>
                  <AppText variant="caption" muted style={{ marginTop: 4 }}>
                    {display.subtitle ?? "Group chat"} · anyone here can rename
                    it
                  </AppText>
                </View>
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Rename group"
                  onPress={startRename}
                  hitSlop={8}
                  style={({ pressed }) => ({
                    width: 44,
                    height: 44,
                    borderRadius: radius.full,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    opacity: pressed ? 0.7 : 1,
                  })}
                >
                  <Feather name="edit-2" size={17} color={theme.brandInk} />
                </Pressable>
              </View>
            )}

            {errorNote ? (
              <View style={{ marginTop: 12 }}>{errorNote}</View>
            ) : null}

            <SectionLabel text="In this group" />

            {people.length === 0 ? (
              <EmptyState
                compact
                icon="users"
                title="Nobody to show"
                body="We couldn't read the roster just now. Pull the screen open again in a moment."
              />
            ) : (
              people.map((person) => (
                <MemberRow
                  key={person.id}
                  person={person}
                  isMe={person.id === userId}
                />
              ))
            )}

            <Button
              label={full ? "This group is full" : "Add people"}
              variant="secondary"
              disabled={full}
              icon={
                <Feather name="user-plus" size={16} color={theme.foreground} />
              }
              onPress={() => {
                setRowError(null);
                setAdding(true);
              }}
              style={{ marginTop: 4 }}
            />

            <SectionLabel text="Leaving" />

            <AppText variant="caption" muted style={{ marginBottom: 10 }}>
              Everyone else keeps the chat and its history. You just stop
              hearing about it.
            </AppText>
            <Button
              label="Leave group"
              variant="danger"
              pending={leaving}
              icon={
                <Feather name="log-out" size={16} color={theme.onSolid} />
              }
              onPress={confirmLeave}
            />
          </ScrollView>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}
