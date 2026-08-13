import Feather from "@expo/vector-icons/Feather";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Alert,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  SectionLabel,
  Sheet,
  Skeleton,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  CATEGORY_NAME_MAX,
  ENTRY_TITLE_MAX,
  GradesError,
  POINTS_MAX,
  WEIGHT_MAX,
  categoryScore,
  courseEstimate,
  createCategory,
  createEntry,
  deleteCategory,
  deleteEntry,
  fetchGradeBook,
  letterFor,
  updateCategory,
  updateEntry,
  weightWarning,
  whatIf,
  type GradeCategory,
  type GradeEntry,
} from "@/lib/grades";
import { tapSuccess } from "@/lib/haptics";
import { useAuth } from "@/providers/auth-provider";
import { clampTextScale, useDisplay } from "@/providers/display-provider";

/* Your grades: the private one.
 *
 * Every number on this screen is the student's own arithmetic on their own
 * scores. Nothing here is shared, nothing is compared against a classmate,
 * and the copy says so once, plainly, right under the title. The math is
 * entirely `@/lib/grades`: this file parses text into numbers, hands them
 * over, and renders sentences the module wrote.
 *
 * Every write is optimistic. The row lands, the estimate moves, and only a
 * server refusal puts it back with a warm line underneath the form.
 */

/* ------------------------------ formatting ----------------------------- */

/** "86.7", "90", "45": a percentage the way a person writes it. */
function pctText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** "18", "17.5": points with no trailing zeros. */
function pointsText(value: number): string {
  return String(Math.round(value * 100) / 100);
}

/** "4 items", "1 item". */
function itemsText(count: number): string {
  return `${count} item${count === 1 ? "" : "s"}`;
}

/** "Oct 14", quiet, and only carrying a year when it isn't this one. */
function shortDate(iso: string): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleDateString(
    undefined,
    sameYear
      ? { month: "short", day: "numeric" }
      : { month: "short", day: "numeric", year: "numeric" }
  );
}

/** A `GradesError` already reads like a person wrote it; anything else won't. */
function messageFor(error: unknown, fallback: string): string {
  return error instanceof GradesError ? error.message : fallback;
}

/* ------------------------------ validation ----------------------------- */

type EntryDraft = { title: string; earned: string; possible: string };
type CategoryDraft = { name: string; weight: string };

type Checked<T> = { ok: true; value: T } | { ok: false; message: string };

/** A finite number out of a text field, or null for empty/garbled. */
function parseNumber(text: string): number | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? value : null;
}

/**
 * The same rules `grades.ts` enforces, checked on the phone first so a typo
 * never becomes a round trip. Extra credit is deliberately not an error:
 * 22 out of 20 is a real thing that happens.
 */
function checkEntry(
  draft: EntryDraft
): Checked<{ title: string; earned: number; possible: number }> {
  const title = draft.title.trim();
  if (title.length === 0) {
    return { ok: false, message: "Give this score a name so you can find it later." };
  }
  if (title.length > ENTRY_TITLE_MAX) {
    return {
      ok: false,
      message: `Score names cap out at ${ENTRY_TITLE_MAX} characters.`,
    };
  }
  const earned = parseNumber(draft.earned);
  if (earned === null || earned < 0) {
    return { ok: false, message: "Points earned needs to be a number, zero or more." };
  }
  const possible = parseNumber(draft.possible);
  if (possible === null || possible <= 0) {
    return { ok: false, message: "Points possible has to be more than zero." };
  }
  if (earned > POINTS_MAX || possible > POINTS_MAX) {
    return { ok: false, message: "That's more points than we can keep track of." };
  }
  return { ok: true, value: { title, earned, possible } };
}

/** Category rules, same idea. */
function checkCategory(
  draft: CategoryDraft
): Checked<{ name: string; weight: number }> {
  const name = draft.name.trim();
  if (name.length === 0) {
    return { ok: false, message: "Give this category a name: homework, labs, midterm." };
  }
  if (name.length > CATEGORY_NAME_MAX) {
    return {
      ok: false,
      message: `Category names cap out at ${CATEGORY_NAME_MAX} characters.`,
    };
  }
  const weight = parseNumber(draft.weight);
  if (weight === null || weight < 0 || weight > WEIGHT_MAX) {
    return {
      ok: false,
      message: `Weights run from 0 to ${WEIGHT_MAX}. Copy the number off your syllabus.`,
    };
  }
  return { ok: true, value: { name, weight } };
}

/** Every category's weight added up, for the live "weights so far" caption. */
function sumWeights(categories: readonly GradeCategory[]): number {
  let total = 0;
  for (const category of categories) {
    if (Number.isFinite(category.weight)) total += Math.max(category.weight, 0);
  }
  return Math.round(total * 100) / 100;
}

