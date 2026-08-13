"use client";

import Link from "next/link";
import { useCallback, useState } from "react";
import {
  BookOpen,
  Calendar,
  CheckCircle2,
  ClipboardList,
  Clock,
  CloudOff,
  Download,
  FileText,
  Loader2,
  MessageSquare,
  Percent,
  Send,
  type LucideIcon,
} from "lucide-react";
import {
  Button,
  Card,
  PageHeader,
  SectionHeader,
  cardClasses,
} from "@/components/ui";
import {
  ExportError,
  downloadExport,
  exportFileName,
  exportedAt,
  requestExport,
  sizeLabel,
  summarize,
  type PreparedExport,
  type SummaryKey,
  type SummaryLine,
} from "@/lib/data-export";

/* Your data: everything Huddl holds that's yours, in one file you can take
   with you. The page explains before it does anything: what's in the file,
   what stays behind, and only then a button.

   Preparing is deliberately a click rather than something that happens on
   arrival. Gathering a semester of messages is real work for the server, and
   a student who wandered in to read the explanation shouldn't set it off.

   The download itself is the browser's own: a Blob, an object URL, a link
   that clicks itself. Nothing is uploaded anywhere and no dependency was
   added for it. If that ever fails, the JSON goes on screen instead. There
   is always a way to get the data out of this page. */

type Phase = "idle" | "working" | "ready" | "error";

/** One icon per countable line, so the list reads at a glance. */
const ICONS: Record<SummaryKey, LucideIcon> = {
  messages: MessageSquare,
  direct_messages: Send,
  courses: BookOpen,
  notes: FileText,
  focus_sessions: Clock,
  grade_entries: Percent,
  calendar_checkoffs: CheckCircle2,
  board_posts: ClipboardList,
  events_created: Calendar,
};

