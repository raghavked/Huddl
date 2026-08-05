"use client";

import { useState } from "react";
import { format } from "date-fns";
import {
  AlertCircle,
  CheckCircle2,
  Cpu,
  Eye,
  EyeOff,
  HardDrive,
  Hash,
  ListChecks,
  Loader2,
  Trash2,
  Upload,
  type LucideIcon,
} from "lucide-react";
import { Badge, Button, cardClasses, type BadgeTone } from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import type {
  ScheduleUpload,
  ScheduleUploadEvent,
  ScheduleUploadEventType,
} from "@/lib/types";

const EVENT_META: Record<
  ScheduleUploadEventType,
  { label: string; icon: LucideIcon }
> = {
  uploaded: { label: "Image uploaded", icon: Upload },
  processed_on_device: { label: "Processed on your device", icon: Cpu },
  stored: { label: "Image stored", icon: HardDrive },
  accessed: { label: "Image accessed", icon: Eye },
  courses_confirmed: { label: "Courses confirmed", icon: ListChecks },
  deleted: { label: "Deleted", icon: Trash2 },
};

function ts(iso: string): string {
  return format(new Date(iso), "MMM d, yyyy · h:mm a");
}

function StatusBadge({ status }: { status: ScheduleUpload["status"] }) {
  const tones: Record<ScheduleUpload["status"], BadgeTone> = {
    pending: "neutral",
    processed: "accent",
    confirmed: "success",
    deleted: "neutral",
  };
  const labels: Record<ScheduleUpload["status"], string> = {
    pending: "Pending",
    processed: "Processed",
    confirmed: "Confirmed",
    deleted: "Deleted",
  };
  return (
    <Badge tone={tones[status]}>
      {status === "confirmed" ? (
        <CheckCircle2 className="size-3.5" aria-hidden />
      ) : status === "deleted" ? (
        <Trash2 className="size-3.5" aria-hidden />
      ) : null}
      {labels[status]}
    </Badge>
  );
}

/**
 * Interactive half of the privacy dashboard: per-upload view (signed URL +
 * logged 'accessed' event) and delete (storage object removed, status set to
 * 'deleted', 'deleted' event logged), plus the live audit timeline. Every
 * event insert also produces a notification via the DB trigger — that's the
 * receipt guarantee the page explains.
 */
