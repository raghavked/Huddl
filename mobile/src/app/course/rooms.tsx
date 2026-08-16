import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useState, type ComponentProps } from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { RoomTile } from "@/components/room-tile";
import { AppText, Button, Card, Field } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { roomTitle } from "@/lib/room-identity";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

/** Minimal local row shape; the web app's types live outside this tsconfig. */
type RoomRow = {
  id: string;
  name: string;
  slug: string;
  is_main: boolean;
};

/** Names classmates reach for first. A tap prefills the field below. */
const SUGGESTIONS = ["Lectures", "Discussion", "Study group", "Notes swap"];

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

export default function CourseRoomsScreen() {
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

  const [rooms, setRooms] = useState<RoomRow[]>([]);
  const [joined, setJoined] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Joining an existing room (per-row pending).
  const [joiningId, setJoiningId] = useState<string | null>(null);
  const [joinError, setJoinError] = useState<string | null>(null);

  // The new-room form.
  const [name, setName] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/channels");
  }, [router]);

  const load = useCallback(async () => {
    if (!userId || !id) return;
    const [roomsRes, mineRes] = await Promise.all([
      supabase
        .from("channels")
        .select("id, name, slug, is_main")
        .eq("course_id", id)
        .order("is_main", { ascending: false })
        .order("name", { ascending: true }),
      supabase.from("channel_members").select("channel_id").eq("user_id", userId),
    ]);
    if (roomsRes.error || mineRes.error) {
      setError("We couldn't load the rooms. Pull down to try again.");
      return;
    }
    setError(null);
    setRooms((roomsRes.data ?? []) as unknown as RoomRow[]);
    setJoined(
      new Set(
        ((mineRes.data ?? []) as { channel_id: string }[]).map(
          (row) => row.channel_id
        )
      )
    );
  }, [userId, id]);

  useEffect(() => {
    if (!userId) return;
    void load().finally(() => setLoading(false));
  }, [userId, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /** Standard membership insert; the university-scoped policy allows it. */
  const handleJoin = useCallback(
    async (room: RoomRow) => {
      if (!userId || joiningId) return;
      setJoinError(null);
      setJoiningId(room.id);
      const { error: insertError } = await supabase
        .from("channel_members")
        .insert({ channel_id: room.id, user_id: userId });
      setJoiningId(null);
      // 23505 means we're already in, so treat it as a win and head on through.
      if (insertError && insertError.code !== "23505") {
        setJoinError("Couldn't join that room just now. Give it another try.");
        return;
      }
      setJoined((prev) => new Set(prev).add(room.id));
      router.push(`/channel/${room.id}`);
    },
    [userId, joiningId, router]
  );

  const trimmedName = name.trim();

  const handleCreate = useCallback(async () => {
    if (!userId || !id || creating) return;
    const roomName = name.trim();
    if (roomName.length < 2 || roomName.length > 40) {
      setCreateError("Room names run 2–40 characters.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    const { data, error: rpcError } = await supabase.rpc("create_course_room", {
      p_course_id: id,
      p_name: roomName,
    });
    setCreating(false);
    const newId = typeof data === "string" ? data : null;
    if (rpcError || !newId) {
      const message = rpcError?.message ?? "";
      setCreateError(
        message.includes("join the course")
          ? "Rooms are for classmates. Add this course to your classes first."
          : rpcError?.code === "23505"
            ? "Looks like that room already exists. It should be in the list above."
            : "We couldn't create that room just now. Give it another try."
      );
      return;
    }
    setName("");
    void load(); // so the new room is listed when they come back
    router.push(`/channel/${newId}`);
  }, [userId, id, creating, name, load, router]);

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
        message="We couldn't tell which course this is. Head back and try again from your channels."
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
          Opening the rooms…
        </AppText>
      </View>
    );
  }

  if (error && rooms.length === 0) {
    return scaffold(
      <CenteredState
        icon="wifi-off"
        title="Something hiccuped"
        message="We couldn't load this course's rooms. Check your connection and give it another go."
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

  /* ------------------------------ the rooms ------------------------------ */

  return scaffold(
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        data={rooms}
        keyExtractor={(room) => room.id}
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
              {courseCode ? `${courseCode} rooms` : "Course rooms"}
            </AppText>
            <AppText variant="caption" muted>
              One main chat for the whole class, plus side rooms for everything
              else.
            </AppText>
            {error ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginTop: space.tight }}
              >
                {error}
              </AppText>
            ) : null}
            {joinError ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginTop: space.tight }}
              >
                {joinError}
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
              <Feather name="home" size={18} color={theme.brand} />
            </View>
            <AppText variant="bodySemi">No rooms yet</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              The course chat opens up as classmates add this class. Or start a
              room below.
            </AppText>
          </Card>
        }
        renderItem={({ item, index }) => {
          const isJoined = joined.has(item.id);
          const joining = joiningId === item.id;
          const title = item.is_main
            ? "Course chat"
            : roomTitle(item.name, item.slug);
          const row = (
            <Card
              padded={false}
              entrance={index}
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.close,
                paddingHorizontal: space.card,
                paddingVertical: space.close,
                minHeight: 60,
              }}
            >
              <RoomTile
                kind="course"
                name={item.name}
                slug={item.slug}
                size={32}
              />
              <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                <AppText variant="bodySemi" numberOfLines={1}>
                  {title}
                </AppText>
                {item.is_main ? (
                  <AppText variant="caption" muted numberOfLines={1}>
                    Where the whole class lands
                  </AppText>
                ) : null}
              </View>
              {isJoined ? (
                <Feather name="chevron-right" size={16} color={theme.muted} />
              ) : (
                <Button
                  label="Join"
                  variant="soft"
                  size="sm"
                  pending={joining}
                  disabled={joiningId !== null}
                  accessibilityLabel={`Join ${title}`}
                  onPress={() => void handleJoin(item)}
                />
              )}
            </Card>
          );
          if (!isJoined) {
            return <View style={{ marginBottom: space.room }}>{row}</View>;
          }
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${title}`}
              onPress={() => router.push(`/channel/${item.id}`)}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
                marginBottom: space.room,
              })}
            >
              {row}
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
              <AppText variant="title">New room</AppText>
            </View>
            <AppText variant="caption" muted>
              Side rooms keep the main chat tidy: one for lectures, one for
              your study group, whatever helps.
            </AppText>
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.cosy,
              }}
            >
              {SUGGESTIONS.map((suggestion) => {
                const active = name === suggestion;
                return (
                  <Pressable
                    key={suggestion}
                    accessibilityRole="button"
                    accessibilityLabel={`Use ${suggestion} as the room name`}
                    disabled={creating}
                    onPress={() => {
                      setName(suggestion);
                      setCreateError(null);
                    }}
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
                      {suggestion}
                    </AppText>
                  </Pressable>
                );
              })}
            </View>
            <Field
              label="Room name"
              value={name}
              onChangeText={(text) => {
                setName(text);
                if (createError) setCreateError(null);
              }}
              placeholder="Study group"
              maxLength={40}
              editable={!creating}
              error={createError}
            />
            <Button
              label="Create room"
              pending={creating}
              disabled={creating || trimmedName.length < 2}
              icon={<Feather name="plus" size={16} color={theme.brandFg} />}
              onPress={() => void handleCreate()}
              style={{ alignSelf: "flex-start" }}
            />
          </Card>
        }
      />
    </KeyboardAvoidingView>
  );
}
