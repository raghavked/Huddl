"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Plus, PlusCircle } from "lucide-react";
import {
  Button,
  Card,
  FieldError,
  Input,
  Label,
} from "@/components/ui";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

/** Names classmates reach for first — a click prefills the field below. */
const SUGGESTIONS = ["Lectures", "Discussion", "Study group", "Notes"];

/**
 * Join button for a course room the viewer isn't in yet. The standard
 * university-scoped membership policy allows the insert; 23505 means
 * we're already in — treat it as a win and head on through.
 */
export function JoinRoomButton({
  channelId,
  roomName,
  userId,
}: {
  channelId: string;
  /** Accessible name — screen readers hear "Join Course chat". */
  roomName: string;
  userId: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleJoin() {
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { error: insertError } = await supabase
      .from("channel_members")
      .insert({ channel_id: channelId, user_id: userId });
    setPending(false);
    if (insertError && insertError.code !== "23505") {
      setError("Couldn't join that room just now. Give it another try.");
      return;
    }
    router.push(`/channels/${channelId}`);
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        size="sm"
        variant="soft"
        disabled={pending}
        aria-label={`Join ${roomName}`}
        onClick={() => void handleJoin()}
      >
        {pending ? (
          <Loader2 className="size-3.5 animate-spin" aria-hidden />
        ) : (
          <Plus className="size-3.5" aria-hidden />
        )}
        Join
      </Button>
      {error ? (
        <p role="alert" className="max-w-44 text-right text-[11px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}

/**
 * New-room card: suggestion chips plus a custom name, backed by the
 * create_course_room RPC (which also joins the creator).
 */
export function CreateRoomForm({ courseId }: { courseId: string }) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const trimmed = name.trim();

  async function handleCreate() {
    if (pending) return;
    if (trimmed.length < 2 || trimmed.length > 40) {
      setError("Room names run 2–40 characters.");
      return;
    }
    setError(null);
    setPending(true);
    const supabase = createClient();
    const { data, error: rpcError } = await supabase.rpc("create_course_room", {
      p_course_id: courseId,
      p_name: trimmed,
    });
    setPending(false);
    const newId = typeof data === "string" ? data : null;
    if (rpcError || !newId) {
      const message = rpcError?.message ?? "";
      setError(
        message.includes("join the course")
          ? "Rooms are for classmates — add this course to your classes first."
          : rpcError?.code === "23505"
            ? "Looks like that room already exists — it should be in the list above."
            : "We couldn't create that room just now. Give it another try."
      );
      return;
    }
    setName("");
    router.refresh(); // so the new room is listed when they come back
    router.push(`/channels/${newId}`);
  }

  return (
    <Card className="mt-6">
      <h2 className="flex items-center gap-2 font-bold tracking-tight">
        <PlusCircle className="size-4 text-brand" aria-hidden />
        New room
      </h2>
      <p className="mt-1.5 text-sm text-muted">
        Side rooms keep the main chat tidy — one for lectures, one for your
        study group, whatever helps.
      </p>
      <div className="mt-4 flex flex-wrap gap-2">
        {SUGGESTIONS.map((suggestion) => {
          const active = name === suggestion;
          return (
            <button
              key={suggestion}
              type="button"
              disabled={pending}
              aria-pressed={active}
              aria-label={`Use ${suggestion} as the room name`}
              onClick={() => {
                setName(suggestion);
                setError(null);
              }}
              className={cn(
                "rounded-full border px-3.5 py-2 text-xs font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
                active
                  ? "border-brand bg-brand-soft text-brand-ink"
                  : "border-border bg-surface text-muted hover:text-foreground"
              )}
            >
              {suggestion}
            </button>
          );
        })}
      </div>
      <form
        className="mt-4"
        onSubmit={(e) => {
          e.preventDefault();
          void handleCreate();
        }}
      >
        <Label htmlFor="room-name">Room name</Label>
        <Input
          id="room-name"
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            if (error) setError(null);
          }}
          placeholder="Study group"
          maxLength={40}
          disabled={pending}
          aria-describedby={error ? "room-name-error" : undefined}
          className="mt-1.5"
        />
        {error ? (
          <FieldError id="room-name-error" className="mt-1.5">
            {error}
          </FieldError>
        ) : null}
        <Button
          type="submit"
          className="mt-4"
          disabled={pending || trimmed.length < 2}
        >
          {pending ? (
            <Loader2 className="size-4 animate-spin" aria-hidden />
          ) : (
            <Plus className="size-4" aria-hidden />
          )}
          Create room
        </Button>
      </form>
    </Card>
  );
}
