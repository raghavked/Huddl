import Feather from "@expo/vector-icons/Feather";
import * as DocumentPicker from "expo-document-picker";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ComponentProps,
  type ReactNode,
} from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Linking,
  Platform,
  Pressable,
  RefreshControl,
  ScrollView,
  View,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import {
  Doorway,
  MagnifyingGlass,
  PinnedNote,
} from "@/components/illustrations";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  Sheet,
  SkeletonRow,
} from "@/components/ui";
import { radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { tapLight, tapSuccess } from "@/lib/haptics";
import {
  formatFileSize,
  getSignedUrl,
  listNotes,
  setNoteTags,
  tallyTags,
  uploadNote,
  MAX_NOTE_BYTES,
  MAX_NOTE_TAGS,
  MAX_NOTE_TAG_LENGTH,
  MIN_NOTE_TAG_LENGTH,
  NOTES_BUCKET,
  NotesError,
  SUGGESTED_TAGS,
  type CourseTag,
  type NoteRow,
} from "@/lib/notes";
import { supabase } from "@/lib/supabase";
import { useAuth } from "@/providers/auth-provider";

/* The whole shared-notes room for one course: every note the class has put
   up, filterable by tag, with the upload flow living here rather than on the
   hub. The hub keeps a short preview and sends people through:

     router.push({
       pathname: "/course/notes",
       params: { courseId, courseCode: course.code },
     });
*/

type FeatherName = ComponentProps<typeof Feather>["name"];

/** Per-note gratitude: how many classmates said thanks, and whether I did. */
type NoteThanksEntry = { count: number; mine: boolean };

const NO_THANKS: NoteThanksEntry = { count: 0, mine: false };

type Status = "loading" | "error" | "ready";

/** Which note a row-level failure belongs to, so the copy lands next to it. */
type NoteFailure = { id: string; message: string };

/* ------------------------------ helpers ------------------------------ */

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic"]);
const SHEET_EXT = new Set(["xls", "xlsx", "csv"]);
const SLIDE_EXT = new Set(["ppt", "pptx", "key"]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "txt", "md", "rtf"]);

/** Feather stand-ins for file types, same mapping as the course hub. */
function noteIcon(mime: string | null, fileName: string): FeatherName {
  const ext = fileName.split(".").pop()?.toLowerCase() ?? "";
  if (mime?.startsWith("image/") || IMAGE_EXT.has(ext)) return "image";
  if (mime?.includes("spreadsheet") || mime === "text/csv" || SHEET_EXT.has(ext)) {
    return "grid";
  }
  if (mime?.includes("presentation") || SLIDE_EXT.has(ext)) return "monitor";
  if (mime === "application/pdf" || mime?.startsWith("text/") || DOC_EXT.has(ext)) {
    return "file-text";
  }
  return "file";
}

/** "Oct 14" */
function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** "week-5-notes.pdf" -> "week 5 notes": a friendly default title. */
function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * How two tags are compared before either has been near the database.
 *
 * Saved tags arrive already trimmed and lowercased by 0032's trigger, so a
 * saved-to-saved comparison is plain equality. A tag the student just typed
 * hasn't been through that yet, and "Midterm 2" and "midterm 2" are the same
 * tag and only one of them should get a chip.
 */
function tagKey(tag: string): string {
  return tag.trim().toLowerCase();
}

function hasTag(tags: readonly string[], tag: string): boolean {
  const key = tagKey(tag);
  return tags.some((existing) => tagKey(existing) === key);
}

/** "12 notes", "1 note": the count beside a filter chip, spelled out. */
function noteCount(n: number): string {
  return n === 1 ? "1 note" : `${n} notes`;
}

/* ---------------------------- tiny pieces ---------------------------- */

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

/** A whole-screen state: the pre-list door, before there's a list to show. */
function CenteredState({
  icon,
  title,
  message,
  children,
}: {
  icon: FeatherName;
  title: string;
  message: string;
  children?: ReactNode;
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
        paddingBottom: 80,
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
      <AppText variant="caption" muted style={{ textAlign: "center", maxWidth: 280 }}>
        {message}
      </AppText>
      {children}
    </View>
  );
}

/** Stable empty default, so the options memo below doesn't churn per render. */
const NO_SUGGESTIONS: readonly string[] = [];

/**
 * The chip editor both tag flows share: tap a word to put it on, tap it
 * again to take it off, or type your own.
 *
 * It offers the starter vocabulary from `SUGGESTED_TAGS` first, then the
 * words this course is already filing notes under (so a class converges on
 * "problem set" instead of drifting into four spellings of it), then
 * anything the student typed themselves. The order never changes as chips
 * are tapped. A list that re-sorts under your finger is how you tap the
 * wrong thing.
 *
 * Nothing here normalizes: the database trigger owns trimming, lowercasing
 * and deduping, and the caller settles on the saved row. The caps this does
 * enforce (`MAX_NOTE_TAGS`, and the field's `maxLength`) exist so a tag never
 * gets silently dropped for being too long or one too many.
 */
