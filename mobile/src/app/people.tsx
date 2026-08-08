import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Pressable,
  RefreshControl,
  TextInput,
  View,
  type ListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card } from "@/components/ui";
import { fonts, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/**
 * The same shape the web /people page hands its directory. Private profiles
 * that aren't the viewer's own are stripped to handle + avatar right after
 * the fetch (mirroring the web's server-side nulling), so hidden fields never
 * reach search or render.
 */
type DirectoryPerson = {
  id: string;
  handle: string;
  display_name: string | null;
  avatar_url: string | null;
  major: string | null;
  grad_year: number | null;
  is_public: boolean;
};

type DirectoryRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  major: string | null;
  grad_year: number | null;
  is_public: boolean;
};

type MeRow = {
  university_id: string;
  university: { short_name: string } | null;
};

function matches(person: DirectoryPerson, query: string): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  // Private profiles only expose their handle, so only the handle is searchable.
  const haystack = [
    person.handle,
    person.display_name,
    person.major,
    person.grad_year ? String(person.grad_year) : null,
  ]
    .filter((v): v is string => Boolean(v))
    .map((v) => v.toLowerCase());
  return haystack.some((v) => v.includes(q));
}

/** Tiny avatar stand-in: two initials on a warm circle, tinted by name hash. */
function Initials({ name, size = 44 }: { name: string; size?: number }) {
  const theme = useTheme();
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const pair =
    hash % 2 === 0
      ? { bg: theme.brandSoft, fg: theme.brandInk }
      : { bg: theme.accentSoft, fg: theme.accent };
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
  const initials =
    `${first.charAt(0)}${last ? last.charAt(0) : first.charAt(1)}`.toUpperCase() ||
    "?";
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: pair.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText
        variant="label"
        style={{ color: pair.fg, fontSize: size * 0.36, lineHeight: size * 0.5 }}
      >
        {initials}
      </AppText>
    </View>
  );
}

function Pill({
  label,
  icon,
  bg,
  fg,
}: {
  label: string;
  icon?: keyof typeof Feather.glyphMap;
  bg: string;
  fg: string;
}) {
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 3,
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: radius.full,
        backgroundColor: bg,
      }}
    >
      {icon ? <Feather name={icon} size={10} color={fg} /> : null}
      <AppText variant="label" style={{ color: fg, fontSize: 11 }}>
        {label}
      </AppText>
    </View>
  );
}

function PersonRow({
  person,
  isMe,
}: {
  person: DirectoryPerson;
  isMe: boolean;
}) {
  const theme = useTheme();
  const limited = person.display_name === null;
  const name = person.display_name ?? person.handle;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={
        limited ? `@${person.handle}, private profile` : name
      }
      onPress={() => router.push(`/u/${person.handle}`)}
      style={({ pressed }) => ({ opacity: pressed ? 0.85 : 1, marginBottom: 10 })}
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
        <Initials name={name} size={44} />
        <View style={{ flex: 1, gap: 2 }}>
          {limited ? (
            <>
              <AppText variant="bodySemi" numberOfLines={1}>
                @{person.handle}
              </AppText>
              <View
                style={{ flexDirection: "row", alignItems: "center", gap: 4 }}
              >
                <Feather name="lock" size={11} color={theme.muted} />
                <AppText variant="caption" muted>
                  Private profile
                </AppText>
              </View>
            </>
          ) : (
            <>
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 6,
                }}
              >
                <AppText
                  variant="bodySemi"
                  numberOfLines={1}
                  style={{ flexShrink: 1 }}
                >
                  {person.display_name}
                </AppText>
                {isMe ? (
                  <Pill label="You" bg={theme.brandSoft} fg={theme.brandInk} />
                ) : null}
                {isMe && !person.is_public ? (
                  <Pill
                    label="Private"
                    icon="lock"
                    bg={theme.surface2}
                    fg={theme.muted}
                  />
                ) : null}
              </View>
              <AppText variant="caption" muted numberOfLines={1}>
                @{person.handle}
              </AppText>
              {person.major || person.grad_year ? (
                <AppText variant="caption" muted numberOfLines={1}>
                  {[
                    person.major,
                    person.grad_year ? `Class of ${person.grad_year}` : null,
                  ]
                    .filter(Boolean)
                    .join(" · ")}
                </AppText>
              ) : null}
            </>
          )}
        </View>
        <Feather name="chevron-right" size={18} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

