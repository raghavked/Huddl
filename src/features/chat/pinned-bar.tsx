"use client";

import { useState } from "react";
import { ChevronDown, ChevronUp, Pin, PinOff } from "lucide-react";
import { Avatar } from "@/components/avatar";
import type { MessageWithAuthor } from "@/lib/types";
import { formatMessageTime } from "@/lib/utils";

/**
 * Slim strip above the message list once a channel has pinned messages.
 * Tapping it unfolds the full pinned list, each row with its own Unpin —
 * any member can pin or unpin, campus rooms are small and self-governing.
 */
export function PinnedBar({
  pinned,
  onUnpin,
}: {
  pinned: MessageWithAuthor[];
  onUnpin: (messageId: string) => void;
}) {
  const [open, setOpen] = useState(false);

  if (pinned.length === 0) return null;

  return (
    <div className="relative z-20 mt-2 shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`${pinned.length} pinned ${
          pinned.length === 1 ? "message" : "messages"
        }`}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-brand-soft/40 px-3 py-1.5 text-xs font-semibold text-brand-ink transition-colors hover:bg-brand-soft/70 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
      >
        <Pin className="size-3.5 shrink-0" aria-hidden />
        <span className="flex-1 text-left">
          {pinned.length} pinned
        </span>
        {open ? (
          <ChevronUp className="size-3.5 shrink-0" aria-hidden />
        ) : (
          <ChevronDown className="size-3.5 shrink-0" aria-hidden />
        )}
      </button>

      {open ? (
        <div
          role="region"
          aria-label="Pinned messages"
          className="absolute inset-x-0 top-full z-20 mt-1 max-h-72 animate-scale-in overflow-y-auto rounded-card border border-border bg-surface p-1.5 shadow-lift"
        >
          <ul className="flex flex-col gap-0.5">
            {pinned.map((message) => (
              <li
                key={message.id}
                className="flex items-start gap-2.5 rounded-xl px-2.5 py-2 transition-colors hover:bg-surface-2/60"
              >
                <Avatar
                  name={message.author.display_name}
                  src={message.author.avatar_url}
                  size="xs"
                  className="mt-0.5"
                />
                <div className="min-w-0 flex-1">
                  <p className="flex items-baseline gap-2">
                    <span className="truncate text-xs font-semibold">
                      {message.author.display_name}
                    </span>
                    <time
                      dateTime={message.created_at}
                      className="shrink-0 text-[10px] text-muted"
                    >
                      {formatMessageTime(message.created_at)}
                    </time>
                  </p>
                  <p className="mt-0.5 line-clamp-2 break-words text-xs text-muted">
                    {message.attachment_path && message.content === "Photo"
                      ? "📷 Photo"
                      : message.content}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => onUnpin(message.id)}
                  aria-label={`Unpin message from ${message.author.display_name}`}
                  className="flex size-7 shrink-0 items-center justify-center rounded-full text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
                >
                  <PinOff className="size-3.5" aria-hidden />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
