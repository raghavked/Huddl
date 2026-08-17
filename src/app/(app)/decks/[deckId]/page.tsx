import { cache } from "react";
import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import {
  DeckHome,
  type DeckCardRow,
  type DeckInfo,
  type DeckReviewRow,
} from "@/features/flashcards/deck-home";
import { getCurrentUser } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";

type DeckQueryRow = {
  id: string;
  course_id: string;
  created_by: string | null;
  title: string;
  source_note_id: string | null;
  creator: { display_name: string } | null;
  course: { code: string } | null;
};

/** RLS hides other classes' decks, so outside the viewer's classes this is null. */
const getDeck = cache(async (deckId: string): Promise<DeckQueryRow | null> => {
  const supabase = await createClient();
  const { data } = await supabase
    .from("decks")
    .select(
      "id, course_id, created_by, title, source_note_id, creator:profiles(display_name), course:courses(code)"
    )
    .eq("id", deckId)
    .maybeSingle();
  return (data as unknown as DeckQueryRow | null) ?? null;
});

export async function generateMetadata({
  params,
}: {
  params: Promise<{ deckId: string }>;
}): Promise<Metadata> {
  const { deckId } = await params;
  const deck = await getDeck(deckId);
  return { title: deck ? deck.title : "Deck" };
}

/**
 * Deck home + study session on one page: the shared card list, a big Study
 * door, and (client-side) the flip-and-grade session itself. Cards are the
 * class's; the review rows loaded here are the viewer's alone.
 */
export default async function DeckPage({
  params,
  searchParams,
}: {
  params: Promise<{ deckId: string }>;
  searchParams: Promise<{ paste?: string }>;
}) {
  const [{ deckId }, { paste }, user] = await Promise.all([
    params,
    searchParams,
    getCurrentUser(),
  ]);
  if (!user) redirect("/login");

  const deck = await getDeck(deckId);
  // RLS hides other classes' decks, so "not found" covers both cases.
  if (!deck) notFound();

  const supabase = await createClient();
  const { data: cardRows } = await supabase
    .from("cards")
    .select("id, deck_id, created_by, front, back, position, created_at")
    .eq("deck_id", deck.id)
    .order("position", { ascending: true })
    .order("created_at", { ascending: true });
  const cards = (cardRows ?? []) as DeckCardRow[];

  let reviews: DeckReviewRow[] = [];
  if (cards.length > 0) {
    const { data: reviewRows } = await supabase
      .from("card_reviews")
      .select("card_id, streak, due_at")
      .eq("user_id", user.userId)
      .in(
        "card_id",
        cards.map((card) => card.id)
      );
    reviews = (reviewRows ?? []) as DeckReviewRow[];
  }

  // The note this deck was struck from (migration 0061), when there is one.
  // A deleted note (source_note_id set, row gone) leaves the title null and
  // the credit line simply doesn't render.
  let sourceNoteTitle: string | null = null;
  if (deck.source_note_id) {
    const { data: noteRow } = await supabase
      .from("notes")
      .select("title")
      .eq("id", deck.source_note_id)
      .maybeSingle();
    sourceNoteTitle = (noteRow as { title: string } | null)?.title ?? null;
  }

  const info: DeckInfo = {
    id: deck.id,
    course_id: deck.course_id,
    created_by: deck.created_by,
    title: deck.title,
    creator_name: deck.creator?.display_name ?? null,
    course_code: deck.course?.code ?? null,
    source_note_id: deck.source_note_id,
    source_note_title: sourceNoteTitle,
  };

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <DeckHome
        deck={info}
        userId={user.userId}
        initialCards={cards}
        initialReviews={reviews}
        openPaste={paste === "1"}
      />
    </div>
  );
}