export default function PeopleScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  const [people, setPeople] = useState<DirectoryPerson[] | null>(null);
  const [uniName, setUniName] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, []);

  const fetchDirectory = useCallback(async (): Promise<{
    people: DirectoryPerson[];
    uniName: string | null;
  }> => {
    if (!userId) throw new Error("Not signed in");

    const { data: meData, error: meError } = await supabase
      .from("profiles")
      .select("university_id, university:universities(short_name)")
      .eq("id", userId)
      .maybeSingle();
    if (meError || !meData) throw meError ?? new Error("No profile");
    const me = meData as unknown as MeRow;

    const { data, error: dirError } = await supabase
      .from("profiles")
      .select("id, handle, display_name, avatar_url, major, grad_year, is_public")
      .eq("university_id", me.university_id)
      .order("display_name", { ascending: true });
    if (dirError) throw dirError;

    // Same rule as the web /people page: private profiles that aren't mine
    // are stripped to handle + avatar before anything else touches them.
    const mapped: DirectoryPerson[] = ((data ?? []) as DirectoryRow[]).map(
      (p) =>
        p.is_public || p.id === userId
          ? p
          : {
              id: p.id,
              handle: p.handle,
              display_name: null,
              avatar_url: p.avatar_url,
              major: null,
              grad_year: null,
              is_public: false,
            }
    );

    // Full cards first (alphabetical), limited private cards after (by handle).
    mapped.sort((a, b) => {
      const aLimited = a.display_name === null;
      const bLimited = b.display_name === null;
      if (aLimited !== bLimited) return aLimited ? 1 : -1;
      return (a.display_name ?? a.handle).localeCompare(
        b.display_name ?? b.handle
      );
    });

    return { people: mapped, uniName: me.university?.short_name ?? null };
  }, [userId]);

  const run = useCallback(
    async (mode: "initial" | "refresh") => {
      if (mode === "initial") setLoading(true);
      if (mode === "refresh") setRefreshing(true);
      try {
        const result = await fetchDirectory();
        setPeople(result.people);
        setUniName(result.uniName);
        setError(null);
      } catch {
        setError("We couldn't load the directory right now.");
      } finally {
        if (mode === "initial") setLoading(false);
        if (mode === "refresh") setRefreshing(false);
      }
    },
    [fetchDirectory]
  );

  useEffect(() => {
    if (!userId) return;
    void run("initial");
  }, [userId, run]);

  const filtered = useMemo(
    () => (people ?? []).filter((p) => matches(p, query)),
    [people, query]
  );
  const searching = query.trim().length > 0;
  const count = people?.length ?? 0;

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<DirectoryPerson>) => (
      <PersonRow person={item} isMe={item.id === userId} />
    ),
    [userId]
  );

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
        paddingHorizontal: 20,
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

      <AppText variant="display" style={{ marginTop: 2 }}>
        People
      </AppText>
      <AppText variant="caption" muted style={{ marginTop: 4, marginBottom: 12 }}>
        {people && uniName
          ? `${count} ${count === 1 ? "student" : "students"} at ${uniName} — find classmates to trade notes or study with.`
          : "Find classmates to trade notes or study with."}
      </AppText>

      <View style={{ justifyContent: "center" }}>
        <Feather
          name="search"
          size={16}
          color={theme.muted}
          style={{ position: "absolute", left: 14, zIndex: 1 }}
        />
        <TextInput
          value={query}
          onChangeText={setQuery}
          placeholder="Search by name, handle or major"
          placeholderTextColor={theme.muted + "b3"}
          accessibilityLabel="Search people by name, handle or major"
          autoCapitalize="none"
          autoCorrect={false}
          cursorColor={theme.brand}
          selectionColor={theme.brandSoft}
          style={{
            height: 44,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: radius.full,
            backgroundColor: theme.surface,
            paddingLeft: 40,
            paddingRight: 44,
            fontFamily: fonts.body,
            fontSize: 15,
            color: theme.foreground,
          }}
        />
        {query.length > 0 ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Clear search"
            onPress={() => setQuery("")}
            style={({ pressed }) => ({
              position: "absolute",
              right: 0,
              width: 44,
              height: 44,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="x" size={16} color={theme.muted} />
          </Pressable>
        ) : null}
      </View>

      <AppText
        variant="caption"
        muted
        style={{ minHeight: 16, marginTop: 8, marginBottom: 8 }}
      >
        {searching
          ? `${filtered.length} ${filtered.length === 1 ? "match" : "matches"}`
          : ""}
      </AppText>

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
            Finding your classmates…
          </AppText>
        </View>
      ) : error && people === null ? (
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
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            {error} Check your connection and give it another go.
          </AppText>
          <Button
            label="Try again"
            variant="soft"
            size="sm"
            onPress={() => void run("initial")}
          />
        </View>
      ) : (
        <FlatList
          data={filtered}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          style={{ flex: 1 }}
          contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
          showsVerticalScrollIndicator={false}
          keyboardDismissMode="on-drag"
          keyboardShouldPersistTaps="handled"
          ListHeaderComponent={
            error ? (
              <AppText
                variant="caption"
                style={{ color: theme.danger, marginBottom: 10 }}
              >
                We couldn't refresh just now — pull down to try again.
              </AppText>
            ) : null
          }
          ListEmptyComponent={
            count === 0 ? (
              <Card
                style={{
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 28,
                  borderStyle: "dashed",
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.full,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 2,
                  }}
                >
                  <Feather name="users" size={20} color={theme.brand} />
                </View>
                <AppText variant="bodySemi">No one here yet</AppText>
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center", maxWidth: 280 }}
                >
                  As classmates join with their school email, they'll show up
                  here automatically.
                </AppText>
              </Card>
            ) : (
              <Card
                style={{
                  alignItems: "center",
                  gap: 6,
                  paddingVertical: 28,
                  borderStyle: "dashed",
                }}
              >
                <View
                  style={{
                    width: 44,
                    height: 44,
                    borderRadius: radius.full,
                    backgroundColor: theme.brandSoft,
                    alignItems: "center",
                    justifyContent: "center",
                    marginBottom: 2,
                  }}
                >
                  <Feather name="search" size={20} color={theme.brand} />
                </View>
                <AppText variant="bodySemi">No matches</AppText>
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center", maxWidth: 280 }}
                >
                  No one matches "{query.trim()}". Try a different name, handle
                  or major.
                </AppText>
                <Button
                  label="Clear search"
                  variant="soft"
                  size="sm"
                  onPress={() => setQuery("")}
                />
              </Card>
            )
          }
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => void run("refresh")}
              tintColor={theme.brand}
              colors={[theme.brand]}
            />
          }
        />
      )}
    </View>
  );
}
