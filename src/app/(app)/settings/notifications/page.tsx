"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  AtSign,
  Bell,
  BookOpen,
  Calendar,
  CornerDownRight,
  Heart,
  Megaphone,
  MessageCircle,
  Moon,
  Sunrise,
  Sunset,
  UserPlus,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  PageHeader,
  SectionHeader,
  Select,
  Skeleton,
  cardClasses,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* Per-kind push opt-outs, mirrored from profiles.notification_prefs.
   A missing key means on; {"dm":"off"} means quiet. We only ever store
   'off' keys; re-enabling removes the key, keeping the object minimal. */
type NotificationPrefs = Record<string, string>;

/* profiles.quiet_hours, exactly the shape in_quiet_hours() reads. `null`
   here is the app's word for "no window". On the row that is stored as an
   empty object, never a deleted or null column. */
type QuietHours = { start: string; end: string; tz: string };

type PushKind =
  | "dm"
  | "mention"
  | "thread_reply"
  | "thanks"
  | "friend"
  | "course_calendar"
  | "event"
  | "club_post"
  | "system";

const PUSH_KINDS: {
  kind: PushKind;
  icon: LucideIcon;
  label: string;
  caption: string;
}[] = [
  {
    kind: "dm",
    icon: MessageCircle,
    label: "Direct messages",
    caption: "New messages sent straight to you.",
  },
  {
    kind: "mention",
    icon: AtSign,
    label: "Mentions",
    caption: "When someone tags you by name.",
  },
  {
    kind: "thread_reply",
    icon: CornerDownRight,
    label: "Thread replies",
    caption: "Replies in threads you're part of.",
  },
  {
    kind: "thanks",
    icon: Heart,
    label: "Thanks on your notes",
    caption: "When a classmate says thanks for notes you uploaded.",
  },
  {
    kind: "friend",
    icon: UserPlus,
    label: "Friend requests",
    caption: "When someone asks to be friends, and when they say yes.",
  },
  {
    kind: "course_calendar",
    icon: BookOpen,
    label: "Class calendar",
    caption: "New due dates and exams in your classes.",
  },
  {
    kind: "event",
    icon: Calendar,
    label: "Events",
    caption: "Updates to events you're going to.",
  },
  {
    kind: "club_post",
    icon: Megaphone,
    label: "Club announcements",
    caption: "When an officer posts in a club you've joined.",
  },
  {
    kind: "system",
    icon: Bell,
    label: "Weekly digest + announcements",
    caption: "Your Monday look-ahead, plus the rare heads-up from Hearth.",
  },
];

/* ---------------------------- quiet hours ---------------------------- */

const QUIET_DEFAULT_START = "22:00";
const QUIET_DEFAULT_END = "08:00";
const FALLBACK_TZ = "America/Los_Angeles";

/** Every half hour of the day, "00:00" through "23:30". */
const HALF_HOURS: string[] = Array.from({ length: 48 }, (_, index) => {
  const hour = Math.floor(index / 2);
  return `${hour < 10 ? "0" : ""}${hour}:${index % 2 === 0 ? "00" : "30"}`;
});

/** The window follows the device it was set on; the server needs the name. */
function deviceTimeZone(): string {
  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return typeof zone === "string" && zone.length > 0 ? zone : FALLBACK_TZ;
  } catch {
    return FALLBACK_TZ;
  }
}

/** "America/Los_Angeles" → "Los Angeles". */
function zoneLabel(zone: string): string {
  const tail = zone.split("/").pop();
  return (tail ?? zone).replace(/_/g, " ");
}

/** Snap anything the column might hold onto the half-hour grid. */
function normalizeTime(value: string, fallback: string): string {
  const match = /^(\d{1,2}):(\d{2})/.exec(value);
  if (!match) return fallback;
  const hour = Math.min(23, Math.max(0, Number(match[1])));
  const half = Number(match[2]) >= 30 ? "30" : "00";
  return `${hour < 10 ? "0" : ""}${hour}:${half}`;
}

/** `null` for the empty object, a malformed row, or a missing time. */
function parseQuietHours(raw: unknown): QuietHours | null {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) return null;
  const value = raw as Record<string, unknown>;
  if (typeof value.start !== "string" || typeof value.end !== "string") {
    return null;
  }
  const zone =
    typeof value.tz === "string" && value.tz.length > 0 ? value.tz : FALLBACK_TZ;
  return {
    start: normalizeTime(value.start, QUIET_DEFAULT_START),
    end: normalizeTime(value.end, QUIET_DEFAULT_END),
    tz: zone,
  };
}

