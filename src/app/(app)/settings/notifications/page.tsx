"use client";

import { useCallback, useEffect, useState } from "react";
import {
  AtSign,
  Bell,
  BookOpen,
  Calendar,
  CornerDownRight,
  Loader2,
  MessageCircle,
  type LucideIcon,
} from "lucide-react";
import { Button, PageHeader, SectionHeader, cardClasses } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/* Per-kind push opt-outs, mirrored from profiles.notification_prefs.
   A missing key means on; {"dm":"off"} means quiet. We only ever store
   'off' keys — re-enabling removes the key, keeping the object minimal. */
type NotificationPrefs = Record<string, string>;

type PushKind =
  | "dm"
  | "mention"
  | "thread_reply"
  | "course_calendar"
  | "event"
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
    kind: "system",
    icon: Bell,
    label: "Weekly digest + announcements",
    caption: "Your Monday look-ahead, plus the rare heads-up from Huddl.",
  },
];

/** A plain switch: track + thumb, keyboard- and screen-reader-honest. */
function Toggle({
  label,
  on,
  onToggle,
}: {
  label: string;
  on: boolean;
  onToggle: (next: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      aria-label={label}
      onClick={() => onToggle(!on)}
      className={cn(
        "relative h-6 w-11 shrink-0 rounded-full transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        on ? "bg-brand" : "bg-surface-3"
      )}
    >
      <span
        aria-hidden
        className={cn(
          "absolute top-0.5 left-0.5 size-5 rounded-full bg-on-solid shadow-soft transition-transform",
          on && "translate-x-5"
        )}
      />
    </button>
  );
}

/**
 * Per-kind push preferences, written straight to profiles.notification_prefs.
 * Push lands on the phone where Huddl is installed; this page is the one
 * dial for what gets through. The in-app inbox never filters.
 */
export default function NotificationSettingsPage() {
  const [userId, setUserId] = useState<string | null>(null);
  const [prefs, setPrefs] = useState<NotificationPrefs | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [toggleError, setToggleError] = useState<string | null>(null);

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
      .select("notification_prefs")
      .eq("id", user.id)
      .maybeSingle();
    if (error || !data) {
      setLoadError("We couldn't load your notification settings right now.");
      return;
    }
    const raw = (data as { notification_prefs: unknown }).notification_prefs;
    setUserId(user.id);
    setPrefs(
      raw !== null && typeof raw === "object" && !Array.isArray(raw)
        ? (raw as NotificationPrefs)
        : {}
    );
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
      // Roll just this switch back — other flips since stay put.
      setPrefs((current) => {
        if (current === null) return current;
        const rolled = { ...current };
        if (wasOff) rolled[kind] = "off";
        else delete rolled[kind];
        return rolled;
      });
      setToggleError(
        "That change didn't save — your phone kept the old setting. Give it another flip."
      );
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/settings"
        backLabel="Settings"
        title="Notifications"
        description="Choose what gets pushed to your phone. Quiet here never means missed — everything still lands in your inbox."
      />

      <section aria-label="What gets pushed" className="mt-8">
        <SectionHeader title="What gets pushed" />
        <p className="mt-2 px-1 text-xs text-muted">
          The in-app inbox always keeps everything — these only quiet your
          phone.
        </p>

        <div className={cardClasses({ padding: "none", className: "mt-3" })}>
          {loadError ? (
            <div className="flex flex-col items-center gap-3 px-6 py-8 text-center">
              <p className="max-w-sm text-sm text-muted">{loadError}</p>
              <Button variant="soft" size="sm" onClick={() => void load()}>
                Try again
              </Button>
            </div>
          ) : prefs === null ? (
            <div
              className="flex items-center justify-center py-10"
              role="status"
              aria-label="Loading your notification settings"
            >
              <Loader2 className="size-5 animate-spin text-brand" aria-hidden />
            </div>
          ) : (
            <ul className="divide-y divide-border">
              {PUSH_KINDS.map(({ kind, icon: Icon, label, caption }) => (
                <li
                  key={kind}
                  className="flex min-h-11 items-center gap-3 px-4 py-3"
                >
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                    <Icon className="size-4" aria-hidden />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-sm font-semibold">{label}</span>
                    <span className="mt-0.5 block text-xs text-muted">
                      {caption}
                    </span>
                  </span>
                  <Toggle
                    label={label}
                    on={prefs[kind] !== "off"}
                    onToggle={(next) => void handleToggle(kind, next)}
                  />
                </li>
              ))}
            </ul>
          )}
        </div>

        {toggleError ? (
          <p role="alert" className="mt-3 text-xs font-medium text-danger">
            {toggleError}
          </p>
        ) : null}
      </section>
    </div>
  );
}
