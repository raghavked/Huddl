import Feather from "@expo/vector-icons/Feather";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useMemo, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { AppText, Button, Card, Field, Sheet } from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapSuccess } from "@/lib/haptics";
import { buildQueue } from "@/lib/srs";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* Deck home: the shared card list, a big Study door, and an add-card form.
   Any classmate adds cards; authors long-press their own to edit or remove.
   Due counts are yours alone; nobody else sees how you're doing. */

/* Minimal local row shapes. The web app's types live outside this tsconfig. */
type DeckRow = {
  id: string;
  course_id: string;
  created_by: string | null;
  title: string;
  /** The note this deck was struck from (migration 0061), if any. */
  source_note_id: string | null;
  creator: { display_name: string } | null;
  course: { code: string } | null;
};

type CardRow = {
  id: string;
  deck_id: string;
  created_by: string | null;
  front: string;
  back: string;
  position: number;
  created_at: string;
};

type Status = "loading" | "error" | "notFound" | "ready";

const CARD_SELECT = "id, deck_id, created_by, front, back, position, created_at";

/* ------------------------------ paste parser ------------------------------ */

type ParsedCard = { front: string; back: string };

/** Separators a pasted line can use, checked in this order. \u2014 is an em dash. */
const PASTE_SEPARATORS = [" - ", " \u2014 ", ": ", "\t"] as const;

/**
 * One card per line: split on the first hyphen, em dash, colon, or tab (in
 * that priority, and see PASTE_SEPARATORS for the exact strings), trim both
 * sides, and skip anything that doesn't make a card: no separator, an empty
 * side, an oversized side, or a front the deck (or an earlier line) already
 * has, compared case-insensitively.
 */
function parsePastedCards(
  text: string,
  existingFronts: ReadonlySet<string>
): { cards: ParsedCard[]; skipped: number } {
  const cards: ParsedCard[] = [];
  const seen = new Set(existingFronts);
  let skipped = 0;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (line.length === 0) continue; // blank lines aren't held against anyone
    let front: string | null = null;
    let back = "";
    for (const separator of PASTE_SEPARATORS) {
      const at = line.indexOf(separator);
      if (at !== -1) {
        front = line.slice(0, at).trim();
        back = line.slice(at + separator.length).trim();
        break;
      }
    }
    if (
      front === null ||
      front.length === 0 ||
      back.length === 0 ||
      front.length > 1000 ||
      back.length > 2000
    ) {
      skipped += 1;
      continue;
    }
    const key = front.toLowerCase();
    if (seen.has(key)) {
      skipped += 1;
      continue;
    }
    seen.add(key);
    cards.push({ front, back });
  }
  return { cards, skipped };
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