/** "22:00" → "10:00 PM". */
function clockLabel(value: string): string {
  const [hourText, minuteText] = value.split(":");
  const hour = Number(hourText);
  if (!Number.isFinite(hour)) return value;
  const suffix = hour < 12 ? "AM" : "PM";
  const shown = hour % 12 === 0 ? 12 : hour % 12;
  return `${shown}:${minuteText ?? "00"} ${suffix}`;
}

/* The lines this page exists to say out loud. Both live as plain strings so
   the copy reads as copy and not as JSX. */

function quietSentence(quiet: QuietHours | null): string {
  if (!quiet) {
    return "Pick a window (10:00 PM until 8:00 AM, say) and your phone stays silent inside it. Nothing gets lost either: whatever arrives is waiting in your inbox in the morning.";
  }
  return `Between ${clockLabel(quiet.start)} and ${clockLabel(
    quiet.end
  )} nothing buzzes. Nothing is dropped either: whatever arrives is sitting in your inbox, and the first nudge after the window carries it along. Those times follow the ${zoneLabel(
    quiet.tz
  )} clock.`;
}

const DIGEST_NOTE =
  "When a class channel gets going, Hearth rolls the pile into one nudge (the “4 new notifications” kind) instead of buzzing twelve times. Tapping it opens your inbox with all of them in it.";

/* ------------------------------- pieces ------------------------------ */

/**
 * A plain switch: track + thumb, keyboard- and screen-reader-honest. The
 * drawn track is 24px tall; the button around it is 44, because everything
 * tappable clears the floor even when the thing you can see doesn't.
 */
function Toggle({
  label,
  on,
  disabled = false,
  onToggle,
}: {
  label: string;
  on: boolean;
  disabled?: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      disabled={disabled}
      onClick={() => onToggle(!on)}
      className={cn(
        "flex size-11 shrink-0 items-center justify-center rounded-full",
        "focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        "disabled:pointer-events-none disabled:opacity-60"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "relative block h-6 w-11 rounded-full transition-colors",
          on ? "bg-brand" : "bg-surface-3"
        )}
      >
        <span
          className={cn(
            "absolute top-0.5 left-0.5 size-5 rounded-full bg-on-solid shadow-soft transition-transform",
            on && "translate-x-5"
          )}
        />
      </span>
    </button>
  );
}

/** Icon tile + label + caption + whatever sits on the right, one per row. */
function SettingRow({
  icon: Icon,
  label,
  labelFor,
  caption,
  dim = false,
  children,
}: {
  icon: LucideIcon;
  label: string;
  /** Set when the trailing control is a real form control, not a switch. */
  labelFor?: string;
  caption?: string;
  dim?: boolean;
  children: React.ReactNode;
}) {
  const text = (
    <>
      <span className="block text-sm font-semibold">{label}</span>
      {caption ? (
        <span className="mt-0.5 block text-xs text-muted">{caption}</span>
      ) : null}
    </>
  );

  return (
    <li className="flex min-h-11 items-center gap-3 px-4 py-3">
      <span
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-xl",
          dim ? "bg-surface-2 text-muted" : "bg-brand-soft text-brand"
        )}
      >
        <Icon className="size-4" aria-hidden />
      </span>
      {labelFor ? (
        <label htmlFor={labelFor} className="min-w-0 flex-1 cursor-pointer">
          {text}
        </label>
      ) : (
        <span className="min-w-0 flex-1">{text}</span>
      )}
      {children}
    </li>
  );
}

/** The ghost of a SettingRow, for the beat before the profile lands. */
function SettingRowSkeleton() {
  return (
    <li className="flex min-h-11 items-center gap-3 px-4 py-3">
      <Skeleton className="size-9 shrink-0" />
      <div className="min-w-0 flex-1">
        <Skeleton className="h-3.5 w-1/2" />
        <Skeleton className="mt-2 h-3 w-3/4" />
      </div>
      <Skeleton className="h-6 w-11 shrink-0 rounded-full" />
    </li>
  );
}