/**
 * Ids for optimistic rows that haven't met the server yet. A draft id is
 * never a real primary key, so anything that would send it to Supabase (the
 * long-press menu, the add-a-score row) stays shut until the insert settles
 * and the row swaps for the saved one.
 */
const DRAFT_PREFIX = "huddl-draft:";
let draftSeq = 0;
function draftId(kind: string): string {
  draftSeq += 1;
  return `${DRAFT_PREFIX}${kind}-${draftSeq}`;
}

/** True while a row is still in flight and its id means nothing to Postgres. */
function isDraft(id: string): boolean {
  return id.startsWith(DRAFT_PREFIX);
}

/* ------------------------------ small parts ---------------------------- */

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

/** One warm line of red under a form or a card. */
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
 * The promise this screen is built on, stated once and never repeated.
 * Fern-soft rather than ember: this is reassurance, not an alert.
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
        marginTop: space.room,
      }}
    >
      <Feather
        name="lock"
        size={14}
        color={theme.accent}
        style={{ marginTop: space.hair }}
      />
      <AppText variant="caption" style={{ flex: 1, lineHeight: 17 }}>
        Only you can see this. Huddl never shares your grades with classmates
        or your school.
      </AppText>
    </View>
  );
}

/* ------------------------------- estimate ------------------------------ */

function EstimateCard({
  categories,
  entriesByCategory,
}: {
  categories: GradeCategory[];
  entriesByCategory: Record<string, GradeEntry[]>;
}) {
  const estimate = useMemo(
    () => courseEstimate(categories, entriesByCategory),
    [categories, entriesByCategory]
  );
  const warning = useMemo(() => weightWarning(categories), [categories]);
  const letter = letterFor(estimate.pct);
  // The one number this screen exists for. Its size is set here rather than
  // by the variant, so the text-size preference has to be multiplied through
  // by hand, same as the timer on /focus.
  const textScale = clampTextScale(useDisplay().textScale);

  if (estimate.pct === null) {
    return (
      <View style={{ gap: space.room }}>
        <EmptyState
          icon="trending-up"
          title="Your estimate starts here"
          body="Add a category and your first score, and the estimate starts working."
        />
        {warning ? <WeightWarning message={warning} /> : null}
      </View>
    );
  }

  return (
    <Card style={{ gap: space.cosy }}>
      <AppText variant="caption" muted>
        Estimated grade
      </AppText>
      <View
        accessible
        accessibilityLabel={`Estimated grade ${pctText(estimate.pct)} percent${
          letter ? `, about a ${letter}` : ""
        }`}
        style={{ flexDirection: "row", alignItems: "center", gap: space.room }}
      >
        <AppText
          variant="title"
          style={{
            fontSize: Math.round(44 * textScale),
            lineHeight: Math.round(50 * textScale),
          }}
        >
          {pctText(estimate.pct)}%
        </AppText>
        {letter ? <Chip label={letter} tone="brand" size="md" /> : null}
      </View>
      <AppText variant="caption" muted style={{ lineHeight: 17 }}>
        {estimate.note}
      </AppText>
      {warning ? <WeightWarning message={warning} /> : null}
      <AppText variant="caption" muted style={{ lineHeight: 17 }}>
        An estimate, not a grade of record. Instructors curve, drop a low
        score, and round their own way.
      </AppText>
    </Card>
  );
}

function WeightWarning({ message }: { message: string }) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "flex-start",
        gap: space.cosy,
      }}
    >
      <Feather
        name="alert-circle"
        size={13}
        color={theme.warning}
        style={{ marginTop: space.hair }}
      />
      <AppText
        variant="caption"
        style={{ flex: 1, color: theme.warning, lineHeight: 17 }}
      >
        {message}
      </AppText>
    </View>
  );
}

/* -------------------------------- entries ------------------------------ */