function TagPicker({
  value,
  onChange,
  suggestions = NO_SUGGESTIONS,
  disabled = false,
}: {
  value: string[];
  onChange: (next: string[]) => void;
  /** Tags this course already uses, offered after the starter vocabulary. */
  suggestions?: readonly string[];
  disabled?: boolean;
}) {
  const theme = useTheme();
  const [input, setInput] = useState("");
  const [hint, setHint] = useState<string | null>(null);

  const atCap = value.length >= MAX_NOTE_TAGS;

  const options = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const tag of [...SUGGESTED_TAGS, ...suggestions, ...value]) {
      const key = tagKey(tag);
      if (key.length === 0 || seen.has(key)) continue;
      seen.add(key);
      out.push(tag);
    }
    return out;
  }, [suggestions, value]);

  const toggle = useCallback(
    (tag: string) => {
      if (disabled) return;
      if (hasTag(value, tag)) {
        setHint(null);
        onChange(value.filter((existing) => tagKey(existing) !== tagKey(tag)));
        return;
      }
      if (atCap) {
        setHint(`That's ${MAX_NOTE_TAGS}. Take one off to add another.`);
        return;
      }
      setHint(null);
      onChange([...value, tag]);
    },
    [atCap, disabled, onChange, value]
  );

  const commitTyped = useCallback(() => {
    if (disabled) return;
    const typed = input.trim();
    if (typed.length === 0) return;
    if (typed.length < MIN_NOTE_TAG_LENGTH) {
      setHint(`Tags need at least ${MIN_NOTE_TAG_LENGTH} characters.`);
      return;
    }
    if (hasTag(value, typed)) {
      setInput("");
      setHint(`"${typed}" is already on there.`);
      return;
    }
    if (atCap) {
      setHint(`That's ${MAX_NOTE_TAGS}. Take one off to add another.`);
      return;
    }
    onChange([...value, typed]);
    setInput("");
    setHint(null);
  }, [atCap, disabled, input, onChange, value]);

  return (
    <View style={{ gap: space.cosy }}>
      <AppText variant="label">Tags</AppText>

      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.cosy }}>
        {options.map((tag) => {
          const on = hasTag(value, tag);
          return (
            <Chip
              key={tagKey(tag)}
              label={tag}
              tone="brand"
              size="md"
              /* The × only shows on the ones already chosen. An unselected
                 chip is an invitation, not a thing to dismiss. */
              {...(on ? { icon: "x" as const } : null)}
              selected={on}
              onPress={() => toggle(tag)}
              accessibilityLabel={
                on ? `Remove the tag ${tag}` : `Tag this note ${tag}`
              }
              /* Faded rather than gone at the cap: the word is still true of
                 this note, it just can't fit until something comes off. */
              style={!on && atCap ? { opacity: 0.5 } : undefined}
            />
          );
        })}
      </View>

      <View
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: space.cosy,
        }}
      >
        <View style={{ flex: 1 }}>
          <Field
            label="Add your own"
            value={input}
            onChangeText={(text) => {
              setInput(text);
              if (hint) setHint(null);
            }}
            placeholder="week 5"
            maxLength={MAX_NOTE_TAG_LENGTH}
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="done"
            onSubmitEditing={commitTyped}
            editable={!disabled}
          />
        </View>
        <Button
          label="Add"
          variant="secondary"
          size="sm"
          disabled={disabled || input.trim().length === 0}
          onPress={commitTyped}
        />
      </View>

      {hint ? (
        <AppText variant="caption" style={{ color: theme.warning }}>
          {hint}
        </AppText>
      ) : (
        <AppText variant="caption" muted>
          {value.length === 0
            ? `Optional, and up to ${MAX_NOTE_TAGS}. They're how classmates find this later.`
            : `${value.length} of ${MAX_NOTE_TAGS} tags.`}
        </AppText>
      )}
    </View>
  );
}

/* ------------------------------- screen ------------------------------- */

