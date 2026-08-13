"use client";

import { useEffect, useState } from "react";
import { ImageOff, X } from "lucide-react";
import { getAttachmentUrl } from "@/features/chat/attachments";
import { cn } from "@/lib/utils";

/**
 * One image attachment in a chat bubble: resolves the storage path to a
 * signed URL (cached per path), renders a rounded thumbnail, and opens a
 * full-screen lightbox on click. Shared by channels, threads, and DMs.
 */
export function AttachmentImage({
  path,
  alt = "Photo attachment",
  className,
}: {
  path: string;
  alt?: string;
  className?: string;
}) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [lightbox, setLightbox] = useState(false);

  useEffect(() => {
    let active = true;
    setUrl(null);
    setFailed(false);
    void getAttachmentUrl(path).then((signed) => {
      if (!active) return;
      if (signed) setUrl(signed);
      else setFailed(true);
    });
    return () => {
      active = false;
    };
  }, [path]);

  // While the lightbox is open, Escape closes it. Captured and stopped so
  // panels underneath (thread slide-over) don't close on the same key.
  useEffect(() => {
    if (!lightbox) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      setLightbox(false);
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [lightbox]);

  if (failed) {
    return (
      <span
        className={cn(
          "flex w-fit items-center gap-1.5 rounded-xl border border-dashed border-border px-3 py-2 text-xs text-muted",
          className
        )}
      >
        <ImageOff className="size-3.5" aria-hidden />
        Photo unavailable
      </span>
    );
  }

  if (!url) {
    return (
      <span
        role="status"
        aria-label="Loading photo"
        className={cn(
          "block h-40 w-60 max-w-full animate-pulse rounded-xl bg-surface-2",
          className
        )}
      />
    );
  }

  return (
    <>
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setLightbox(true);
        }}
        aria-label="View photo full size"
        className={cn(
          "block w-fit overflow-hidden rounded-xl border border-border transition-opacity hover:opacity-90 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
          className
        )}
      >
        {/* Signed URLs are short-lived and per-user, so the Next.js image
            optimizer would only get in the way here. */}
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={url}
          alt={alt}
          loading="lazy"
          onError={() => setFailed(true)}
          className="block max-h-60 w-auto max-w-60 object-cover"
        />
      </button>

      {lightbox ? (
        <div
          role="dialog"
          aria-modal="true"
          aria-label="Photo"
          onClick={(e) => {
            e.stopPropagation();
            setLightbox(false);
          }}
          className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/85 p-4"
        >
          <button
            type="button"
            onClick={() => setLightbox(false)}
            aria-label="Close photo"
            className="absolute right-4 top-4 flex size-11 items-center justify-center rounded-full bg-white/10 text-white transition-colors hover:bg-white/20 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-white"
          >
            <X className="size-5" aria-hidden />
          </button>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={url}
            alt={alt}
            className="max-h-full max-w-full rounded-xl object-contain"
          />
        </div>
      ) : null}
    </>
  );
}
