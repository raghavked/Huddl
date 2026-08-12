import Feather from "@expo/vector-icons/Feather";
import { Redirect, useFocusEffect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useRef, useState } from "react";
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
import { buildQueue } from "@/lib/srs";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The course's deck shelf: every shared flashcard deck for this class, with
   card counts and how many are due for YOU. Anyone can start a deck; deck
   creators can rename or retire theirs with a long press. */

/* Minimal local row shapes — the web app's types live outside this tsconfig. */
type DeckRow = {
  id: string;
  title: string;
  created_by: string | null;
  created_at: string;
};

type CardLite = { id: string; deck_id: string; position: number };

type DeckMeta = { total: number; due: number };

type Status = "loading" | "error" | "ready";

/** "12 cards · 4 due" — the shelf line under each deck title. */
function countsLabel(meta: DeckMeta | undefined): string {
  if (!meta || meta.total === 0) return "No cards yet — add the first one";
  const cards = meta.total === 1 ? "1 card" : `${meta.total} cards`;
  return meta.due > 0 ? `${cards} · ${meta.due} due` : `${cards} · all rested`;
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

export default function CourseDecksScreen() {
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

  const [status, setStatus] = useState<Status>("loading");
  const [decks, setDecks] = useState<DeckRow[]>([]);
  const [meta, setMeta] = useState<Map<string, DeckMeta>>(new Map());
  const [refreshing, setRefreshing] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  // Renaming one of your decks, inline where the row was.
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [renameError, setRenameError] = useState<string | null>(null);

  // The new-deck form.
  const [title, setTitle] = useState("");
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else if (id) {
      router.replace({ pathname: "/course/[id]", params: { id } });
    } else router.replace("/(tabs)/home");
  }, [router, id]);

  const load = useCallback(async () => {
    if (!userId || !id) {
      setStatus("error");
      return;
    }
    const decksRes = await supabase
      .from("decks")
      .select("id, title, created_by, created_at")
      .eq("course_id", id)
      .order("created_at", { ascending: true });
    if (decksRes.error) {
      setStatus("error");
      return;
    }
    const deckRows = (decksRes.data ?? []) as unknown as DeckRow[];

    // Card counts + your due counts, in two flat queries across all decks.
    let cards: CardLite[] = [];
    if (deckRows.length > 0) {
      const cardsRes = await supabase
        .from("cards")
        .select("id, deck_id, position")
        .in(
          "deck_id",
          deckRows.map((deck) => deck.id)
        )
        .order("position", { ascending: true })
        .order("created_at", { ascending: true });
      if (cardsRes.error) {
        setStatus("error");
        return;
      }
      cards = (cardsRes.data ?? []) as unknown as CardLite[];
    }
    const reviews = new Map<string, { dueAt: Date }>();
    if (cards.length > 0) {
      const reviewsRes = await supabase
        .from("card_reviews")
        .select("card_id, due_at")
        .eq("user_id", userId)
        .in(
          "card_id",
          cards.map((card) => card.id)
        );
      if (reviewsRes.error) {
        setStatus("error");
        return;
      }
      for (const row of (reviewsRes.data ?? []) as {
        card_id: string;
        due_at: string;
      }[]) {
        reviews.set(row.card_id, { dueAt: new Date(row.due_at) });
      }
    }

    const byDeck = new Map<string, CardLite[]>();
    for (const card of cards) {
      const bucket = byDeck.get(card.deck_id);
      if (bucket) bucket.push(card);
      else byDeck.set(card.deck_id, [card]);
    }
    const now = new Date();
    const nextMeta = new Map<string, DeckMeta>();
    for (const deck of deckRows) {
      const deckCards = byDeck.get(deck.id) ?? [];
      nextMeta.set(deck.id, {
        total: deckCards.length,
        // Full due-for-you count: new cards + due reviews, uncapped.
        due: buildQueue(deckCards, reviews, now, deckCards.length).length,
      });
    }
    // The shelf sorts by what's waiting for YOU, biggest pile first, and
    // falls back to the order the decks were started. Oldest-first put week
    // 1 vocab at the top of every visit while the deck a classmate filled
    // yesterday sat at the bottom — the "40 due" badge sorted nothing.
    const shelved = [...deckRows].sort(
      (a, b) =>
        (nextMeta.get(b.id)?.due ?? 0) - (nextMeta.get(a.id)?.due ?? 0) ||
        a.created_at.localeCompare(b.created_at)
    );
    setDecks(shelved);
    setMeta(nextMeta);
    setStatus("ready");
  }, [userId, id]);

  // Reload on every focus, so counts settle after a study session next door.
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

  /* -------------------- rename / delete (yours only) -------------------- */

  const startRename = useCallback((deck: DeckRow) => {
    setRenamingId(deck.id);
    setRenameValue(deck.title);
    setRenameError(null);
  }, []);

  const closeRename = useCallback(() => {
    setRenamingId(null);
    setRenameValue("");
    setRenameError(null);
  }, []);

  const saveRename = useCallback(
    async (deck: DeckRow) => {
      const nextTitle = renameValue.trim();
      if (nextTitle.length < 1 || nextTitle.length > 120) {
        setRenameError("Deck titles run 1–120 characters.");
        return;
      }
      // Optimistic: the shelf updates now, and reverts if the server minds.
      const before = decks;
      setDecks((prev) =>
        prev.map((row) => (row.id === deck.id ? { ...row, title: nextTitle } : row))
      );
      closeRename();
      const { error } = await supabase
        .from("decks")
        .update({ title: nextTitle })
        .eq("id", deck.id);
      if (error) {
        setDecks(before);
        setActionError("That rename didn't stick — give it another try.");
      }
    },
    [renameValue, decks, closeRename]
  );

  const deleteDeck = useCallback(
    async (deck: DeckRow) => {
      setActionError(null);
      const before = decks;
      setDecks((prev) => prev.filter((row) => row.id !== deck.id));
      const { error } = await supabase.from("decks").delete().eq("id", deck.id);
      if (error) {
        setDecks(before);
        setActionError("We couldn't delete that deck. Give it another try.");
      }
    },
    [decks]
  );

  const confirmDelete = useCallback(
    (deck: DeckRow) => {
      Alert.alert(
        `Delete “${deck.title}”?`,
        "It goes for the whole class, cards and all.",
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Delete deck",
            style: "destructive",
            onPress: () => void deleteDeck(deck),
          },
        ]
      );
    },
    [deleteDeck]
  );

  /* The owner menu, as the same warm sheet every other long-press in the app
     opens. Hold onto the deck while the card slides away so its title doesn't
     blank out mid-dismissal. */
  const [menu, setMenu] = useState<DeckRow | null>(null);
  const lastMenu = useRef<DeckRow | null>(null);
  if (menu !== null) lastMenu.current = menu;
  const menuDeck = menu ?? lastMenu.current;

  const handleLongPress = useCallback(
    (deck: DeckRow) => {
      if (deck.created_by !== userId) return; // only your own decks
      setMenu(deck);
    },
    [userId]
  );

  /** Close the sheet first, then act — the row is about to change under it. */
  const runFromMenu = useCallback(
    (action: (deck: DeckRow) => void) => () => {
      const deck = menu;
      setMenu(null);
      if (deck) action(deck);
    },
    [menu]
  );

  /* ------------------------------ new deck ------------------------------ */

  const trimmedTitle = title.trim();

  const handleCreate = useCallback(async () => {
    if (!userId || !id || creating) return;
    const deckTitle = title.trim();
    if (deckTitle.length < 1 || deckTitle.length > 120) {
      setCreateError("Deck titles run 1–120 characters.");
      return;
    }
    setCreateError(null);
    setCreating(true);
    const { data, error } = await supabase
      .from("decks")
      .insert({ course_id: id, created_by: userId, title: deckTitle })
      .select("id, title, created_by, created_at")
      .single();
    setCreating(false);
    if (error || !data) {
      setCreateError(
        error?.message.includes("row-level security")
          ? "Decks are for classmates — add this course to your classes first."
          : "We couldn't start that deck just now. Give it another try."
      );
      return;
    }
    const row = data as unknown as DeckRow;
    setDecks((prev) => [...prev, row]);
    setMeta((prev) => new Map(prev).set(row.id, { total: 0, due: 0 }));
    setTitle("");
    router.push(`/deck/${row.id}`);
  }, [userId, id, creating, title, router]);

  // Deep links land here directly — a signed-out visitor gets a proper door.
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

  if (!id) {
    return scaffold(
      centered(
        <>
          <Feather name="book-open" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Course not available</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            We couldn't tell which course this is. Head back and try again from
            the course page.
          </AppText>
          <Button label="Back" variant="soft" size="sm" onPress={goBack} />
        </>
      )
    );
  }

  if (status === "loading") {
    return scaffold(
      centered(
        <>
          <ActivityIndicator size="large" color={theme.brand} />
          <AppText variant="caption" muted>
            Pulling the decks off the shelf…
          </AppText>
        </>
      )
    );
  }

  if (status === "error") {
    return scaffold(
      centered(
        <>
          <Feather name="wifi-off" size={28} color={theme.muted} />
          <AppText variant="bodySemi">Something hiccuped</AppText>
          <AppText
            variant="caption"
            muted
            style={{ textAlign: "center", maxWidth: 260 }}
          >
            We couldn't load this course's decks. Check your connection and
            give it another go.
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
    );
  }

  /* ------------------------------ the shelf ------------------------------ */

  const ownerSheet = (
    <Sheet
      visible={menu !== null}
      onClose={() => setMenu(null)}
      title={menuDeck?.title ?? "Your deck"}
    >
      <Sheet.Row
        icon="edit-2"
        label="Rename deck"
        onPress={runFromMenu(startRename)}
      />
      <Sheet.Row
        icon="trash-2"
        label="Delete deck"
        danger
        onPress={runFromMenu(confirmDelete)}
      />
      {/* 46 lines this up with the row labels above rather than the sheet's
          edge: Sheet.Row draws a 36px icon tile and a 10 gap. An alignment
          taken from the primitive, not a spacing choice. */}
      <AppText
        variant="caption"
        muted
        style={{ marginLeft: 46, marginTop: space.hair }}
      >
        Deleting takes it down for everyone in the class.
      </AppText>
    </Sheet>
  );

  return scaffold(
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        data={decks}
        keyExtractor={(deck) => deck.id}
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
          <View style={{ gap: space.tight, marginBottom: space.card }}>
            <AppText variant="display">
              {courseCode ? `${courseCode} flashcards` : "Flashcards"}
            </AppText>
            <AppText variant="caption" muted>
              Shared decks — anyone in the class can add cards. How well you
              know them stays yours.
            </AppText>
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
              <Feather name="layers" size={18} color={theme.brand} />
            </View>
            <AppText variant="bodySemi">No decks yet</AppText>
            <AppText
              variant="caption"
              muted
              style={{ textAlign: "center", maxWidth: 260 }}
            >
              Start one and the whole class can pile in.
            </AppText>
          </Card>
        }
        renderItem={({ item }) => {
          if (renamingId === item.id) {
            return (
              <Card style={{ gap: space.close, marginBottom: space.room }}>
                <AppText variant="title">Rename deck</AppText>
                <Field
                  label="Deck title"
                  value={renameValue}
                  onChangeText={(text) => {
                    setRenameValue(text);
                    if (renameError) setRenameError(null);
                  }}
                  placeholder="Midterm 1 vocab"
                  maxLength={120}
                  error={renameError}
                  autoFocus
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
                    onPress={closeRename}
                  />
                  <Button
                    label="Save"
                    size="sm"
                    disabled={renameValue.trim().length === 0}
                    onPress={() => void saveRename(item)}
                  />
                </View>
              </Card>
            );
          }
          const mine = item.created_by === userId;
          return (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Open ${item.title} — ${countsLabel(meta.get(item.id))}${
                mine ? ". Long press to rename or delete" : ""
              }`}
              onPress={() => router.push(`/deck/${item.id}`)}
              onLongPress={mine ? () => handleLongPress(item) : undefined}
              style={({ pressed }) => ({
                opacity: pressed ? 0.85 : 1,
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
                  <Feather name="layers" size={18} color={theme.brand} />
                </View>
                <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
                  <AppText variant="bodySemi" numberOfLines={1}>
                    {item.title}
                  </AppText>
                  <AppText variant="caption" muted numberOfLines={1}>
                    {countsLabel(meta.get(item.id))}
                  </AppText>
                </View>
                {(meta.get(item.id)?.due ?? 0) > 0 ? (
                  <View
                    style={{
                      paddingHorizontal: space.cosy,
                      paddingVertical: 3,
                      borderRadius: radius.full,
                      backgroundColor: theme.brandSoft,
                    }}
                  >
                    <AppText
                      variant="label"
                      style={{ color: theme.brandInk, fontSize: 11, lineHeight: 14 }}
                    >
                      {meta.get(item.id)?.due} due
                    </AppText>
                  </View>
                ) : null}
                <Feather name="chevron-right" size={16} color={theme.muted} />
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
              <AppText variant="title">New deck</AppText>
            </View>
            <AppText variant="caption" muted>
              One topic per deck works best — a chapter, a lecture, a pile of
              formulas.
            </AppText>
            <Field
              label="Deck title"
              value={title}
              onChangeText={(text) => {
                setTitle(text);
                if (createError) setCreateError(null);
              }}
              placeholder="Midterm 1 vocab"
              maxLength={120}
              editable={!creating}
              error={createError}
            />
            <Button
              label="Create deck"
              pending={creating}
              disabled={creating || trimmedTitle.length === 0}
              icon={<Feather name="plus" size={16} color={theme.brandFg} />}
              onPress={() => void handleCreate()}
              style={{ alignSelf: "flex-start" }}
            />
          </Card>
        }
      />
      {ownerSheet}
    </KeyboardAvoidingView>
  );
}
