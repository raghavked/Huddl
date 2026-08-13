import Feather from "@expo/vector-icons/Feather";
import {
  Redirect,
  useFocusEffect,
  useLocalSearchParams,
  useRouter,
} from "expo-router";
import { useCallback, useEffect, useState } from "react";
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { Doorway } from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  SectionLabel,
  Skeleton,
  SkeletonRow,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import { tapSuccess } from "@/lib/haptics";
import {
  BUDDY_NOTE_MAX,
  StudyBuddyError,
  buddyDetail,
  fetchBuddies,
  fetchMyOptIn,
  optIn,
  optOut,
  type MyOptIn,
  type StudyBuddy,
} from "@/lib/study-buddy";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Study partners: one course's who's-looking list.
 *
 * Two halves, stacked. Up top is the student's own state: an invitation to
 * put their name up, or, once they have, a fern-toned card holding the note
 * their classmates can read, with a way to change it and a way to step out.
 * Below is everyone else, newest first, their own row lifted to the top by
 * `@/lib/study-buddy`.
 *
 * Every write here is optimistic. Opting in adds the row and flips the card
 * before the round trip; opting out takes it away instantly, which is what
 * the privacy line at the bottom promises. A refusal puts everything back
 * exactly as it was and explains itself in one warm line.
 */

/** Just enough of my own profile to draw my row before the refetch lands. */
type MyProfile = {
  handle: string;
  display_name: string;
  avatar_url: string | null;
  major: string | null;
  grad_year: number | null;
};

/** The number of characters left before the counter is worth showing. */
const COUNTER_FROM = 40;

/* ------------------------------ small parts ----------------------------- */

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
        marginLeft: -10,
        alignItems: "center",
        justifyContent: "center",
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <Feather name="chevron-left" size={26} color={theme.foreground} />
    </Pressable>
  );
}

/** One warm line of red under a card or a form. */
function InlineError({ message }: { message: string | null }) {
  const theme = useTheme();
  if (!message) return null;
  return (
    <AppText variant="caption" style={{ color: theme.danger }}>
      {message}
    </AppText>
  );
}

/**
 * The closing promise, stated plainly once. Fern-soft rather than ember,
 * because this is reassurance about a mechanism, not a warning.
 */
function PrivacyLine() {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.room,
        padding: space.close,
        borderRadius: radius.control,
        backgroundColor: theme.accentSoft,
        marginTop: space.chapter,
      }}
    >
      <Feather
        name="lock"
        size={14}
        color={theme.accent}
        style={{ marginTop: space.hair }}
      />
      <AppText variant="caption" style={{ flex: 1, lineHeight: 17 }}>
        Only people in this class can see this list, and stepping out removes
        you instantly.
      </AppText>
    </View>
  );
}

/**
 * One classmate: who they are, how they like to study, and the way to say
 * hello. My own row carries a "You" chip instead of a button, so I can see
 * exactly what my classmates see.
 *
 * A classmate with a private profile arrives already stripped by
 * `@/lib/study-buddy`: handle, avatar, and their note, nothing else. Their
 * row says so with a lock, the same as the new-message picker, so it reads as
 * a choice they made rather than a blank they forgot to fill.
 */
