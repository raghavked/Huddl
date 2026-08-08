import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
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
import { AppText, Button, Card, Field } from "@/components/ui";
import { radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Row shape returned by the search_catalog RPC. */
type SearchRow = {
  id: string;
  code: string;
  title: string;
  units: number | string | null;
  offered_now: boolean;
};

/* What the free-text fallback needs: campus + the session we're in. */
type AddContext = {
  universityId: string;
  termId: string | null;
  termName: string | null;
};

function formatUnits(units: SearchRow["units"]): string | null {
  if (units === null) return null;
  const n = Number(units);
  if (Number.isNaN(n)) return null;
  return `${n} ${n === 1 ? "unit" : "units"}`;
}

function InlineBanner({
  tone,
  icon,
  text,
}: {
  tone: "warm" | "danger";
  icon: React.ComponentProps<typeof Feather>["name"];
  text: string;
}) {
  const theme = useTheme();
  const bg = tone === "warm" ? theme.brandSoft : theme.surface2;
  const fg = tone === "warm" ? theme.brandInk : theme.danger;
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 8,
        backgroundColor: bg,
        borderRadius: radius.control,
        paddingHorizontal: 12,
        paddingVertical: 10,
        marginBottom: 10,
      }}
    >
      <Feather name={icon} size={16} color={fg} />
      <AppText variant="caption" style={{ color: fg, flex: 1 }}>
        {text}
      </AppText>
    </View>
  );
}

function ResultRow({
  item,
  added,
  pending,
  busy,
  onAdd,
}: {
  item: SearchRow;
  added: boolean;
  pending: boolean;
  busy: boolean;
  onAdd: () => void;
}) {
  const theme = useTheme();
  const units = formatUnits(item.units);
  return (
    <Card
      padded={false}
      style={{
        flexDirection: "row",
        alignItems: "center",
        gap: 12,
        paddingHorizontal: 14,
        paddingVertical: 12,
        minHeight: 76,
      }}
    >
      <View style={{ flex: 1, gap: 2 }}>
        <AppText variant="bodySemi" numberOfLines={1}>
          {item.code}
        </AppText>
        <AppText variant="caption" muted numberOfLines={2}>
          {item.title}
        </AppText>
        {units ? (
          <AppText variant="caption" muted>
            {units}
          </AppText>
        ) : null}
      </View>
      <View style={{ alignItems: "flex-end", gap: 6 }}>
        {item.offered_now ? (
          <>
            <View style={{ flexDirection: "row", alignItems: "center", gap: 5 }}>
              <View
                style={{
                  width: 7,
                  height: 7,
                  borderRadius: radius.full,
                  backgroundColor: theme.success,
                }}
              />
              <AppText variant="caption" muted>
                Offered now
              </AppText>
            </View>
            {added ? (
              <View
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 5,
                  height: 38,
                  paddingHorizontal: 8,
                }}
                accessibilityLabel={`${item.code} added`}
              >
                <Feather name="check-circle" size={15} color={theme.success} />
                <AppText variant="label" style={{ color: theme.success }}>
                  Added
                </AppText>
              </View>
            ) : (
              <Button
                label="Add"
                variant="soft"
                size="sm"
                pending={pending}
                disabled={busy}
                accessibilityLabel={`Add ${item.code}`}
                onPress={onAdd}
              />
            )}
          </>
        ) : (
          <>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "right", maxWidth: 130 }}
            >
              Not offered this session
            </AppText>
            <Button label="Add" variant="soft" size="sm" disabled />
          </>
        )}
      </View>
    </Card>
  );
}

