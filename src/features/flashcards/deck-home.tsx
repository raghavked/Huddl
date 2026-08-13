"use client";

import { useMemo, useState } from "react";
import {
  Check,
  ChevronLeft,
  CircleAlert,
  ClipboardList,
  Coffee,
  FileText,
  Loader2,
  Pencil,
  Play,
  Plus,
  RotateCcw,
  Trash2,
  UserRound,
  X,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Button,
  Card,
  Label,
  PageHeader,
  Textarea,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { buildQueue, nextReview, type Grade } from "@/lib/srs";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* Deck home + study mode on one page: the shared card list with a big Study
   door, and, once the door opens, one card at a time, click to flip, three
   honest buttons. Any classmate adds cards; authors edit or remove their own.
   Due counts are yours alone. Nobody else sees how you're doing. */

/** Serializable rows the deck page passes down. */
export type DeckCardRow = {
  id: string;
  deck_id: string;
  created_by: string | null;
  front: string;
  back: string;
  position: number;
  created_at: string;
};

export type DeckReviewRow = { card_id: string; streak: number; due_at: string };

export type DeckInfo = {
  id: string;
  course_id: string;
  created_by: string | null;
  title: string;
  creator_name: string | null;
  course_code: string | null;
};

type ReviewsMap = Map<string, { streak: number; dueAt: Date }>;

/** Which card form is open. One at a time, both closed by default. */
type Composer = "none" | "single" | "paste";

const CARD_SELECT = "id, deck_id, created_by, front, back, position, created_at";

/* ------------------------------ paste parser ------------------------------ */

type ParsedCard = { front: string; back: string };

/** Separators a pasted line can use, checked in this order. */
const PASTE_SEPARATORS = [" - ", " \u2014 ", ": ", "\t"] as const;

/**
 * One card per line: split on the first separator in {@link PASTE_SEPARATORS}
 * (spaced hyphen, spaced em dash, colon, then tab), trim both sides, and skip
 * anything that doesn't make a card: no separator, an empty side, an oversized
 * side, or a front the deck (or an earlier line) already has, compared
 * case-insensitively.
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

type Counts = { again: number; good: number; easy: number };

const ZERO_COUNTS: Counts = { again: 0, good: 0, easy: 0 };

/** "10 min", "1 day", "30 days": what pressing a button buys you. */
function intervalPreview(
  prev: { streak: number } | null,
  grade: Grade,
  now: Date
): string {
  const { dueAt } = nextReview(prev, grade, now);
  const minutes = Math.round((dueAt.getTime() - now.getTime()) / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const days = Math.round(minutes / (60 * 24));
  return days === 1 ? "1 day" : `${days} days`;
}

const GRADE_BUTTON: Record<Grade, { label: string; className: string }> = {
  // "Again" is a soft danger: a nudge, not an alarm.
  again: {
    label: "Again",
    className:
      "border-danger/35 bg-danger/10 text-danger focus-visible:outline-danger",
  },
  good: { label: "Good", className: "border-border bg-surface text-foreground" },
  easy: { label: "Easy", className: "border-brand bg-brand text-brand-fg" },
};

function GradeButton({
  grade,
  sublabel,
  pending,
  disabled,
  onClick,
}: {
  grade: Grade;
  sublabel: string;
  pending: boolean;
  disabled: boolean;
  onClick: () => void;
}) {
  const meta = GRADE_BUTTON[grade];
  return (
    <button
      type="button"
      aria-label={`${meta.label}, next look in ${sublabel}`}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        "flex min-h-14 flex-1 flex-col items-center justify-center gap-0.5 rounded-2xl border font-semibold transition-all active:scale-[0.98]",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "disabled:pointer-events-none",
        disabled && !pending ? "opacity-60" : "",
        meta.className
      )}
    >
      {pending ? (
        <Loader2 className="size-4 animate-spin" aria-hidden />
      ) : (
        <>
          <span className="text-sm">{meta.label}</span>
          <span className="text-[11px] font-medium opacity-80">{sublabel}</span>
        </>
      )}
    </button>
  );
}