function BuddyRow({
  buddy,
  messaging,
  disabled,
  errorText,
  onMessage,
  onOpenProfile,
}: {
  buddy: StudyBuddy;
  messaging: boolean;
  disabled: boolean;
  errorText: string | null;
  onMessage: () => void;
  onOpenProfile: () => void;
}) {
  const theme = useTheme();
  const detail = buddyDetail(buddy);
  const shownName = buddy.locked ? `@${buddy.handle}` : buddy.display_name;

  return (
    <Card
      padded={false}
      style={{ padding: space.card, gap: space.room, marginBottom: space.room }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.close }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${shownName}'s profile`}
          onPress={onOpenProfile}
          style={({ pressed }) => ({
            flex: 1,
            minWidth: 0,
            minHeight: 44,
            flexDirection: "row",
            alignItems: "center",
            gap: space.close,
            opacity: pressed ? 0.7 : 1,
          })}
        >
          <Avatar url={buddy.avatar_url} name={buddy.display_name} size={44} />
          <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
            <AppText variant="bodySemi" numberOfLines={1}>
              {shownName}
            </AppText>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.tight,
              }}
            >
              {buddy.locked ? (
                <Feather name="lock" size={11} color={theme.muted} />
              ) : null}
              <AppText variant="caption" muted numberOfLines={1}>
                {buddy.locked
                  ? "Private profile"
                  : (detail ?? `@${buddy.handle}`)}
              </AppText>
            </View>
          </View>
        </Pressable>

        {buddy.is_me ? (
          <Chip label="You" tone="brand" size="sm" />
        ) : (
          <Button
            label="Message"
            variant="soft"
            size="sm"
            pending={messaging}
            disabled={disabled}
            accessibilityLabel={`Message ${shownName}`}
            onPress={onMessage}
            icon={
              <Feather name="message-circle" size={14} color={theme.brandInk} />
            }
          />
        )}
      </View>

      {buddy.note ? <AppText>{buddy.note}</AppText> : null}
      <InlineError message={errorText} />
    </Card>
  );
}

/* -------------------------------- helpers ------------------------------- */

/** A `StudyBuddyError` already reads like a person wrote it; nothing else does. */
function messageFor(caught: unknown, fallback: string): string {
  return caught instanceof StudyBuddyError ? caught.message : fallback;
}

/* -------------------------------- screen -------------------------------- */