export default function AddCoursesScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session } = useAuth();
  const userId = session?.user.id ?? null;

  /* ------------------------------ search ------------------------------ */

  const [query, setQuery] = useState("");
  const [results, setResults] = useState<SearchRow[] | null>(null);
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState(false);
  const requestRef = useRef(0);

  const runSearch = useCallback(async (q: string) => {
    const ticket = ++requestRef.current;
    const { data, error } = await supabase.rpc("search_catalog", { q });
    if (ticket !== requestRef.current) return; // a newer keystroke won
    setSearching(false);
    if (error) {
      setSearchError(true);
      return;
    }
    setSearchError(false);
    setResults((data ?? []) as SearchRow[]);
  }, []);

  useEffect(() => {
    const q = query.trim();
    if (!q) {
      requestRef.current += 1; // cancel anything in flight
      setResults(null);
      setSearching(false);
      setSearchError(false);
      return;
    }
    setSearching(true);
    const timer = setTimeout(() => void runSearch(q), 250);
    return () => clearTimeout(timer);
  }, [query, runSearch]);

  /* ---------------------------- catalog add ---------------------------- */

  const [added, setAdded] = useState<Set<string>>(new Set());
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [toast, setToast] = useState<string | null>(null);
  const [addError, setAddError] = useState<string | null>(null);

  const enroll = useCallback(
    async (row: SearchRow) => {
      setAddError(null);
      setPendingId(row.id);
      const { error } = await supabase.rpc("enroll_from_catalog", {
        p_catalog_course_id: row.id,
      });
      setPendingId(null);
      if (error) {
        setToast(null);
        setAddError(
          `We couldn't add ${row.code} just now. Give it another try.`
        );
        return;
      }
      setAdded((prev) => new Set(prev).add(row.id));
      setToast("You're in — the course chat is ready.");
    },
    []
  );

  /* ------------------- context for the free-text path ------------------- */

  const [ctx, setCtx] = useState<AddContext | null>(null);

  useEffect(() => {
    if (!userId) return;
    let cancelled = false;
    void (async () => {
      const [profileRes, enrolledRes] = await Promise.all([
        supabase
          .from("profiles")
          .select("university_id")
          .eq("id", userId)
          .maybeSingle(),
        supabase
          .from("enrollments")
          .select("catalog_course_id")
          .eq("user_id", userId)
          .not("catalog_course_id", "is", null),
      ]);
      if (cancelled) return;
      const universityId = (
        profileRes.data as { university_id: string } | null
      )?.university_id;
      if (!universityId) return;
      // Courses you've already added show up checked in the results.
      const already = (
        (enrolledRes.data ?? []) as { catalog_course_id: string | null }[]
      )
        .map((row) => row.catalog_course_id)
        .filter((id): id is string => id !== null);
      if (already.length > 0) {
        setAdded((prev) => new Set([...prev, ...already]));
      }
      const today = new Date().toISOString().slice(0, 10);
      const { data: term } = await supabase
        .from("terms")
        .select("id, name")
        .eq("university_id", universityId)
        .lte("starts_on", today)
        .gte("ends_on", today)
        .limit(1)
        .maybeSingle();
      if (cancelled) return;
      const termRow = term as { id: string; name: string } | null;
      setCtx({
        universityId,
        termId: termRow?.id ?? null,
        termName: termRow?.name ?? null,
      });
    })();
    return () => {
      cancelled = true;
    };
  }, [userId]);

  /* ------------------------- free-text fallback ------------------------- */

  const [fbCode, setFbCode] = useState("");
  const [fbTitle, setFbTitle] = useState("");
  const [fbPending, setFbPending] = useState(false);
  const [fbError, setFbError] = useState<string | null>(null);
  const [fbDone, setFbDone] = useState<string | null>(null);

  const addByHand = useCallback(async () => {
    if (!userId || !ctx) return;
    const code = fbCode.trim();
    if (!code) return;
    const title = fbTitle.trim() || code;
    setFbPending(true);
    setFbError(null);
    setFbDone(null);
    try {
      // Mirror the web manual-picker: insert the course row; if that trips
      // (a classmate beat us to it), find the existing one by code instead.
      let courseId: string | null = null;
      const { data: inserted, error: insertError } = await supabase
        .from("courses")
        .insert({
          university_id: ctx.universityId,
          term_id: ctx.termId,
          code,
          title,
        })
        .select("id")
        .single();
      if (insertError) {
        // Probably created by a classmate moments ago — look it up instead.
        const { data: found } = await supabase
          .from("courses")
          .select("id")
          .eq("university_id", ctx.universityId)
          .eq("code", code)
          .limit(1)
          .maybeSingle();
        courseId = (found as { id: string } | null)?.id ?? null;
      } else {
        courseId = (inserted as { id: string }).id;
      }
      if (!courseId) {
        setFbError("We couldn't add that course. Give it another try.");
        return;
      }
      // Hand-added enrollment: source 'manual', no catalog_course_id. The
      // enrollment trigger opens the course chat and joins you to it.
      const { error: enrollError } = await supabase.from("enrollments").upsert(
        { user_id: userId, course_id: courseId, source: "manual" },
        { onConflict: "user_id,course_id", ignoreDuplicates: true }
      );
      if (enrollError) throw enrollError;
      setFbDone(`${code} added — you're in its chat.`);
      setFbCode("");
      setFbTitle("");
    } catch {
      setFbError("We couldn't add that course. Give it another try.");
    } finally {
      setFbPending(false);
    }
  }, [userId, ctx, fbCode, fbTitle]);

  /* ------------------------------ render ------------------------------ */

  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    const q = query.trim();
    if (!q) {
      setRefreshing(false);
      return;
    }
    setRefreshing(true);
    void runSearch(q).finally(() => setRefreshing(false));
  }, [query, runSearch]);

  const q = query.trim();
  const statusLine = searchError
    ? null
    : searching
      ? "Searching the catalog…"
      : results === null
        ? "Search by code or title — try “MAT 21A” or “calculus”."
        : results.length === 0
          ? `Nothing in the catalog matching “${q}” — add it by hand below.`
          : null;

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
            onPress={() => {
              if (router.canGoBack()) router.back();
              else router.replace("/courses");
            }}
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
          <AppText variant="display" style={{ marginTop: 2 }}>
            Add courses
          </AppText>
          <AppText variant="caption" muted style={{ marginTop: 6 }}>
            Your classes, your call — search the catalog to save some typing,
            or add any class by hand.
          </AppText>

          <View style={{ marginTop: 14, marginBottom: 12 }}>
            <Field
              label="Search the catalog"
              value={query}
              onChangeText={setQuery}
              placeholder="Course code or title"
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              returnKeyType="search"
            />
          </View>

          <FlatList
            data={results ?? []}
            keyExtractor={(row) => row.id}
            style={{ flex: 1 }}
            contentContainerStyle={{ paddingBottom: insets.bottom + 32 }}
            showsVerticalScrollIndicator={false}
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
              <View>
                {toast ? (
                  <InlineBanner tone="warm" icon="check-circle" text={toast} />
                ) : null}
                {addError ? (
                  <InlineBanner tone="danger" icon="alert-circle" text={addError} />
                ) : null}
                {searchError ? (
                  <AppText
                    variant="caption"
                    style={{ color: theme.danger, marginBottom: 10 }}
                  >
                    We couldn't search the catalog just now — check your
                    connection and keep typing to retry.
                  </AppText>
                ) : null}
                {statusLine ? (
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: 8,
                      marginBottom: 10,
                    }}
                  >
                    {searching ? (
                      <ActivityIndicator size="small" color={theme.brand} />
                    ) : null}
                    <AppText variant="caption" muted style={{ flex: 1 }}>
                      {statusLine}
                    </AppText>
                  </View>
                ) : null}
              </View>
            }
            renderItem={({ item }) => (
              <View style={{ marginBottom: 10 }}>
                <ResultRow
                  item={item}
                  added={added.has(item.id)}
                  pending={pendingId === item.id}
                  busy={pendingId !== null}
                  onAdd={() => void enroll(item)}
                />
              </View>
            )}
            ListFooterComponent={
              <Card style={{ marginTop: 8, gap: 10 }}>
                <View
                  style={{ flexDirection: "row", alignItems: "center", gap: 8 }}
                >
                  <Feather name="help-circle" size={16} color={theme.brand} />
                  <AppText variant="title">Can't find your class?</AppText>
                </View>
                <AppText variant="caption" muted>
                  The catalog covers common classes and just saves you the
                  typing. Anything it's missing you can add by hand right
                  here — it counts exactly the same.
                </AppText>
                <View
                  style={{
                    borderTopWidth: 1,
                    borderTopColor: theme.border,
                    paddingTop: 12,
                    gap: 10,
                  }}
                >
                  <Field
                    label="Course code"
                    value={fbCode}
                    onChangeText={setFbCode}
                    placeholder="CS 101"
                    autoCapitalize="characters"
                    autoCorrect={false}
                    spellCheck={false}
                    editable={!fbPending}
                  />
                  <Field
                    label="Title (optional)"
                    value={fbTitle}
                    onChangeText={setFbTitle}
                    placeholder="Intro to Computer Science"
                    editable={!fbPending}
                  />
                  <AppText variant="caption" muted>
                    We'll open the class chat the moment it's added.
                  </AppText>
                  {fbError ? (
                    <AppText variant="caption" style={{ color: theme.danger }}>
                      {fbError}
                    </AppText>
                  ) : null}
                  {fbDone ? (
                    <View
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 6,
                      }}
                    >
                      <Feather name="check" size={14} color={theme.success} />
                      <AppText
                        variant="caption"
                        style={{ color: theme.success, flex: 1 }}
                      >
                        {fbDone}
                      </AppText>
                    </View>
                  ) : null}
                  <Button
                    label="Add class"
                    variant="secondary"
                    size="sm"
                    pending={fbPending}
                    disabled={fbPending || !fbCode.trim() || !ctx}
                    onPress={() => void addByHand()}
                    style={{ alignSelf: "flex-start" }}
                  />
                </View>
              </Card>
            }
          />
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}