function EntryRow({
  entry,
  onOpenMenu,
}: {
  entry: GradeEntry;
  onOpenMenu: () => void;
}) {
  const theme = useTheme();
  const extra = entry.points_earned > entry.points_possible;
  const pending = isDraft(entry.id);
  const when = pending ? "Saving…" : shortDate(entry.recorded_at);
  const fraction = `${pointsText(entry.points_earned)}/${pointsText(
    entry.points_possible
  )}`;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${entry.title}, ${pointsText(
        entry.points_earned
      )} out of ${pointsText(entry.points_possible)}`}
      accessibilityHint="Opens edit and delete for this score"
      disabled={pending}
      onPress={onOpenMenu}
      onLongPress={onOpenMenu}
      style={({ pressed }) => ({
        flexDirection: "row",
        alignItems: "center",
        gap: space.room,
        minHeight: 44,
        paddingVertical: space.snug,
        opacity: pressed ? 0.6 : 1,
      })}
    >
      <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
        <AppText variant="bodyMedium" numberOfLines={1}>
          {entry.title}
        </AppText>
        {when ? (
          <AppText variant="caption" muted>
            {when}
          </AppText>
        ) : null}
      </View>
      <AppText
        variant="bodySemi"
        style={extra ? { color: theme.accent } : undefined}
      >
        {fraction}
      </AppText>
    </Pressable>
  );
}

/** The three fields a score is made of, shared by the add and edit forms. */
function EntryFields({
  draft,
  onChange,
  disabled,
}: {
  draft: EntryDraft;
  onChange: (next: EntryDraft) => void;
  disabled: boolean;
}) {
  const theme = useTheme();
  const earned = parseNumber(draft.earned);
  const possible = parseNumber(draft.possible);
  const extra =
    earned !== null && possible !== null && possible > 0 && earned > possible;

  return (
    <View style={{ gap: space.room }}>
      <Field
        label="What was it?"
        value={draft.title}
        onChangeText={(title) => onChange({ ...draft, title })}
        placeholder="Problem set 3"
        maxLength={ENTRY_TITLE_MAX}
        editable={!disabled}
      />
      <View style={{ flexDirection: "row", gap: space.room }}>
        <View style={{ flex: 1 }}>
          <Field
            label="You got"
            value={draft.earned}
            onChangeText={(value) => onChange({ ...draft, earned: value })}
            placeholder="18"
            keyboardType="decimal-pad"
            maxLength={9}
            editable={!disabled}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Field
            label="Out of"
            value={draft.possible}
            onChangeText={(value) => onChange({ ...draft, possible: value })}
            placeholder="20"
            keyboardType="decimal-pad"
            maxLength={9}
            editable={!disabled}
          />
        </View>
      </View>
      {extra ? (
        <AppText variant="caption" style={{ color: theme.accent }}>
          Above the max. That's extra credit, and it counts. Keep it.
        </AppText>
      ) : null}
    </View>
  );
}

const EMPTY_ENTRY: EntryDraft = { title: "", earned: "", possible: "" };

function AddEntryForm({
  onSubmit,
  onCancel,
}: {
  /** Resolves to an error message, or null when the score landed. */
  onSubmit: (draft: EntryDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EntryDraft>(EMPTY_ENTRY);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    if (saving) return;
    const checked = checkEntry(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setSaving(true);
    const failure = await onSubmit(draft);
    setSaving(false);
    if (failure) {
      setError(failure);
      return;
    }
    setDraft(EMPTY_ENTRY);
  }, [draft, onSubmit, saving]);

  return (
    <View style={{ gap: space.room, marginTop: space.tight }}>
      <EntryFields
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          if (error) setError(null);
        }}
        disabled={saving}
      />
      <InlineError message={error} />
      <View style={{ flexDirection: "row", gap: space.cosy }}>
        <Button
          label="Add score"
          size="sm"
          pending={saving}
          onPress={() => void submit()}
        />
        <Button
          label="Cancel"
          variant="ghost"
          size="sm"
          disabled={saving}
          onPress={onCancel}
        />
      </View>
    </View>
  );
}

function EditEntryForm({
  entry,
  onSubmit,
  onCancel,
}: {
  entry: GradeEntry;
  onSubmit: (draft: EntryDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<EntryDraft>(() => ({
    title: entry.title,
    earned: pointsText(entry.points_earned),
    possible: pointsText(entry.points_possible),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    if (saving) return;
    const checked = checkEntry(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setSaving(true);
    const failure = await onSubmit(draft);
    setSaving(false);
    if (failure) setError(failure);
  }, [draft, onSubmit, saving]);

  const theme = useTheme();
  return (
    <View
      style={{
        gap: space.room,
        paddingVertical: space.room,
        paddingHorizontal: space.close,
        borderRadius: radius.control,
        backgroundColor: theme.surface2,
      }}
    >
      <AppText variant="label" muted>
        Fixing this score
      </AppText>
      <EntryFields
        draft={draft}
        onChange={(next) => {
          setDraft(next);
          if (error) setError(null);
        }}
        disabled={saving}
      />
      <InlineError message={error} />
      <View style={{ flexDirection: "row", gap: space.cosy }}>
        <Button
          label="Save"
          size="sm"
          pending={saving}
          onPress={() => void submit()}
        />
        <Button
          label="Cancel"
          variant="ghost"
          size="sm"
          disabled={saving}
          onPress={onCancel}
        />
      </View>
    </View>
  );
}

/* ------------------------------ categories ----------------------------- */

function EditCategoryForm({
  category,
  focus,
  onSubmit,
  onCancel,
}: {
  category: GradeCategory;
  focus: "name" | "weight";
  onSubmit: (draft: CategoryDraft) => Promise<string | null>;
  onCancel: () => void;
}) {
  const theme = useTheme();
  const [draft, setDraft] = useState<CategoryDraft>(() => ({
    name: category.name,
    weight: pointsText(category.weight),
  }));
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = useCallback(async () => {
    if (saving) return;
    const checked = checkCategory(draft);
    if (!checked.ok) {
      setError(checked.message);
      return;
    }
    setError(null);
    setSaving(true);
    const failure = await onSubmit(draft);
    setSaving(false);
    if (failure) setError(failure);
  }, [draft, onSubmit, saving]);

  return (
    <View
      style={{
        gap: space.room,
        paddingVertical: space.room,
        paddingHorizontal: space.close,
        borderRadius: radius.control,
        backgroundColor: theme.surface2,
      }}
    >
      <Field
        label="Category"
        value={draft.name}
        autoFocus={focus === "name"}
        onChangeText={(name) => {
          setDraft((current) => ({ ...current, name }));
          if (error) setError(null);
        }}
        placeholder="Homework"
        maxLength={CATEGORY_NAME_MAX}
        editable={!saving}
      />
      <Field
        label="Weight (%)"
        value={draft.weight}
        autoFocus={focus === "weight"}
        onChangeText={(weight) => {
          setDraft((current) => ({ ...current, weight }));
          if (error) setError(null);
        }}
        placeholder="20"
        keyboardType="decimal-pad"
        maxLength={6}
        editable={!saving}
      />
      <InlineError message={error} />
      <View style={{ flexDirection: "row", gap: space.cosy }}>
        <Button
          label="Save"
          size="sm"
          pending={saving}
          onPress={() => void submit()}
        />
        <Button
          label="Cancel"
          variant="ghost"
          size="sm"
          disabled={saving}
          onPress={onCancel}
        />
      </View>
    </View>
  );
}

function CategoryCard({
  category,
  entries,
  editing,
  editingEntryId,
  onOpenCategoryMenu,
  onOpenEntryMenu,
  onSaveCategory,
  onCancelCategoryEdit,
  onAddEntry,
  onSaveEntry,
  onCancelEntryEdit,
}: {
  category: GradeCategory;
  entries: GradeEntry[];
  editing: "name" | "weight" | null;
  editingEntryId: string | null;
  onOpenCategoryMenu: () => void;
  onOpenEntryMenu: (entry: GradeEntry) => void;
  onSaveCategory: (draft: CategoryDraft) => Promise<string | null>;
  onCancelCategoryEdit: () => void;
  onAddEntry: (draft: EntryDraft) => Promise<string | null>;
  onSaveEntry: (entry: GradeEntry, draft: EntryDraft) => Promise<string | null>;
  onCancelEntryEdit: () => void;
}) {
  const theme = useTheme();
  const [adding, setAdding] = useState(false);
  const score = categoryScore(entries);
  // Still in flight: its id is a local draft, so nothing here may be sent on.
  const pending = isDraft(category.id);

  return (
    <Card style={{ gap: space.room, marginBottom: space.room }}>
      {/* Long-press anywhere on the header opens the menu; the "…" button is
          the same door for anyone who can't long-press, so the wrapper stays
          out of the accessibility tree and its children stay in it. */}
      <Pressable
        accessible={false}
        disabled={pending}
        onLongPress={onOpenCategoryMenu}
        delayLongPress={320}
        style={({ pressed }) => ({ opacity: pressed ? 0.75 : 1 })}
      >
        <View
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.cosy,
          }}
        >
          <View style={{ flex: 1, minWidth: 0, gap: space.snug }}>
            <View
              style={{
                flexDirection: "row",
                alignItems: "center",
                gap: space.cosy,
                flexWrap: "wrap",
              }}
            >
              <AppText variant="title" numberOfLines={2} style={{ flexShrink: 1 }}>
                {category.name}
              </AppText>
              <Chip label={`${pointsText(category.weight)}%`} tone="brand" />
            </View>
            <AppText variant="caption" muted>
              {score
                ? `${pctText(score.pct)}% · ${itemsText(entries.length)}`
                : "Nothing scored in here yet"}
            </AppText>
          </View>
          {pending ? null : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Options for ${category.name}, worth ${pointsText(
                category.weight
              )} percent`}
              accessibilityHint="Rename, re-weight, or delete this category"
              onPress={onOpenCategoryMenu}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                marginRight: -10,
                marginVertical: -10,
                alignItems: "center",
                justifyContent: "center",
                opacity: pressed ? 0.6 : 1,
              })}
            >
              <Feather name="more-horizontal" size={18} color={theme.muted} />
            </Pressable>
          )}
        </View>
      </Pressable>

      {editing ? (
        <EditCategoryForm
          /* Remount when the menu picks the other field, so `autoFocus`
             actually lands on the one they tapped. */
          key={editing}
          category={category}
          focus={editing}
          onSubmit={onSaveCategory}
          onCancel={onCancelCategoryEdit}
        />
      ) : null}

      {entries.length > 0 ? (
        <View
          style={{
            borderTopWidth: 1,
            borderTopColor: theme.border,
            paddingTop: space.hair,
          }}
        >
          {entries.map((entry) =>
            editingEntryId === entry.id ? (
              <View key={entry.id} style={{ paddingVertical: space.cosy }}>
                <EditEntryForm
                  entry={entry}
                  onSubmit={(draft) => onSaveEntry(entry, draft)}
                  onCancel={onCancelEntryEdit}
                />
              </View>
            ) : (
              <EntryRow
                key={entry.id}
                entry={entry}
                onOpenMenu={() => onOpenEntryMenu(entry)}
              />
            )
          )}
        </View>
      ) : null}

      {pending ? (
        <AppText variant="caption" muted>
          Saving this category…
        </AppText>
      ) : adding ? (
        <AddEntryForm onSubmit={onAddEntry} onCancel={() => setAdding(false)} />
      ) : (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Add a score to ${category.name}`}
          onPress={() => setAdding(true)}
          style={({ pressed }) => ({
            flexDirection: "row",
            alignItems: "center",
            gap: space.cosy,
            minHeight: 44,
            opacity: pressed ? 0.6 : 1,
          })}
        >
          <Feather name="plus" size={15} color={theme.brand} />
          <AppText variant="label" style={{ color: theme.brand }}>
            Add a score
          </AppText>
        </Pressable>
      )}
    </Card>
  );
}

/* -------------------------------- what-if ------------------------------ */

const TARGETS: readonly { label: string; value: number }[] = [
  { label: "A · 93", value: 93 },
  { label: "A- · 90", value: 90 },
  { label: "B+ · 87", value: 87 },
  { label: "B · 83", value: 83 },
];

function WhatIfPanel({
  categories,
  entriesByCategory,
}: {
  categories: GradeCategory[];
  entriesByCategory: Record<string, GradeEntry[]>;
}) {
  const theme = useTheme();
  const [open, setOpen] = useState(false);
  const [target, setTarget] = useState(90);

  const result = useMemo(
    () => whatIf(categories, entriesByCategory, target),
    [categories, entriesByCategory, target]
  );

  return (
    <Card style={{ gap: open ? 12 : 0 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="What do I need for an A minus?"
        accessibilityState={{ expanded: open }}
        onPress={() => setOpen((current) => !current)}
        style={({ pressed }) => ({
          flexDirection: "row",
          alignItems: "center",
          gap: space.cosy,
          minHeight: 44,
          opacity: pressed ? 0.7 : 1,
        })}
      >
        <AppText variant="title" style={{ flex: 1 }}>
          What do I need for an A-?
        </AppText>
        <Feather
          name={open ? "chevron-up" : "chevron-down"}
          size={18}
          color={theme.muted}
        />
      </Pressable>

      {open ? (
        <View style={{ gap: space.close }}>
          <View
            style={{ flexDirection: "row", flexWrap: "wrap", gap: space.cosy }}
          >
            {TARGETS.map((option) => (
              <Chip
                key={option.value}
                label={option.label}
                size="md"
                tone="brand"
                selected={target === option.value}
                accessibilityLabel={`Aim for ${option.value} percent`}
                onPress={() => setTarget(option.value)}
              />
            ))}
          </View>
          <View
            style={{
              flexDirection: "row",
              alignItems: "flex-start",
              gap: space.cosy,
            }}
          >
            <Feather
              name={result.reachable ? "check-circle" : "info"}
              size={14}
              color={result.reachable ? theme.accent : theme.muted}
              /* Optical: 3px drops a 14px glyph onto the cap-height of the
                 21px body line beside it. */
              style={{ marginTop: 3 }}
            />
            <AppText variant="body" style={{ flex: 1, lineHeight: 21 }}>
              {result.message}
            </AppText>
          </View>
        </View>
      ) : null}
    </Card>
  );
}

/* -------------------------------- screen ------------------------------- */

export default function CourseGradesScreen() {
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

  const [categories, setCategories] = useState<GradeCategory[]>([]);
  const [entriesByCategory, setEntriesByCategory] = useState<
    Record<string, GradeEntry[]>
  >({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // The long-press menus.
  const [categoryMenu, setCategoryMenu] = useState<GradeCategory | null>(null);
  const [entryMenu, setEntryMenu] = useState<GradeEntry | null>(null);

  // Which inline editor is open, if any.
  const [editingCategory, setEditingCategory] = useState<{
    id: string;
    focus: "name" | "weight";
  } | null>(null);
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);

  // The add-a-category form at the bottom.
  const [categoryDraft, setCategoryDraft] = useState<CategoryDraft>({
    name: "",
    weight: "",
  });
  const [categoryFormError, setCategoryFormError] = useState<string | null>(
    null
  );
  const [savingCategory, setSavingCategory] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, [router]);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const book = await fetchGradeBook(id);
      setCategories(book.categories);
      setEntriesByCategory(book.entriesByCategory);
      setError(null);
    } catch (caught) {
      setError(
        messageFor(caught, "We couldn't load your grades for this class.")
      );
    }
  }, [id]);

  useEffect(() => {
    if (!userId || !id) return;
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [userId, id, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setActionError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /* --------------------------- category writes -------------------------- */

  const handleAddCategory = useCallback(async () => {
    if (savingCategory || !userId || !id) return;
    const checked = checkCategory(categoryDraft);
    if (!checked.ok) {
      setCategoryFormError(checked.message);
      return;
    }
    const { name, weight } = checked.value;
    setCategoryFormError(null);
    setSavingCategory(true);

    // Optimistic: the bucket appears, and the estimate re-reads without it
    // only if the server turns it down.
    const optimistic: GradeCategory = {
      id: draftId("category"),
      user_id: userId,
      course_id: id,
      name,
      weight,
      position: categories.length,
      created_at: new Date().toISOString(),
    };
    setCategories((current) => [...current, optimistic]);
    setEntriesByCategory((current) => ({ ...current, [optimistic.id]: [] }));

    try {
      const saved = await createCategory({
        courseId: id,
        name,
        weight,
        position: categories.length,
      });
      setCategories((current) =>
        current.map((row) => (row.id === optimistic.id ? saved : row))
      );
      setEntriesByCategory((current) => {
        const next = { ...current };
        delete next[optimistic.id];
        next[saved.id] = next[saved.id] ?? [];
        return next;
      });
      setCategoryDraft({ name: "", weight: "" });
      tapSuccess();
    } catch (caught) {
      setCategories((current) =>
        current.filter((row) => row.id !== optimistic.id)
      );
      setEntriesByCategory((current) => {
        const next = { ...current };
        delete next[optimistic.id];
        return next;
      });
      setCategoryFormError(
        messageFor(caught, "We couldn't save that category. Give it another go.")
      );
    } finally {
      setSavingCategory(false);
    }
  }, [savingCategory, userId, id, categoryDraft, categories.length]);

  const handleSaveCategory = useCallback(
    async (category: GradeCategory, draft: CategoryDraft) => {
      const checked = checkCategory(draft);
      if (!checked.ok) return checked.message;
      const { name, weight } = checked.value;
      const previous = category;

      setCategories((current) =>
        current.map((row) =>
          row.id === category.id ? { ...row, name, weight } : row
        )
      );
      try {
        const saved = await updateCategory(category.id, { name, weight });
        setCategories((current) =>
          current.map((row) => (row.id === category.id ? saved : row))
        );
        setEditingCategory(null);
        tapSuccess();
        return null;
      } catch (caught) {
        setCategories((current) =>
          current.map((row) => (row.id === category.id ? previous : row))
        );
        return messageFor(
          caught,
          "We couldn't save that change. Give it another go."
        );
      }
    },
    []
  );

  const handleDeleteCategory = useCallback((category: GradeCategory) => {
    const count = (entriesByCategory[category.id] ?? []).length;
    // Name what leaves with it: deleting a category cascades its scores.
    const stakes =
      count === 0
        ? "The category goes, and the estimate recalculates without its weight."
        : count === 1
          ? "Its one score goes with it, and the estimate recalculates without it."
          : `Its ${count} scores go with it, and the estimate recalculates without them.`;

    Alert.alert(
      `Delete ${category.name}?`,
      `${stakes} This can't be undone.`,
      [
        { text: "Keep it", style: "cancel" },
        {
          text: "Delete",
          style: "destructive",
          onPress: () => {
            const previousCategories = categories;
            const previousEntries = entriesByCategory;
            setActionError(null);
            setEditingCategory(null);
            setCategories((current) =>
              current.filter((row) => row.id !== category.id)
            );
            setEntriesByCategory((current) => {
              const next = { ...current };
              delete next[category.id];
              return next;
            });
            void deleteCategory(category.id).catch((caught: unknown) => {
              setCategories(previousCategories);
              setEntriesByCategory(previousEntries);
              setActionError(
                messageFor(
                  caught,
                  "We couldn't delete that category. Try again."
                )
              );
            });
          },
        },
      ]
    );
  }, [categories, entriesByCategory]);

  /* ----------------------------- entry writes --------------------------- */

  const handleAddEntry = useCallback(
    async (category: GradeCategory, draft: EntryDraft) => {
      if (!userId) return "Sign in again to pick this back up.";
      const checked = checkEntry(draft);
      if (!checked.ok) return checked.message;
      const { title, earned, possible } = checked.value;

      const optimistic: GradeEntry = {
        id: draftId("entry"),
        user_id: userId,
        category_id: category.id,
        title,
        points_earned: earned,
        points_possible: possible,
        recorded_at: new Date().toISOString(),
      };
      setEntriesByCategory((current) => ({
        ...current,
        [category.id]: [...(current[category.id] ?? []), optimistic],
      }));

      try {
        const saved = await createEntry({
          categoryId: category.id,
          title,
          pointsEarned: earned,
          pointsPossible: possible,
        });
        setEntriesByCategory((current) => ({
          ...current,
          [category.id]: (current[category.id] ?? []).map((row) =>
            row.id === optimistic.id ? saved : row
          ),
        }));
        tapSuccess();
        return null;
      } catch (caught) {
        setEntriesByCategory((current) => ({
          ...current,
          [category.id]: (current[category.id] ?? []).filter(
            (row) => row.id !== optimistic.id
          ),
        }));
        return messageFor(
          caught,
          "We couldn't save that score. Give it another go."
        );
      }
    },
    [userId]
  );

  const handleSaveEntry = useCallback(
    async (entry: GradeEntry, draft: EntryDraft) => {
      const checked = checkEntry(draft);
      if (!checked.ok) return checked.message;
      const { title, earned, possible } = checked.value;

      setEntriesByCategory((current) => ({
        ...current,
        [entry.category_id]: (current[entry.category_id] ?? []).map((row) =>
          row.id === entry.id
            ? {
                ...row,
                title,
                points_earned: earned,
                points_possible: possible,
              }
            : row
        ),
      }));

      try {
        const saved = await updateEntry(entry.id, {
          title,
          pointsEarned: earned,
          pointsPossible: possible,
        });
        setEntriesByCategory((current) => ({
          ...current,
          [entry.category_id]: (current[entry.category_id] ?? []).map((row) =>
            row.id === entry.id ? saved : row
          ),
        }));
        setEditingEntryId(null);
        tapSuccess();
        return null;
      } catch (caught) {
        setEntriesByCategory((current) => ({
          ...current,
          [entry.category_id]: (current[entry.category_id] ?? []).map((row) =>
            row.id === entry.id ? entry : row
          ),
        }));
        return messageFor(
          caught,
          "We couldn't save that change. Give it another go."
        );
      }
    },
    []
  );

  const handleDeleteEntry = useCallback(
    (entry: GradeEntry) => {
      const previous = entriesByCategory[entry.category_id] ?? [];
      setActionError(null);
      setEditingEntryId((current) => (current === entry.id ? null : current));
      setEntriesByCategory((current) => ({
        ...current,
        [entry.category_id]: (current[entry.category_id] ?? []).filter(
          (row) => row.id !== entry.id
        ),
      }));
      void deleteEntry(entry.id).catch((caught: unknown) => {
        setEntriesByCategory((current) => ({
          ...current,
          [entry.category_id]: previous,
        }));
        setActionError(
          messageFor(caught, "We couldn't delete that score. Try again.")
        );
      });
    },
    [entriesByCategory]
  );

  /* ------------------------------ scaffold ------------------------------ */

  // A deep link can land here signed out, so send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const weightsSoFar = sumWeights(categories);
  const draftWeight = parseNumber(categoryDraft.weight);
  const weightsCaption =
    draftWeight !== null && draftWeight >= 0 && draftWeight <= WEIGHT_MAX
      ? `Weights so far: ${pctText(weightsSoFar)}%, and this one takes it to ${pctText(
          weightsSoFar + draftWeight
        )}%.`
      : `Weights so far: ${pctText(weightsSoFar)}%.`;

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

  if (!id) {
    return scaffold(
      <View
        style={{ paddingHorizontal: space.gutter, paddingTop: space.close }}
      >
        <AppText variant="display">Your grades</AppText>
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
        <AppText variant="display">Your grades</AppText>
        {courseCode ? (
          <Chip
            label={courseCode}
            tone="brand"
            size="md"
            style={{ marginBottom: space.tight }}
          />
        ) : null}
      </View>
      <PrivacyLine />
    </View>
  );

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
        <Card style={{ gap: space.room }}>
          <Skeleton width={90} height={11} radius={radius.full} />
          <Skeleton width={150} height={40} />
          <Skeleton width="80%" height={11} radius={radius.full} />
        </Card>
        <SectionLabel text="Categories" />
        {[0, 1].map((index) => (
          <Card
            key={index}
            style={{ gap: space.room, marginBottom: space.room }}
          >
            <Skeleton width="55%" height={16} radius={radius.full} />
            <Skeleton width="35%" height={11} radius={radius.full} />
            <Skeleton width="70%" height={11} radius={radius.full} />
          </Card>
        ))}
      </ScrollView>
    );
  }

  if (error && categories.length === 0) {
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
          <View style={{ marginBottom: space.room }}>
            <InlineError message={error} />
          </View>
        ) : null}
        {actionError ? (
          <View style={{ marginBottom: space.room }}>
            <InlineError message={actionError} />
          </View>
        ) : null}

        <EstimateCard
          categories={categories}
          entriesByCategory={entriesByCategory}
        />

        <SectionLabel text="Categories" />

        {categories.length === 0 ? (
          /* The estimate card above is already the dashed recruit; a second
             one here would just be two empty boxes stacked. */
          <AppText variant="caption" muted style={{ lineHeight: 18 }}>
            Your syllabus lists these: homework 20%, midterm 30%, final 50%.
            Add them below and your scores slot in underneath.
          </AppText>
        ) : (
          categories.map((category) => (
            <CategoryCard
              key={category.id}
              category={category}
              entries={entriesByCategory[category.id] ?? []}
              editing={
                editingCategory?.id === category.id
                  ? editingCategory.focus
                  : null
              }
              editingEntryId={editingEntryId}
              onOpenCategoryMenu={() => setCategoryMenu(category)}
              onOpenEntryMenu={(entry) => setEntryMenu(entry)}
              onSaveCategory={(draft) => handleSaveCategory(category, draft)}
              onCancelCategoryEdit={() => setEditingCategory(null)}
              onAddEntry={(draft) => handleAddEntry(category, draft)}
              onSaveEntry={handleSaveEntry}
              onCancelEntryEdit={() => setEditingEntryId(null)}
            />
          ))
        )}

        <Card style={{ marginTop: space.room, gap: space.close }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.cosy,
            }}
          >
            <Feather name="plus-circle" size={16} color={theme.brand} />
            <AppText variant="title">Add a category</AppText>
          </View>
          <Field
            label="Category"
            value={categoryDraft.name}
            onChangeText={(name) => {
              setCategoryDraft((current) => ({ ...current, name }));
              if (categoryFormError) setCategoryFormError(null);
            }}
            placeholder="Homework"
            maxLength={CATEGORY_NAME_MAX}
            editable={!savingCategory}
          />
          <Field
            label="Weight (%)"
            value={categoryDraft.weight}
            onChangeText={(weight) => {
              setCategoryDraft((current) => ({ ...current, weight }));
              if (categoryFormError) setCategoryFormError(null);
            }}
            placeholder="20"
            keyboardType="decimal-pad"
            maxLength={6}
            editable={!savingCategory}
          />
          <AppText variant="caption" muted>
            {weightsCaption}
          </AppText>
          <InlineError message={categoryFormError} />
          <Button
            label="Add category"
            size="sm"
            pending={savingCategory}
            style={{ alignSelf: "flex-start" }}
            onPress={() => void handleAddCategory()}
          />
        </Card>

        {categories.length > 0 ? (
          <>
            <SectionLabel text="Looking ahead" />
            <WhatIfPanel
              categories={categories}
              entriesByCategory={entriesByCategory}
            />
          </>
        ) : null}
      </ScrollView>

      <Sheet
        visible={categoryMenu !== null}
        onClose={() => setCategoryMenu(null)}
        title={categoryMenu?.name ?? "Category"}
      >
        <Sheet.Row
          icon="edit-2"
          label="Rename"
          onPress={() => {
            const category = categoryMenu;
            setCategoryMenu(null);
            if (category) setEditingCategory({ id: category.id, focus: "name" });
          }}
        />
        <Sheet.Row
          icon="percent"
          label="Change weight"
          onPress={() => {
            const category = categoryMenu;
            setCategoryMenu(null);
            if (category) {
              setEditingCategory({ id: category.id, focus: "weight" });
            }
          }}
        />
        <Sheet.Row
          icon="trash-2"
          label="Delete category"
          danger
          onPress={() => {
            const category = categoryMenu;
            setCategoryMenu(null);
            if (category) handleDeleteCategory(category);
          }}
        />
      </Sheet>

      <Sheet
        visible={entryMenu !== null}
        onClose={() => setEntryMenu(null)}
        title={entryMenu?.title ?? "Score"}
      >
        <Sheet.Row
          icon="edit-2"
          label="Edit score"
          onPress={() => {
            const entry = entryMenu;
            setEntryMenu(null);
            if (entry) setEditingEntryId(entry.id);
          }}
        />
        <Sheet.Row
          icon="trash-2"
          label="Delete score"
          danger
          onPress={() => {
            const entry = entryMenu;
            setEntryMenu(null);
            if (entry) handleDeleteEntry(entry);
          }}
        />
      </Sheet>
    </KeyboardAvoidingView>
  );
}
