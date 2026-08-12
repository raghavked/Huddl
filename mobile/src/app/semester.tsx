import Feather from "@expo/vector-icons/Feather";
import { Redirect, router } from "expo-router";
import { useCallback, useEffect, useState } from "react";
import { Pressable, RefreshControl, ScrollView, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { WallCalendar } from "@/components/illustrations";
import {
  AppText,
  Card,
  EmptyState,
  SectionLabel,
  Skeleton,
} from "@/components/ui";
import {
  courseTintsFor,
  radius,
  space,
  type CourseTintColors,
} from "@/constants/theme";
import { useTheme } from "@/hooks/use-theme";
import {
  GRADE_POINT_MAX,
  SemesterError,
  fetchSemester,
  formatGpa,
  totalUnits,
  type Semester,
  type SemesterCourse,
  type SemesterEstimate,
} from "@/lib/semester";
import { useAuth } from "@/providers/auth-provider";
import {
  clampTextScale,
  useDisplay,
  useResolvedScheme,
} from "@/providers/display-provider";

/* This semester — every class's estimate, and the one number across them.
 *
 * Scratch math from top to bottom. Every figure here is arithmetic on scores
 * the student typed into their own private gradebook: nothing on this screen
 * is a transcript, a registrar number, or a grade of record, and none of it
 * is ever visible to a classmate. It is also an estimate OF an estimate —
 * each course number is already a projection from partial grades — so the
 * copy stays hedged the whole way down: the privacy line up top, the note
 * under the number, and the line about the 4.0 scale at the bottom.
 *
 * All the math lives in `@/lib/semester` and all of it is pure. This file
 * fetches once, decides what to show, and writes the sentences the module
 * didn't already write. It never averages anything itself.
 *
 * A pushed screen — `router.push("/semester")` is the whole entry point, and
 * it takes no params. The courses hub and the home shell own their own tiles.
 */

/* ------------------------------ formatting ----------------------------- */

/** "86.7", "90", "45" — a percentage the way a person writes it. */
function pctText(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/** "4 units", "1 unit", or the plain truth when nobody has filled them in. */
function unitsText(units: number | null): string {
  if (units === null || !Number.isFinite(units) || units <= 0) {
    return "Units not set";
  }
  const value = Math.round(units * 100) / 100;
  return `${value} ${value === 1 ? "unit" : "units"}`;
}

/**
 * The semester's units, but only when every class has them. `totalUnits`
 * happily adds up the classes it knows about, and "17 units" beside a
 * half-known list would read as the whole semester when it isn't. Null means
 * leave the line out — the summary note already says which classes are short.
 */
function unitsLine(courses: readonly SemesterCourse[]): string | null {
  const known = courses.every(
    (course) =>
      typeof course.units === "number" &&
      Number.isFinite(course.units) &&
      course.units > 0
  );
  if (!known) return null;
  const total = totalUnits(courses);
  return total === null ? null : unitsText(total);
}

/** "3 of 5 classes have grades in" — the ledger beside the note's prose. */
function coverageLine(estimate: SemesterEstimate): string {
  if (estimate.total === 1) return "Your one class has grades in";
  const verb = estimate.graded === 1 ? "has" : "have";
  return `${estimate.graded} of ${estimate.total} classes ${verb} grades in`;
}

/**
 * The class where "add a category" is genuinely the next step: one with no
 * gradebook set up at all, falling back to the first class on the list. Null
 * only when there are no classes, and that case has its own empty state.
 */
function recruitCourse(
  courses: readonly SemesterCourse[]
): SemesterCourse | null {
  const noGradebook = courses.find((course) => course.categoryCount === 0);
  return noGradebook ?? courses[0] ?? null;
}

/**
 * ", about an A minus" — the letter said aloud rather than spelled, with the
 * article that fits it. Empty when there's no letter to say, so it can be
 * dropped straight onto the end of the sentence.
 */
function spokenLetterClause(letter: string | null): string {
  if (letter === null || letter.length === 0) return "";
  const article = /^[AF]/.test(letter) ? "an" : "a";
  const spoken = letter.replace("+", " plus").replace("-", " minus");
  return `, about ${article} ${spoken}`;
}

/** Everything one row says, in one sentence, for a screen reader. */
function rowLabel(course: SemesterCourse): string {
  const parts: string[] = [course.code];
  if (course.title) parts.push(course.title);
  // Mid-sentence, so it's spoken lowercase: "…, 4 units, estimated 88 percent."
  parts.push(unitsText(course.units).toLowerCase());
  const pct = course.estimate.pct;
  parts.push(
    pct === null
      ? "no grades yet"
      : `estimated ${pctText(pct)} percent${spokenLetterClause(course.letter)}`
  );
  return `${parts.join(", ")}.`;
}

/** A `SemesterError` already reads like a person wrote it; anything else won't. */
function messageFor(error: unknown): string {
  return error instanceof SemesterError
    ? error.message
    : "We couldn't put your semester together just now. Give it another go.";
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

/**
 * The promise this screen is built on, stated once at the top and never
 * repeated. Fern-soft rather than ember: reassurance, not an alert.
 *
 * Word for word and pixel for pixel the line `/course/grades` opens with, on
 * purpose. Those two screens are the only places in the app that show a
 * student their own grades, and a promise that changes wording between them
 * is a promise a reader has to re-read. If a third grade surface ever wants
 * it, that is the moment this becomes a shared piece instead of a copy.
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

/**
 * The course code, wearing that course's colour.
 *
 * Hand-drawn rather than a `Chip` for the reason `/plan` wrote down: `Chip`
 * takes a `tone` — four fixed meanings — and a course tint is a sixth of a
 * personal palette, not a meaning. The metrics are `Chip`'s static `sm`
 * numbers exactly, so this is a colour change and nothing else.
 *
 * This is the third screen to need it, after `/plan` and `/calendar`, which
 * is precisely the signal `/plan` left behind: `Chip` should grow a way to be
 * handed a soft/ink pair and all three should collapse onto it. Flagged
 * rather than done here — `@/components/ui/chip.tsx` is not this screen's to
 * edit — and called out in the handoff so it doesn't quietly become four.
 */
function CourseCodeChip({
  code,
  tint,
}: {
  code: string;
  tint: CourseTintColors;
}) {
  return (
    <View
      style={{
        alignSelf: "flex-start",
        paddingHorizontal: space.cosy,
        paddingVertical: 3,
        borderRadius: radius.full,
        backgroundColor: tint.soft,
      }}
    >
      <AppText
        variant="label"
        numberOfLines={1}
        style={{ color: tint.ink, fontSize: 11, lineHeight: 14 }}
      >
        {code}
      </AppText>
    </View>
  );
}

/* -------------------------------- summary ------------------------------ */

/**
 * The headline: the estimated GPA, what the number covers, and how many
 * classes are actually in it.
 *
 * The size is set here rather than by the `display` variant, so the student's
 * text-size preference has to be multiplied through by hand — the same
 * treatment the timer on `/focus` and the estimate on `/course/grades` get.
 */
function SummaryCard({
  summary,
  units,
}: {
  summary: SemesterEstimate;
  units: string | null;
}) {
  const textScale = clampTextScale(useDisplay().textScale);
  const gpa = formatGpa(summary.gpa);
  if (gpa === null) return null;

  const coverage = coverageLine(summary);
  const scale = GRADE_POINT_MAX.toFixed(1);

  return (
    <Card style={{ gap: space.cosy }}>
      <AppText variant="caption" muted>
        Estimated GPA
      </AppText>
      <View
        accessible
        accessibilityLabel={`Estimated grade point average ${gpa} out of ${scale}`}
        style={{
          flexDirection: "row",
          alignItems: "flex-end",
          gap: space.cosy,
        }}
      >
        <AppText
          variant="display"
          numberOfLines={1}
          adjustsFontSizeToFit
          style={{
            fontSize: Math.round(44 * textScale),
            lineHeight: Math.round(50 * textScale),
          }}
        >
          {gpa}
        </AppText>
        <AppText variant="caption" muted style={{ marginBottom: space.cosy }}>
          out of {scale}
        </AppText>
      </View>
      <AppText variant="caption" muted style={{ lineHeight: 17 }}>
        {summary.note}
      </AppText>
      <AppText variant="caption" muted>
        {units ? `${coverage} · ${units}` : coverage}
      </AppText>
    </Card>
  );
}

/**
 * What stands in for the number before there is one. A 0.00 would be a lie
 * with a decimal point on it — an empty gradebook is not a failing semester —
 * so the card recruits toward the one thing that starts it: a category off a
 * syllabus in a class that hasn't got one yet.
 */
function RecruitCard({
  course,
  onOpen,
}: {
  course: SemesterCourse;
  onOpen: () => void;
}) {
  return (
    <EmptyState
      icon="trending-up"
      title="Your average starts with one score"
      body={`Add a category off your syllabus — homework 20%, midterm 30% — to ${course.code}, then log a score. Every class you set up joins the average.`}
      action={{ label: `Set up ${course.code}`, onPress: onOpen }}
    />
  );
}

/* --------------------------------- rows -------------------------------- */

function CourseRow({
  course,
  index,
  tint,
  onPress,
}: {
  course: SemesterCourse;
  /** Position in the list, for the staggered arrival. */
  index: number;
  tint: CourseTintColors;
  onPress: () => void;
}) {
  const theme = useTheme();
  const pct = course.estimate.pct;

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={rowLabel(course)}
      accessibilityHint="Opens your grades for this class"
      onPress={onPress}
      style={({ pressed }) => ({
        opacity: pressed ? 0.7 : 1,
        marginBottom: space.room,
      })}
    >
      <Card
        padded={false}
        entrance={index}
        style={{
          flexDirection: "row",
          alignItems: "center",
          gap: space.room,
          paddingLeft: space.card,
          paddingRight: space.room,
          paddingVertical: space.close,
          minHeight: 68,
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
            <CourseCodeChip code={course.code} tint={tint} />
            <AppText variant="caption" muted>
              {unitsText(course.units)}
            </AppText>
          </View>
          {course.title ? (
            <AppText variant="bodySemi" numberOfLines={1}>
              {course.title}
            </AppText>
          ) : null}
        </View>

        <View style={{ alignItems: "flex-end", gap: space.hair }}>
          {pct === null ? (
            <AppText variant="caption" muted>
              No grades yet
            </AppText>
          ) : (
            <>
              <AppText variant="bodySemi">{pctText(pct)}%</AppText>
              {course.letter !== null && course.gradePoint !== null ? (
                /* The letter and what it's worth, so the number at the top of
                   the screen is traceable to the rows under it. */
                <AppText variant="caption" muted>
                  {course.letter} · {course.gradePoint.toFixed(1)}
                </AppText>
              ) : null}
            </>
          )}
        </View>

        <Feather name="chevron-right" size={16} color={theme.muted} />
      </Card>
    </Pressable>
  );
}

/* -------------------------------- screen ------------------------------- */

export default function SemesterScreen() {
  const theme = useTheme();
  const insets = useSafeAreaInsets();
  const { session, ready } = useAuth();
  const userId = session?.user.id ?? null;
  const tints = courseTintsFor(useResolvedScheme());

  const [data, setData] = useState<Semester | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const goBack = useCallback(() => {
    if (router.canGoBack()) router.back();
    else router.replace("/courses");
  }, []);

  const load = useCallback(async () => {
    try {
      setData(await fetchSemester());
      setError(null);
    } catch (caught) {
      setError(messageFor(caught));
    }
  }, []);

  useEffect(() => {
    if (!userId) return;
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [userId, load]);

  const onRefresh = useCallback(() => {
    setRefreshing(true);
    void load().finally(() => setRefreshing(false));
  }, [load]);

  const retry = useCallback(() => {
    setLoading(true);
    void load().finally(() => setLoading(false));
  }, [load]);

  const openGrades = useCallback((course: SemesterCourse) => {
    router.push({
      pathname: "/course/grades",
      params: { courseId: course.courseId, courseCode: course.code },
    });
  }, []);

  /* ------------------------------ scaffold ----------------------------- */

  // A deep link can land here signed out — send them to a proper door.
  if (ready && !session) {
    return <Redirect href="/(auth)/login" />;
  }

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

  const header = (
    <View style={{ marginBottom: space.gutter }}>
      <AppText variant="display">This semester</AppText>
      <PrivacyLine />
    </View>
  );

  /* One gutter, one bottom inset, every state — loading, error, and the real
     thing scroll to exactly the same edges. */
  const scrollProps = {
    style: { flex: 1 },
    contentContainerStyle: {
      paddingHorizontal: space.gutter,
      paddingBottom: insets.bottom + space.rest,
    },
    showsVerticalScrollIndicator: false,
  };

  if (loading) {
    return scaffold(
      <ScrollView {...scrollProps}>
        {header}
        {/* The shape is honest — a number card over a short list of classes. */}
        <Card style={{ gap: space.room }}>
          <Skeleton width={92} height={11} radius={radius.full} />
          <Skeleton width={132} height={42} />
          <Skeleton width="80%" height={11} radius={radius.full} />
          <Skeleton width="55%" height={11} radius={radius.full} />
        </Card>
        <SectionLabel text="Your classes" />
        {[0, 1, 2].map((index) => (
          <Card
            key={index}
            style={{ gap: space.room, marginBottom: space.room }}
          >
            <Skeleton width={78} height={14} radius={radius.full} />
            <Skeleton width="62%" height={12} radius={radius.full} />
          </Card>
        ))}
      </ScrollView>
    );
  }

  if (error && data === null) {
    return scaffold(
      <ScrollView {...scrollProps}>
        {header}
        <EmptyState
          icon="cloud-off"
          title="Something hiccuped"
          body={error}
          action={{ label: "Try again", onPress: retry }}
        />
      </ScrollView>
    );
  }

  /* ------------------------------- content ----------------------------- */

  const courses = data?.courses ?? [];
  const summary = data?.summary ?? null;
  const recruit = recruitCourse(courses);

  return scaffold(
    <ScrollView
      {...scrollProps}
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
        <AppText
          variant="caption"
          style={{ color: theme.danger, marginBottom: space.room }}
        >
          {error}
        </AppText>
      ) : null}

      {courses.length === 0 || summary === null ? (
        <EmptyState
          illustration={WallCalendar}
          title="Your term, once it has classes in it"
          body="This is where the whole quarter adds up: every class you're taking, what each one is running at, and one average across all of them. Add your classes and it starts filling in."
          action={{
            label: "Add your classes",
            onPress: () => router.push("/courses/add"),
          }}
        />
      ) : (
        <>
          {summary.gpa !== null ? (
            <SummaryCard summary={summary} units={unitsLine(courses)} />
          ) : recruit !== null ? (
            <RecruitCard course={recruit} onOpen={() => openGrades(recruit)} />
          ) : null}

          <SectionLabel text="Your classes" />

          {/* The tint is already resolved by `@/lib/semester`: the student's
              own pick where they made one, the stable hash of the course code
              where they didn't. It is personal — the lab partner reading the
              same class may well see a different colour. */}
          {courses.map((course, index) => (
            <CourseRow
              key={course.enrollmentId}
              course={course}
              index={index}
              tint={tints[course.color]}
              onPress={() => openGrades(course)}
            />
          ))}

          {/* The closing hedge: whose 4.0 scale this is, and whose it isn't. */}
          <AppText
            variant="caption"
            muted
            style={{ marginTop: space.snug, lineHeight: 18 }}
          >
            The letters here follow one common 4.0 scale — an A is 4.0, an A-
            is 3.7, and nothing sits above 4.0. Plenty of schools count plus
            and minus their own way, so treat this as your math, not your
            registrar's.
          </AppText>
        </>
      )}
    </ScrollView>
  );
}