export function PrivacyDashboard({
  uploads: initialUploads,
  events: initialEvents,
}: {
  uploads: ScheduleUpload[];
  events: ScheduleUploadEvent[];
}) {
  const [uploads, setUploads] = useState(initialUploads);
  const [events, setEvents] = useState(initialEvents);
  const [busy, setBusy] = useState<Record<string, "view" | "delete" | null>>({});
  const [viewUrls, setViewUrls] = useState<Record<string, string | null>>({});
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string | null>>({});

  function setError(uploadId: string, message: string | null) {
    setErrors((e) => ({ ...e, [uploadId]: message }));
  }

  async function handleView(upload: ScheduleUpload) {
    // Toggle closed without logging another access.
    if (viewUrls[upload.id]) {
      setViewUrls((v) => ({ ...v, [upload.id]: null }));
      return;
    }
    setBusy((b) => ({ ...b, [upload.id]: "view" }));
    setError(upload.id, null);
    const supabase = createClient();
    try {
      const { data, error } = await supabase.storage
        .from("schedules")
        .createSignedUrl(upload.storage_path, 300);
      if (error || !data?.signedUrl) {
        setError(upload.id, "Couldn't open the image. Please try again.");
        return;
      }
      // Log the access — the DB trigger turns this into a notification.
      const { data: event } = await supabase
        .from("schedule_upload_events")
        .insert({
          upload_id: upload.id,
          event_type: "accessed",
          detail: "Viewed by you from the privacy dashboard",
        })
        .select("*")
        .single();
      if (event) {
        setEvents((list) => [...list, event as ScheduleUploadEvent]);
      }
      setViewUrls((v) => ({ ...v, [upload.id]: data.signedUrl }));
    } catch {
      setError(upload.id, "Couldn't open the image. Please try again.");
    } finally {
      setBusy((b) => ({ ...b, [upload.id]: null }));
    }
  }

  async function handleDelete(upload: ScheduleUpload) {
    setBusy((b) => ({ ...b, [upload.id]: "delete" }));
    setError(upload.id, null);
    const supabase = createClient();
    try {
      if (upload.storage_path) {
        const { error: removeError } = await supabase.storage
          .from("schedules")
          .remove([upload.storage_path]);
        if (removeError) {
          setError(upload.id, "Couldn't delete the image. Please try again.");
          return;
        }
      }
      const { error: statusError } = await supabase
        .from("schedule_uploads")
        .update({ status: "deleted" })
        .eq("id", upload.id);
      if (statusError) {
        setError(upload.id, "Couldn't update the record. Please try again.");
        return;
      }
      const { data: event } = await supabase
        .from("schedule_upload_events")
        .insert({
          upload_id: upload.id,
          event_type: "deleted",
          detail: upload.storage_path
            ? "Image and stored copy deleted by you from the privacy dashboard"
            : "Record deleted by you from the privacy dashboard",
        })
        .select("*")
        .single();
      if (event) {
        setEvents((list) => [...list, event as ScheduleUploadEvent]);
      }
      setUploads((list) =>
        list.map((u) => (u.id === upload.id ? { ...u, status: "deleted" } : u))
      );
      setViewUrls((v) => ({ ...v, [upload.id]: null }));
      setConfirmingDelete(null);
    } catch {
      setError(upload.id, "Couldn't delete the image. Please try again.");
    } finally {
      setBusy((b) => ({ ...b, [upload.id]: null }));
    }
  }

  return (
    <ul className="space-y-4">
      {uploads.map((upload) => {
        const uploadEvents = events
          .filter((e) => e.upload_id === upload.id)
          .sort(
            (a, b) =>
              new Date(a.created_at).getTime() -
              new Date(b.created_at).getTime()
          );
        const summaryCourses = upload.ocr_summary?.courses ?? [];
        const isDeleted = upload.status === "deleted";
        const hasImage = Boolean(upload.storage_path) && !isDeleted;
        const uploadBusy = busy[upload.id] ?? null;
        const viewUrl = viewUrls[upload.id] ?? null;
        const uploadError = errors[upload.id] ?? null;

        return (
          <li key={upload.id} className={cardClasses()}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="font-semibold">
                  Schedule from {format(new Date(upload.created_at), "MMM d, yyyy")}
                </h3>
                <p className="mt-0.5 text-xs text-muted">
                  {hasImage
                    ? "Image stored in your private folder — only you can open it."
                    : upload.storage_path
                      ? "Stored image has been deleted."
                      : "Processed on your device — the image was never stored."}
                </p>
              </div>
              <StatusBadge status={upload.status} />
            </div>

            {summaryCourses.length > 0 ? (
              <ul
                aria-label="Courses confirmed from this schedule"
                className="mt-3 flex flex-wrap gap-1.5"
              >
                {summaryCourses.map((course) => (
                  <li key={course.code}>
                    <Badge tone="brand">
                      <Hash className="size-3" aria-hidden />
                      {course.code}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}

            {!isDeleted ? (
              <div className="mt-4 flex flex-wrap items-center gap-2">
                {hasImage ? (
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={uploadBusy !== null}
                    onClick={() => handleView(upload)}
                  >
                    {uploadBusy === "view" ? (
                      <Loader2 className="size-4 animate-spin" aria-hidden />
                    ) : viewUrl ? (
                      <EyeOff className="size-4" aria-hidden />
                    ) : (
                      <Eye className="size-4" aria-hidden />
                    )}
                    {viewUrl ? "Hide image" : "View image"}
                  </Button>
                ) : null}
                {confirmingDelete === upload.id ? (
                  <>
                    <Button
                      variant="danger"
                      size="sm"
                      disabled={uploadBusy !== null}
                      onClick={() => handleDelete(upload)}
                    >
                      {uploadBusy === "delete" ? (
                        <Loader2 className="size-4 animate-spin" aria-hidden />
                      ) : (
                        <Trash2 className="size-4" aria-hidden />
                      )}
                      Yes, delete
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={uploadBusy !== null}
                      onClick={() => setConfirmingDelete(null)}
                    >
                      Cancel
                    </Button>
                  </>
                ) : (
                  <Button
                    variant="danger-ghost"
                    size="sm"
                    disabled={uploadBusy !== null}
                    onClick={() => setConfirmingDelete(upload.id)}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    {hasImage ? "Delete image" : "Delete record"}
                  </Button>
                )}
              </div>
            ) : null}

            {!isDeleted && confirmingDelete === upload.id ? (
              <p className="mt-2 text-xs text-muted">
                {hasImage
                  ? "This permanently removes the stored image. Your courses and channels are not affected. The deletion itself is logged and you'll get a receipt."
                  : "This marks the record as deleted. Your courses and channels are not affected, and the audit trail is kept so your receipts still add up."}
              </p>
            ) : null}

            {viewUrl ? (
              <figure className="mt-3">
                {/* eslint-disable-next-line @next/next/no-img-element -- short-lived signed URL */}
                <img
                  src={viewUrl}
                  alt="Your stored schedule image"
                  className="max-h-96 w-full rounded-xl border border-border bg-surface-2 object-contain"
                />
                <figcaption className="mt-1.5 flex items-center gap-1.5 text-xs text-muted">
                  <Eye className="size-3.5" aria-hidden />
                  This view was logged just now — check your notifications for
                  the receipt.
                </figcaption>
              </figure>
            ) : null}

            {uploadError ? (
              <div
                role="alert"
                className="mt-3 flex items-start gap-2 rounded-xl border border-danger/30 bg-danger/5 px-3.5 py-2.5 text-sm text-danger"
              >
                <AlertCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
                <span>{uploadError}</span>
              </div>
            ) : null}

            <div className="mt-4 border-t border-border pt-4">
              <h4 className="px-1 text-xs font-bold uppercase tracking-widest text-muted">
                Audit timeline
              </h4>
              <ol aria-live="polite" className="mt-1 divide-y divide-border">
                {uploadEvents.length === 0 ? (
                  <li className="py-2.5 text-sm text-muted">
                    No events recorded.
                  </li>
                ) : (
                  uploadEvents.map((event) => {
                    const meta = EVENT_META[event.event_type];
                    const Icon = meta.icon;
                    return (
                      <li
                        key={event.id}
                        className="flex items-start gap-3 py-2.5"
                      >
                        <span className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent-soft text-accent">
                          <Icon className="size-3.5" aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium">{meta.label}</p>
                          {event.detail ? (
                            <p className="text-xs text-muted">{event.detail}</p>
                          ) : null}
                        </div>
                        <p className="mt-0.5 shrink-0 whitespace-nowrap font-mono text-xs text-muted">
                          <time dateTime={event.created_at}>
                            {ts(event.created_at)}
                          </time>
                        </p>
                      </li>
                    );
                  })
                )}
              </ol>
            </div>
          </li>
        );
      })}
    </ul>
  );
}