export function DeckHome({
  deck,
  userId,
  initialCards,
  initialReviews,
}: {
  deck: DeckInfo;
  userId: string;
  initialCards: DeckCardRow[];
  initialReviews: DeckReviewRow[];
}) {
  const [cards, setCards] = useState<DeckCardRow[]>(initialCards);
  const [reviews, setReviews] = useState<ReviewsMap>(
    () =>
      new Map(
        initialReviews.map((row) => [
          row.card_id,
          { streak: row.streak, dueAt: new Date(row.due_at) },
        ])
      )
  );
  const [actionError, setActionError] = useState<string | null>(null);

  // Deck view <-> study mode, one page.
  const [studying, setStudying] = useState(false);
  const [queue, setQueue] = useState<DeckCardRow[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [grading, setGrading] = useState<Grade | null>(null);
  const [counts, setCounts] = useState<Counts>(ZERO_COUNTS);
  const [againIds, setAgainIds] = useState<string[]>([]);
  const [sessionError, setSessionError] = useState<string | null>(null);

  // The card forms: one card at a time, or a whole pasted stack. Both stay
  // tucked behind their buttons until needed.
  const [composer, setComposer] = useState<Composer>("none");
  const [front, setFront] = useState("");
  const [back, setBack] = useState("");
  const [adding, setAdding] = useState(false);
  const [addError, setAddError] = useState<string | null>(null);
  const [pasteText, setPasteText] = useState("");
  const [bulkAdding, setBulkAdding] = useState(false);
  const [pasteError, setPasteError] = useState<string | null>(null);
  const [pasteSuccess, setPasteSuccess] = useState<string | null>(null);

  // Editing one of your own cards, inline where the row was.
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editFront, setEditFront] = useState("");
  const [editBack, setEditBack] = useState("");
  const [editError, setEditError] = useState<string | null>(null);

  // Removing one of your own cards: inline confirm, no modal.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  const [deletingId, setDeletingId] = useState<string | null>(null);

  /* ---------------------------- study session ---------------------------- */

  function startStudy() {
    // New cards first, then oldest-due, capped so it stays one sitting.
    setQueue(buildQueue(cards, reviews, new Date()));
    setIndex(0);
    setRevealed(false);
    setCounts(ZERO_COUNTS);
    setAgainIds([]);
    setSessionError(null);
    setStudying(true);
  }

  async function handleGrade(grade: Grade) {
    const card = queue[index];
    if (!card || grading) return;
    const now = new Date();
    const prevState = reviews.get(card.id) ?? null;
    const next = nextReview(
      prevState ? { streak: prevState.streak } : null,
      grade,
      now
    );
    setSessionError(null);
    setGrading(grade);
    // Save first, advance after, so leaving mid-stack never loses a grade.
    const supabase = createClient();
    const { error } = await supabase.from("card_reviews").upsert(
      {
        user_id: userId,
        card_id: card.id,
        streak: next.streak,
        last_grade: grade,
        due_at: next.dueAt.toISOString(),
        updated_at: now.toISOString(),
      },
      { onConflict: "user_id,card_id" }
    );
    setGrading(null);
    if (error) {
      setSessionError("That grade didn't save. Give the button another click.");
      return;
    }
    setReviews((prev) =>
      new Map(prev).set(card.id, { streak: next.streak, dueAt: next.dueAt })
    );
    setCounts((prev) => ({
      again: prev.again + (grade === "again" ? 1 : 0),
      good: prev.good + (grade === "good" ? 1 : 0),
      easy: prev.easy + (grade === "easy" ? 1 : 0),
    }));
    if (grade === "again") {
      setAgainIds((prev) =>
        prev.includes(card.id) ? prev : [...prev, card.id]
      );
    }
    setRevealed(false);
    setIndex((prev) => prev + 1);
  }

  /** Re-run just the cards graded "again". They're due back in minutes. */
  function studyAgain() {
    const rerun = new Set(againIds);
    const nextQueue = queue.filter((card) => rerun.has(card.id));
    if (nextQueue.length === 0) return;
    setQueue(nextQueue);
    setIndex(0);
    setRevealed(false);
    setCounts(ZERO_COUNTS);
    setAgainIds([]);
    setSessionError(null);
  }

  /* ------------------------------ add a card ----------------------------- */

  function resetForm() {
    setComposer("none");
    setFront("");
    setBack("");
    setAddError(null);
  }

  async function handleAdd() {
    if (adding) return;
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
    const supabase = createClient();
    const { data, error } = await supabase
      .from("cards")
      .insert({
        deck_id: deck.id,
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
    setCards((prev) => [...prev, data as unknown as DeckCardRow]);
    // Keep the form open and clear. Card entry comes in bursts.
    setFront("");
    setBack("");
  }

  /* ------------------------- paste a stack at once ------------------------ */

  function resetPaste() {
    setComposer("none");
    setPasteText("");
    setPasteError(null);
    setPasteSuccess(null);
  }

  const existingFronts = useMemo(
    () => new Set(cards.map((card) => card.front.trim().toLowerCase())),
    [cards]
  );

  const parsed = useMemo(
    () => parsePastedCards(pasteText, existingFronts),
    [pasteText, existingFronts]
  );
  const readyCount = parsed.cards.length;

  async function handleBulkAdd() {
    if (bulkAdding) return;
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
    const supabase = createClient();
    const { data, error } = await supabase
      .from("cards")
      .insert(
        ready.map((card, offset) => ({
          deck_id: deck.id,
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
    const inserted = [...(data as unknown as DeckCardRow[])].sort(
      (a, b) => a.position - b.position
    );
    setCards((prev) => [...prev, ...inserted]);
    setPasteText("");
    setPasteSuccess(
      `${inserted.length === 1 ? "1 card" : `${inserted.length} cards`} in. The class thanks you.`
    );
  }

  /* ---------------------- edit / delete (yours only) ---------------------- */

  function startEdit(card: DeckCardRow) {
    setConfirmingId(null);
    setEditingId(card.id);
    setEditFront(card.front);
    setEditBack(card.back);
    setEditError(null);
  }

  function closeEdit() {
    setEditingId(null);
    setEditFront("");
    setEditBack("");
    setEditError(null);
  }

  async function saveEdit(card: DeckCardRow) {
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
    const supabase = createClient();
    const { error } = await supabase
      .from("cards")
      .update({ front: frontText, back: backText })
      .eq("id", card.id);
    if (error) {
      setCards(before);
      setActionError("That edit didn't stick. Give it another try.");
    }
  }

  async function deleteCard(card: DeckCardRow) {
    setActionError(null);
    setDeletingId(card.id);
    const before = cards;
    setCards((prev) => prev.filter((row) => row.id !== card.id));
    const supabase = createClient();
    const { error } = await supabase.from("cards").delete().eq("id", card.id);
    setDeletingId(null);
    setConfirmingId(null);
    if (error) {
      setCards(before);
      setActionError("We couldn't remove that card. Give it another try.");
    }
  }

  /* ------------------------------ study mode ------------------------------ */

  if (studying) {
    const finished = index >= queue.length;
    const card = queue[index];
    const now = new Date();
    const prevState = card ? reviews.get(card.id) ?? null : null;
    const prevStreak = prevState ? { streak: prevState.streak } : null;

    return (
      <div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setStudying(false)}
            className="inline-flex items-center gap-1 rounded-full text-sm font-semibold text-muted transition-colors hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-brand"
          >
            <ChevronLeft className="size-4" aria-hidden />
            {deck.title}
          </button>
          {!finished && queue.length > 0 ? (
            <p className="ml-auto text-sm font-semibold" aria-live="polite">
              {Math.min(index + 1, queue.length)} of {queue.length}
            </p>
          ) : null}
        </div>

        {queue.length === 0 ? (
          <div className="mt-6 rounded-card border border-dashed border-border">
            <EmptyState
              icon={Coffee}
              title="Nothing due right now"
              description="The schedule knows what it's doing. Check back tomorrow."
              action={
                <Button variant="soft" size="sm" onClick={() => setStudying(false)}>
                  Back to the deck
                </Button>
              }
            />
          </div>
        ) : finished ? (
          <div className="mt-10 flex animate-fade-up flex-col items-center gap-4 px-6 text-center">
            <span className="flex size-14 items-center justify-center rounded-full bg-accent-soft text-accent">
              <Check className="size-6" aria-hidden />
            </span>
            <div>
              <p className="text-lg font-bold tracking-tight">
                That&apos;s the stack
              </p>
              <p className="mx-auto mt-1 max-w-sm text-sm text-muted">
                {counts.again + counts.good + counts.easy === 1
                  ? "1 card"
                  : `${counts.again + counts.good + counts.easy} cards`}{" "}
                handled. Come back when they&apos;re due.
              </p>
            </div>
            <div className="flex flex-wrap justify-center gap-2">
              <span className="rounded-full bg-danger/10 px-2.5 py-1 text-[11px] font-semibold text-danger">
                Again {counts.again}
              </span>
              <span className="rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted">
                Good {counts.good}
              </span>
              <span className="rounded-full bg-brand-soft px-2.5 py-1 text-[11px] font-semibold text-brand-ink">
                Easy {counts.easy}
              </span>
            </div>
            <div className="mt-2 flex flex-col items-center gap-2">
              {againIds.length > 0 ? (
                <>
                  <Button onClick={studyAgain}>
                    <RotateCcw className="size-4" aria-hidden />
                    Study again now
                  </Button>
                  <p className="text-xs text-muted">
                    {againIds.length === 1
                      ? "The one you marked “again” is"
                      : `The ${againIds.length} you marked “again” are`}{" "}
                    ready for another lap.
                  </p>
                </>
              ) : null}
              <Button
                variant={againIds.length > 0 ? "ghost" : "soft"}
                size="sm"
                onClick={() => setStudying(false)}
              >
                Back to the deck
              </Button>
            </div>
          </div>
        ) : card ? (
          <div className="mt-6">
            <button
              type="button"
              onClick={() => setRevealed((prev) => !prev)}
              aria-label={
                revealed ? "Card back shown. Click to flip" : "Click to flip"
              }
              className={cardClasses({
                padding: "none",
                className:
                  "flex min-h-72 w-full cursor-pointer flex-col items-center justify-center gap-4 p-6 text-center transition-all hover:border-brand/25 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
              })}
            >
              <span className="text-xl font-bold tracking-tight text-balance">
                {card.front}
              </span>
              {revealed ? (
                <>
                  <span className="h-px w-full self-stretch bg-border" aria-hidden />
                  <span className="text-base text-pretty">{card.back}</span>
                </>
              ) : (
                <span className="text-xs text-muted">Click to flip</span>
              )}
            </button>

            {revealed ? (
              <div className="mt-4">
                <div className="flex gap-2.5">
                  {(["again", "good", "easy"] as const).map((grade) => (
                    <GradeButton
                      key={grade}
                      grade={grade}
                      sublabel={intervalPreview(prevStreak, grade, now)}
                      pending={grading === grade}
                      disabled={grading !== null}
                      onClick={() => void handleGrade(grade)}
                    />
                  ))}
                </div>
                {sessionError ? (
                  <p
                    role="alert"
                    className="mt-3 text-center text-xs font-medium text-danger"
                  >
                    {sessionError}
                  </p>
                ) : null}
              </div>
            ) : null}

            <p className="mt-4 text-center text-xs text-muted">
              Leave anytime. Every grade saves as you go.
            </p>
          </div>
        ) : null}
      </div>
    );
  }

  /* ------------------------------ deck home ------------------------------ */

  // New cards count as due, so the queue length IS the honest due count.
  const due = buildQueue(cards, reviews, new Date(), cards.length).length;
  const cardsLabel = cards.length === 1 ? "1 card" : `${cards.length} cards`;
  const creatorName =
    deck.created_by === userId ? "you" : deck.creator_name ?? "a classmate";

  return (
    <div>
      <PageHeader
        backHref={`/courses/${deck.course_id}/decks`}
        backLabel={deck.course_code ? `${deck.course_code} decks` : "Decks"}
        title={deck.title}
        description={`${deck.course_code ? `${deck.course_code} · ` : ""}${cardsLabel} · ${
          due > 0 ? `${due} due for you` : "nothing due for you"
        }`}
      />

      <div className="mt-4 flex items-center">
        <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-muted">
          <UserRound className="size-3" aria-hidden />
          Started by {creatorName}
        </span>
      </div>

      <div className="mt-6">
        <Button
          size="lg"
          disabled={due === 0}
          onClick={startStudy}
          className="w-full sm:w-auto sm:px-10"
        >
          <Play className="size-4" aria-hidden />
          Study
        </Button>
        {due === 0 ? (
          <p className="mt-2 text-xs text-muted">
            {cards.length === 0
              ? "Add the first card and the studying can start."
              : "Nothing due. Check back tomorrow."}
          </p>
        ) : null}
      </div>

      <section className="mt-8" aria-label="Cards">
        <h2 className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
          Cards
        </h2>

        <div className="mt-3">
          {composer === "single" ? (
            <Card className="animate-fade-up">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold tracking-tight">Add a card</h3>
                <button
                  type="button"
                  onClick={resetForm}
                  disabled={adding}
                  aria-label="Close the card form"
                  className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleAdd();
                }}
              >
                <div className="mt-3">
                  <Label htmlFor="card-front">Front</Label>
                  <Textarea
                    id="card-front"
                    value={front}
                    onChange={(e) => {
                      setFront(e.target.value);
                      if (addError) setAddError(null);
                    }}
                    placeholder="What does RLS stand for?"
                    maxLength={1000}
                    disabled={adding}
                    className="mt-1.5 min-h-20"
                  />
                </div>
                <div className="mt-3">
                  <Label htmlFor="card-back">Back</Label>
                  <Textarea
                    id="card-back"
                    value={back}
                    onChange={(e) => {
                      setBack(e.target.value);
                      if (addError) setAddError(null);
                    }}
                    placeholder="Row-level security"
                    maxLength={2000}
                    disabled={adding}
                    aria-describedby={addError ? "card-add-error" : undefined}
                    className="mt-1.5 min-h-20"
                  />
                </div>
                {addError ? (
                  <p
                    id="card-add-error"
                    role="alert"
                    className="mt-3 text-xs font-medium text-danger"
                  >
                    {addError}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  className="mt-4"
                  disabled={
                    adding ||
                    front.trim().length === 0 ||
                    back.trim().length === 0
                  }
                >
                  {adding ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-3.5" aria-hidden />
                  )}
                  Add card
                </Button>
              </form>
            </Card>
          ) : composer === "paste" ? (
            <Card className="animate-fade-up">
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-bold tracking-tight">Paste cards</h3>
                <button
                  type="button"
                  onClick={resetPaste}
                  disabled={bulkAdding}
                  aria-label="Close the paste form"
                  className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                >
                  <X className="size-4" aria-hidden />
                </button>
              </div>
              <form
                onSubmit={(e) => {
                  e.preventDefault();
                  void handleBulkAdd();
                }}
              >
                <div className="mt-3">
                  <Label htmlFor="card-paste">
                    One card per line, front and back separated by a dash,
                    colon, or tab
                  </Label>
                  <Textarea
                    id="card-paste"
                    value={pasteText}
                    onChange={(e) => {
                      setPasteText(e.target.value);
                      if (pasteError) setPasteError(null);
                      if (pasteSuccess) setPasteSuccess(null);
                    }}
                    placeholder={
                      "osmosis - water moving across a membrane\nATP: the cell's energy currency"
                    }
                    disabled={bulkAdding}
                    aria-describedby="card-paste-status"
                    className="mt-1.5 min-h-32"
                  />
                </div>
                <p
                  id="card-paste-status"
                  aria-live="polite"
                  className="mt-2 min-h-4 text-xs text-muted"
                >
                  {pasteText.trim().length === 0
                    ? null
                    : readyCount === 0
                      ? "No cards in there yet. Try lines like “osmosis - water moving across a membrane”, one per line."
                      : `${readyCount === 1 ? "1 card ready" : `${readyCount} cards ready`} · ${
                          parsed.skipped === 1
                            ? "1 line skipped"
                            : `${parsed.skipped} lines skipped`
                        }`}
                </p>
                {pasteError ? (
                  <p role="alert" className="mt-2 text-xs font-medium text-danger">
                    {pasteError}
                  </p>
                ) : null}
                {pasteSuccess ? (
                  <p role="status" className="mt-2 text-xs font-medium text-success">
                    {pasteSuccess}
                  </p>
                ) : null}
                <Button
                  type="submit"
                  size="sm"
                  className="mt-4"
                  disabled={bulkAdding || readyCount === 0}
                >
                  {bulkAdding ? (
                    <Loader2 className="size-3.5 animate-spin" aria-hidden />
                  ) : (
                    <Plus className="size-3.5" aria-hidden />
                  )}
                  {readyCount === 1 ? "Add 1 card" : `Add ${readyCount} cards`}
                </Button>
              </form>
            </Card>
          ) : (
            <div className="flex flex-wrap gap-2.5">
              <Button variant="secondary" onClick={() => setComposer("single")}>
                <Plus className="size-4" aria-hidden />
                Add a card
              </Button>
              <Button
                variant="secondary"
                onClick={() => {
                  setPasteSuccess(null);
                  setComposer("paste");
                }}
              >
                <ClipboardList className="size-4" aria-hidden />
                Paste cards
              </Button>
            </div>
          )}
        </div>

        {actionError ? (
          <p
            role="alert"
            className="mt-4 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
          >
            <CircleAlert className="mt-0.5 size-4 shrink-0" aria-hidden />
            {actionError}
          </p>
        ) : null}

        {cards.length === 0 ? (
          <div className="mt-4 rounded-card border border-dashed border-border">
            <EmptyState
              icon={FileText}
              title="An empty deck, for now"
              description="Every card you add shows up for the whole class."
            />
          </div>
        ) : (
          <ul className="mt-4 flex flex-col gap-2.5">
            {cards.map((card) => {
              if (editingId === card.id) {
                return (
                  <li key={card.id}>
                    <Card className="animate-fade-up">
                      <h3 className="font-bold tracking-tight">Edit card</h3>
                      <form
                        onSubmit={(e) => {
                          e.preventDefault();
                          void saveEdit(card);
                        }}
                      >
                        <div className="mt-3">
                          <Label htmlFor={`edit-front-${card.id}`}>Front</Label>
                          <Textarea
                            id={`edit-front-${card.id}`}
                            value={editFront}
                            onChange={(e) => {
                              setEditFront(e.target.value);
                              if (editError) setEditError(null);
                            }}
                            maxLength={1000}
                            autoFocus
                            className="mt-1.5 min-h-20"
                          />
                        </div>
                        <div className="mt-3">
                          <Label htmlFor={`edit-back-${card.id}`}>Back</Label>
                          <Textarea
                            id={`edit-back-${card.id}`}
                            value={editBack}
                            onChange={(e) => {
                              setEditBack(e.target.value);
                              if (editError) setEditError(null);
                            }}
                            maxLength={2000}
                            className="mt-1.5 min-h-20"
                          />
                        </div>
                        {editError ? (
                          <p
                            role="alert"
                            className="mt-3 text-xs font-medium text-danger"
                          >
                            {editError}
                          </p>
                        ) : null}
                        <div className="mt-4 flex justify-end gap-2">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={closeEdit}
                          >
                            Cancel
                          </Button>
                          <Button
                            type="submit"
                            size="sm"
                            disabled={
                              editFront.trim().length === 0 ||
                              editBack.trim().length === 0
                            }
                          >
                            Save
                          </Button>
                        </div>
                      </form>
                    </Card>
                  </li>
                );
              }
              const mine = card.created_by === userId;
              return (
                <li
                  key={card.id}
                  className={cardClasses({
                    padding: "none",
                    className: "flex min-h-13 items-center gap-2 py-2.5 pl-4 pr-2",
                  })}
                >
                  <p className="min-w-0 flex-1 truncate text-sm font-medium">
                    {card.front}
                  </p>
                  {mine ? (
                    confirmingId === card.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <span className="text-xs font-medium text-muted">
                          Remove for the class?
                        </span>
                        <button
                          type="button"
                          onClick={() => void deleteCard(card)}
                          disabled={deletingId === card.id}
                          className={buttonClasses({
                            variant: "danger",
                            size: "sm",
                          })}
                        >
                          {deletingId === card.id ? (
                            <Loader2
                              className="size-3.5 animate-spin"
                              aria-hidden
                            />
                          ) : null}
                          Yes
                        </button>
                        <button
                          type="button"
                          onClick={() => setConfirmingId(null)}
                          disabled={deletingId === card.id}
                          aria-label="Keep this card"
                          className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground disabled:pointer-events-none disabled:opacity-60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        >
                          <X className="size-4" aria-hidden />
                        </button>
                      </span>
                    ) : (
                      <span className="flex shrink-0 items-center">
                        <button
                          type="button"
                          onClick={() => startEdit(card)}
                          aria-label={`Edit card: ${card.front}`}
                          title="Edit"
                          className="rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                        >
                          <Pencil className="size-4" aria-hidden />
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setActionError(null);
                            setConfirmingId(card.id);
                          }}
                          aria-label={`Remove card: ${card.front}`}
                          title="Remove"
                          className="rounded-full p-2 text-muted transition-colors hover:bg-danger/10 hover:text-danger focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-danger"
                        >
                          <Trash2 className="size-4" aria-hidden />
                        </button>
                      </span>
                    )
                  ) : null}
                </li>
              );
            })}
          </ul>
        )}
      </section>
    </div>
  );
}
