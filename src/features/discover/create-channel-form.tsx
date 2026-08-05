"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Loader2 } from "lucide-react";
import {
  Button,
  FieldError,
  Hint,
  Input,
  Label,
  Textarea,
} from "@/components/ui";
import { createTopicChannel } from "@/features/discover/actions";

/**
 * Client-side mirror of the server action's slugifier — the preview under the
 * name field has to match what actually lands in the database.
 * "AI Study Buddies!" -> "ai-study-buddies".
 */
function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 60)
    .replace(/-+$/g, "");
}

/**
 * Topic-channel creation form. The createTopicChannel server action inserts
 * the channel, adds the creator as moderator, and hands back the id (or an
 * inline error — most notably "slug already taken").
 */
export function CreateChannelForm({
  universityName,
}: {
  universityName: string;
}) {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();
  const slug = slugify(name);

  function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (isPending) return;

    const trimmed = name.trim();
    if (trimmed.length < 3) {
      setError("Give your channel a name of at least 3 characters.");
      return;
    }
    if (!slug) {
      setError("The name needs at least one letter or number.");
      return;
    }

    setError(null);
    startTransition(async () => {
      const result = await createTopicChannel({
        name: trimmed,
        description,
      });
      if (result.error || !result.channelId) {
        setError(result.error ?? "Something went wrong. Please try again.");
        return;
      }
      router.push(`/channels/${result.channelId}`);
      router.refresh();
    });
  }

  return (
    <form
      onSubmit={handleSubmit}
      aria-label="Start a topic channel"
      className="flex flex-col gap-5"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="channel-name">Channel name</Label>
        <Input
          id="channel-name"
          type="text"
          required
          maxLength={80}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="AI Study Buddies"
          aria-describedby="channel-slug-preview"
        />
        <Hint id="channel-slug-preview">
          Appears as{" "}
          <span className="font-mono text-foreground">
            #{slug || "your-channel"}
          </span>{" "}
          to everyone at {universityName}.
        </Hint>
      </div>

      <div className="flex flex-col gap-1.5">
        <Label htmlFor="channel-description">
          Description <span className="font-normal text-muted">(optional)</span>
        </Label>
        <Textarea
          id="channel-description"
          rows={4}
          maxLength={500}
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="What's this channel for? Who should join the conversation?"
        />
      </div>

      {error ? <FieldError>{error}</FieldError> : null}

      <Button type="submit" disabled={isPending}>
        {isPending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Creating…
          </>
        ) : (
          "Create channel"
        )}
      </Button>
    </form>
  );
}
