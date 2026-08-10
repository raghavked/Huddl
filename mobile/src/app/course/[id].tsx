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
import { AppText, Button, Card, Field } from "@/components/ui";
import { radius, type Palette } from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
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
import { supabase } from "@/lib/supabase";
import { kindLabel, type CalendarKind } from "@/lib/syllabus";
import { useAuth } from "@/providers/auth-provider";

type FeatherName = ComponentProps<typeof Feather>["name"];

/* Minimal local row shapes — the web app's types live outside this tsconfig. */

type CourseRow = {
  id: string;
  code: string;
  title: string;
  term: { name: string } | null;
  instructor: string | null;
  meeting_info: string | null;
  location: string | null;
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
  } | null;
};

/* The next few shared calendar dates, previewed on the hub. */
type UpcomingItem = {
  id: string;
  kind: CalendarKind;
  title: string;
  due_at: string;
};

/* Upcoming events linked to this course — study sessions, mostly. */
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

/** "Fri, Oct 14" — how calendar dates read on the hub preview. */
function dueDay(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, {
    weekday: "short",
    month: "short",
    day: "numeric",
  });
}

/** "Fri, Oct 14 · 3:00 PM" — how study sessions read on the hub. */
function sessionWhen(iso: string): string {
  const time = new Date(iso).toLocaleTimeString(undefined, {
    hour: "numeric",
    minute: "2-digit",
  });
  return `${dueDay(iso)} · ${time}`;
}

/** Quiet chip palette for calendar kinds — mirrored in course/calendar.tsx. */
function kindColors(kind: CalendarKind, theme: Palette): { bg: string; fg: string } {
  switch (kind) {
    case "exam":
      return { bg: theme.brandSoft, fg: theme.brandInk };
    case "quiz":
    case "project":
      return { bg: theme.accentSoft, fg: theme.accent };
    default:
      return { bg: theme.surface2, fg: theme.muted };
  }
}

function KindChip({ kind }: { kind: CalendarKind }) {
  const theme = useTheme();
  const colors = kindColors(kind, theme);
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: colors.bg,
      }}
    >
      <AppText variant="label" style={{ color: colors.fg, fontSize: 11, lineHeight: 14 }}>
        {kindLabel(kind)}
      </AppText>
    </View>
  );
}

/** "week-5-notes.pdf" -> "week 5 notes" — a friendly default title. */
function titleFromFileName(name: string): string {
  return name
    .replace(/\.[^.]+$/, "")
    .replace(/[-_]+/g, " ")
    .trim()
    .slice(0, 120);
}

/* --------------------------- tiny pieces ---------------------------- */

/** Uniform section label — the same quiet uppercase rhythm as home. */
function SectionLabel({
  text,
  action,
}: {
  text: string;
  action?: { label: string; onPress: () => void };
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flexDirection: "row",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 8,
        marginTop: 24,
        marginBottom: 10,
      }}
    >
      <AppText
        variant="label"
        muted
        style={{ textTransform: "uppercase", letterSpacing: 1.2 }}
      >
        {text}
      </AppText>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          hitSlop={{ top: 14, bottom: 14, left: 12, right: 12 }}
          style={({ pressed }) => ({ opacity: pressed ? 0.6 : 1 })}
        >
          <AppText variant="label" style={{ color: theme.brand }}>
            {action.label}
          </AppText>
        </Pressable>
      ) : null}
    </View>
  );
}

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
      accessibilityLabel={`${title} — ${caption}`}
      onPress={onPress}
      style={({ pressed }) => ({
        flexBasis: "47%",
        flexGrow: 1,
        opacity: pressed ? 0.7 : 1,
      })}
    >
      <Card padded={false} style={{ flex: 1, padding: 12, minHeight: 92, gap: 8 }}>
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
        <View style={{ gap: 2 }}>
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

/** Tiny avatar stand-in: two initials on a warm circle, tinted by name hash. */
function Initials({ name, size = 40 }: { name: string; size?: number }) {
  const theme = useTheme();
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  }
  const pair =
    hash % 2 === 0
      ? { bg: theme.brandSoft, fg: theme.brandInk }
      : { bg: theme.accentSoft, fg: theme.accent };
  const parts = name.trim().split(/\s+/).filter(Boolean);
  const first = parts[0] ?? "";
  const last = parts.length > 1 ? parts[parts.length - 1] ?? "" : "";
  const initials =
    `${first.charAt(0)}${last ? last.charAt(0) : first.charAt(1)}`.toUpperCase() ||
    "?";
  return (
    <View
      accessibilityElementsHidden
      style={{
        width: size,
        height: size,
        borderRadius: radius.full,
        backgroundColor: pair.bg,
        alignItems: "center",
        justifyContent: "center",
      }}
    >
      <AppText
        variant="label"
        style={{ color: pair.fg, fontSize: size * 0.36, lineHeight: size * 0.5 }}
      >
        {initials}
      </AppText>
    </View>
  );
}