export default function DeckHomeScreen() {
  const theme = useTheme();
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const { id, paste } = useLocalSearchParams<{ id: string; paste?: string }>();
  const deckId = id ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [deck, setDeck] = useState<DeckRow | null>(null);
  /* The source note's title, when the deck has one. Null covers "no source
     note" and "the note has since been deleted" alike: nothing renders. */
  const [sourceNoteTitle, setSourceNoteTitle] = useState<string | null>(null);
  const [cards, setCards] = useState<CardRow[]>([]);
  const [reviews, setReviews] = useState<Map<string, { dueAt: Date }>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // The composer: closed, the single add-card form, or the paste-cards field.
  // Arriving through "Turn into flashcards" opens the paste field straight away.
  const [composer, setComposer] = useState<"closed" | "single" | "paste">(
    paste === "1" ? "paste" : "closed"
  );
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);

  // Paste-to-import: a block of lines, parsed live into ready cards.
  const [pasteText, setPasteText] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteSuccess, setPasteSuccess] = useState<string | null>(null);

  // Editing one of your own cards, inline where the row was.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (deck) {
      router.replace({
        pathname: "/course/decks",
        params: deck.course
          ? { courseId: deck.course_id, courseCode: deck.course.code }
          : { courseId: deck.course_id },
      });
    } else router.replace("/(tabs)/home");
  }, [router, deck]);

  const load = useCallback(async () => {
    if (!userId || !deckId) {
      setStatus(deckId ? "error" : "notFound");
      return;
    }
    const [deckRes, cardsRes] = await Promise.all([
      supabase
        .from("decks")
        .select(
          "id, course_id, created_by, title, source_note_id, creator:profiles(display_name), course:courses(code)"
        )
        .eq("id", deckId)
        .maybeSingle(),
      supabase
        .from("cards")
        .select(CARD_SELECT)
        .eq("deck_id", deckId)
        .order("position", { ascending: true })
        .order("created_at", { ascending: true }),
    ]);
    if (deckRes.error || cardsRes.error) {
      setStatus("error");
      return;
    }
    const deckRow = deckRes.data as unknown as DeckRow | null;
    // RLS hides other classes' decks, so "not found" covers both cases.
    if (!deckRow) {
      setStatus("notFound");
      return;
    }
    const cardRows = (cardsRes.data ?? []) as unknown as CardRow[];
    const reviewMap = new Map<string, { dueAt: Date }>();
    if (cardRows.length > 0) {
      const reviewsRes = await supabase
        .from("card_reviews")
        .select("card_id, due_at")
        .eq("user_id", userId)
        .in(
          "card_id",
          cardRows.map((card) => card.id)
        );
      if (reviewsRes.error) {
        setStatus("error");
        return;
      }
      for (const row of (reviewsRes.data ?? []) as {
        card_id: string;
        due_at: string;
      }[]) {
        reviewMap.set(row.card_id, { dueAt: new Date(row.due_at) });
      }
    }
    /* The note this deck was struck from, when there is one. Best-effort: a
       deleted note (source_note_id set, row gone) or a hiccup on this probe
       leaves the title null, and the credit line simply doesn't render. */
    let noteTitle: string | null = null;
    if (deckRow.source_note_id) {
      const noteRes = await supabase
        .from("notes")
        .select("title")
        .eq("id", deckRow.source_note_id)
        .maybeSingle();
      if (!noteRes.error && noteRes.data) {
        noteTitle = (noteRes.data as { title: string }).title;
      }
    }
    setDeck(deckRow);
    setSourceNoteTitle(noteTitle);
    setCards(cardRows);
    setReviews(reviewMap);
    setStatus("ready");
  }, [userId, deckId]);

  // Reload on every focus, so due counts settle after a study session.
  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load])
  );

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setActionError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /* ------------------------------ add a card ----------------------------- */

  const resetForm = useCallback(() => {
    setComposer("closed");
    setFront("");
    setBack("");
    setAddError(null);
  }, []);

  const resetPaste = useCallback(() => {
    setComposer("closed");
    setPasteText("");
    setPasteError(null);
    setPasteSuccess(null);
  }, []);

  const handleAdd = useCallback(async () => {
    if (!userId || !deckId || adding) return;
    const frontText = front.trim();
    const backText = back.trim();
    if (frontText.length === 0 || backText.length === 0) {
      setAddError("A card needs both sides: a prompt up front, the answer behind.");
      return;
    }
    if (frontText.length > 1000 || backText.length > 2000) {
      setAddError("That's a lot of card. Trim it down a little.");
      return;
    }
    setAddError(null);
    setAdding(true);
    const position =
      cards.length > 0 ? Math.max(...cards.map((card) => card.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("cards")
      .insert({
        deck_id: deckId,
        created_by: userId,
        front: frontText,
        back: backText,
        position,
      })
      .select(CARD_SELECT)
      .single();
    setAdding(false);
    if (error || !data) {
      setAddError(
        error?.message.includes("row-level security")
          ? "Cards are for classmates. Add this course to your classes first."
          : "We couldn't add that card just now. Give it another try."
      );
      return;
    }
    setCards((prev) => [...prev, data as unknown as CardRow]);
    // Keep the form open and clear, because card entry comes in bursts.
    setFront("");
    setBack("");
  }, [userId, deckId, adding, front, back, cards]);

  /* ------------------------- paste a stack at once ------------------------ */

  const existingFronts = useMemo(
    () => new Set(cards.map((card) => card.front.trim().toLowerCase())),
    [cards]
  );

  const parsed = useMemo(
    () => parsePastedCards(pasteText, existingFronts),
    [pasteText, existingFronts]
  );

  const handleBulkAdd = useCallback(async () => {
    if (!userId || !deckId || bulkAdding) return;
    const ready = parsed.cards;
    if (ready.length === 0) {
      setPasteError(
        "Nothing to add yet. Paste a few lines, one card per line."
      );
      return;
    }
    setPasteError(null);
    setPasteSuccess(null);
    setBulkAdding(true);
    const basePosition =
      cards.length > 0 ? Math.max(...cards.map((card) => card.position)) + 1 : 0;
    const { data, error } = await supabase
      .from("cards")
      .insert(
        ready.map((card, offset) => ({
          deck_id: deckId,
          created_by: userId,
          front: card.front,
          back: card.back,
          position: basePosition + offset,
        }))
      )
      .select(CARD_SELECT);
    setBulkAdding(false);
    if (error || !data) {
      setPasteError(
        error?.message.includes("row-level security")
          ? "Cards are for classmates. Add this course to your classes first."
          : "Those cards didn't make it in. Give it another try."
      );
      return;
    }
    const inserted = [...(data as unknown as CardRow[])].sort(
      (a, b) => a.position - b.position
    );
    setCards((prev) => [...prev, ...inserted]);
    setPasteText("");
    tapSuccess();
    setPasteSuccess(
      `${inserted.length === 1 ? "1 card" : `${inserted.length} cards`} in. The class thanks you.`
    );
  }, [userId, deckId, bulkAdding, parsed, cards]);

  /* ---------------------- edit / delete (yours only) ---------------------- */

  const startEdit = useCallback((card: CardRow) => {
    setEditingId(card.id);
    setEditFront(card.front);
    setEditBack(card.back);
    setEditError(null);
  }, []);

  const closeEdit = useCallback(() => {
    setEditingId(null);
    setEditFront("");
    setEditBack("");
    setEditError(null);
  }, []);

  const saveEdit = useCallback(
    async (card: CardRow) => {
      const frontText = editFront.trim();
      const backText = editBack.trim();
      if (frontText.length === 0 || backText.length === 0) {
        setEditError("A card needs both sides: keep a prompt and an answer.");
        return;
      }
      if (frontText.length > 1000 || backText.length > 2000) {
        setEditError("That's a lot of card. Trim it down a little.");
        return;
      }
      // Optimistic: the row updates now, and reverts if the server minds.
      const before = cards;
      setCards((prev) =>
        prev.map((row) =>
          row.id === card.id ? { ...row, front: frontText, back: backText } : row
        )
      );
      closeEdit();
      const { error } = await supabase
        .from("cards")
        .update({ front: frontText, back: backText })
        .eq("id", card.id);
      if (error) {
        setCards(before);
        setActionError("That edit didn't stick. Give it another try.");
      }
    },
    [editFront, editBack, cards, closeEdit]
  );

  const deleteCard = useCallback(
    async (card: CardRow) => {
      setActionError(null);
      const before = cards;
      setCards((prev) => prev.filter((row) => row.id !== card.id));
      const { error } = await supabase.from("cards").delete().eq("id", card.id);
      if (error) {
        setCards(before);
        setActionError("We couldn't remove that card. Give it another try.");
      }
    },
    [cards]
  );

  const confirmDelete = useCallback(
    (card: CardRow) => {
      Alert.alert(
        "Remove this card?",
        "It comes out of the deck for the whole class.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => void deleteCard(card),
          },
        ]
      );
    },
    [deleteCard]
  );

  /* The author menu, as the same warm sheet every other long-press in the
     app opens. The card is held while the sheet slides away, so its front
     doesn't blank out of the title mid-dismissal. */
  const [menu, setMenu] = useState<CardRow | null>(null);
  const lastMenu = useRef<CardRow | null>(null);
  if (menu !== null) lastMenu.current = menu;
  const menuCard = menu ?? lastMenu.current;

  const handleLongPress = useCallback(
    (card: CardRow) => {
      if (card.created_by !== userId) return; // only your own cards
      setMenu(card);
    },
    [userId]
  );

  /** Close the sheet first, then act. The row is about to change under it. */
  const runFromMenu = useCallback(
    (action: (card: CardRow) => void) => () => {
      const card = menu;
      setMenu(null);
      if (card) action(card);
    },
    [menu]
  );

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

  const centered = (children: React.ReactNode) => (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: space.room,
        padding: space.rest,
      }}
    >
      {children}
    </View>
  );

  if (status !== "ready" || !deck) {
    return scaffold(
      status === "loading" ? (
        centered(
          <>
            <ActivityIndicator size="large" color={theme.brand} />
            <AppText variant="caption" muted>
              Opening the deck…
            </AppText>
          </>
        )
      ) : status === "notFound" ? (
        centered(
          <>
            <Feather name="layers" size={28} color={theme.muted} />
            <AppText variant="bodySemi">Deck not available</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              It may have been taken down, or it belongs to a class you're not
              in yet.
            </AppText>
            <Button label="Back" variant="soft" size="sm" onPress={goBack} />
          </>
        )
      ) : (
        centered(
          <>
            <Feather name="wifi-off" size={28} color={theme.muted} />
            <AppText variant="bodySemi">Something hiccuped</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              We couldn't load this deck. Check your connection and give it
              another go.
            </AppText>
            <Button
              label="Try again"
              variant="soft"
              size="sm"
              onPress={() => {
                setStatus("loading");
                void load();
              }}
            />
          </>
        )
      )
    );
  }

  /* ------------------------------ deck home ------------------------------ */

  // New cards count as due, so the queue length IS the honest due count.
  const due = buildQueue(cards, reviews, new Date(), cards.length).length;
  /** Nothing owed, but there is a deck to run: the night-before lap. */
  const cram = due === 0 && cards.length > 0;
  const cardsLabel = cards.length === 1 ? "1 card" : `${cards.length} cards`;
  const creatorName =
    deck.created_by === userId
      ? "you"
      : deck.creator?.display_name ?? "a classmate";

  const readyCount = parsed.cards.length;

  const composerSection =
    composer === "single" ? (
      <Card style={{ gap: space.close }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.cosy,
          }}
        >
          <AppText variant="title">Add a card</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the card form"
            onPress={resetForm}
            disabled={adding}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              marginRight: -12,
              marginVertical: -12,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="x" size={18} color={theme.muted} />
          </Pressable>
        </View>
        <Field
          label="Front"
          value={front}
          onChangeText={(text) => {
            setFront(text);
            if (addError) setAddError(null);
          }}
          placeholder="What does RLS stand for?"
          maxLength={1000}
          editable={!adding}
          multiline
        />
        <Field
          label="Back"
          value={back}
          onChangeText={(text) => {
            setBack(text);
            if (addError) setAddError(null);
          }}
          placeholder="Row-level security"
          maxLength={2000}
          editable={!adding}
          multiline
          error={addError}
        />
        <Button
          label="Add card"
          size="sm"
          pending={adding}
          disabled={adding || front.trim().length === 0 || back.trim().length === 0}
          icon={<Feather name="plus" size={14} color={theme.brandFg} />}
          onPress={() => void handleAdd()}
          style={{ alignSelf: "flex-start" }}
        />
      </Card>
    ) : composer === "paste" ? (
      <Card style={{ gap: space.close }}>
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            justifyContent: "space-between",
            gap: space.cosy,
          }}
        >
          <AppText variant="title">Paste cards</AppText>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close the paste form"
            onPress={resetPaste}
            disabled={bulkAdding}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 44,
              height: 44,
              marginRight: -12,
              marginVertical: -12,
              alignItems: "center",
              justifyContent: "center",
              opacity: pressed ? 0.6 : 1,
            })}
          >
            <Feather name="x" size={18} color={theme.muted} />
          </Pressable>
        </View>
        <Field
          label="One card per line, front and back separated by a dash, colon, or tab"
          value={pasteText}
          onChangeText={(text) => {
            setPasteText(text);
            if (pasteError) setPasteError(null);
            if (pasteSuccess) setPasteSuccess(null);
          }}
          placeholder={
            "osmosis - water moving across a membrane\nATP: the cell's energy currency"
          }
          editable={!bulkAdding}
          multiline
          style={{ minHeight: 132, textAlignVertical: "top" }}
          error={pasteError}
        />
        {pasteText.trim().length === 0 ? null : readyCount === 0 ? (
          <AppText variant="caption" muted>
            No cards in there yet. Try lines like "osmosis - water moving
            across a membrane", one per line.
          </AppText>
        ) : (
          <AppText variant="caption" muted>
            {readyCount === 1 ? "1 card ready" : `${readyCount} cards ready`} ·{" "}
            {parsed.skipped === 1
              ? "1 line skipped"
              : `${parsed.skipped} lines skipped`}
          </AppText>
        )}
        {pasteSuccess ? (
          <AppText variant="caption" style={{ color: theme.success }}>
            {pasteSuccess}
          </AppText>
        ) : null}
        <Button
          label={readyCount === 1 ? "Add 1 card" : `Add ${readyCount} cards`}
          size="sm"
          pending={bulkAdding}
          disabled={bulkAdding || readyCount === 0}
          icon={<Feather name="plus" size={14} color={theme.brandFg} />}
          onPress={() => void handleBulkAdd()}
          style={{ alignSelf: "flex-start" }}
        />
      </Card>
    ) : (
      <View style={{ flexDirection: "row", gap: space.room }}>
        <Button
          label="Add a card"
          variant="secondary"
          icon={<Feather name="plus" size={16} color={theme.foreground} />}
          onPress={() => setComposer("single")}
          style={{ flex: 1 }}
        />
        <Button
          label="Paste cards"
          variant="secondary"
          icon={<Feather name="clipboard" size={16} color={theme.foreground} />}
          onPress={() => setComposer("paste")}
          style={{ flex: 1 }}
        />
      </View>
    );

  return scaffold(
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        data={cards}
        keyExtractor={(card) => card.id}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
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
        ListHeaderComponent={
          <View style={{ gap: space.close, marginBottom: space.card }}>
            <View style={{ gap: space.tight }}>
              <AppText variant="display">{deck.title}</AppText>
              <AppText variant="caption" muted>
                {deck.course ? `${deck.course.code} · ` : ""}
                {cardsLabel} ·{" "}
                {due > 0 ? `${due} due for you` : "nothing due for you"}
              </AppText>
              <View style={{ flexDirection: "row", marginTop: space.hair }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    gap: space.snug,
                    paddingHorizontal: space.room,
                    paddingVertical: space.tight,
                    borderRadius: radius.full,
                    backgroundColor: theme.surface2,
                  }}
                >
                  <Feather name="user" size={11} color={theme.muted} />
                  <AppText
                    variant="label"
                    muted
                    style={{ fontSize: 11, lineHeight: 14 }}
                  >
                    Started by {creatorName}
                  </AppText>
                </View>
              </View>
              {/* The note this deck came from, linking back to the course's
                  shared notes. A deleted note renders nothing. */}
              {deck.source_note_id && sourceNoteTitle ? (
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`From the notes: ${sourceNoteTitle}. Open the shared notes`}
                  onPress={() =>
                    router.push({
                      pathname: "/course/notes",
                      params: deck.course
                        ? {
                            courseId: deck.course_id,
                            courseCode: deck.course.code,
                          }
                        : { courseId: deck.course_id },
                    })
                  }
                  style={({ pressed }) => ({
                    alignSelf: "flex-start",
                    opacity: pressed ? 0.6 : 1,
                  })}
                >
                  <View
                    style={{
                      flexDirection: "row",
                      alignItems: "center",
                      gap: space.snug,
                      paddingHorizontal: space.room,
                      paddingVertical: space.tight,
                      borderRadius: radius.full,
                      backgroundColor: theme.surface2,
                    }}
                  >
                    <Feather name="file-text" size={11} color={theme.muted} />
                    <AppText
                      variant="label"
                      muted
                      numberOfLines={1}
                      style={{ fontSize: 11, lineHeight: 14 }}
                    >
                      From the notes: {sourceNoteTitle}
                    </AppText>
                  </View>
                </Pressable>
              ) : null}
            </View>

            {/* A deck with cards in it is always studyable. The schedule is
                a suggestion, not a lock: grade a deck "good" three days out
                and the old button went dark on the one night you needed it.
                With nothing due, the door opens a cram lap: the whole deck,
                no grading, no `card_reviews` written, so a panic run the
                night before an exam can't wreck the real spacing. */}
            <View style={{ gap: space.snug }}>
              <Button
                label={cram ? "Study anyway" : "Study"}
                size="lg"
                disabled={cards.length === 0}
                icon={<Feather name="play" size={18} color={theme.brandFg} />}
                onPress={() =>
                  router.push({
                    pathname: "/deck/study",
                    params: cram
                      ? { deckId: deck.id, cram: "1" }
                      : { deckId: deck.id },
                  })
                }
              />
              {cards.length === 0 ? (
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center" }}
                >
                  Add the first card and the studying can start.
                </AppText>
              ) : cram ? (
                <AppText
                  variant="caption"
                  muted
                  style={{ textAlign: "center" }}
                >
                  Nothing's due. A lap through the whole deck won't change
                  when these come back around.
                </AppText>
              ) : null}
            </View>

            <AppText variant="title" style={{ marginTop: space.hair }}>
              Cards
            </AppText>
            {composerSection}
            {actionError ? (
              <AppText variant="caption" style={{ color: theme.danger }}>
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
              <Feather name="file-text" size={18} color={theme.brand} />
            </View>
            <AppText variant="bodySemi">An empty deck, for now</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              Every card you add shows up for the whole class.
            </AppText>
          </Card>
        }
        renderItem={({ item }) => {
          if (editingId === item.id) {
            return (
              <Card style={{ gap: space.close, marginBottom: space.room }}>
                <AppText variant="title">Edit card</AppText>
                <Field
                  label="Front"
                  value={editFront}
                  onChangeText={(text) => {
                    setEditFront(text);
                    if (editError) setEditError(null);
                  }}
                  maxLength={1000}
                  multiline
                  autoFocus
                />
                <Field
                  label="Back"
                  value={editBack}
                  onChangeText={(text) => {
                    setEditBack(text);
                    if (editError) setEditError(null);
                  }}
                  maxLength={2000}
                  multiline
                  error={editError}
                />
                <View
                  style={{
                    flexDirection: "row",
                    justifyContent: "flex-end",
                    gap: space.cosy,
                  }}
                >
                  <Button
                    label="Cancel"
                    variant="ghost"
                    size="sm"
                    onPress={closeEdit}
                  />
                  <Button
                    label="Save"
                    size="sm"
                    disabled={
                      editFront.trim().length === 0 ||
                      editBack.trim().length === 0
                    }
                    onPress={() => void saveEdit(item)}
                  />
                </View>
              </Card>
            );
          }
          const mine = item.created_by === userId;
          return (
            <Pressable
              accessibilityRole={mine ? "button" : "none"}
              accessibilityLabel={`${item.front}${
                mine ? ". Long press to edit or delete" : ""
              }`}
              onLongPress={mine ? () => handleLongPress(item) : undefined}
              style={({ pressed }) => ({
                opacity: mine && pressed ? 0.85 : 1,
                marginBottom: space.room,
              })}
            >
              <Card
                padded={false}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.close,
                  paddingHorizontal: space.card,
                  paddingVertical: space.close,
                  minHeight: 52,
                }}
              >
                <AppText
                  variant="bodyMedium"
                  numberOfLines={1}
                  style={{ flex: 1, minWidth: 0 }}
                >
                  {item.front}
                </AppText>
                {mine ? (
                  <Feather name="edit-2" size={13} color={theme.muted} />
                ) : null}
              </Card>
            </Pressable>
          );
        }}
      />
      <Sheet
        visible={menu !== null}
        onClose={() => setMenu(null)}
        title={
          menuCard === null
            ? "Your card"
            : menuCard.front.length > 60
              ? `${menuCard.front.slice(0, 60)}…`
              : menuCard.front
        }
      >
        <Sheet.Row
          icon="edit-2"
          label="Edit card"
          onPress={runFromMenu(startEdit)}
        />
        <Sheet.Row
          icon="trash-2"
          label="Remove card"
          danger
          onPress={runFromMenu(confirmDelete)}
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
