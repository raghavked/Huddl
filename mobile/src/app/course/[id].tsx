import Feather from "@expo/vector-icons/Feather";
import * as DocumentPicker from "expo-document-picker";
import { Redirect, useLocalSearchParams, useRouter } from "expo-router";
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type ComponentProps,
} from "react";
import {
  ActivityIndicator,
  Linking,
  Pressable,
  RefreshControl,
  SectionList,
  View,
  type SectionListData,
  type SectionListRenderItemInfo,
} from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Avatar } from "@/components/avatar";
import { FocusStrip } from "@/components/focus-strip";
import {
  AppText,
  Button,
  Card,
  Chip,
  EmptyState,
  Field,
  SectionLabel,
  Skeleton,
  SkeletonRow,
  type ChipTone,
} from "@/components/ui";
import { courseTintsFor, radius, space } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import { colorForCourse } from "@/lib/course-color";
import { tapLight } from "@/lib/haptics";
import {
  formatFileSize,
  getSignedUrl,
  listNotes,
  uploadNote,
  MAX_NOTE_BYTES,
  NotesError,
  type NoteRow,
} from "@/lib/notes";
import {
  SemesterError,
  UNITS_MAX,
  UNITS_MIN,
  setCourseUnits,
  unitsFrom,
} from "@/lib/semester";
import { buddyCountLabel, countBuddies } from "@/lib/study-buddy";
import { supabase } from "@/lib/supabase";
import { kindLabel, type CalendarKind } from "@/lib/syllabus";
import { useAuth } from "@/providers/auth-provider";
import { useResolvedScheme } from "@/providers/display-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

/* Minimal local row shapes. The web app's types live outside this tsconfig. */

type CourseRow = {
  id: string;
  code: string;
  title: string;
  term: { name: string } | null;
  instructor: string | null;
  meeting_info: string | null;
  location: string | null;
  /**
   * `courses.units`. A `numeric` column, so PostgREST hands it back as a
   * number or as a string depending on the driver, so read it through
   * {@link unitsOf} rather than trusting the shape.
   */
  units: number | string | null;
};

type ClassmateRole = "student" | "ta" | "instructor";

type ClassmateRow = {
  id: string;
  user_id: string;
  role: ClassmateRole;
  catalog_course_id: string | null;
  profile: {
    id: string;
    handle: string;
    display_name: string;
    avatar_url: string | null;
    major: string | null;
    /** Whether they let the campus see them by name. See {@link mateName}. */
    is_public: boolean;
  } | null;
};

/**
 * What to call a classmate on this list, and whether to say anything else
 * about them.
 *
 * A student who turned Public profile off stands under their handle, with no
 * major beside it, the same redaction the people directory, the board, study
 * buddies and the web's own classmates tab apply. Sharing a lecture hall is
 * not consent to have your name and your major read off a class list, and no
 * policy stops it: migration 0012 left this to the app, which means every
 * list that forgets is a leak. You always see yourself in full.
 *
 * Fails closed: anything other than a literal `true` reads as private, so a
 * select that loses the column redacts rather than leaks.
 */
function mateName(
  profile: ClassmateRow["profile"],
  isMe: boolean
): { name: string; caption: string | null } {
  if (!profile) return { name: "A classmate", caption: null };
  if (!isMe && profile.is_public !== true) {
    return { name: `@${profile.handle}`, caption: "Private profile" };
  }
  return {
    name: profile.display_name,
    caption: `@${profile.handle}${profile.major ? ` · ${profile.major}` : ""}`,
  };
}

/**
 * The enrollment row as it actually arrives, tint included.
 *
 * `enrollments.color` is **personal**: the SELECT policy lets a student read
 * their classmates' enrollment rows, so every classmate's pick comes down the
 * wire, and exactly one of them is ever read: the one whose `user_id` is
 * ours. `ClassmateRow` deliberately doesn't carry the field, so nothing that
 * renders a classmate can reach it by accident.
 */
type EnrollmentRow = ClassmateRow & { color: string | null };

/* The next few shared calendar dates, previewed on the hub. */
type UpcomingItem = {
  id: string;
  kind: CalendarKind;
  title: string;
  due_at: string;
};

/* Upcoming events linked to this course: study sessions, mostly. */
type CourseEventRow = {
  id: string;
  kind: "study_session" | "meetup";
  title: string;
  starts_at: string;
};

/* Per-note gratitude: how many classmates said thanks, and whether I did. */
type NoteThanksEntry = { count: number; mine: boolean };

const NO_THANKS: NoteThanksEntry = { count: 0, mine: false };

type Status = "loading" | "error" | "notFound" | "ready";

type NoteItem = { key: string; type: "note"; note: NoteRow };
type MateItem = { key: string; type: "mate"; mate: ClassmateRow };
type EmptyItem = {
  key: string;
  type: "empty";
  icon: FeatherName;
  title: string;
  message: string;
};
type Item = NoteItem | MateItem | EmptyItem;
type Section = { key: "notes" | "mates"; title: string; data: Item[] };