/** A warning line: the honest kind, short of an error. */
function WarningLine({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 text-xs font-medium text-warning">{children}</p>;
}

/* ------------------------------- page -------------------------------- */

/**
 * Push preferences: the quiet window, then what gets through when the window
 * is open. Both live on `profiles` (`quiet_hours` from 0035 and
 * `notification_prefs`), and both are written straight from here, optimistically.
 * Push lands on the phone where Hearth is installed; this page is the one dial
 * for what gets through. The in-app inbox never filters.
 */
export default function NotificationSettingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [quiet, setQuiet] = useState<QuietHours | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);
  const [quietError, setQuietError] = useState<string | null>(null);
  const [savingQuiet, setSavingQuiet] = useState(false);

  /* Read on the client only. The server renders this page too, and its clock
     lives in a different city, so comparing a server zone against a stored
     one would flash a warning that isn't true. */
  const [deviceTz, setDeviceTz] = useState<string | null>(null);
  useEffect(() => {
    setDeviceTz(deviceTimeZone());
  }, []);

  const load = useCallback(async () => {
    setLoadError(null);
    const supabase = createClient();
    const {
      data: { user },
    } = await supabase.auth.getUser();
    if (!user) {
      setLoadError("We couldn't load your notification settings right now.");
      return;
    }
    const { data, error } = await supabase
      .from("profiles")
      .select("notification_prefs, quiet_hours")
      .eq("id", user.id)
      .maybeSingle();
    if (error || !data) {
      setLoadError("We couldn't load your notification settings right now.");
      return;
    }
    const row = data as { notification_prefs: unknown; quiet_hours: unknown };
    setUserId(user.id);
    setPrefs(
      row.notification_prefs !== null &&
        typeof row.notification_prefs === "object" &&
        !Array.isArray(row.notification_prefs)
        ? (row.notification_prefs as NotificationPrefs)
        : {}
    );
    setQuiet(parseQuietHours(row.quiet_hours));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function handleToggle(kind: PushKind, next: boolean) {
    if (!userId || prefs === null) return;
    setToggleError(null);
    const wasOff = prefs[kind] === "off";
    // Keep the stored object minimal: only 'off' keys, never 'on'.
    const updated: NotificationPrefs = { ...prefs };
    if (next) delete updated[kind];
    else updated[kind] = "off";
    setPrefs(updated);
    const supabase = createClient();
    const { error } = await supabase
      .from("profiles")
      .update({ notification_prefs: updated })
      .eq("id", userId);
    if (error) {
      // Roll just this switch back. Other flips since stay put.
      setPrefs((current) => {
        if (current === null) return current;
        const rolled = { ...current };
        if (wasOff) rolled[kind] = "off";
        else delete rolled[kind];
        return rolled;
      });
      setToggleError(
        "That change didn't save, so your phone kept the old setting. Give it another flip."
      );
    }
  }

  /** Optimistic, like every other write here: the row moves, then syncs. */
  const saveQuiet = useCallback(
    async (next: QuietHours | null) => {
      if (!userId) return;
      const previous = quiet;
      setQuietError(null);
      setQuiet(next);
      setSavingQuiet(true);
      const supabase = createClient();
      const { error } = await supabase
        .from("profiles")
        // Off is an empty object, not a null and not a missing row. That is
        // what in_quiet_hours() reads as "never quiet".
        .update({ quiet_hours: next ?? {} })
        .eq("id", userId);
      setSavingQuiet(false);
      if (error) {
        setQuiet(previous);
        setQuietError(
          "That didn't save, so your quiet hours are still the old ones. Give it another go."
        );
      }
    },
    [userId, quiet]
  );

  const toggleQuiet = useCallback(
    (next: boolean) => {
      void saveQuiet(
        next
          ? {
              start: QUIET_DEFAULT_START,
              end: QUIET_DEFAULT_END,
              tz: deviceTz ?? deviceTimeZone(),
            }
          : null
      );
    },
    [saveQuiet, deviceTz]
  );

  const pickTime = useCallback(
    (which: "start" | "end", value: string) => {
      if (quiet === null) return;
      void saveQuiet({
        start: which === "start" ? value : quiet.start,
        end: which === "end" ? value : quiet.end,
        // Re-stamp the zone on every edit: set the window here, it runs here.
        tz: deviceTz ?? deviceTimeZone(),
      });
    },
    [quiet, saveQuiet, deviceTz]
  );

  const timeOptions = useMemo(
    () =>
      HALF_HOURS.map((value) => (
        <option key={value} value={value}>
          {clockLabel(value)}
        </option>
      )),
    []
  );

  const emptyWindow = quiet !== null && quiet.start === quiet.end;
  const staleZone = quiet !== null && deviceTz !== null && quiet.tz !== deviceTz;

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/settings"
        backLabel="Settings"
        title="Notifications"
        description="Choose what gets pushed to your phone. Quiet here never means missed: everything still lands in your inbox."
      />

      {loadError ? (
        <div className={cardClasses({ className: "mt-8" })}>
          <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
            <p className="max-w-sm text-sm text-muted">{loadError}</p>
            <Button variant="soft" size="sm" onClick={() => void load()}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <>
          <section aria-label="Quiet hours" className="mt-8">
            <SectionHeader title="Quiet hours" />

            <div className={cardClasses({ padding: "none", className: "mt-3" })}>
              <ul className="divide-y divide-border">
                {prefs === null ? (
                  <SettingRowSkeleton />
                ) : (
                  <>
                    <SettingRow
                      icon={Moon}
                      label="Quiet hours"
                      caption={
                        quiet
                          ? "Silent between the times below."
                          : "Your phone can buzz at any hour."
                      }
                      dim={quiet === null}
                    >
                      <Toggle
                        label="Quiet hours"
                        on={quiet !== null}
                        disabled={savingQuiet}
                        onToggle={toggleQuiet}
                      />
                    </SettingRow>

                    {quiet ? (
                      <>
                        <SettingRow
                          icon={Sunset}
                          label="From"
                          labelFor="quiet-start"
                          caption="When your phone goes quiet."
                        >
                          <Select
                            id="quiet-start"
                            value={quiet.start}
                            disabled={savingQuiet}
                            onChange={(e) => pickTime("start", e.target.value)}
                            className="h-11 w-32 shrink-0"
                          >
                            {timeOptions}
                          </Select>
                        </SettingRow>
                        <SettingRow
                          icon={Sunrise}
                          label="Until"
                          labelFor="quiet-end"
                          caption="When it's allowed to buzz again."
                        >
                          <Select
                            id="quiet-end"
                            value={quiet.end}
                            disabled={savingQuiet}
                            onChange={(e) => pickTime("end", e.target.value)}
                            className="h-11 w-32 shrink-0"
                          >
                            {timeOptions}
                          </Select>
                        </SettingRow>
                      </>
                    ) : null}
                  </>
                )}
              </ul>
            </div>

            {prefs === null ? null : (
              <p className="mt-3 px-1 text-xs text-muted text-pretty">
                {quietSentence(quiet)}
              </p>
            )}

            {emptyWindow ? (
              <WarningLine>
                From and until are the same time, so the window is empty and
                nothing is quiet yet. Move one of them.
              </WarningLine>
            ) : null}

            {staleZone && deviceTz ? (
              <WarningLine>
                {`This browser is on ${zoneLabel(
                  deviceTz
                )} time, and the window is stored on ${zoneLabel(
                  quiet.tz
                )} time. Pick either time again to move the window here.`}
              </WarningLine>
            ) : null}

            {quietError ? (
              <p role="alert" className="mt-2 text-xs font-medium text-danger">
                {quietError}
              </p>
            ) : null}
          </section>

          <section aria-label="What gets pushed" className="mt-8">
            <SectionHeader title="What gets pushed" />
            <p className="mt-2 px-1 text-xs text-muted">
              The in-app inbox always keeps everything. These only quiet your
              phone.
            </p>

            <div className={cardClasses({ padding: "none", className: "mt-3" })}>
              {prefs === null ? (
                <ul className="divide-y divide-border">
                  {PUSH_KINDS.map((entry) => (
                    <SettingRowSkeleton key={entry.kind} />
                  ))}
                </ul>
              ) : (
                <ul className="divide-y divide-border">
                  {PUSH_KINDS.map(({ kind, icon, label, caption }) => (
                    <SettingRow
                      key={kind}
                      icon={icon}
                      label={label}
                      caption={caption}
                    >
                      <Toggle
                        label={label}
                        on={prefs[kind] !== "off"}
                        onToggle={(next) => void handleToggle(kind, next)}
                      />
                    </SettingRow>
                  ))}
                </ul>
              )}
            </div>

            <p className="mt-3 px-1 text-xs text-muted text-pretty">
              {DIGEST_NOTE}
            </p>

            {toggleError ? (
              <p role="alert" className="mt-2 text-xs font-medium text-danger">
                {toggleError}
              </p>
            ) : null}
          </section>
        </>
      )}
    </div>
  );
}