export default function StudyBuddiesScreen() {
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
  const courseLabel = courseCode ?? "this class";

  const [buddies, setBuddies] = useState<StudyBuddy[]>([]);
  const [mine, setMine] = useState<MyOptIn | null>(null);
  const [myProfile, setMyProfile] = useState<MyProfile | null>(null);
  /**
   * Am I in this class? Null until the check lands, and null again if it
   * can't be read. Only a definitive `false` closes the door, so a flaky
   * connection never locks a classmate out of their own list.
   */
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // The note composer. `editing` only matters once I'm already on the list.
  // Before that the composer is the invitation itself.
  const [noteDraft, setNoteDraft] = useState("");
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const [messagingId, setMessagingId] = useState<string | null>(null);
  const [messageError, setMessageError] = useState<{
    userId: string;
    text: string;
  } | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (id) router.replace(`/course/${id}`);
    else router.replace("/(tabs)/home");
  }, [router, id]);

  const load = useCallback(async () => {
    if (!userId || !id) return;
    // Fired alongside the list: my own name and major, so an optimistic row
    // can be drawn complete instead of waiting on a refetch.
    const profilePromise = supabase
      .from("profiles")
      .select("handle, display_name, avatar_url, major, grad_year")
      .eq("id", userId)
      .maybeSingle();

    /* The gate, same as the web page's: this list is classmates only. RLS
       already refuses the write and hands back an empty read, but an empty
       read renders as "nobody has raised a hand yet", which may simply be
       untrue, above a button the server will turn down. One cheap lookup
       buys an honest screen. */
    const enrollmentPromise = supabase
      .from("enrollments")
      .select("id")
      .eq("course_id", id)
      .eq("user_id", userId)
      .maybeSingle();

    try {
      const [list, optin] = await Promise.all([
        fetchBuddies(id),
        fetchMyOptIn(id),
      ]);
      setBuddies(list);
      setMine(optin);
      setError(null);
    } catch (caught) {
      setError(
        messageFor(
          caught,
          "We couldn't load who's looking for a study partner. Give it another go."
        )
      );
    }

    const { data } = await profilePromise;
    const row = data as unknown as MyProfile | null;
    if (row) setMyProfile(row);

    const enrollmentRes = await enrollmentPromise;
    setEnrolled(enrollmentRes.error ? null : enrollmentRes.data !== null);
  }, [userId, id]);

  useEffect(() => {
    if (!userId || !id) return;
    void load().finally(() => setLoading(false));
  }, [userId, id, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /* Somebody you blocked doesn't get to hand you a note. Their row carries
     free text straight to you, which is the least defensible place for the
     block list's promise to go unkept. Refreshed on focus so a block made
     from their profile takes hold on the way back. */
  const { blocked, refresh: refreshBlocked } = useBlockedIds();
  useFocusEffect(
    useCallback(() => {
      void refreshBlocked();
    }, [refreshBlocked])
  );

  /** My row as classmates would see it, for the optimistic insert. */
  const buildMyRow = useCallback(
    (note: string | null, createdAt: string): StudyBuddy | null => {
      if (!userId || !myProfile) return null;
      return {
        user_id: userId,
        course_id: id,
        note,
        created_at: createdAt,
        handle: myProfile.handle,
        display_name: myProfile.display_name,
        avatar_url: myProfile.avatar_url,
        major: myProfile.major,
        grad_year: myProfile.grad_year,
        // You always see yourself in full, however your profile is set.
        locked: false,
        is_me: true,
      };
    },
    [userId, myProfile, id]
  );

  /**
   * Put my name up, or save an edited note: the same upsert either way.
   * The card flips and the row lands before the request goes out; a refusal
   * puts both back and reopens the composer with the text still in it.
   */
  const handleSave = useCallback(async () => {
    if (!userId || !id || saving) return;
    const trimmed = noteDraft.trim();
    if (trimmed.length > BUDDY_NOTE_MAX) {
      setActionError(
        `Keep your note to ${BUDDY_NOTE_MAX} characters. Say when you study and where.`
      );
      return;
    }

    const wasListed = mine !== null;
    const previousMine = mine;
    const previousBuddies = buddies;
    const note = trimmed.length > 0 ? trimmed : null;
    const createdAt = previousMine?.created_at ?? new Date().toISOString();
    const row = buildMyRow(note, createdAt);

    setActionError(null);
    setSaving(true);
    setEditing(false);
    setMine({ course_id: id, note, created_at: createdAt });
    if (row) setBuddies([row, ...previousBuddies.filter((b) => !b.is_me)]);

    try {
      const saved = await optIn(id, note);
      setMine(saved);
      setNoteDraft("");
      // A completion moment: my name is up where my classmates can see it.
      if (!wasListed) tapSuccess();
      // No local profile to draw with, so let the server tell us how it looks.
      if (!row) void load();
    } catch (caught) {
      setMine(previousMine);
      setBuddies(previousBuddies);
      setEditing(true);
      setActionError(
        messageFor(
          caught,
          "We couldn't add you to that list just now. Give it another go."
        )
      );
    } finally {
      setSaving(false);
    }
  }, [userId, id, saving, noteDraft, mine, buddies, buildMyRow, load]);

  /** Take my name back down. The row leaves first, as the privacy line says. */
  const handleOptOut = useCallback(async () => {
    if (!userId || !id || saving) return;
    const previousMine = mine;
    const previousBuddies = buddies;

    setActionError(null);
    setSaving(true);
    setEditing(false);
    setMine(null);
    setBuddies(previousBuddies.filter((b) => !b.is_me));

    try {
      await optOut(id);
      setNoteDraft("");
    } catch (caught) {
      setMine(previousMine);
      setBuddies(previousBuddies);
      setActionError(
        messageFor(
          caught,
          "We couldn't take your name down just now. Give it another go."
        )
      );
    } finally {
      setSaving(false);
    }
  }, [userId, id, saving, mine, buddies]);

  /**
   * Open the 1:1 thread with a classmate. `create_dm_thread` is find-or-create
   * on the server (and since 0028 it skips group threads), so one call covers
   * both "we've talked before" and "we haven't".
   *
   * Every failure reads the same on purpose. The server also refuses across a
   * block, and a block is one-way and private. A message that said "you two
   * can't message each other" would only ever be read by the person who got
   * blocked, which tells them exactly what they were never meant to learn.
   */
  const handleMessage = useCallback(
    async (buddy: StudyBuddy) => {
      if (messagingId) return;
      setMessageError(null);
      setMessagingId(buddy.user_id);
      try {
        const { data, error: rpcError } = await supabase.rpc(
          "create_dm_thread",
          { other_user: buddy.user_id }
        );
        const threadId = typeof data === "string" ? data : null;
        if (rpcError || !threadId) throw rpcError ?? new Error("No thread");
        router.push(`/dm/${threadId}`);
      } catch {
        setMessageError({
          userId: buddy.user_id,
          text: "We couldn't open that conversation. Give it another go.",
        });
      } finally {
        setMessagingId(null);
      }
    },
    [messagingId, router]
  );

  /* ------------------------------ scaffold ------------------------------ */

  // A deep link can land here signed out, so send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const scaffold = (children: React.ReactNode) => (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View style={{ paddingHorizontal: space.gutter }}>
        <BackChevron onPress={goBack} />
      </View>
      {children}
    </View>
  );

  const header = (
    <View style={{ marginBottom: space.gutter }}>
      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: space.room,
          flexWrap: "wrap",
        }}
      >
        <AppText variant="display">Study partners</AppText>
        {courseCode ? (
          <Chip
            label={courseCode}
            tone="brand"
            size="md"
            style={{ marginBottom: space.tight }}
          />
        ) : null}
      </View>
      <AppText
        variant="caption"
        muted
        style={{ marginTop: space.snug, lineHeight: 17 }}
      >
        Classmates in {courseLabel} who are up for working through it together.
      </AppText>
    </View>
  );

  if (!id) {
    return scaffold(
      <View
        style={{ paddingHorizontal: space.gutter, paddingTop: space.close }}
      >
        <AppText variant="display">Study partners</AppText>
        <View style={{ marginTop: space.card }}>
          <EmptyState
            icon="book-open"
            title="We lost track of the class"
            body="We couldn't tell which course this is. Head back and open it from the course page."
            action={{ label: "Go back", onPress: goBack }}
          />
        </View>
      </View>
    );
  }

  if (loading) {
    return scaffold(
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
      >
        {header}
        <Card style={{ gap: space.close }}>
          <Skeleton width="80%" height={18} radius={radius.full} />
          <Skeleton width="60%" height={11} radius={radius.full} />
          <Skeleton width="100%" height={72} />
        </Card>
        <SectionLabel text="Who's looking" />
        {[0, 1].map((index) => (
          <SkeletonRow key={index} />
        ))}
      </ScrollView>
    );
  }

  /* Not in the class. Say so plainly rather than showing an empty list that
     would read as "nobody's looking". We genuinely can't see the list, and
     the course page is where the class gets added. */
  if (enrolled === false) {
    return scaffold(
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
      >
        {header}
        <EmptyState
          illustration={Doorway}
          title="This list is for people in the class"
          body={`Add ${courseLabel} to your courses and you'll see who's looking, and you can put your name up too.`}
          action={{
            label: "Open the class",
            onPress: () => router.replace(`/course/${id}`),
          }}
        />
      </ScrollView>
    );
  }

  if (error && buddies.length === 0 && mine === null) {
    return scaffold(
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
      >
        {header}
        <EmptyState
          icon="cloud-off"
          title="Something hiccuped"
          body={`${error} Check your connection and give it another go.`}
          action={{
            label: "Try again",
            onPress: () => {
              setLoading(true);
              void load().finally(() => setLoading(false));
            },
          }}
        />
      </ScrollView>
    );
  }

  /* ------------------------------- content ------------------------------ */

  const remaining = BUDDY_NOTE_MAX - noteDraft.length;
  const listed = buddies.filter(
    (buddy) => buddy.is_me || !blocked.has(buddy.user_id)
  );
  const others = listed.filter((buddy) => !buddy.is_me);
  const composerOpen = mine === null || editing;

  /* The composer: the invitation when I'm not on the list, and the same
     field again when I'm editing the note that's already up there. */
  const composer = (
    <View style={{ gap: space.close }}>
      <Field
        label="How you like to study (optional)"
        value={noteDraft}
        onChangeText={(text) => {
          setNoteDraft(text);
          if (actionError) setActionError(null);
        }}
        placeholder="Weeknights at the library, mostly problem sets"
        maxLength={BUDDY_NOTE_MAX}
        multiline
        editable={!saving}
        style={{ minHeight: 76, textAlignVertical: "top" }}
      />
      {remaining <= COUNTER_FROM ? (
        <AppText variant="caption" muted style={{ alignSelf: "flex-end" }}>
          {remaining} character{remaining === 1 ? "" : "s"} left
        </AppText>
      ) : null}
      <InlineError message={actionError} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.room }}>
        <Button
          label={mine === null ? "I am looking" : "Save note"}
          pending={saving}
          onPress={() => void handleSave()}
          icon={
            <Feather
              name={mine === null ? "user-plus" : "check"}
              size={16}
              color={theme.brandFg}
            />
          }
        />
        {mine === null ? null : (
          <Button
            label="Cancel"
            variant="secondary"
            disabled={saving}
            onPress={() => {
              setEditing(false);
              setNoteDraft("");
              setActionError(null);
            }}
          />
        )}
      </View>
    </View>
  );

  /* Writing keeps the plain paper card. A tinted surface can't carry muted
     helper text, and the fern is for the settled state, not the draft. */
  const myStateCard = composerOpen ? (
    <Card style={{ gap: space.close }}>
      <AppText variant="title">
        {mine === null
          ? "Looking for someone to work through this with?"
          : "Your note"}
      </AppText>
      <AppText variant="caption" muted style={{ lineHeight: 17 }}>
        {mine === null
          ? `Put your name up and everyone in ${courseLabel} sees it here. Take it down whenever you like.`
          : "Say when you study and where. That gets more replies than a friendly hello."}
      </AppText>
      {composer}
    </Card>
  ) : (
    <Card
      style={{
        gap: space.close,
        backgroundColor: theme.accentSoft,
        borderColor: theme.accent + "40",
      }}
    >
      <View
        style={{ flexDirection: "row", alignItems: "center", gap: space.cosy }}
      >
        <Feather name="check-circle" size={16} color={theme.accent} />
        <AppText variant="title">You're on the list</AppText>
      </View>

      {mine?.note ? (
        <AppText style={{ lineHeight: 21 }}>{mine.note}</AppText>
      ) : (
        <AppText style={{ color: theme.accent }}>
          You didn't leave a note. Classmates will just see your name.
        </AppText>
      )}
      <InlineError message={actionError} />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.room }}>
        <Button
          label="Edit note"
          variant="secondary"
          size="sm"
          disabled={saving}
          onPress={() => {
            setActionError(null);
            setNoteDraft(mine?.note ?? "");
            setEditing(true);
          }}
          icon={<Feather name="edit-2" size={14} color={theme.foreground} />}
        />
        <Button
          label="Never mind"
          variant="secondary"
          size="sm"
          pending={saving}
          onPress={() => void handleOptOut()}
          icon={<Feather name="x" size={14} color={theme.foreground} />}
        />
      </View>
    </Card>
  );

  return scaffold(
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + 40,
        }}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
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
        {header}

        {error ? (
          <View style={{ marginBottom: space.close }}>
            <InlineError message={error} />
          </View>
        ) : null}

        {myStateCard}

        <SectionLabel text="Who's looking" />

        {listed.map((buddy) => (
          <BuddyRow
            key={buddy.user_id}
            buddy={buddy}
            messaging={messagingId === buddy.user_id}
            disabled={messagingId !== null && messagingId !== buddy.user_id}
            errorText={
              messageError?.userId === buddy.user_id ? messageError.text : null
            }
            onMessage={() => void handleMessage(buddy)}
            onOpenProfile={() => router.push(`/u/${buddy.handle}`)}
          />
        ))}

        {others.length === 0 ? (
          <EmptyState
            illustration={Doorway}
            compact={mine !== null}
            title={
              mine === null
                ? "Nobody has raised a hand yet"
                : "You're the first one up"
            }
            body={
              mine === null
                ? "Be first, and your classmates will see you here."
                : `Your name is up. The next person in ${courseLabel} who comes looking will find you.`
            }
          />
        ) : null}

        <PrivacyLine />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}
