"use client";

import { useId, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDistanceToNow } from "date-fns";
import {
  AlertCircle,
  ArrowRight,
  BookOpen,
  Check,
  CheckCircle2,
  ChevronDown,
  EyeOff,
  Hash,
  KeyRound,
  Link2,
  Loader2,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import { EmptyState } from "@/components/empty-state";
import {
  Badge,
  Button,
  Card,
  Hint,
  Input,
  Label,
  buttonClasses,
  cardClasses,
} from "@/components/ui";
import { cn } from "@/lib/utils";
import type { CanvasConnection } from "@/lib/types";

/** Token-free slice of canvas_connections that is safe to send to the client. */
export type CanvasConnectionSummary = Pick<
  CanvasConnection,
  "base_url" | "last_synced_at" | "sync_status" | "sync_error" | "created_at"
>;

interface SyncResult {
  coursesSynced: number;
  enrolled: { code: string; title: string }[];
}

type Phase = "idle" | "connecting" | "syncing" | "disconnecting";

function ErrorAlert({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3 py-2.5 text-sm text-danger"
    >
      <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>{message}</span>
    </div>
  );
}

function SyncResultPanel({ result }: { result: SyncResult }) {
  if (result.enrolled.length === 0) {
    return (
      <Card padding="none">
        <EmptyState
          icon={BookOpen}
          title="No active courses found"
          description="Canvas didn't return any published courses right now. Once your instructors publish their courses, come back and re-sync."
        />
      </Card>
    );
  }
  const n = result.enrolled.length;
  return (
    <section aria-label="Sync results" className={cardClasses()}>
      <div className="flex items-start gap-3">
        <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
          <CheckCircle2 className="size-5" aria-hidden />
        </span>
        <div>
          <h2 className="font-bold tracking-tight">
            You&apos;ve been added to {n} course {n === 1 ? "channel" : "channels"}
          </h2>
          <p className="mt-0.5 text-sm text-muted">
            Every course now has its own chat — go say hi to your classmates.
          </p>
        </div>
      </div>
      <ul className="mt-4 divide-y divide-border overflow-hidden rounded-xl border border-border">
        {result.enrolled.map((course) => (
          <li
            key={`${course.code}-${course.title}`}
            className="flex items-center gap-3 bg-surface px-3 py-2.5"
          >
            <Hash className="size-4 shrink-0 text-muted" aria-hidden />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{course.code}</p>
              <p className="truncate text-xs text-muted">{course.title}</p>
            </div>
          </li>
        ))}
      </ul>
      <Link
        href="/channels"
        className={buttonClasses({ className: "mt-4 w-full sm:w-auto" })}
      >
        Go to your channels
        <ArrowRight className="size-4" aria-hidden />
      </Link>
    </section>
  );
}

/**
 * Canvas connector flow, shared by /setup/canvas and /settings/canvas.
 * Not connected → explain + URL/token form → connect, then sync, then results.
 * Connected → status card with Re-sync and Disconnect.
 */
export function CanvasConnect({
  connection: initialConnection,
}: {
  connection: CanvasConnectionSummary | null;
}) {
  const router = useRouter();
  const helpId = useId();

  const [connection, setConnection] = useState(initialConnection);
  const [baseUrl, setBaseUrl] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [phase, setPhase] = useState<Phase>("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  const busy = phase !== "idle";

  async function runSync() {
    setPhase("syncing");
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/canvas/sync", { method: "POST" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        const message =
          json?.error ?? "Syncing failed. Please try again in a moment.";
        setError(message);
        setConnection((c) =>
          c ? { ...c, sync_status: "error", sync_error: message } : c
        );
        return;
      }
      setResult({
        coursesSynced: json.coursesSynced ?? 0,
        enrolled: Array.isArray(json.enrolled) ? json.enrolled : [],
      });
      setConnection((c) =>
        c
          ? {
              ...c,
              sync_status: "ok",
              sync_error: null,
              last_synced_at: new Date().toISOString(),
            }
          : c
      );
      router.refresh();
    } catch {
      setError("Something went wrong while syncing. Please try again.");
    } finally {
      setPhase("idle");
    }
  }

  async function handleConnect(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setResult(null);
    setPhase("connecting");
    try {
      const res = await fetch("/api/canvas/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ baseUrl, accessToken }),
      });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(
          json?.error ?? "Couldn't connect to Canvas. Please try again."
        );
        setPhase("idle");
        return;
      }
      setConnection({
        base_url: json.baseUrl ?? baseUrl,
        last_synced_at: null,
        sync_status: "never",
        sync_error: null,
        created_at: new Date().toISOString(),
      });
      setAccessToken("");
    } catch {
      setError("Something went wrong. Check your connection and try again.");
      setPhase("idle");
      return;
    }
    await runSync();
  }

  async function handleDisconnect() {
    setPhase("disconnecting");
    setError(null);
    try {
      const res = await fetch("/api/canvas/connect", { method: "DELETE" });
      const json = await res.json().catch(() => null);
      if (!res.ok || !json?.ok) {
        setError(json?.error ?? "Couldn't disconnect. Please try again.");
        return;
      }
      setConnection(null);
      setResult(null);
      setConfirmingDisconnect(false);
      setBaseUrl("");
      setAccessToken("");
      router.refresh();
    } catch {
      setError("Couldn't disconnect. Please try again.");
    } finally {
      setPhase("idle");
    }
  }

  // ---------- Connected: status card + actions ----------
  if (connection) {
    const host = connection.base_url.replace(/^https:\/\//, "");
    return (
      <div className="flex flex-col gap-4">
        <section aria-label="Canvas connection" className={cardClasses()}>
          <div className="flex items-start justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-brand-soft text-brand">
                <Link2 className="size-5" aria-hidden />
              </span>
              <div className="min-w-0">
                <p className="truncate font-semibold">{host}</p>
                <p className="text-xs text-muted">
                  {connection.last_synced_at
                    ? `Last synced ${formatDistanceToNow(
                        new Date(connection.last_synced_at),
                        { addSuffix: true }
                      )}`
                    : "Not synced yet"}
                </p>
              </div>
            </div>
            {phase === "syncing" ? (
              <Badge tone="neutral">
                <Loader2 className="size-3.5 animate-spin" aria-hidden />
                Syncing…
              </Badge>
            ) : connection.sync_status === "ok" ? (
              <Badge tone="success">
                <CheckCircle2 className="size-3.5" aria-hidden />
                Synced
              </Badge>
            ) : connection.sync_status === "error" ? (
              <Badge tone="danger">
                <AlertCircle className="size-3.5" aria-hidden />
                Sync failed
              </Badge>
            ) : (
              <Badge tone="neutral">Connected</Badge>
            )}
          </div>

          {connection.sync_status === "error" && connection.sync_error ? (
            <p className="mt-3 rounded-xl bg-surface-2 px-3 py-2 text-xs text-danger">
              {connection.sync_error}
            </p>
          ) : null}

          {error ? (
            <div className="mt-3">
              <ErrorAlert message={error} />
            </div>
          ) : null}

          <div className="mt-4 flex flex-wrap items-center gap-2">
            <Button onClick={runSync} disabled={busy}>
              {phase === "syncing" ? (
                <Loader2 className="size-4 animate-spin" aria-hidden />
              ) : (
                <RefreshCw className="size-4" aria-hidden />
              )}
              {phase === "syncing" ? "Syncing…" : "Re-sync courses"}
            </Button>
            {confirmingDisconnect ? (
              <>
                <Button
                  variant="danger"
                  onClick={handleDisconnect}
                  disabled={busy}
                >
                  {phase === "disconnecting" ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <Unplug className="size-4" aria-hidden />
                  )}
                  Yes, disconnect
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => setConfirmingDisconnect(false)}
                  disabled={busy}
                >
                  Cancel
                </Button>
              </>
            ) : (
              <Button
                variant="secondary"
                onClick={() => setConfirmingDisconnect(true)}
                disabled={busy}
              >
                <Unplug className="size-4" aria-hidden />
                Disconnect
              </Button>
            )}
          </div>
          {confirmingDisconnect ? (
            <p className="mt-2 text-xs text-muted">
              Disconnecting deletes your stored token. Your courses and channels
              stay — you just won&apos;t get new ones from Canvas.
            </p>
          ) : null}
        </section>

        <div aria-live="polite">
          {result ? <SyncResultPanel result={result} /> : null}
        </div>
      </div>
    );
  }

  // ---------- Not connected: explain + connect form ----------
  return (
    <div className="flex flex-col gap-4">
      <section
        aria-label="What Huddl does with Canvas"
        className="rounded-card border border-accent/30 bg-accent-soft p-5 shadow-soft"
      >
        <div className="flex items-center gap-3">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-surface text-accent">
            <ShieldCheck className="size-5" aria-hidden />
          </span>
          <h2 className="font-bold tracking-tight">
            What Huddl does with Canvas
          </h2>
        </div>
        <ul className="mt-4 flex flex-col gap-2.5 text-sm">
          <li className="flex gap-2.5">
            <Check className="mt-0.5 size-4 shrink-0 text-success" aria-hidden />
            <span>
              <span className="font-medium">We read your active courses</span>{" "}
              — just names and course codes, to drop you into the right
              channels.
            </span>
          </li>
          <li className="flex gap-2.5">
            <EyeOff className="mt-0.5 size-4 shrink-0 text-muted" aria-hidden />
            <span>
              <span className="font-medium">We never touch</span> grades,
              assignments, submissions, or Canvas messages.
            </span>
          </li>
          <li className="flex gap-2.5">
            <ShieldCheck
              className="mt-0.5 size-4 shrink-0 text-accent"
              aria-hidden
            />
            <span>
              <span className="font-medium">You stay in control</span> —
              disconnect anytime and Huddl deletes your token.
            </span>
          </li>
        </ul>
      </section>

      <form onSubmit={handleConnect} className={cardClasses()}>
        <div className="flex flex-col gap-5">
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="canvas-url">Canvas URL</Label>
            <Input
              id="canvas-url"
              name="canvasUrl"
              type="text"
              inputMode="url"
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
              required
              disabled={busy}
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://canvas.university.edu"
              aria-describedby="canvas-url-hint"
            />
            <Hint id="canvas-url-hint">
              The address you use to open Canvas in your browser.
            </Hint>
          </div>

          <div className="flex flex-col gap-1.5">
            <Label htmlFor="canvas-token">Access token</Label>
            <Input
              id="canvas-token"
              name="accessToken"
              type="password"
              autoComplete="off"
              required
              disabled={busy}
              value={accessToken}
              onChange={(e) => setAccessToken(e.target.value)}
              placeholder="Paste your Canvas access token"
            />
          </div>

          <div>
            <button
              type="button"
              onClick={() => setHelpOpen((open) => !open)}
              aria-expanded={helpOpen}
              aria-controls={helpId}
              className="inline-flex items-center gap-1.5 rounded-full text-sm font-semibold text-brand transition-colors hover:text-brand-strong focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
            >
              <ChevronDown
                className={cn(
                  "size-4 transition-transform",
                  helpOpen && "rotate-180"
                )}
                aria-hidden
              />
              How to create a token
            </button>
            {helpOpen ? (
              <ol
                id={helpId}
                className="mt-2 list-decimal space-y-1.5 rounded-xl bg-surface-2 py-3 pl-8 pr-4 text-sm text-muted"
              >
                <li>Open Canvas in your browser and sign in.</li>
                <li>
                  Go to{" "}
                  <span className="font-medium text-foreground">
                    Account → Settings
                  </span>
                  .
                </li>
                <li>
                  Scroll to{" "}
                  <span className="font-medium text-foreground">
                    Approved integrations
                  </span>{" "}
                  and click{" "}
                  <span className="font-medium text-foreground">
                    + New access token
                  </span>
                  .
                </li>
                <li>
                  Name it something like &ldquo;Huddl&rdquo; and click{" "}
                  <span className="font-medium text-foreground">
                    Generate token
                  </span>
                  .
                </li>
                <li>
                  Copy the token right away — Canvas only shows it once — and
                  paste it above.
                </li>
              </ol>
            ) : null}
          </div>

          {error ? <ErrorAlert message={error} /> : null}

          <Button type="submit" variant="gradient" disabled={busy} className="w-full">
            {phase === "connecting" ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Verifying token…
              </>
            ) : phase === "syncing" ? (
              <>
                <Loader2 className="size-4 animate-spin" aria-hidden />
                Syncing courses…
              </>
            ) : (
              <>
                <KeyRound className="size-4" aria-hidden />
                Connect and sync
              </>
            )}
          </Button>
        </div>
      </form>
    </div>
  );
}
