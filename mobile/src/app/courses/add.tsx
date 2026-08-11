import Feather from "@expo/vector-icons/Feather";
import { router } from "expo-router";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  FlatList,
  Keyboard,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  TextInput,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Chip, Field, Sheet } from "@/components/ui";
import { fonts, radius } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapSuccess } from "@/lib/haptics";
import {
  MAX_PASTED_COURSES,
  normalizeCourseCode,
  parseSchedule,
} from "@/lib/schedule-paste";
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

/* A class you're already in: the catalog id checks off a search result, the
   course code tells the paste sheet what to skip. */
type EnrollmentRow = {
  catalog_course_id: string | null;
  course: { code: string } | null;
};

/* A catalog row a pasted code matched — for its real, properly-cased title. */
type CatalogRow = {
  id: string;
  subject_code: string;
  course_number: string;
  title: string;
};

/* One line of the paste preview. `edited` freezes a row against re-parsing
   and against the catalog lookup: once a student has typed their own title,
   nothing overwrites it. */
type PasteDraft = {
  code: string;
  title: string;
  confidence: "high" | "low";
  edited: boolean;
};

function formatUnits(units: SearchRow["units"]): string | null {
  if (units === null) return null;
  const n = Number(units);
  if (Number.isNaN(n)) return null;
  return `${n} ${n === 1 ? "unit" : "units"}`;
}

/** How a code reads on both sides of the "are you already in this?" check —
    the student's typing and the catalog's spelling meet in the middle. */
function codeKey(code: string): string {
  return normalizeCourseCode(code) ?? code.trim().toUpperCase();
}

/** "MAT 21A" · "MAT 21A and CHE 2B" · "MAT 21A, CHE 2B, and STA 13". */
function joinCodes(codes: string[]): string {
  if (codes.length <= 1) return codes[0] ?? "";
  if (codes.length === 2) return `${codes[0]} and ${codes[1]}`;
  return `${codes.slice(0, -1).join(", ")}, and ${codes[codes.length - 1]}`;
}

/** The honest sentence after a bulk add: what landed, what was already there,
    and what didn't go through. Never rounds any of the three away. */