const ROLE_WEIGHT: Record<ClassmateRole, number> = {
  instructor: 0,
  ta: 1,
  student: 2,
};

/* ----------------------------- helpers ----------------------------- */

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "gif", "webp", "heic"]);
const SHEET_EXT = new Set(["xls", "xlsx", "csv"]);
const SLIDE_EXT = new Set(["ppt", "pptx", "key"]);
const DOC_EXT = new Set(["pdf", "doc", "docx", "txt", "md", "rtf"]);

/** Feather stand-ins for the web's lucide file-type icons. */
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

function shortDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

/** "Fri, Oct 14", how calendar dates read on the hub preview. */
function dueDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Fri, Oct 14 · 3:00 PM", how study sessions read on the hub. */
function sessionWhen(iso: string): string {
  const time = new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dueDay(iso)} · ${time}`;
}

/** Quiet chip palette for calendar kinds, mirrored in course/calendar.tsx. */
function kindTone(kind: CalendarKind): ChipTone {
  switch (kind) {
    case "exam":
      return "brand";
    case "quiz":
    case "project":
      return "accent";
    default:
      return "neutral";
  }
}

/** "week-5-notes.pdf" -> "week 5 notes", a friendly default title. */
function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 120);
}

/**
 * `courses.units` as a number the screen can trust, or null for "nobody has
 * filled this in". Zero and negatives read as unknown too, exactly the way
 * `@/lib/semester` reads them. A course worth no units is not a thing, so
 * treating it as one would put a silent zero into somebody's GPA.
 */
function unitsOf(raw: number | string | null): number | null {
  const value = typeof raw === "string" ? Number(raw) : raw;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    return null;
  }
  return Math.round(value * 100) / 100;
}

/**
 * The units the column can actually hold. `courses.units` is `numeric(3,1)`
 * (migration 0032), so Postgres rounds a second decimal on the way in: a
 * student who typed 1.25 would watch the card say 1.3 after the next load.
 * Round here instead, so what they're shown is what the class got. The field
 * says "to one decimal place" before they type, so this is the stated rule
 * rather than a quiet correction.
 */
function toStorablePrecision(units: number | null): number | null {
  return units === null ? null : Math.round(units * 10) / 10;
}

/** "4 units", "1 unit", "0.5 units". */
function unitsText(units: number): string {
  return `${units} ${units === 1 ? "unit" : "units"}`;
}

/** What the units field starts with: the number as typed, or empty. */
function unitsDraft(units: number | null): string {
  return units === null ? "" : String(units);
}

/* --------------------------- tiny pieces ---------------------------- */

/** One doorway in the grid: an icon tile, a name, a one-line hint. */
function DoorwayTile({
  icon,
  title,
  caption,
  tone,
  onPress,
}: {
  icon: FeatherName;
  title: string;
  caption: string;
  tone: "brand" | "accent";
  onPress: () => void;
}) {
  const theme = useTheme();
  const colors =
    tone === "brand"
      ? { bg: theme.brandSoft, fg: theme.brand }
      : { bg: theme.accentSoft, fg: theme.accent };
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${title}, ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: "47%",
        flexGrow: 1,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Card
        padded={false}
        style={{
          flex: 1,
          padding: space.close,
          minHeight: 92,
          gap: space.cosy,
        }}
      >
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: radius.control,
            backgroundColor: colors.bg,
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <Feather name={icon} size={16} color={colors.fg} />
        </View>
        <View style={{ gap: space.hair }}>
          <AppText variant="bodySemi" numberOfLines={1}>
            {title}
          </AppText>
          <AppText variant="caption" muted numberOfLines={1}>
            {caption}
          </AppText>
        </View>
      </Card>
    </Pressable>
  );
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

/** The shared `EmptyState`, floated in the middle of an otherwise bare screen. */
function CenteredState({
  icon,
  title,
  message,
  action,
}: {
  icon: FeatherName;
  title: string;
  message: string;
  action: { label: string; onPress: () => void };
}) {
  return (
    <View
      style={{
        flex: 1,
        alignItems: "stretch",
        justifyContent: "center",
        paddingHorizontal: space.gutter,
        paddingBottom: 40,
      }}
    >
      <EmptyState icon={icon} title={title} body={message} action={action} />
    </View>
  );
}

/** The hub with the words not yet written. Same bones, same order. */
function HubSkeleton() {
  return (
    <View
      style={{
        paddingHorizontal: space.gutter,
        paddingTop: space.tight,
        gap: space.close,
      }}
    >
      <Skeleton width={128} height={28} radius={radius.full} />
      <Skeleton width="76%" height={15} radius={radius.full} />
      <Skeleton
        height={44}
        radius={radius.full}
        style={{ marginTop: space.tight }}
      />
      <View style={{ flexDirection: "row", flexWrap: "wrap", gap: space.room }}>
        {[0, 1, 2, 3, 4, 5, 6, 7].map((slot) => (
          <View key={slot} style={{ flexBasis: "47%", flexGrow: 1 }}>
            <Skeleton height={92} radius={radius.card} />
          </View>
        ))}
      </View>
      <View style={{ marginTop: space.tight }}>
        <SkeletonRow avatar={false} lines={2} />
        <SkeletonRow avatar={false} lines={1} />
      </View>
    </View>
  );
}

/* ------------------------------ screen ------------------------------ */

export default function CourseHubScreen() {
  const theme = useTheme();
  const tints = courseTintsFor(useResolvedScheme());
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const { id } = useLocalSearchParams<{ id: string }>();
  const courseId = id ?? "";

  const [status, setStatus] = useState<Status>("loading");
  const [course, setCourse] = useState<CourseRow | null>(null);
  const [channelId, setChannelId] = useState<string | null>(null);
  const [notes, setNotes] = useState<NoteRow[]>([]);
  const [noteThanks, setNoteThanks] = useState<Record<string, NoteThanksEntry>>(
    {}
  );
  const [mates, setMates] = useState<ClassmateRow[]>([]);
  /** My own tint for this course, straight off the wire. Null until it
      loads, and null forever for a student who never picked one. */
  const [myColor, setMyColor] = useState<string | null>(null);
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [sessions, setSessions] = useState<CourseEventRow[]>([]);
  const [linkCount, setLinkCount] = useState(0);
  const [buddyCount, setBuddyCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Classmate-kept course details: an inline three-field editor.
  const [editingDetails, setEditingDetails] = useState(false);
  const [draftInstructor, setDraftInstructor] = useState("");
  const [draftMeeting, setDraftMeeting] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [draftUnits, setDraftUnits] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);
  /** Sits on the units field itself, so a bad number never leaves the form. */
  const [unitsError, setUnitsError] = useState<string | null>(null);

  // Opening a note (signed URL -> browser/viewer).
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // Saying thanks on a classmate's note: optimistic, retractable.
  const [thanksError, setThanksError] = useState<string | null>(null);
  const thanksInFlight = useRef<Set<string>>(new Set());

  // The share-notes flow: pick a file, then a small inline title form.
  const [picking, setPicking] = useState(false);
  const [pickedFile, setPickedFile] =
    useState<DocumentPicker.DocumentPickerAsset | null>(null);
  const [noteTitle, setNoteTitle] = useState("");
  const [noteDescription, setNoteDescription] = useState("");
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/(tabs)/home");
  }, [router]);

  const load = useCallback(async () => {
    if (!userId) return;
    if (!courseId) {
      setStatus("notFound");
      return;
    }
    try {
      const [
        courseRes,
        channelRes,
        notesList,
        matesRes,
        upcomingRes,
        sessionsRes,
        linksRes,
        buddyTally,
      ] = await Promise.all([
          supabase
            .from("courses")
            .select(
              "id, code, title, instructor, meeting_info, location, units, term:terms(name)"
            )
            .eq("id", courseId)
            .maybeSingle(),
          // Courses grew rooms (extra channels). The front room is is_main.
          supabase
            .from("channels")
            .select("id")
            .eq("course_id", courseId)
            .eq("is_main", true)
            .maybeSingle(),
          listNotes(courseId),
          supabase
            .from("enrollments")
            .select(
              "id, user_id, role, catalog_course_id, color, profile:profiles(id, handle, display_name, avatar_url, major, is_public)"
            )
            .eq("course_id", courseId),
          supabase
            .from("course_calendar_items")
            .select("id, kind, title, due_at")
            .eq("course_id", courseId)
            .gte("due_at", new Date().toISOString())
            .order("due_at", { ascending: true })
            .limit(3),
          supabase
            .from("events")
            .select("id, kind, title, starts_at")
            .eq("course_id", courseId)
            .gte("starts_at", new Date().toISOString())
            .order("starts_at", { ascending: true })
            .limit(3),
          // The Links doorway shows a tally; the list lives on its own screen.
          supabase
            .from("course_links")
            .select("id", { count: "exact", head: true })
            .eq("course_id", courseId),
          // How many classmates are open to studying together. Head-only, and
          // it swallows its own failures, because a doorway caption is never worth
          // holding up the hub for.
          countBuddies(courseId),
        ]);
      if (courseRes.error) {
        setStatus("error");
        return;
      }
      const courseRow = courseRes.data as unknown as CourseRow | null;
      // RLS hides other campuses' courses, so "not found" covers both cases.
      if (!courseRow) {
        setStatus("notFound");
        return;
      }
      if (matesRes.error) {
        setStatus("error");
        return;
      }
      setCourse(courseRow);
      setChannelId(
        (channelRes.data as unknown as { id: string } | null)?.id ?? null
      );
      setNotes(notesList);
      // Gratitude on the listed notes: one query, reduced to {count, mine}
      // per note. Best-effort: a hiccup keeps whatever we already had.
      if (notesList.length > 0) {
        const { data: thanksRows, error: thanksFetchError } = await supabase
          .from("note_thanks")
          .select("note_id, user_id")
          .in(
            "note_id",
            notesList.map((n) => n.id)
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
      // The calendar preview is a bonus, so a hiccup here shouldn't block the hub.
      setUpcoming(
        (upcomingRes.data ?? []) as unknown as UpcomingItem[]
      );
      // Same deal for study sessions: best-effort preview.
      setSessions(
        (sessionsRes.data ?? []) as unknown as CourseEventRow[]
      );
      // And for the pinned-links tally: best-effort too.
      setLinkCount(linksRes.count ?? 0);
      // Same for the study-partner tally: `countBuddies` returns 0 rather
      // than throwing, so it can never be the reason this screen fails.
      setBuddyCount(buddyTally);
      const enrollmentRows = (matesRes.data ?? []) as unknown as EnrollmentRow[];
      // Only ever our own row's colour. See the note on `EnrollmentRow`.
      setMyColor(
        enrollmentRows.find((row) => row.user_id === userId)?.color ?? null
      );
      // Alphabetised by the name the list actually prints. Sorting on
      // `display_name` would order a private classmate by a name we refuse to
      // show, giving it away a letter at a time.
      const sortedMates = enrollmentRows.sort(
        (a, b) =>
          ROLE_WEIGHT[a.role] - ROLE_WEIGHT[b.role] ||
          mateName(a.profile, a.user_id === userId).name.localeCompare(
            mateName(b.profile, b.user_id === userId).name
          )
      );
      setMates(sortedMates);
      setStatus("ready");
    } catch {
      setStatus("error");
    }
  }, [courseId, userId]);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    setOpenError(null);
    setThanksError(null);
    setDetailsError(null);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  /* ------------------- course details (classmate-kept) ------------------- */

  const openDetailsEditor = useCallback(() => {
    if (!course) return;
    setDraftInstructor(course.instructor ?? "");
    setDraftMeeting(course.meeting_info ?? "");
    setDraftLocation(course.location ?? "");
    setDraftUnits(unitsDraft(unitsOf(course.units)));
    setDetailsError(null);
    setUnitsError(null);
    setEditingDetails(true);
  }, [course]);

  const closeDetailsEditor = useCallback(() => {
    setEditingDetails(false);
    setDetailsError(null);
    setUnitsError(null);
  }, []);

  const handleSaveDetails = useCallback(async () => {
    if (!course || savingDetails) return;

    // Units are read before anything is written. `unitsFrom` throws copy that
    // names the range, so a typo'd 500 stops the save at the field instead of
    // being quietly clamped into the whole class's GPA.
    let nextUnits: number | null;
    try {
      nextUnits = toStorablePrecision(unitsFrom(draftUnits));
    } catch (caught) {
      setUnitsError(
        caught instanceof SemesterError
          ? caught.message
          : `Units run ${UNITS_MIN} to ${UNITS_MAX}.`
      );
      return;
    }
    setUnitsError(null);

    const next = {
      instructor: draftInstructor.trim() || null,
      meeting_info: draftMeeting.trim() || null,
      location: draftLocation.trim() || null,
    };
    const previous = {
      instructor: course.instructor,
      meeting_info: course.meeting_info,
      location: course.location,
    };
    const previousUnits = unitsOf(course.units);
    const unitsChanged = nextUnits !== previousUnits;
    setDetailsError(null);
    setSavingDetails(true);
    // Optimistic: the card updates right away; a failure rolls it back.
    setCourse((cur) => (cur ? { ...cur, ...next, units: nextUnits } : cur));
    setEditingDetails(false);
    const { error: rpcError } = await supabase.rpc("update_course_details", {
      p_course_id: course.id,
      p_instructor: next.instructor,
      p_meeting_info: next.meeting_info,
      p_location: next.location,
    });
    if (rpcError) {
      setSavingDetails(false);
      setCourse((cur) =>
        cur ? { ...cur, ...previous, units: previousUnits } : cur
      );
      setDetailsError(
        rpcError.message.includes("join the course")
          ? "Details are kept by classmates. Add this course to your classes first."
          : "Couldn't save those details just now. Give it another try."
      );
      return;
    }
    // Units ride their own RPC, and only when the field actually moved.
    // Migration 0036 split them off the details save on purpose: a classmate
    // fixing a room number must never be able to blank the number every
    // student's semester GPA is weighted by. Its own write, its own rollback.
    if (unitsChanged) {
      try {
        await setCourseUnits(course.id, nextUnits);
      } catch (caught) {
        setCourse((cur) => (cur ? { ...cur, units: previousUnits } : cur));
        setDetailsError(
          caught instanceof SemesterError
            ? caught.message
            : "Couldn't save those units just now. Give it another try."
        );
      }
    }
    setSavingDetails(false);
  }, [
    course,
    savingDetails,
    draftInstructor,
    draftMeeting,
    draftLocation,
    draftUnits,
  ]);

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
    } catch {
      setUploadError("Couldn't open the file picker. Give it another try.");
    } finally {
      setPicking(false);
    }
  }, []);

  const closeUploadForm = useCallback(() => {
    setPickedFile(null);
    setNoteTitle("");
    setNoteDescription("");
    setUploadError(null);
  }, []);

  const handleUpload = useCallback(async () => {
    if (!pickedFile || !userId || uploading) return;
    setUploadError(null);
    setUploading(true);
    try {
      const note = await uploadNote({
        courseId,
        userId,
        file: pickedFile,
        title: noteTitle,
        description: noteDescription,
      });
      setNotes((prev) => [note, ...prev.filter((n) => n.id !== note.id)]);
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
    courseId,
    noteTitle,
    noteDescription,
    closeUploadForm,
  ]);

  // Deep links land here directly, so make sure a signed-out visitor gets a
  // proper door, not a broken screen.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

  const isEnrolled = mates.some((m) => m.user_id === userId);

  /* ------------------------- sections + rows ------------------------- */

  const noteItems: Item[] =
    notes.length > 0
      ? notes.map((note) => ({ key: `note-${note.id}`, type: "note", note }))
      : [
          {
            key: "notes-empty",
            type: "empty",
            icon: "file-text",
            title: "No notes yet",
            message: isEnrolled
              ? "Be the first to share lecture notes, a study guide or slides with your class."
              : "Notes are shared between classmates. Add this course to see them.",
          },
        ];

  const mateItems: Item[] =
    mates.length > 0
      ? mates.map((mate) => ({ key: `mate-${mate.id}`, type: "mate", mate }))
      : [
          {
            key: "mates-empty",
            type: "empty",
            icon: "users",
            title: "No classmates yet",
            message: "People show up here as they add this course.",
          },
        ];

  const sections: Section[] = [
    { key: "notes", title: "Notes", data: noteItems },
    { key: "mates", title: "Classmates", data: mateItems },
  ];

  const renderNoteRow = (note: NoteRow) => {
    const mine = note.uploader_id === userId;
    const uploaderName = mine
      ? "You"
      : note.uploader?.display_name ?? "A classmate";
    const opening = openingId === note.id;
    const thanksEntry = noteThanks[note.id] ?? NO_THANKS;
    return (
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`Open ${note.title}, shared by ${uploaderName}`}
        onPress={() => void handleOpenNote(note)}
        disabled={opening}
        style={({ pressed }) => ({ opacity: pressed ? 0.7 : 1 })}
      >
        <Card
          padded={false}
          style={{
            flexDirection: "row",
            alignItems: "center",
            gap: space.close,
            padding: space.close,
            minHeight: 64,
            marginBottom: space.room,
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
          <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
            <AppText variant="bodySemi" numberOfLines={1}>
              {note.title}
            </AppText>
            {note.description ? (
              <AppText variant="caption" muted numberOfLines={2}>
                {note.description}
              </AppText>
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
                backgroundColor: thanksEntry.mine
                  ? theme.brandSoft
                  : undefined,
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
    );
  };

  const renderMateRow = (mate: ClassmateRow) => {
    const isMe = mate.user_id === userId;
    const fromCatalog = mate.catalog_course_id !== null;
    // `name` feeds the Avatar too, so a private classmate's initials can't
    // spell out the name the caption just withheld.
    const { name, caption } = mateName(mate.profile, isMe);
    return (
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.close,
          padding: space.close,
          minHeight: 64,
          marginBottom: space.room,
        }}
      >
        <Avatar url={mate.profile?.avatar_url} name={name} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: space.hair }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: space.snug,
              flexWrap: "wrap",
            }}
          >
            <AppText variant="bodySemi" style={{ flexShrink: 1 }} numberOfLines={1}>
              {name}
            </AppText>
            {fromCatalog ? (
              <Feather
                name="check-circle"
                size={13}
                color={theme.accent}
                accessibilityLabel="Added from the catalog"
              />
            ) : null}
            {isMe ? <Chip label="You" tone="brand" /> : null}
            {mate.role === "instructor" ? (
              <Chip label="Instructor" tone="brand" />
            ) : mate.role === "ta" ? (
              <Chip label="TA" tone="accent" />
            ) : null}
          </View>
          {caption ? (
            <AppText variant="caption" muted numberOfLines={1}>
              {caption}
            </AppText>
          ) : null}
        </View>
      </Card>
    );
  };

  const renderEmptyRow = (item: EmptyItem) => (
    <EmptyState
      icon={item.icon}
      title={item.title}
      body={item.message}
      compact
      style={{ marginBottom: space.room }}
    />
  );

  const renderItem = ({ item }: SectionListRenderItemInfo<Item, Section>) => {
    if (item.type === "note") return renderNoteRow(item.note);
    if (item.type === "mate") return renderMateRow(item.mate);
    return renderEmptyRow(item);
  };

  const renderSectionHeader = ({
    section,
  }: {
    section: SectionListData<Item, Section>;
  }) => (
    <View>
      <SectionLabel text={section.title} />

      {section.key === "notes" ? (
        <View style={{ gap: space.room, marginBottom: space.room }}>
          {isEnrolled ? (
            pickedFile ? (
              <Card style={{ gap: space.close }}>
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
                    icon={
                      <Feather name="upload" size={14} color={theme.brandFg} />
                    }
                    onPress={() => void handleUpload()}
                  />
                </View>
              </Card>
            ) : (
              <View style={{ gap: space.cosy }}>
                <Button
                  label="Share notes"
                  variant="secondary"
                  pending={picking}
                  icon={<Feather name="upload" size={16} color={theme.brand} />}
                  onPress={() => void handlePickFile()}
                />
                {uploadError ? (
                  <AppText variant="caption" style={{ color: theme.danger }}>
                    {uploadError}
                  </AppText>
                ) : null}
              </View>
            )
          ) : null}
          {openError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {openError}
            </AppText>
          ) : null}
          {thanksError ? (
            <AppText variant="caption" style={{ color: theme.danger }}>
              {thanksError}
            </AppText>
          ) : null}
        </View>
      ) : null}
    </View>
  );

  /* --------------------------- pre-hub states ------------------------ */

  if (status !== "ready" || !course) {
    return (
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
        {status === "loading" ? (
          <HubSkeleton />
        ) : status === "notFound" ? (
          <CenteredState
            icon="book-open"
            title="Course not available"
            message="This course doesn't exist, or it belongs to another campus."
            action={{ label: "Back to home", onPress: goBack }}
          />
        ) : (
          <CenteredState
            icon="wifi-off"
            title="Something hiccuped"
            message="We couldn't load this course. Check your connection and give it another go."
            action={{
              label: "Try again",
              onPress: () => {
                setStatus("loading");
                void load();
              },
            }}
          />
        )}
      </View>
    );
  }

  /* ------------------------------ the hub ---------------------------- */

  /* The colour this student gave this course, or the tint hashed from its
     code when they never picked one. It is theirs alone; the classmate
     reading the same hub may well see a different band. */
  const tint = tints[colorForCourse(myColor, course.code)];

  const detailRows: {
    key: string;
    icon: FeatherName;
    value: string;
    /** A line standing in for a fact nobody has filled in yet. */
    pending?: boolean;
  }[] = [];
  if (course.instructor) {
    detailRows.push({ key: "instructor", icon: "user", value: course.instructor });
  }
  if (course.meeting_info) {
    detailRows.push({ key: "meeting", icon: "clock", value: course.meeting_info });
  }
  if (course.location) {
    detailRows.push({ key: "location", icon: "map-pin", value: course.location });
  }
  /* Units come last: the first three say where to be, this one only matters
     later, on the semester screen, where it decides how much this class
     weighs against the others. */
  const courseUnits = unitsOf(course.units);
  if (courseUnits !== null) {
    detailRows.push({
      key: "units",
      icon: "hash",
      value: unitsText(courseUnits),
    });
  } else if (isEnrolled && detailRows.length > 0) {
    /* Unset units get a line of their own, but only on a card that's already
       being drawn for someone who can fix it. The semester screen sends
       students here to fill this in, and a card that never mentions units
       would be a dead end at the end of that trip. Never the only row:
       one lonely "not set" line is what the empty state below is for. */
    detailRows.push({
      key: "units",
      icon: "hash",
      value: "Units not set",
      pending: true,
    });
  }

  return (
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

      <SectionList<Item, Section>
        sections={sections}
        keyExtractor={(item) => item.key}
        renderItem={renderItem}
        renderSectionHeader={renderSectionHeader}
        stickySectionHeadersEnabled={false}
        keyboardShouldPersistTaps="handled"
        keyboardDismissMode="on-drag"
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingHorizontal: space.gutter,
          paddingBottom: insets.bottom + space.rest,
        }}
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
            {/* The header wears the course's colour: a soft band, with the
                code set in that tint's ink. A saturated block would turn the
                first thing on the screen into a button it isn't, so this is
                the wash. The term line takes its colour from the band rather
                than falling back to grey, because muted text never sits on a tinted
                fill. */}
            <View
              style={{
                backgroundColor: tint.soft,
                borderRadius: radius.card,
                paddingHorizontal: space.card,
                paddingVertical: space.close,
                gap: space.tight,
              }}
            >
              <AppText variant="display" style={{ color: tint.ink }}>
                {course.code}
              </AppText>
              <AppText variant="bodyMedium">{course.title}</AppText>
              {course.term ? (
                <AppText variant="caption" style={{ color: tint.ink }}>
                  {course.term.name}
                </AppText>
              ) : null}
            </View>
            {channelId ? (
              <Button
                label="Open class chat"
                icon={
                  <Feather
                    name="message-circle"
                    size={16}
                    color={theme.brandFg}
                  />
                }
                onPress={() => router.push(`/channel/${channelId}`)}
                style={{ marginTop: space.close }}
              />
            ) : null}
            {!isEnrolled ? (
              <Card
                padded={false}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: space.room,
                  padding: space.close,
                  marginTop: space.close,
                  backgroundColor: theme.surface2,
                }}
              >
                <Feather name="info" size={16} color={theme.muted} />
                <AppText variant="caption" muted style={{ flex: 1 }}>
                  You're not in this course yet. Add it to share notes and
                  meet your classmates.
                </AppText>
                <Button
                  label="Add"
                  variant="soft"
                  size="sm"
                  onPress={() => router.push("/courses/add")}
                />
              </Card>
            ) : null}

            {/* Who's heads-down in this class right now. It draws nothing at
                all on a quiet day (no loading row, no empty state), so it
                costs the hub nothing until it has something warm to say. */}
            <FocusStrip
              courseId={courseId}
              style={{ marginTop: space.close }}
            />

            {/* Course details: who teaches it, when it meets, where, and
                what it's worth in units. Classmate-kept, like the course list
                itself: one row for the whole class, edited by anyone in it. */}
            <SectionLabel
              text="Course details"
              action={
                isEnrolled && !editingDetails
                  ? { label: "Edit", onPress: openDetailsEditor }
                  : undefined
              }
            />
            <View style={{ gap: space.room }}>
              {editingDetails ? (
                <Card style={{ gap: space.close }}>
                  <Field
                    label="Instructor"
                    value={draftInstructor}
                    onChangeText={setDraftInstructor}
                    placeholder="Prof. Alvarez"
                    maxLength={120}
                    editable={!savingDetails}
                  />
                  <Field
                    label="Meeting times"
                    value={draftMeeting}
                    onChangeText={setDraftMeeting}
                    placeholder="MWF 10:00–10:50 AM"
                    maxLength={120}
                    editable={!savingDetails}
                  />
                  <Field
                    label="Location"
                    value={draftLocation}
                    onChangeText={setDraftLocation}
                    placeholder="Wellman 106"
                    maxLength={120}
                    editable={!savingDetails}
                  />
                  {/* The one field on this card that changes a number
                      elsewhere. It sits under the room and carries its own
                      sentence, because "units" on its own doesn't say what
                      filling it in actually does for anyone. */}
                  <View style={{ gap: space.snug }}>
                    <Field
                      label="Units"
                      value={draftUnits}
                      onChangeText={(value) => {
                        setDraftUnits(value);
                        setUnitsError(null);
                      }}
                      placeholder="4"
                      keyboardType="decimal-pad"
                      maxLength={5}
                      editable={!savingDetails}
                      error={unitsError}
                    />
                    <AppText variant="caption" muted style={{ lineHeight: 17 }}>
                      Units weight your semester estimate, so a 5-unit lab
                      counts for more than a 1-unit seminar. Anything from{" "}
                      {UNITS_MIN} to {UNITS_MAX}, to one decimal place, or
                      leave it blank if you're not sure.
                    </AppText>
                  </View>
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
                      disabled={savingDetails}
                      onPress={closeDetailsEditor}
                    />
                    <Button
                      label="Save details"
                      size="sm"
                      pending={savingDetails}
                      onPress={() => void handleSaveDetails()}
                    />
                  </View>
                </Card>
              ) : detailRows.length > 0 ? (
                <Card padded={false}>
                  {detailRows.map((row, index) => (
                    <View
                      key={row.key}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.room,
                        paddingHorizontal: space.card,
                        paddingVertical: space.room,
                        minHeight: 48,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: theme.border,
                      }}
                    >
                      <Feather
                        name={row.icon}
                        size={15}
                        color={row.pending ? theme.muted : theme.brand}
                      />
                      <AppText
                        variant="bodyMedium"
                        muted={row.pending}
                        style={{ flex: 1 }}
                      >
                        {row.value}
                      </AppText>
                    </View>
                  ))}
                </Card>
              ) : (
                <EmptyState
                  compact
                  icon="info"
                  title="No details yet"
                  body="Who teaches it, when it meets, where, how many units. Fill it in for the class."
                />
              )}
              {detailsError ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  {detailsError}
                </AppText>
              ) : null}
              <AppText variant="caption" muted>
                Kept up by the class. Anyone enrolled can edit.
              </AppText>
            </View>

            {/* Doorways: every room of the course, eight tiles in four rows.
                Each opens a screen that was built as its own feature.

                Tone is meaning, not variety: fern for the dated and the
                graded (calendar, the weekly pattern that fills it, links
                you've filed, grades), ember for the people and the studying
                (rooms, notes, flashcards, partners). Laid out two-up that
                lands as a woven checkerboard (ember, fern / fern, ember /
                ember, fern / fern, ember) instead of the two solid color
                columns a mechanical alternation would draw.

                The order is read in pairs, not columns: the calendar and the
                pattern that fills it land back to back, and so do the notes
                and the links, because those are the two you reach for
                together. */}
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: space.room,
                marginTop: space.card,
              }}
            >
              <DoorwayTile
                icon="message-square"
                title="Rooms"
                caption="Lectures, study groups…"
                tone="brand"
                onPress={() =>
                  router.push({
                    pathname: "/course/rooms",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
              <DoorwayTile
                icon="book-open"
                title="Calendar"
                caption={upcoming[0]?.title ?? "Nothing due"}
                tone="accent"
                onPress={() =>
                  router.push({
                    pathname: "/course/calendar",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
              <DoorwayTile
                icon="repeat"
                title="Weekly pattern"
                caption="Set it once for the term"
                tone="accent"
                onPress={() =>
                  router.push({
                    pathname: "/course/series",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
              <DoorwayTile
                icon="file-text"
                title="Notes"
                caption={
                  notes.length === 0
                    ? "Share the first set"
                    : notes.length === 1
                      ? "1 note shared"
                      : `${notes.length} notes shared`
                }
                tone="brand"
                onPress={() =>
                  router.push({
                    pathname: "/course/notes",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
              <DoorwayTile
                icon="layers"
                title="Flashcards"
                caption="Shared decks"
                tone="brand"
                onPress={() =>
                  router.push({
                    pathname: "/course/decks",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
              <DoorwayTile
                icon="link"
                title="Links"
                caption={
                  linkCount === 0
                    ? "Pin the syllabus"
                    : linkCount === 1
                      ? "1 link pinned"
                      : `${linkCount} links pinned`
                }
                tone="accent"
                onPress={() =>
                  router.push({
                    pathname: "/course/links",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
              <DoorwayTile
                icon="bar-chart-2"
                title="Grades"
                caption="Only you see it"
                tone="accent"
                onPress={() =>
                  router.push({
                    pathname: "/course/grades",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
              <DoorwayTile
                icon="users"
                title="Study partners"
                caption={buddyCountLabel(buddyCount) ?? "Find someone"}
                tone="brand"
                onPress={() =>
                  router.push({
                    pathname: "/course/buddies",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
            </View>

            {/* Class calendar: the next few shared dates, previewed. */}
            <SectionLabel text="Class calendar" />
            <View style={{ gap: space.room }}>
              {upcoming.length > 0 ? (
                <Card padded={false}>
                  {upcoming.map((item, index) => (
                    <View
                      key={item.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: space.room,
                        paddingHorizontal: space.card,
                        paddingVertical: space.room,
                        minHeight: 48,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: theme.border,
                      }}
                    >
                      <Chip label={kindLabel(item.kind)} tone={kindTone(item.kind)} />
                      <AppText
                        variant="bodyMedium"
                        numberOfLines={1}
                        style={{ flex: 1 }}
                      >
                        {item.title}
                      </AppText>
                      <AppText variant="caption" muted>
                        {dueDay(item.due_at)}
                      </AppText>
                    </View>
                  ))}
                </Card>
              ) : (
                <EmptyState
                  compact
                  icon="calendar"
                  title="No dates yet"
                  body="Paste the syllabus once and the whole class gets the schedule."
                />
              )}
              <Button
                label="Import syllabus"
                variant="secondary"
                size="sm"
                icon={
                  <Feather
                    name="file-plus"
                    size={14}
                    color={theme.foreground}
                  />
                }
                onPress={() =>
                  router.push({
                    pathname: "/course/syllabus",
                    params: { courseId, courseCode: course.code },
                  })
                }
                style={{ alignSelf: "flex-start" }}
              />
            </View>

            {/* Study sessions: course-linked events, planned right here. */}
            <SectionLabel text="Study sessions" />
            <View style={{ gap: space.room }}>
              {sessions.length > 0 ? (
                <Card padded={false}>
                  {sessions.map((event, index) => (
                    <Pressable
                      key={event.id}
                      accessibilityRole="button"
                      accessibilityLabel={`${event.title}, ${sessionWhen(event.starts_at)}`}
                      onPress={() => router.push(`/event/${event.id}`)}
                      style={({ pressed }) => ({
                        opacity: pressed ? 0.7 : 1,
                      })}
                    >
                      <View
                        style={{
                          flexDirection: "row",
                          alignItems: "center",
                          gap: space.room,
                          paddingHorizontal: space.card,
                          paddingVertical: space.room,
                          minHeight: 48,
                          borderTopWidth: index === 0 ? 0 : 1,
                          borderTopColor: theme.border,
                        }}
                      >
                        <Feather
                          name={
                            event.kind === "study_session"
                              ? "book-open"
                              : "smile"
                          }
                          size={15}
                          color={theme.accent}
                        />
                        <AppText
                          variant="bodyMedium"
                          numberOfLines={1}
                          style={{ flex: 1 }}
                        >
                          {event.title}
                        </AppText>
                        <AppText variant="caption" muted>
                          {sessionWhen(event.starts_at)}
                        </AppText>
                        <Feather
                          name="chevron-right"
                          size={16}
                          color={theme.muted}
                        />
                      </View>
                    </Pressable>
                  ))}
                </Card>
              ) : (
                <EmptyState
                  compact
                  icon="users"
                  title="Nothing planned yet"
                  body="Be the one who gets the class together. Pick a time and a place."
                />
              )}
              <Button
                label="Plan a study session"
                variant="soft"
                size="sm"
                icon={<Feather name="users" size={14} color={theme.brandInk} />}
                onPress={() =>
                  router.push({
                    pathname: "/event/new",
                    params: { courseId, courseCode: course.code },
                  })
                }
                style={{ alignSelf: "flex-start" }}
              />
            </View>
          </View>
        }
      />
    </View>
  );
}