export default function CourseNotesScreen() {
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
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteThanks, setNoteThanks] = useState<Record<string, NoteThanksEntry>>({});
  /** null until we know. The share affordance waits rather than flickering. */
  const [enrolled, setEnrolled] = useState<boolean | null>(null);
  const [refreshing, setRefreshing] = useState(false);

  // Which tags are being filtered on. Multi-select, and they AND together:
  // a note has to wear every one of them.
  const [selected, setSelected] = useState<string[]>([]);

  // Opening a note (signed URL -> viewer) and saying thanks.
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);
  const [thanksError, setThanksError] = useState<string | null>(null);
  const thanksInFlight = useRef<Set<string>>(new Set());

  // Row-level failures: retagging and removing both land here, keyed to the
  // note so the sentence sits under the card it's about.
  const [noteError, setNoteError] = useState<NoteFailure | null>(null);

  // The share-a-note flow: pick a file, then title / description / tags.
  const [picking, setPicking] = useState(false);
  const [pickedFile, setPickedFile] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteDescription, setNoteDescription] = useState("");
  const [draftTags, setDraftTags] = useState<string[]>([]);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // The long-press menu on a note (flashcards for anyone; tags and removal
  // for the uploader), and the inline tag editor it opens.
  const [menuNote, setMenuNote] = useState<NoteRow | null>(null);
  /* Held while the sheet slides away, so the uploader-only rows don't blink
     out of it mid-dismissal. Same trick as the deck screen's card menu. */
  const lastMenuNote = useRef<NoteRow | null>(null);
  if (menuNote !== null) lastMenuNote.current = menuNote;
  const menuNoteShown = menuNote ?? lastMenuNote.current;
  // Which note is on its way to a deck, so a double-tap can't mint two.
  const [deckingId, setDeckingId] = useState<string | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editTags, setEditTags] = useState<string[]>([]);
  const [savingTags, setSavingTags] = useState(false);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, [router]);

  /* -------------------------------- load -------------------------------- */

  const load = useCallback(async () => {
    if (!userId || !id) return;
    try {
      const [rows, enrollRes] = await Promise.all([
        listNotes(id),
        // Reading notes and sharing one are different permissions, and this is
        // what decides whether the share affordance is honest to offer.
        supabase
          .from("enrollments")
          .select("id")
          .eq("course_id", id)
          .eq("user_id", userId)
          .maybeSingle(),
      ]);
      setNotes(rows);
      // A hiccup on the enrollment probe keeps whatever we already knew,
      // rather than hiding the share button on someone who's in the class.
      if (!enrollRes.error) setEnrolled(enrollRes.data !== null);

      // Gratitude on the listed notes: one query, reduced to {count, mine}
      // per note. Best-effort: a hiccup keeps whatever we already had.
      if (rows.length > 0) {
        const { data: thanksRows, error: thanksFetchError } = await supabase
          .from("note_thanks")
          .select("note_id, user_id")
          .in(
            "note_id",
            rows.map((note) => note.id)
          );
        if (!thanksFetchError) {
          const reduced: Record<string, NoteThanksEntry> = {};
          for (const row of (thanksRows ?? []) as unknown as {
            note_id: string;
            user_id: string;
          }[]) {
            const current = reduced[row.note_id] ?? NO_THANKS;
            reduced[row.note_id] = {
              count: current.count + 1,
              mine: current.mine || row.user_id === userId,
            };
          }
          setNoteThanks(reduced);
        }
      } else {
        setNoteThanks({});
      }
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [id, userId]);

  useEffect(() => {
    if (!userId) return;
    void load();
  }, [userId, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setOpenError(null);
    setThanksError(null);
    setNoteError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /* ------------------------------ the tags ------------------------------ */

  /* Tallied from the notes already in state rather than fetched again.
     `fetchCourseTags` runs the identical query behind `listNotes` (same
     course, same RLS, same rows), so a second round trip would only buy a
     tally that goes stale the moment someone retags a note here. This one
     recomputes off the list itself, which means an optimistic retag and a
     just-shared note both move the counts immediately. */
  const courseTags: CourseTag[] = useMemo(
    () => tallyTags(notes.map((note) => note.tags)),
    [notes]
  );

  /* If the last note wearing a filtered tag gets retagged or taken down, that
     chip leaves the bar, and a filter you can no longer see is a filter you
     can't clear. Drop it instead of stranding an empty list. */
  useEffect(() => {
    setSelected((current) => {
      if (current.length === 0) return current;
      const live = new Set(courseTags.map((entry) => entry.tag));
      const next = current.filter((tag) => live.has(tag));
      return next.length === current.length ? current : next;
    });
  }, [courseTags]);

  const visible = useMemo(() => {
    if (selected.length === 0) return notes;
    // AND, not OR: "lecture" + "midterm" means the notes that are both.
    // Saved tags are already lowercased by the trigger, so this is exact.
    return notes.filter((note) =>
      selected.every((tag) => note.tags.includes(tag))
    );
  }, [notes, selected]);

  const toggleFilter = useCallback((tag: string) => {
    setSelected((current) =>
      current.includes(tag)
        ? current.filter((existing) => existing !== tag)
        : [...current, tag]
    );
  }, []);

  const clearFilter = useCallback(() => setSelected([]), []);

  /* ----------------------------- open + thanks ---------------------------- */

  const handleOpenNote = useCallback(async (note: NoteRow) => {
    setOpenError(null);
    setOpeningId(note.id);
    try {
      const url = await getSignedUrl(note.storage_path);
      await Linking.openURL(url);
    } catch (err) {
      setOpenError(
        err instanceof NotesError
          ? err.message
          : "Couldn't open that file. Give it another try."
      );
    } finally {
      setOpeningId(null);
    }
  }, []);

  /** Give thanks, or take it back. Optimistic either way, rolled back on
      failure. The uploader hears about it through the server-side trigger. */
  const handleToggleThanks = useCallback(
    async (note: NoteRow) => {
      // You can't thank yourself, and the server agrees, so don't even try.
      if (!userId || note.uploader_id === userId) return;
      if (thanksInFlight.current.has(note.id)) return;
      thanksInFlight.current.add(note.id);
      const previous = noteThanks[note.id] ?? NO_THANKS;
      const giving = !previous.mine;
      setThanksError(null);
      setNoteThanks((prev) => ({
        ...prev,
        [note.id]: giving
          ? { count: previous.count + 1, mine: true }
          : { count: Math.max(previous.count - 1, 0), mine: false },
      }));
      if (giving) tapLight();
      try {
        if (giving) {
          const { error: insertError } = await supabase
            .from("note_thanks")
            .insert({ note_id: note.id, user_id: userId });
          // Already thanked from elsewhere? The heart is right as drawn.
          if (insertError && insertError.code !== "23505") throw insertError;
        } else {
          const { error: deleteError } = await supabase
            .from("note_thanks")
            .delete()
            .eq("note_id", note.id)
            .eq("user_id", userId);
          if (deleteError) throw deleteError;
        }
      } catch {
        setNoteThanks((prev) => ({ ...prev, [note.id]: previous }));
        setThanksError(
          giving
            ? "Your thanks didn't make it through. Give it another try."
            : "Couldn't take that back just now. Give it another try."
        );
      } finally {
        thanksInFlight.current.delete(note.id);
      }
    },
    [userId, noteThanks]
  );

  /* ------------------------------- sharing ------------------------------- */

  const handlePickFile = useCallback(async () => {
    setUploadError(null);
    setPicking(true);
    try {
      const result = await DocumentPicker.getDocumentAsync({
        copyToCacheDirectory: true,
        multiple: false,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      if (!asset) return;
      if (typeof asset.size === "number" && asset.size > MAX_NOTE_BYTES) {
        setUploadError(
          `That file is ${formatFileSize(asset.size)}. The limit is 25 MB.`
        );
        return;
      }
      setPickedFile(asset);
      setNoteTitle(titleFromFileName(asset.name));
      setNoteDescription("");
      // Whatever tags are being filtered on are almost always the ones this
      // note wants too, so start there, and they're one tap from gone.
      setDraftTags(selected.slice(0, MAX_NOTE_TAGS));
    } catch {
      setUploadError("Couldn't open the file picker. Give it another try.");
    } finally {
      setPicking(false);
    }
  }, [selected]);

  const closeUploadForm = useCallback(() => {
    setPickedFile(null);
    setNoteTitle("");
    setNoteDescription("");
    setDraftTags([]);
    setUploadError(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!pickedFile || !userId || uploading) return;
    setUploadError(null);
    setUploading(true);
    try {
      const note = await uploadNote({
        courseId: id,
        userId,
        file: pickedFile,
        title: noteTitle,
        description: noteDescription,
        // Sent as typed; the row that comes back carries the tags the
        // trigger settled on, and that's what gets rendered.
        tags: draftTags,
      });
      setNotes((prev) => [note, ...prev.filter((n) => n.id !== note.id)]);
      // If they took the seeded tags back off, the note they just shared
      // wouldn't match the filter that's on, and disappearing is a terrible
      // answer to "I just shared this". Drop the filter rather than their work.
      setSelected((current) =>
        current.length > 0 && !current.every((tag) => note.tags.includes(tag))
          ? []
          : current
      );
      tapSuccess();
      closeUploadForm();
    } catch (err) {
      setUploadError(
        err instanceof NotesError
          ? err.message
          : "Couldn't share that note. Please try again."
      );
    } finally {
      setUploading(false);
    }
  }, [
    pickedFile,
    userId,
    uploading,
    id,
    noteTitle,
    noteDescription,
    draftTags,
    closeUploadForm,
  ]);

  /* ------------------------- notes into flashcards ------------------------ */

  /**
   * One deck per note: open the deck this note already seeded, or start it.
   * Either way the deck opens with the paste composer waiting, ready for the
   * note's lines.
   */
  const handleTurnIntoFlashcards = useCallback(
    async (note: NoteRow) => {
      if (!userId || deckingId) return;
      setNoteError(null);
      setDeckingId(note.id);
      try {
        const { data: existing, error: findError } = await supabase
          .from("decks")
          .select("id")
          .eq("source_note_id", note.id)
          .limit(1)
          .maybeSingle();
        if (findError) throw findError;
        if (existing) {
          router.push({
            pathname: "/deck/[id]",
            params: { id: (existing as { id: string }).id, paste: "1" },
          });
          return;
        }
        const { data: created, error: insertError } = await supabase
          .from("decks")
          .insert({
            course_id: id,
            created_by: userId,
            // Deck titles run 1-120 characters; note titles already fit, but
            // the trim keeps this honest if that ever loosens.
            title: note.title.trim().slice(0, 120),
            source_note_id: note.id,
          })
          .select("id")
          .single();
        if (insertError || !created) {
          throw insertError ?? new Error("No deck returned");
        }
        router.push({
          pathname: "/deck/[id]",
          params: { id: (created as { id: string }).id, paste: "1" },
        });
      } catch (err) {
        setNoteError({
          id: note.id,
          message:
            err instanceof Error && err.message.includes("row-level security")
              ? "Decks are for classmates. Add this course to your classes first."
              : "Couldn't turn that note into flashcards just now. Give it another try.",
        });
      } finally {
        setDeckingId(null);
      }
    },
    [userId, deckingId, id, router]
  );

  /* ------------------------- the long-press menu -------------------------- */

  const startEditTags = useCallback((note: NoteRow) => {
    setNoteError(null);
    setEditTags([...note.tags]);
    setEditingId(note.id);
  }, []);

  const cancelEditTags = useCallback(() => {
    setEditingId(null);
    setEditTags([]);
  }, []);

  const handleSaveTags = useCallback(
    async (note: NoteRow, next: string[]) => {
      if (savingTags) return;
      const previous = note.tags;
      setNoteError(null);
      setSavingTags(true);
      // Optimistic: the chips read as typed, then settle on whatever the
      // trigger made of them when the saved row lands.
      setNotes((current) =>
        current.map((row) => (row.id === note.id ? { ...row, tags: next } : row))
      );
      setEditingId(null);
      setEditTags([]);
      try {
        const saved = await setNoteTags(note.id, next);
        setNotes((current) =>
          current.map((row) => (row.id === saved.id ? saved : row))
        );
      } catch (err) {
        setNotes((current) =>
          current.map((row) =>
            row.id === note.id ? { ...row, tags: previous } : row
          )
        );
        setNoteError({
          id: note.id,
          message:
            err instanceof NotesError
              ? err.message
              : "Those tags didn't save. Give it another try.",
        });
      } finally {
        setSavingTags(false);
      }
    },
    [savingTags]
  );

  const handleRemove = useCallback(
    (note: NoteRow) => {
      Alert.alert(
        "Remove this note?",
        `"${note.title}" comes off ${courseCode ?? "the course"} for everyone, and the file goes with it.`,
        [
          { text: "Keep it", style: "cancel" },
          {
            text: "Remove",
            style: "destructive",
            onPress: () => {
              // Where to put it back if the delete doesn't take. Restoring
              // this one row beats restoring the whole array: a refresh
              // that landed while the alert was open keeps its work.
              const slot = notes.findIndex((row) => row.id === note.id);
              setNoteError(null);
              setEditingId((current) => (current === note.id ? null : current));
              setNotes((current) => current.filter((row) => row.id !== note.id));
              void (async () => {
                const { error: deleteError } = await supabase
                  .from("notes")
                  .delete()
                  .eq("id", note.id);
                if (deleteError) {
                  setNotes((current) => {
                    if (current.some((row) => row.id === note.id)) return current;
                    const restored = [...current];
                    restored.splice(
                      slot < 0 ? restored.length : Math.min(slot, restored.length),
                      0,
                      note
                    );
                    return restored;
                  });
                  setNoteError({
                    id: note.id,
                    message:
                      "Couldn't take that note down just now. Give it another try.",
                  });
                  return;
                }
                // The row is gone, so the file shouldn't linger in the
                // bucket. Best-effort on purpose: nothing points at it any
                // more, so a failed cleanup isn't worth a sentence.
                await supabase.storage
                  .from(NOTES_BUCKET)
                  .remove([note.storage_path]);
              })();
            },
          },
        ]
      );
    },
    [courseCode, notes]
  );

  // Deep links land here directly, so a signed-out visitor gets a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  /* ---------------------------- scaffold states --------------------------- */

  const scaffold = (children: ReactNode) => (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + space.close,
      }}
    >
      <View
        style={{
          flexDirection: "row",
          alignItems: "center",
          justifyContent: "space-between",
          paddingHorizontal: space.close,
        }}
      >
        <BackChevron onPress={goBack} />
        {status === "ready" && enrolled === true && pickedFile === null ? (
          <Button
            label="Share a note"
            variant="soft"
            size="sm"
            pending={picking}
            icon={<Feather name="upload" size={14} color={theme.brandInk} />}
            onPress={() => void handlePickFile()}
            style={{ marginRight: space.cosy }}
          />
        ) : null}
      </View>
      {children}
    </View>
  );

  if (!id) {
    return scaffold(
      <CenteredState
        icon="book-open"
        title="Course not available"
        message="We couldn't tell which course this is. Head back and open it from the course page."
      >
        <Button label="Back" variant="soft" size="sm" onPress={goBack} />
      </CenteredState>
    );
  }

  if (status === "loading") {
    /* The room names itself while it fills: the title is true before the
       query lands, and the rows underneath are the shape they'll be. */
    return scaffold(
      <View style={{ paddingHorizontal: space.gutter }}>
        <AppText variant="display" style={{ marginTop: space.hair }}>
          Shared notes
        </AppText>
        <AppText
          variant="caption"
          muted
          style={{ marginTop: space.snug, marginBottom: space.card }}
        >
          {courseCode
            ? `Put up by everyone in ${courseCode}.`
            : "Put up by your classmates."}
        </AppText>
        {[0, 1, 2].map((index) => (
          <SkeletonRow key={index} lines={2} />
        ))}
      </View>
    );
  }

  if (status === "error") {
    return scaffold(
      <CenteredState
        icon="cloud-off"
        title="Something hiccuped"
        message="We couldn't load this course's notes. Check your connection and give it another go."
      >
        <Button
          label="Try again"
          variant="soft"
          size="sm"
          onPress={() => {
            setStatus("loading");
            void load();
          }}
        />
      </CenteredState>
    );
  }

  /* ------------------------------ the notes ------------------------------ */

  const filtering = selected.length > 0;
  const suggestFromCourse = courseTags.slice(0, 6).map((entry) => entry.tag);

  const filterSummary = !filtering
    ? null
    : selected.length === 1
      ? `${noteCount(visible.length)} tagged "${selected[0]}".`
      : `${noteCount(visible.length)} with all ${selected.length} of these tags.`;

  const listHeader = (
    <View style={{ marginBottom: space.card }}>
      <AppText variant="display" style={{ marginTop: space.hair }}>
        Shared notes
      </AppText>
      <AppText variant="caption" muted style={{ marginTop: space.snug }}>
        {courseCode
          ? `Put up by everyone in ${courseCode}.`
          : "Put up by your classmates."}{" "}
        Tap one to download it.
        {enrolled === true
          ? " Long-press one to turn it into flashcards; your own can also be retagged or taken down."
          : ""}
      </AppText>

      {/* The filter rail. It bleeds to both gutters so a long list of tags
          runs off the edge instead of stopping short of it, and it isn't
          drawn at all until the class has actually tagged something. */}
      {courseTags.length > 0 ? (
        <>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            keyboardShouldPersistTaps="handled"
            style={{ marginHorizontal: -20, marginTop: space.close }}
            contentContainerStyle={{
              alignItems: "center",
              gap: space.cosy,
              paddingHorizontal: space.gutter,
              paddingVertical: space.hair,
            }}
          >
            <Chip
              label="All"
              tone="brand"
              size="md"
              selected={!filtering}
              onPress={clearFilter}
              accessibilityLabel={`All notes, ${noteCount(notes.length)}`}
            />
            {courseTags.map((entry) => (
              <Chip
                key={entry.tag}
                /* "lecture · 12", never "lecture 12". Plenty of real tags
                   end in a number ("week 5"), and the middot is what keeps
                   the count from reading as part of the word. */
                label={`${entry.tag} · ${entry.count}`}
                tone="brand"
                size="md"
                selected={selected.includes(entry.tag)}
                onPress={() => toggleFilter(entry.tag)}
                accessibilityLabel={`${entry.tag}, ${noteCount(entry.count)}`}
              />
            ))}
          </ScrollView>
          {filterSummary ? (
            <AppText variant="caption" muted style={{ marginTop: space.cosy }}>
              {filterSummary}
            </AppText>
          ) : null}
        </>
      ) : null}

      {/* No "you're not in this course" banner here on purpose: 0006's read
          policy is `is_enrolled(course_id)`, so a student outside the course
          never gets a single row back. A non-enrolled visitor is always
          looking at the empty state, which says it properly. */}

      {/* The share form, once a file has been picked. */}
      {pickedFile ? (
        <Card style={{ gap: space.close, marginTop: space.close }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              justifyContent: "space-between",
              gap: space.cosy,
            }}
          >
            <AppText variant="title">Share a note</AppText>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Close the note form"
              onPress={closeUploadForm}
              disabled={uploading}
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

          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.snug,
            }}
          >
            <Feather name="paperclip" size={13} color={theme.muted} />
            <AppText variant="caption" muted numberOfLines={1} style={{ flex: 1 }}>
              {pickedFile.name}
              {typeof pickedFile.size === "number"
                ? ` · ${formatFileSize(pickedFile.size)}`
                : ""}
            </AppText>
          </View>

          <Field
            label="Title"
            value={noteTitle}
            onChangeText={setNoteTitle}
            placeholder="Week 5 lecture notes"
            maxLength={120}
            editable={!uploading}
          />
          <Field
            label="Description (optional)"
            value={noteDescription}
            onChangeText={setNoteDescription}
            placeholder="What's covered, which lecture…"
            maxLength={500}
            editable={!uploading}
          />
          <TagPicker
            value={draftTags}
            onChange={setDraftTags}
            suggestions={suggestFromCourse}
            disabled={uploading}
          />

          {uploadError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {uploadError}
            </AppText>
          ) : null}

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
              disabled={uploading}
              onPress={closeUploadForm}
            />
            <Button
              label={uploading ? "Sharing…" : "Share note"}
              size="sm"
              pending={uploading}
              icon={<Feather name="upload" size={14} color={theme.brandFg} />}
              onPress={() => void handleUpload()}
            />
          </View>
        </Card>
      ) : uploadError ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginTop: space.room }}
        >
          {uploadError}
        </AppText>
      ) : null}

      {openError ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginTop: space.room }}
        >
          {openError}
        </AppText>
      ) : null}
      {thanksError ? (
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginTop: space.room }}
        >
          {thanksError}
        </AppText>
      ) : null}
    </View>
  );

  const emptyState = filtering ? (
    /* A filter is a query, and a query that came back with nothing is a
       reason to look again rather than an apology. */
    <EmptyState
      illustration={MagnifyingGlass}
      title={
        selected.length === 1
          ? "Nothing under that tag"
          : "Nothing wearing all those tags"
      }
      body={
        selected.length === 1
          ? "Nothing's filed under it right now. Clear the filter to see everything the class has put up."
          : "A note has to match every tag you picked. Try one fewer, or clear the filter."
      }
      action={{ label: "Clear the filter", onPress: clearFilter }}
    />
  ) : enrolled === false ? (
    /* Not "no notes yet": for someone outside the course there could be
       dozens, and the read policy doesn't show them any. Say the
       mechanism rather than let the empty list imply an empty shelf. The
       door is the mark: the room is there, and adding the course opens it. */
    <EmptyState
      illustration={Doorway}
      title="Notes stay inside the class"
      body={
        courseCode
          ? `Only people taking ${courseCode} can see what's been shared here. Add the course and everything your classmates have put up shows up.`
          : "Only people taking this course can see what's been shared here. Add it and everything your classmates have put up shows up."
      }
      action={{ label: "Add this course", onPress: () => router.push("/courses/add") }}
    />
  ) : (
    <EmptyState
      illustration={PinnedNote}
      title="The shelf is empty"
      body={
        courseCode
          ? `This is where ${courseCode} keeps its lecture notes, study guides and slides for everyone taking it. Put up the first one and the whole class has it.`
          : "This is where the class keeps its lecture notes, study guides and slides. Put up the first one and everyone taking it has them."
      }
      {...(enrolled === true
        ? { action: { label: "Share a note", onPress: () => void handlePickFile() } }
        : null)}
    />
  );

  const renderNote = (note: NoteRow, index: number) => {
    const mine = note.uploader_id === userId;
    const uploaderName = mine ? "You" : note.uploader?.display_name ?? "A classmate";
    const opening = openingId === note.id;
    const thanksEntry = noteThanks[note.id] ?? NO_THANKS;
    const failure = noteError?.id === note.id ? noteError.message : null;
    const editing = editingId === note.id;

    return (
      <View style={{ marginBottom: space.room }}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Open ${note.title}, shared by ${uploaderName}`}
          accessibilityHint={
            mine
              ? "Long press for flashcards, tags and removal"
              : "Long press to turn it into flashcards"
          }
          onPress={() => void handleOpenNote(note)}
          onLongPress={() => setMenuNote(note)}
          disabled={opening}
          style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
        >
          <Card
            padded={false}
            entrance={index}
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.close,
              padding: space.close,
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
              <Feather
                name={noteIcon(note.mime_type, note.file_name)}
                size={18}
                color={theme.brand}
              />
            </View>

            <View style={{ flex: 1, minWidth: 0, gap: space.tight }}>
              <AppText variant="bodySemi" numberOfLines={1}>
                {note.title}
              </AppText>
              {note.description ? (
                <AppText variant="caption" muted numberOfLines={2}>
                  {note.description}
                </AppText>
              ) : null}
              {note.tags.length > 0 ? (
                <View
                  style={{
                    flexDirection: "row",
                    flexWrap: "wrap",
                    gap: space.snug,
                  }}
                >
                  {note.tags.map((tag) => (
                    /* A tag that's part of the live filter wears the ember,
                       so it's visible at a glance why this note is here. */
                    <Chip
                      key={tag}
                      label={tag}
                      tone={selected.includes(tag) ? "brand" : "neutral"}
                    />
                  ))}
                </View>
              ) : null}
              <AppText variant="caption" muted numberOfLines={1}>
                {uploaderName} · {formatFileSize(note.file_size)} ·{" "}
                {shortDate(note.created_at)}
              </AppText>
            </View>

            {mine ? (
              /* Your own notes: the warmth just shows. You can't thank
                 yourself, and the server agrees. */
              <View
                accessible={thanksEntry.count > 0}
                accessibilityLabel={
                  thanksEntry.count === 1
                    ? "1 classmate said thanks"
                    : `${thanksEntry.count} classmates said thanks`
                }
                style={{
                  minWidth: 44,
                  height: 44,
                  marginVertical: -12,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space.tight,
                }}
              >
                <Feather name="heart" size={16} color={theme.muted} />
                {thanksEntry.count > 0 ? (
                  <AppText variant="caption" muted>
                    {thanksEntry.count}
                  </AppText>
                ) : null}
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={
                  thanksEntry.mine
                    ? `Take back your thanks for ${note.title}`
                    : `Say thanks for ${note.title}`
                }
                accessibilityState={{ selected: thanksEntry.mine }}
                onPress={() => void handleToggleThanks(note)}
                style={({ pressed }) => ({
                  minWidth: 44,
                  height: 44,
                  marginVertical: -12,
                  paddingHorizontal: space.snug,
                  borderRadius: radius.full,
                  backgroundColor: thanksEntry.mine ? theme.brandSoft : undefined,
                  flexDirection: "row",
                  alignItems: "center",
                  justifyContent: "center",
                  gap: space.tight,
                  opacity: pressed ? 0.6 : 1,
                })}
              >
                <Feather
                  name="heart"
                  size={16}
                  color={thanksEntry.mine ? theme.brand : theme.muted}
                />
                {thanksEntry.count > 0 ? (
                  <AppText
                    variant="caption"
                    style={{
                      color: thanksEntry.mine ? theme.brandInk : theme.muted,
                    }}
                  >
                    {thanksEntry.count}
                  </AppText>
                ) : null}
              </Pressable>
            )}

            {opening ? (
              <ActivityIndicator size="small" color={theme.brand} />
            ) : (
              <Feather name="download" size={18} color={theme.muted} />
            )}
          </Card>
        </Pressable>

        {failure ? (
          <AppText
            variant="caption"
            style={{
              color: theme.danger,
              marginTop: space.snug,
              marginHorizontal: space.tight,
            }}
          >
            {failure}
          </AppText>
        ) : null}

        {/* The tag editor opens under the note it belongs to, rather than in
            a sheet the keyboard would sit on top of. */}
        {editing ? (
          <Card style={{ gap: space.close, marginTop: space.cosy }}>
            <AppText variant="title">Tags for this note</AppText>
            <TagPicker
              value={editTags}
              onChange={setEditTags}
              suggestions={suggestFromCourse}
              disabled={savingTags}
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
                disabled={savingTags}
                onPress={cancelEditTags}
              />
              <Button
                label="Save tags"
                size="sm"
                pending={savingTags}
                onPress={() => void handleSaveTags(note, editTags)}
              />
            </View>
          </Card>
        ) : null}
      </View>
    );
  };

  return scaffold(
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
    >
      <FlatList
        data={visible}
        keyExtractor={(note) => note.id}
        renderItem={({ item, index }) => renderNote(item, index)}
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
          flexGrow: 1,
        }}
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
        ListHeaderComponent={listHeader}
        ListEmptyComponent={emptyState}
      />

      <Sheet
        visible={menuNote !== null}
        onClose={() => setMenuNote(null)}
        title={menuNoteShown?.title ?? "This note"}
      >
        <Sheet.Row
          icon="layers"
          label="Turn into flashcards"
          onPress={() => {
            const note = menuNote;
            setMenuNote(null);
            if (note) void handleTurnIntoFlashcards(note);
          }}
        />
        {menuNoteShown?.uploader_id === userId ? (
          <>
            <Sheet.Row
              icon="tag"
              label="Edit tags"
              onPress={() => {
                const note = menuNote;
                setMenuNote(null);
                if (note) startEditTags(note);
              }}
            />
            <Sheet.Row
              icon="trash-2"
              label="Remove note"
              danger
              onPress={() => {
                const note = menuNote;
                setMenuNote(null);
                if (note) handleRemove(note);
              }}
            />
          </>
        ) : null}
      </Sheet>
    </KeyboardAvoidingView>
  );
}