function pasteReport(
  landed: string[],
  already: string[],
  missed: string[]
): string {
  const tail: string[] = [];
  if (already.length > 0) {
    tail.push(
      `${joinCodes(already)} ${already.length === 1 ? "was" : "were"} already on your list`
    );
  }
  if (missed.length > 0) {
    tail.push(
      `${joinCodes(missed)} didn't go through — give ${missed.length === 1 ? "it" : "them"} another try`
    );
  }
  if (landed.length === 0) {
    return tail.length > 0 ? `${tail.join(". ")}.` : "Nothing to add yet.";
  }
  if (tail.length === 0) {
    return landed.length === 1
      ? "1 class added — its chat is open."
      : `${landed.length} classes added — their chats are open.`;
  }
  return `${landed.length} added — ${tail.join(". ")}.`;
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

/* One pasted class, still yours to shape: the code we read, a title you can
   fix, and a way to drop it. A row we could only read a bare code out of says
   so quietly — it never blocks the add, because the code alone is enough. */
function PasteDraftRow({
  row,
  busy,
  onChangeTitle,
  onRemove,
}: {
  row: PasteDraft;
  busy: boolean;
  onChangeTitle: (code: string, title: string) => void;
  onRemove: (code: string) => void;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        gap: 6,
        paddingTop: 10,
        borderTopWidth: 1,
        borderTopColor: theme.border,
      }}
    >
      <View style={{ flexDirection: "row", alignItems: "center", gap: 8 }}>
        <Chip label={row.code} tone="brand" />
        <TextInput
          accessibilityLabel={`Title for ${row.code}`}
          value={row.title}
          onChangeText={(value) => onChangeTitle(row.code, value)}
          placeholder="Add a title"
          placeholderTextColor={theme.muted + "b3"}
          cursorColor={theme.brand}
          selectionColor={theme.brandSoft}
          maxLength={120}
          editable={!busy}
          style={{
            flex: 1,
            minHeight: 38,
            borderWidth: 1,
            borderColor: theme.border,
            borderRadius: radius.control,
            backgroundColor: theme.surface,
            paddingHorizontal: 10,
            paddingVertical: 8,
            fontFamily: fonts.body,
            fontSize: 14,
            color: theme.foreground,
          }}
        />
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Remove ${row.code}`}
          onPress={() => onRemove(row.code)}
          disabled={busy}
          hitSlop={10}
          style={({ pressed }) => ({
            width: 30,
            height: 30,
            marginRight: -4,
            alignItems: "center",
            justifyContent: "center",
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="x" size={16} color={theme.muted} />
        </Pressable>
      </View>
      {row.confidence === "low" ? (
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Feather name="alert-circle" size={12} color={theme.brandInk} />
          <AppText variant="caption" style={{ color: theme.brandInk, flex: 1 }}>
            just the code came through — add a title if you want one
          </AppText>
        </View>
      ) : null}
    </View>
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
  /* Every course code you're already in, normalized. The paste sheet skips
     these rather than erroring on them. */
  const [enrolledCodes, setEnrolledCodes] = useState<Set<string>>(new Set());

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
      setEnrolledCodes((prev) => new Set(prev).add(codeKey(row.code)));
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
          .select("catalog_course_id, course:courses(code)")
          .eq("user_id", userId),
      ]);
      if (cancelled) return;
      const universityId = (
        profileRes.data as { university_id: string } | null
      )?.university_id;
      if (!universityId) return;
      const enrolled = (enrolledRes.data ?? []) as unknown as EnrollmentRow[];
      // Courses you've already added show up checked in the results.
      const already = enrolled
        .map((row) => row.catalog_course_id)
        .filter((id): id is string => id !== null);
      if (already.length > 0) {
        setAdded((prev) => new Set([...prev, ...already]));
      }
      // …and their codes, so a pasted schedule knows what to leave alone.
      const codes = enrolled
        .map((row) => row.course?.code)
        .filter((code): code is string => typeof code === "string")
        .map(codeKey);
      if (codes.length > 0) {
        setEnrolledCodes((prev) => new Set([...prev, ...codes]));
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

  /* The one write path for a self-input class: create-or-find the course row
     for a code, then upsert the caller's enrollment. Both the hand-add card
     and the paste sheet go through here, so a pasted class lands exactly the
     way a typed one does — same row, same chat, same 'manual' source. */
  const enrollByCode = useCallback(
    async (code: string, title: string): Promise<boolean> => {
      if (!userId || !ctx) return false;
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
        if (!courseId) return false;
        // Hand-added enrollment: source 'manual', no catalog_course_id. The
        // enrollment trigger opens the course chat and joins you to it, and
        // the upsert makes a class you're already in a no-op, not an error.
        const { error: enrollError } = await supabase.from("enrollments").upsert(
          { user_id: userId, course_id: courseId, source: "manual" },
          { onConflict: "user_id,course_id", ignoreDuplicates: true }
        );
        if (enrollError) throw enrollError;
        return true;
      } catch {
        return false;
      }
    },
    [userId, ctx]
  );

  const addByHand = useCallback(async () => {
    const code = fbCode.trim();
    if (!userId || !ctx || !code) return;
    setFbPending(true);
    setFbError(null);
    setFbDone(null);
    const ok = await enrollByCode(code, fbTitle.trim() || code);
    setFbPending(false);
    if (!ok) {
      setFbError("We couldn't add that course. Give it another try.");
      return;
    }
    setEnrolledCodes((prev) => new Set(prev).add(codeKey(code)));
    setFbDone(`${code} added — you're in its chat.`);
    setFbCode("");
    setFbTitle("");
  }, [userId, ctx, fbCode, fbTitle, enrollByCode]);

  /* -------------------------- paste a schedule -------------------------- */

  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [drafts, setDrafts] = useState<PasteDraft[]>([]);
  const [pasteBusy, setPasteBusy] = useState(false);
  const [pasteNote, setPasteNote] = useState<string | null>(null);
  /* Codes the student crossed off, so re-parsing never resurrects them. */
  const dismissedRef = useRef<Set<string>>(new Set());
  /* Catalog titles by code — a convenience the parse reads, never a gate. */
  const catalogRef = useRef<Map<string, { id: string; title: string }>>(
    new Map()
  );

  // Parse as they type: the caption and the preview both track the text, and
  // a title the student has already touched survives the next keystroke.
  useEffect(() => {
    const { courses } = parseSchedule(pasteText);
    setPasteNote(null); // editing the paste retires the last attempt's note
    setDrafts((prev) => {
      const previous = new Map(prev.map((row) => [row.code, row]));
      const next: PasteDraft[] = [];
      for (const course of courses) {
        if (dismissedRef.current.has(course.code)) continue;
        const kept = previous.get(course.code);
        if (kept?.edited) {
          next.push(kept);
          continue;
        }
        const known = catalogRef.current.get(course.code)?.title ?? null;
        const title = known ?? course.title;
        next.push({
          code: course.code,
          title: title ?? "",
          confidence: title === null ? "low" : "high",
          edited: false,
        });
      }
      return next;
    });
  }, [pasteText]);

  const draftCodes = drafts.map((row) => row.code).join(",");

  /* Give a pasted code its real title when the catalog has one. Entirely
     best-effort: a code the catalog has never heard of is added exactly as
     it was typed, and a failed lookup changes nothing at all. */
  useEffect(() => {
    const universityId = ctx?.universityId;
    if (!pasteOpen || draftCodes === "" || !universityId) return;
    const subjects = Array.from(
      new Set(
        draftCodes
          .split(",")
          .map((code) => code.split(" ")[0] ?? "")
          .filter((subject) => subject !== "")
      )
    );
    if (subjects.length === 0) return;
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        const { data, error } = await supabase
          .from("catalog_courses")
          .select("id, subject_code, course_number, title")
          .eq("university_id", universityId)
          .in("subject_code", subjects)
          .limit(200);
        if (cancelled || error || !data) return;
        let learned = false;
        for (const row of data as unknown as CatalogRow[]) {
          const code = normalizeCourseCode(
            `${row.subject_code} ${row.course_number}`
          );
          if (!code || catalogRef.current.has(code)) continue;
          catalogRef.current.set(code, { id: row.id, title: row.title });
          learned = true;
        }
        if (!learned) return;
        setDrafts((prev) =>
          prev.map((row) => {
            const hit = catalogRef.current.get(row.code);
            if (row.edited || !hit) return row;
            return { ...row, title: hit.title, confidence: "high" };
          })
        );
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [pasteOpen, draftCodes, ctx]);

  /* The sheet is a Modal, so the keyboard slides over it instead of resizing
     it. The card is anchored to the bottom edge, so a spacer beneath the
     button grows it upward and keeps the preview in view. iOS only — Android
     resizes the modal window itself. */
  const [keyboardInset, setKeyboardInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== "ios") return;
    const show = Keyboard.addListener("keyboardWillShow", (event) => {
      setKeyboardInset(event.endCoordinates.height);
    });
    const hide = Keyboard.addListener("keyboardWillHide", () => {
      setKeyboardInset(0);
    });
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);

  const editDraft = useCallback((code: string, title: string) => {
    setDrafts((prev) =>
      prev.map((row) =>
        row.code === code ? { ...row, title, edited: true } : row
      )
    );
  }, []);

  const dropDraft = useCallback((code: string) => {
    dismissedRef.current.add(code);
    setDrafts((prev) => prev.filter((row) => row.code !== code));
  }, []);

  const closePaste = useCallback(() => {
    Keyboard.dismiss();
    setPasteOpen(false);
  }, []);

  /* Add them one after another down the same path a hand-added class takes,
     then say plainly how it went. Anything that landed leaves the preview;
     anything that didn't stays put so a second tap only retries the misses. */
  const addPasted = useCallback(async () => {
    if (!userId || !ctx || pasteBusy || drafts.length === 0) return;
    setPasteBusy(true);
    setPasteNote(null);
    const landed: string[] = [];
    const already: string[] = [];
    const missed: string[] = [];
    for (const row of drafts) {
      if (enrolledCodes.has(row.code)) {
        already.push(row.code);
        continue;
      }
      const title = row.title.trim();
      const ok = await enrollByCode(row.code, title === "" ? row.code : title);
      if (ok) landed.push(row.code);
      else missed.push(row.code);
    }
    setPasteBusy(false);

    const handled = [...landed, ...already];
    if (handled.length > 0) {
      for (const code of handled) dismissedRef.current.add(code);
      setDrafts((prev) => prev.filter((row) => !handled.includes(row.code)));
      setEnrolledCodes((prev) => new Set([...prev, ...handled]));
      // A pasted code the catalog knows also checks off its search result.
      const catalogIds = handled
        .map((code) => catalogRef.current.get(code)?.id)
        .filter((id): id is string => typeof id === "string");
      if (catalogIds.length > 0) {
        setAdded((prev) => new Set([...prev, ...catalogIds]));
      }
    }

    const message = pasteReport(landed, already, missed);
    if (missed.length === 0) {
      if (landed.length > 0) tapSuccess(); // completion, not a no-op
      dismissedRef.current.clear();
      setPasteText("");
      setAddError(null);
      setToast(message);
      closePaste();
      return;
    }
    setPasteNote(message);
  }, [
    userId,
    ctx,
    pasteBusy,
    drafts,
    enrolledCodes,
    enrollByCode,
    closePaste,
  ]);

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

  const draftCount = drafts.length;
  const pasteCaption =
    pasteText.trim() === ""
      ? "Paste the whole thing — a registrar table, a list, or just the codes."
      : draftCount === 0
        ? "No course codes in there yet. They look like MAT 21A or ECS 36A."
        : `Found ${draftCount} ${draftCount === 1 ? "class" : "classes"} — fix any titles, drop what you're not taking.${
            draftCount >= MAX_PASTED_COURSES
              ? ` ${MAX_PASTED_COURSES} at a time is our limit.`
              : ""
          }`;
  const pasteAction =
    draftCount === 0
      ? "Add these classes"
      : draftCount === 1
        ? "Add 1 class"
        : `Add ${draftCount} classes`;
  const keyboardLift = pasteOpen
    ? Math.max(0, keyboardInset - Math.max(insets.bottom, 12))
    : 0;

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
                {/* The third way in: one paste instead of six trips through
                    the form below. */}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Paste your schedule"
                  onPress={() => setPasteOpen(true)}
                  style={({ pressed }) => ({
                    marginBottom: 12,
                    opacity: pressed ? 0.7 : 1,
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
                      minHeight: 64,
                    }}
                  >
                    <View
                      style={{
                        width: 36,
                        height: 36,
                        borderRadius: radius.control,
                        backgroundColor: theme.brandSoft,
                        alignItems: "center",
                        justifyContent: "center",
                      }}
                    >
                      <Feather
                        name="clipboard"
                        size={16}
                        color={theme.brand}
                      />
                    </View>
                    <View style={{ flex: 1, gap: 2 }}>
                      <AppText variant="bodySemi">Paste your schedule</AppText>
                      <AppText variant="caption" muted>
                        Copy it out of the registrar and drop the whole thing
                        in — we'll pull the classes out.
                      </AppText>
                    </View>
                    <Feather
                      name="chevron-right"
                      size={18}
                      color={theme.muted}
                    />
                  </Card>
                </Pressable>
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

      <Sheet
        visible={pasteOpen}
        onClose={closePaste}
        title="Paste your schedule"
      >
        <ScrollView
          style={{ flexShrink: 1 }}
          contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
          keyboardShouldPersistTaps="handled"
          showsVerticalScrollIndicator={false}
        >
          <Field
            label="Your schedule, however it copied out"
            value={pasteText}
            onChangeText={setPasteText}
            placeholder={
              "MAT 021A  001  CALCULUS  MWF 10:00-10:50AM  OLSON 106\nECS 36A - Programming & Problem Solving\nBIS 2A, CHE 2B"
            }
            multiline
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            editable={!pasteBusy}
            style={{ minHeight: 96, textAlignVertical: "top" }}
          />
          <AppText variant="caption" muted>
            {pasteCaption}
          </AppText>
          {drafts.map((row) => (
            <PasteDraftRow
              key={row.code}
              row={row}
              busy={pasteBusy}
              onChangeTitle={editDraft}
              onRemove={dropDraft}
            />
          ))}
          {pasteNote ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {pasteNote}
            </AppText>
          ) : null}
        </ScrollView>
        <Button
          label={pasteAction}
          pending={pasteBusy}
          disabled={pasteBusy || draftCount === 0 || !ctx}
          icon={<Feather name="check" size={16} color={theme.brandFg} />}
          onPress={() => void addPasted()}
          style={{ marginTop: 6 }}
        />
        <View style={{ height: keyboardLift }} />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
