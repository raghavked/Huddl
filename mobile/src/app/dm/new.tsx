import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  View,
  type ListRenderItemInfo,
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
import { radius } from "@/constants/theme";
import { useBlockedIds } from "@/hooks/use-blocked";
import { useTheme } from "@/hooks/use-theme";
import {
  createGroupThread,
  GROUP_MAX_PEOPLE,
  GROUP_MIN_PEOPLE,
  GROUP_TITLE_MAX,
  GroupDmError,
  type ThreadPerson,
} from "@/lib/group-dm";
import { tapSuccess } from "@/lib/haptics";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Start a group: name it, pick your people, and everyone lands in the same
   chat. The roster picker below is shared with /dm/info's "Add people" —
   it lives here (rather than in components/) because the two screens are
   the only callers and app/ files can't hold a non-route module. */

const DEBOUNCE_MS = 300;
const RESULT_LIMIT = 30;

/** Shared empty set so the picker's optional props keep a stable identity. */
const NO_IDS: ReadonlySet<string> = new Set<string>();

/* -------------------------------- escaping -------------------------------- */

/** Literal `%`, `_`, and `\` in the query shouldn't act as ilike wildcards. */
function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

/**
 * An `or=` filter matching any of `columns`. The pattern rides inside a
 * double-quoted PostgREST string (backslashes and quotes escaped) so
 * free-typed commas, parens, and quotes can't break the filter syntax.
 * Same idiom as the campus search screen.
 */
function orIlike(columns: string[], raw: string): string {
  const quoted = `%${escapeLike(raw)}%`
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"');
  return columns.map((column) => `${column}.ilike."${quoted}"`).join(",");
}

/** "Maya Ortiz" -> "Maya", for chips and previews. */
function firstNameOf(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/* --------------------------- the campus picker ---------------------------- */

type CandidateRow = {
  id: string;
  handle: string;
  display_name: string;
  avatar_url: string | null;
  is_public: boolean;
};

/** A classmate as the picker shows them — private profiles keep their name back. */
type Candidate = ThreadPerson & { locked: boolean };

function PickerRow({
  person,
  selected,
  pending,
  disabled,
  onPress,
}: {
  person: Candidate;
  selected: boolean;
  pending: boolean;
  disabled: boolean;
  onPress: () => void;
}) {
  const theme = useTheme();
  const shownName = person.locked ? `@${person.handle}` : person.display_name;
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected, disabled: disabled || pending }}
      accessibilityLabel={
        selected ? `Remove ${shownName}` : `Add ${shownName} to the group`
      }
      disabled={disabled || pending}
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: disabled ? 0.5 : pressed ? 0.85 : 1,
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
        <Avatar
          url={person.avatar_url}
          name={person.display_name}
          size={40}
        />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {shownName}
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 4 }}>
            {person.locked ? (
              <Feather name="lock" size={11} color={theme.muted} />
            ) : null}
            <AppText variant="caption" muted numberOfLines={1}>
              {person.locked ? "Private profile" : `@${person.handle}`}
            </AppText>
          </View>
        </View>
        {pending ? (
          <ActivityIndicator size="small" color={theme.brand} />
        ) : (
          <View
            style={{
              width: 28,
              height: 28,
              borderRadius: radius.full,
              backgroundColor: selected ? theme.accentSoft : theme.surface2,
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <Feather
              name={selected ? "check" : "plus"}
              size={15}
              color={selected ? theme.accent : theme.muted}
            />
          </View>
        )}
      </Card>
    </Pressable>
  );
}

/**
 * Search-as-you-type over the classmates at your university.
 *
 * Everyone here shares your campus (the only people a group may hold), you
 * are never in your own results, and anyone you've blocked is filtered out
 * before the list renders. Private profiles appear as a handle behind a
 * lock — enough to invite someone you know without exposing their name.
 *
 * It *is* the scrolling list, so give it a parent with real height. Anything
 * the caller wants above the search box goes in `header` and scrolls with
 * the results — on a small phone with the keyboard up, a pinned form would
 * leave no room for anyone to pick.
 *
 * @param excludeIds  Ids to drop from results entirely (existing members).
 * @param selectedIds Ids drawn with a fern check — tapping calls `onPick`
 *   again so the parent can toggle them back off.
 * @param onPick      Called with the tapped classmate.
 * @param pendingId   Id currently being written to the server, if any.
 * @param header      The caller's own form, drawn above the search box.
 */