function Pill({
  label,
  tone,
}: {
  label: string;
  tone: "brand" | "accent";
}) {
  const theme = useTheme();
  const colors =
    tone === "brand"
      ? { bg: theme.brandSoft, fg: theme.brandInk }
      : { bg: theme.accentSoft, fg: theme.accent };
  return (
    <View
      style={{
        paddingHorizontal: 8,
        paddingVertical: 2,
        borderRadius: radius.full,
        backgroundColor: colors.bg,
      }}
    >
      <AppText variant="label" style={{ color: colors.fg, fontSize: 11 }}>
        {label}
      </AppText>
    </View>
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

function CenteredState({
  icon,
  title,
  message,
  children,
}: {
  icon: FeatherName;
  title: string;
  message: string;
  children?: React.ReactNode;
}) {
  const theme = useTheme();
  return (
    <View
      style={{
        flex: 1,
        alignItems: "center",
        justifyContent: "center",
        gap: 10,
        padding: 28,
      }}
    >
      <View
        style={{
          width: 52,
          height: 52,
          borderRadius: 16,
          backgroundColor: theme.brandSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <Feather name={icon} size={22} color={theme.brand} />
      </View>
      <AppText variant="title">{title}</AppText>
      <AppText muted style={{ textAlign: "center", maxWidth: 280 }}>
        {message}
      </AppText>
      {children}
    </View>
  );
}

/* ------------------------------ screen ------------------------------ */

export default function CourseHubScreen() {
  const theme = useTheme();
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
  const [upcoming, setUpcoming] = useState<UpcomingItem[]>([]);
  const [sessions, setSessions] = useState<CourseEventRow[]>([]);
  const [linkCount, setLinkCount] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Classmate-kept course details: an inline three-field editor.
  const [editingDetails, setEditingDetails] = useState(false);
  const [draftInstructor, setDraftInstructor] = useState("");
  const [draftMeeting, setDraftMeeting] = useState("");
  const [draftLocation, setDraftLocation] = useState("");
  const [savingDetails, setSavingDetails] = useState(false);
  const [detailsError, setDetailsError] = useState<string | null>(null);

  // Opening a note (signed URL -> browser/viewer).
  const [openingId, setOpeningId] = useState<string | null>(null);
  const [openError, setOpenError] = useState<string | null>(null);

  // Saying thanks on a classmate's note — optimistic, retractable.
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
      ] = await Promise.all([
          supabase
            .from("courses")
            .select(
              "id, code, title, instructor, meeting_info, location, term:terms(name)"
            )
            .eq("id", courseId)
            .maybeSingle(),
          // Courses grew rooms (extra channels) — the front room is is_main.
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
              "id, user_id, role, catalog_course_id, profile:profiles(id, handle, display_name, avatar_url, major)"
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
          // The Links doorway shows a tally — the list lives on its own screen.
          supabase
            .from("course_links")
            .select("id", { count: "exact", head: true })
            .eq("course_id", courseId),
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
      // per note. Best-effort — a hiccup keeps whatever we already had.
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
      // The calendar preview is a bonus — a hiccup here shouldn't block the hub.
      setUpcoming(
        (upcomingRes.data ?? []) as unknown as UpcomingItem[]
      );
      // Same deal for study sessions — best-effort preview.
      setSessions(
        (sessionsRes.data ?? []) as unknown as CourseEventRow[]
      );
      // And for the pinned-links tally — best-effort too.
      setLinkCount(linksRes.count ?? 0);
      const sortedMates = (
        (matesRes.data ?? []) as unknown as ClassmateRow[]
      ).sort(
        (a, b) =>
          ROLE_WEIGHT[a.role] - ROLE_WEIGHT[b.role] ||
          (a.profile?.display_name ?? "").localeCompare(
            b.profile?.display_name ?? ""
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
    setDetailsError(null);
    setEditingDetails(true);
  }, [course]);

  const closeDetailsEditor = useCallback(() => {
    setEditingDetails(false);
    setDetailsError(null);
  }, []);

  const handleSaveDetails = useCallback(async () => {
    if (!course || savingDetails) return;
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
    setDetailsError(null);
    setSavingDetails(true);
    // Optimistic: the card updates right away; a failure rolls it back.
    setCourse((cur) => (cur ? { ...cur, ...next } : cur));
    setEditingDetails(false);
    const { error: rpcError } = await supabase.rpc("update_course_details", {
      p_course_id: course.id,
      p_instructor: next.instructor,
      p_meeting_info: next.meeting_info,
      p_location: next.location,
    });
    setSavingDetails(false);
    if (rpcError) {
      setCourse((cur) => (cur ? { ...cur, ...previous } : cur));
      setDetailsError(
        rpcError.message.includes("join the course")
          ? "Details are kept by classmates — add this course to your classes first."
          : "Couldn't save those details just now. Give it another try."
      );
    }
  }, [course, savingDetails, draftInstructor, draftMeeting, draftLocation]);

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

  /** Give thanks, or take it back — optimistic either way, rolled back on
      failure. The uploader hears about it through the server-side trigger. */
  const handleToggleThanks = useCallback(
    async (note: NoteRow) => {
      // You can't thank yourself — the server agrees, so don't even try.
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
            ? "Your thanks didn't make it through — give it another try."
            : "Couldn't take that back just now — give it another try."
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
          `That file is ${formatFileSize(asset.size)} — the limit is 25 MB.`
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

  // Deep links land here directly — make sure a signed-out visitor gets a
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
              : "Notes are shared between classmates — add this course to see them.",
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
            gap: 12,
            padding: 12,
            minHeight: 64,
            marginBottom: 10,
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
          <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
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
            /* Your own notes: the warmth just shows — you can't thank
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
                gap: 4,
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
                paddingHorizontal: 6,
                borderRadius: radius.full,
                backgroundColor: thanksEntry.mine
                  ? theme.brandSoft
                  : undefined,
                flexDirection: "row",
                alignItems: "center",
                justifyContent: "center",
                gap: 4,
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
    const name = mate.profile?.display_name ?? "A classmate";
    const isMe = mate.user_id === userId;
    const fromCatalog = mate.catalog_course_id !== null;
    const caption = mate.profile
      ? `@${mate.profile.handle}${mate.profile.major ? ` · ${mate.profile.major}` : ""}`
      : null;
    return (
      <Card
        padded={false}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: 12,
          padding: 12,
          minHeight: 64,
          marginBottom: 10,
        }}
      >
        <Initials name={name} size={40} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <View
            style={{
              flexDirection: "row",
              alignItems: "center",
              gap: 6,
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
            {isMe ? <Pill label="You" tone="brand" /> : null}
            {mate.role === "instructor" ? (
              <Pill label="Instructor" tone="brand" />
            ) : mate.role === "ta" ? (
              <Pill label="TA" tone="accent" />
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
    <Card
      style={{
        alignItems: "center",
        gap: 6,
        paddingVertical: 24,
        borderStyle: "dashed",
        marginBottom: 10,
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
          marginBottom: 2,
        }}
      >
        <Feather name={item.icon} size={18} color={theme.brand} />
      </View>
      <AppText variant="bodySemi">{item.title}</AppText>
      <AppText
        variant="caption"
        muted
        style={{ textAlign: "center", maxWidth: 260 }}
      >
        {item.message}
      </AppText>
    </Card>
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
        <View style={{ gap: 10, marginBottom: 10 }}>
          {isEnrolled ? (
            pickedFile ? (
              <Card style={{ gap: 12 }}>
                <View
                  style={{
                    flexDirection: "row",
                    alignItems: "center",
                    justifyContent: "space-between",
                    gap: 8,
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
                    gap: 6,
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
                    gap: 8,
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
              <View style={{ gap: 8 }}>
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
          paddingTop: insets.top + 8,
        }}
      >
        <View style={{ paddingHorizontal: 12 }}>
          <BackChevron onPress={goBack} />
        </View>
        {status === "loading" ? (
          <View
            style={{
              flex: 1,
              alignItems: "center",
              justifyContent: "center",
              gap: 12,
            }}
          >
            <ActivityIndicator size="large" color={theme.brand} />
            <AppText variant="caption" muted>
              Opening your course…
            </AppText>
          </View>
        ) : status === "notFound" ? (
          <CenteredState
            icon="book-open"
            title="Course not available"
            message="This course doesn't exist, or it belongs to another campus."
          >
            <Button
              label="Back to home"
              variant="soft"
              size="sm"
              onPress={goBack}
            />
          </CenteredState>
        ) : (
          <CenteredState
            icon="wifi-off"
            title="Something hiccuped"
            message="We couldn't load this course. Check your connection and give it another go."
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
        )}
      </View>
    );
  }

  /* ------------------------------ the hub ---------------------------- */

  const detailRows: { key: string; icon: FeatherName; value: string }[] = [];
  if (course.instructor) {
    detailRows.push({ key: "instructor", icon: "user", value: course.instructor });
  }
  if (course.meeting_info) {
    detailRows.push({ key: "meeting", icon: "clock", value: course.meeting_info });
  }
  if (course.location) {
    detailRows.push({ key: "location", icon: "map-pin", value: course.location });
  }

  return (
    <View
      style={{
        flex: 1,
        backgroundColor: theme.background,
        paddingTop: insets.top + 8,
      }}
    >
      <View style={{ paddingHorizontal: 12 }}>
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
          paddingHorizontal: 20,
          paddingBottom: insets.bottom + 32,
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
            <View style={{ gap: 4 }}>
              <AppText variant="display">{course.code}</AppText>
              <AppText variant="bodyMedium">{course.title}</AppText>
              {course.term ? (
                <AppText variant="caption" muted>
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
                style={{ marginTop: 12 }}
              />
            ) : null}
            {!isEnrolled ? (
              <Card
                padded={false}
                style={{
                  flexDirection: "row",
                  alignItems: "center",
                  gap: 10,
                  padding: 12,
                  marginTop: 12,
                  backgroundColor: theme.surface2,
                }}
              >
                <Feather name="info" size={16} color={theme.muted} />
                <AppText variant="caption" muted style={{ flex: 1 }}>
                  You're not in this course yet — add it to share notes and
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

            {/* Course details — who teaches it, when it meets, where.
                Classmate-kept, like the course list itself. */}
            <SectionLabel
              text="Course details"
              action={
                isEnrolled && !editingDetails
                  ? { label: "Edit", onPress: openDetailsEditor }
                  : undefined
              }
            />
            <View style={{ gap: 10 }}>
              {editingDetails ? (
                <Card style={{ gap: 12 }}>
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
                  <View
                    style={{
                      flexDirection: "row",
                      justifyContent: "flex-end",
                      gap: 8,
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
                        gap: 10,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        minHeight: 48,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: theme.border,
                      }}
                    >
                      <Feather name={row.icon} size={15} color={theme.brand} />
                      <AppText variant="bodyMedium" style={{ flex: 1 }}>
                        {row.value}
                      </AppText>
                    </View>
                  ))}
                </Card>
              ) : (
                <Card
                  style={{
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: 20,
                    borderStyle: "dashed",
                  }}
                >
                  <AppText
                    variant="caption"
                    muted
                    style={{ textAlign: "center", maxWidth: 260 }}
                  >
                    Who teaches it, when it meets, where — fill it in for the
                    class.
                  </AppText>
                </Card>
              )}
              {detailsError ? (
                <AppText variant="caption" style={{ color: theme.danger }}>
                  {detailsError}
                </AppText>
              ) : null}
              <AppText variant="caption" muted>
                Kept up by the class — anyone enrolled can edit.
              </AppText>
            </View>

            {/* Doorways — every room of the course, four tiles deep. Each
                opens a screen that was built as its own feature. */}
            <View
              style={{
                flexDirection: "row",
                flexWrap: "wrap",
                gap: 10,
                marginTop: 16,
              }}
            >
              <DoorwayTile
                icon="book-open"
                title="Calendar"
                caption={upcoming[0]?.title ?? "Nothing due"}
                tone="brand"
                onPress={() =>
                  router.push({
                    pathname: "/course/calendar",
                    params: { courseId, courseCode: course.code },
                  })
                }
              />
              <DoorwayTile
                icon="message-square"
                title="Rooms"
                caption="Lectures, study groups…"
                tone="accent"
                onPress={() =>
                  router.push({
                    pathname: "/course/rooms",
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
            </View>

            {/* Class calendar — the next few shared dates, previewed. */}
            <SectionLabel text="Class calendar" />
            <View style={{ gap: 10 }}>
              {upcoming.length > 0 ? (
                <Card padded={false}>
                  {upcoming.map((item, index) => (
                    <View
                      key={item.id}
                      style={{
                        flexDirection: "row",
                        alignItems: "center",
                        gap: 10,
                        paddingHorizontal: 14,
                        paddingVertical: 10,
                        minHeight: 48,
                        borderTopWidth: index === 0 ? 0 : 1,
                        borderTopColor: theme.border,
                      }}
                    >
                      <KindChip kind={item.kind} />
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
                <Card
                  style={{
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: 20,
                    borderStyle: "dashed",
                  }}
                >
                  <AppText variant="bodySemi">No dates yet</AppText>
                  <AppText
                    variant="caption"
                    muted
                    style={{ textAlign: "center", maxWidth: 260 }}
                  >
                    Paste the syllabus once and the whole class gets the
                    schedule.
                  </AppText>
                </Card>
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

            {/* Study sessions — course-linked events, planned right here. */}
            <SectionLabel text="Study sessions" />
            <View style={{ gap: 10 }}>
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
                          gap: 10,
                          paddingHorizontal: 14,
                          paddingVertical: 10,
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
                <Card
                  style={{
                    alignItems: "center",
                    gap: 6,
                    paddingVertical: 20,
                    borderStyle: "dashed",
                  }}
                >
                  <AppText
                    variant="caption"
                    muted
                    style={{ textAlign: "center", maxWidth: 260 }}
                  >
                    Nothing planned yet — be the one who gets the class
                    together.
                  </AppText>
                </Card>
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