/** "3:14 PM" in the student's own locale and clock. */
function timeLabel(at: Date): string {
  return at.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

/** One "312 messages" row. */
function SummaryRow({ line }: { line: SummaryLine }) {
  const Icon = ICONS[line.key];
  return (
    <li className="flex min-h-11 items-center gap-3 px-4 py-3">
      <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
        <Icon className="size-4" aria-hidden />
      </span>
      <span className="min-w-0 flex-1 text-sm font-semibold">{line.label}</span>
    </li>
  );
}

export default function DataExportPage() {
  const [phase, setPhase] = useState<Phase>("idle");
  const [prepared, setPrepared] = useState<PreparedExport | null>(null);
  const [lines, setLines] = useState<SummaryLine[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saveNote, setSaveNote] = useState<string | null>(null);
  const [showRaw, setShowRaw] = useState(false);

  const prepare = useCallback(async () => {
    setPhase("working");
    setError(null);
    setSaveNote(null);
    setShowRaw(false);
    try {
      const result = await requestExport();
      setPrepared(result);
      setLines(summarize(result.data));
      setPhase("ready");
    } catch (caught) {
      setPrepared(null);
      setLines([]);
      setError(
        caught instanceof ExportError
          ? caught.message
          : "We couldn't gather your data just now. Check your connection and give it another go."
      );
      setPhase("error");
    }
  }, []);

  /* Handing it over. Anything the browser can't write ends with the JSON on
     screen instead. */
  const handleDownload = useCallback(() => {
    if (!prepared) return;
    setSaveNote(null);
    const at = exportedAt(prepared.data) ?? new Date();
    const outcome = downloadExport(prepared.json, at);
    if (outcome === "saved") {
      setSaveNote(
        `Saved as ${exportFileName(at)}. Check wherever your downloads land.`
      );
      return;
    }
    setShowRaw(true);
    setSaveNote(
      outcome === "empty"
        ? "That came back empty, which shouldn't happen. Prepare it once more and it should fill in."
        : "This browser wouldn't write the file, so it's down below instead. Select all of it and copy."
    );
  }, [prepared]);

  const preparedAt = prepared ? exportedAt(prepared.data) : null;
  const fileName = exportFileName(preparedAt ?? new Date());

  return (
    <div className="mx-auto max-w-3xl px-4 py-6 md:py-10">
      <PageHeader
        backHref="/settings"
        backLabel="Settings"
        title="Your data"
        description="One file with everything Huddl holds that's yours. Yours to keep, wherever you keep things."
      />

      <Card className="mt-8 animate-fade-up">
        <h2 className="font-bold tracking-tight">What&apos;s in the file</h2>
        <p className="mt-1.5 text-sm text-muted text-pretty">
          Your profile, your classes, the messages and notes you&apos;ve
          written, your focus sessions, your grades, your board posts and the
          events you created, as plain JSON, readable in any text editor.
        </p>
        <h3 className="mt-4 font-bold tracking-tight">
          What isn&apos;t in it
        </h3>
        <p className="mt-1.5 text-sm text-muted text-pretty">
          Other people&apos;s words. A conversation you were part of holds
          messages that aren&apos;t yours to take, so the file has only your
          side of it. Things you shared stay in the rooms you shared them in,
          and nothing here belongs to anyone else.
        </p>
      </Card>

      {phase === "ready" && prepared ? (
        <>
          <section aria-label="What's in it" className="mt-8">
            <SectionHeader title="What's in it" />

            {lines.length > 0 ? (
              <div
                className={cardClasses({ padding: "none", className: "mt-3" })}
              >
                <ul className="divide-y divide-border">
                  {lines.map((line) => (
                    <SummaryRow key={line.key} line={line} />
                  ))}
                </ul>
              </div>
            ) : (
              <Card className="mt-3">
                <p className="text-sm font-semibold">Not much yet</p>
                <p className="mt-1 text-sm text-muted text-pretty">
                  Your profile and settings are in there, and not a lot else.
                  The file works the same either way.
                </p>
              </Card>
            )}

            <p className="mt-3 px-1 text-xs text-muted">
              {fileName} · {sizeLabel(prepared.json)}
              {preparedAt ? ` · prepared at ${timeLabel(preparedAt)}` : ""}
            </p>

            <div className="mt-4 flex flex-wrap gap-2">
              <Button onClick={handleDownload}>
                <Download className="size-4" aria-hidden />
                Download the file
              </Button>
              <Button
                variant="secondary"
                onClick={() => setShowRaw((open) => !open)}
                aria-expanded={showRaw}
              >
                {showRaw ? "Hide the raw file" : "Show the raw file"}
              </Button>
            </div>

            {saveNote ? (
              <p className="mt-3 text-xs font-medium text-muted text-pretty">
                {saveNote}
              </p>
            ) : null}

            {showRaw ? (
              <Card className="mt-3">
                <p className="text-xs text-muted">Select all of it and copy.</p>
                {/* The file can run to thousands of lines, so it scrolls
                    inside its own box rather than pushing the page around,
                    and horizontally too, so a long line never widens the
                    column. */}
                <pre className="mt-2 max-h-80 overflow-auto rounded-xl bg-surface-2 p-3 font-mono text-xs whitespace-pre">
                  {prepared.json}
                </pre>
              </Card>
            ) : null}
          </section>
        </>
      ) : phase === "error" ? (
        <div className="mt-8 flex flex-col items-center gap-2.5 px-6 py-14 text-center">
          <CloudOff className="size-7 text-muted" aria-hidden />
          <p className="font-bold tracking-tight">Something went sideways</p>
          <p className="max-w-xs text-sm text-muted text-pretty">{error}</p>
          <Button
            variant="soft"
            size="sm"
            onClick={() => void prepare()}
            className="mt-1"
          >
            Try again
          </Button>
        </div>
      ) : (
        <div className="mt-6 flex flex-col items-center gap-3">
          <Button
            disabled={phase === "working"}
            onClick={() => void prepare()}
            className="w-full sm:w-auto"
          >
            {phase === "working" ? (
              <Loader2 className="size-4 animate-spin" aria-hidden />
            ) : null}
            {phase === "working" ? "Gathering it up" : "Prepare my data"}
          </Button>
          <p className="text-center text-xs text-muted text-pretty">
            {phase === "working"
              ? "A semester of messages takes a moment to gather. Stay here and it'll land."
              : "Nothing goes anywhere until you save it yourself."}
          </p>
        </div>
      )}

      {/* The companion action, mentioned once and left alone. */}
      <p className="mt-10 px-1 text-xs text-muted text-pretty">
        Leaving is the other half of this. Deleting your account removes all of
        it at once (profile, messages, files, courses, blocks and push tokens)
        immediately and permanently, with no recovery window and no archive.{" "}
        <Link
          href="/legal/privacy"
          className="font-semibold text-accent underline-offset-2 hover:underline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
        >
          The privacy policy spells out exactly what goes.
        </Link>
      </p>
    </div>
  );
}