export function CampusPeoplePicker({
  excludeIds = NO_IDS,
  selectedIds = NO_IDS,
  onPick,
  pendingId = null,
  disabled = false,
  label,
  placeholder,
  autoFocus = false,
  paddingBottom = 32,
  header,
}: {
  excludeIds?: ReadonlySet<string>;
  selectedIds?: ReadonlySet<string>;
  onPick: (person: ThreadPerson) => void;
  pendingId?: string | null;
  disabled?: boolean;
  label: string;
  placeholder: string;
  autoFocus?: boolean;
  paddingBottom?: number;
  header?: ReactNode;
}) {
  const theme = useTheme();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;
  const { blocked } = useBlockedIds();

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<Candidate[] | null>(null);
  // Starts true so the very first paint is a spinner, not a wrong "nobody
  // here" — the session may still be resolving.
  const [searching, setSearching] = useState(true);
  const [failed, setFailed] = useState(false);

  // One university lookup per mount, then every search reuses it.
  const universityRef = useRef<string | null>(null);
  const requestRef = useRef(0);

  const runSearch = useCallback(
    async (q: string) => {
      if (!userId) return;
      const ticket = ++requestRef.current;
      try {
        let university = universityRef.current;
        if (!university) {
          const { data, error } = await supabase
            .from("profiles")
            .select("university_id")
            .eq("id", userId)
            .maybeSingle();
          if (error || !data) throw error ?? new Error("No profile");
          university = (data as unknown as { university_id: string })
            .university_id;
          universityRef.current = university;
        }

        const base = supabase
          .from("profiles")
          .select("id, handle, display_name, avatar_url, is_public")
          .eq("university_id", university)
          .neq("id", userId);
        const filtered =
          q.length > 0 ? base.or(orIlike(["display_name", "handle"], q)) : base;
        const { data, error } = await filtered
          .order("display_name", { ascending: true })
          .limit(RESULT_LIMIT);
        if (error) throw error;
        if (ticket !== requestRef.current) return; // a newer keystroke won

        setResults(
          ((data ?? []) as unknown as CandidateRow[]).map((row) => ({
            id: row.id,
            handle: row.handle,
            // A private classmate is only ever their handle to us.
            display_name: row.is_public
              ? row.display_name || row.handle
              : row.handle,
            avatar_url: row.avatar_url,
            locked: !row.is_public,
          }))
        );
        setFailed(false);
      } catch {
        if (ticket !== requestRef.current) return;
        setFailed(true);
      } finally {
        if (ticket === requestRef.current) setSearching(false);
      }
    },
    [userId]
  );

  // Empty query lists the first slice of campus alphabetically, so the
  // picker has something warm to show before anyone types.
  useEffect(() => {
    if (!userId) return;
    setSearching(true);
    setFailed(false);
    const timer = setTimeout(() => void runSearch(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [query, userId, runSearch]);

  const retry = useCallback(() => {
    setSearching(true);
    setFailed(false);
    void runSearch(query.trim());
  }, [query, runSearch]);

  const visible = (results ?? []).filter(
    (person) => !excludeIds.has(person.id) && !blocked.has(person.id)
  );

  const renderItem = useCallback(
    ({ item }: ListRenderItemInfo<Candidate>) => (
      <PickerRow
        person={item}
        selected={selectedIds.has(item.id)}
        pending={pendingId === item.id}
        disabled={disabled}
        onPress={() => onPick(item)}
      />
    ),
    [selectedIds, pendingId, disabled, onPick]
  );

  return (
    <FlatList
      data={visible}
      keyExtractor={(item) => item.id}
      renderItem={renderItem}
      style={{ flex: 1 }}
      contentContainerStyle={{ paddingBottom }}
      showsVerticalScrollIndicator={false}
      keyboardShouldPersistTaps="handled"
      keyboardDismissMode="on-drag"
      // The caller's form rides inside the list so the results always get
      // the rest of the screen, keyboard up or not.
      ListHeaderComponent={
        <View style={{ marginBottom: 10 }}>
          {header}
          <Field
            label={label}
            value={query}
            onChangeText={setQuery}
            placeholder={placeholder}
            autoCapitalize="none"
            autoCorrect={false}
            autoFocus={autoFocus}
            returnKeyType="search"
            editable={!disabled}
          />
        </View>
      }
      ListEmptyComponent={
        failed ? (
          <EmptyState
            compact
            icon="cloud-off"
            title="We couldn't reach campus"
            body="Check your connection and give it another go."
            action={{ label: "Try again", onPress: retry }}
          />
        ) : searching ? (
          <View style={{ paddingVertical: 44, alignItems: "center" }}>
            <ActivityIndicator size="large" color={theme.brand} />
          </View>
        ) : (
          <EmptyState
            compact
            icon="search"
            title={query.trim() ? "Nobody by that name" : "Nobody to add yet"}
            body={
              query.trim()
                ? "Try a different name or handle — groups only hold people from your campus."
                : "As classmates join your campus they'll show up here."
            }
          />
        )
      }
    />
  );
}

/* --------------------------------- screen --------------------------------- */

export default function NewGroupScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();

  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<ThreadPerson[]>([]);
  const [formError, setFormError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/messages");
  }, []);

  const selectedIds = useMemo(
    () => new Set(selected.map((person) => person.id)),
    [selected]
  );
  // The counter always speaks in whole-group terms: you're in it too.
  const headcount = selected.length + 1;
  const full = headcount >= GROUP_MAX_PEOPLE;
  const shortBy = Math.max(0, GROUP_MIN_PEOPLE - headcount);

  const togglePerson = useCallback(
    (person: ThreadPerson) => {
      if (selected.some((p) => p.id === person.id)) {
        setFormError(null);
        setSelected(selected.filter((p) => p.id !== person.id));
        return;
      }
      if (selected.length + 1 >= GROUP_MAX_PEOPLE) {
        setFormError("This group is full at 16.");
        return;
      }
      setFormError(null);
      setSelected([...selected, person]);
    },
    [selected]
  );

  const handleCreate = useCallback(async () => {
    if (pending) return;
    const trimmed = title.trim();
    if (trimmed.length < 2 || trimmed.length > GROUP_TITLE_MAX) {
      setFormError("Group names run 2 to 60 characters.");
      return;
    }
    if (selected.length < GROUP_MIN_PEOPLE - 1) {
      setFormError("Groups hold 3 to 16 people including you.");
      return;
    }
    setFormError(null);
    setPending(true);
    try {
      const threadId = await createGroupThread(
        trimmed,
        selected.map((person) => person.id)
      );
      tapSuccess(); // the group exists — that's a completion
      router.replace(`/dm/${threadId}`);
    } catch (err) {
      setFormError(
        err instanceof GroupDmError
          ? err.message
          : "We couldn't start that group just now. Try again."
      );
      setPending(false);
    }
  }, [pending, title, selected]);

  // Deep links land here directly — signed-out visitors get a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const canCreate =
    !pending &&
    title.trim().length >= 2 &&
    selected.length >= GROUP_MIN_PEOPLE - 1;

  const hint = full
    ? "That's the whole group — sixteen is the cap."
    : shortBy > 0
      ? `Pick ${shortBy} more ${shortBy === 1 ? "person" : "people"} — groups start at three.`
      : "Tap a classmate to add them, or tap their chip to take them back out.";

  return (
    <KeyboardAvoidingView
      style={{ flex: 1, backgroundColor: theme.background }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
        <View style={{ paddingHorizontal: 12 }}>
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

        <View style={{ flex: 1, paddingHorizontal: 20 }}>
          <CampusPeoplePicker
            label="Add classmates"
            placeholder="Search your campus by name or handle"
            selectedIds={selectedIds}
            onPick={togglePerson}
            disabled={pending}
            paddingBottom={16}
            header={
              <View style={{ marginBottom: 4 }}>
                <AppText variant="display" style={{ marginTop: 2 }}>
                  Start a group
                </AppText>
                <AppText variant="caption" muted style={{ marginTop: 4 }}>
                  Name it, pick your people, and everyone lands in the same
                  chat.
                </AppText>

                <View style={{ marginTop: 16 }}>
                  <Field
                    label="Group name"
                    value={title}
                    onChangeText={(next) => {
                      setTitle(next);
                      setFormError(null);
                    }}
                    placeholder="ECS 36A study crew"
                    maxLength={GROUP_TITLE_MAX}
                    editable={!pending}
                  />
                </View>

                <SectionLabel text="Who's in" />

                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  keyboardShouldPersistTaps="handled"
                  contentContainerStyle={{
                    gap: 8,
                    alignItems: "center",
                    paddingRight: 8,
                  }}
                  style={{ marginBottom: 8 }}
                >
                  <Chip
                    label={`${headcount} of ${GROUP_MAX_PEOPLE}`}
                    tone={shortBy === 0 ? "accent" : "neutral"}
                    size="md"
                  />
                  {selected.map((person) => (
                    <Chip
                      key={person.id}
                      label={firstNameOf(person.display_name)}
                      tone="brand"
                      size="md"
                      icon="x"
                      selected
                      accessibilityLabel={`Remove ${person.display_name}`}
                      onPress={() => togglePerson(person)}
                    />
                  ))}
                </ScrollView>

                <AppText variant="caption" muted style={{ marginBottom: 12 }}>
                  {hint}
                </AppText>
              </View>
            }
          />
        </View>

        <View
          style={{
            paddingHorizontal: 20,
            paddingTop: 10,
            paddingBottom: insets.bottom + 12,
            gap: 8,
            borderTopWidth: 1,
            borderTopColor: theme.border,
          }}
        >
          {formError ? (
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
              <AppText
                variant="caption"
                style={{ color: theme.danger, flex: 1 }}
              >
                {formError}
              </AppText>
            </View>
          ) : null}
          <Button
            label={pending ? "Starting the group…" : "Create group"}
            pending={pending}
            disabled={!canCreate}
            icon={<Feather name="users" size={16} color={theme.brandFg} />}
            onPress={() => void handleCreate()}
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
