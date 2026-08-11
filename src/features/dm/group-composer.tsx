"use client";

import { useCallback, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertCircle, Loader2, X } from "lucide-react";
import {
  Badge,
  Button,
  FieldError,
  Hint,
  Input,
  Label,
} from "@/components/ui";
import { CampusPeoplePicker } from "@/features/dm/campus-people-picker";
import { createGroupThread } from "@/features/dm/group-actions";
import {
  firstNameOf,
  GROUP_MAX_PEOPLE,
  GROUP_MIN_PEOPLE,
  GROUP_TITLE_MAX,
  GroupDmError,
  type ThreadPerson,
} from "@/features/dm/group-dm";

/**
 * Start a group: name it, pick your people, and everyone lands in the same
 * chat. The counter and the chips always speak in whole-group terms — you're
 * in it too — so "3 of 16" matches what the database will count.
 */
export function GroupComposer({ userId }: { userId: string }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [selected, setSelected] = useState<ThreadPerson[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  const selectedIds = useMemo(
    () => new Set(selected.map((person) => person.id)),
    [selected]
  );
  const headcount = selected.length + 1;
  const full = headcount >= GROUP_MAX_PEOPLE;
  const shortBy = Math.max(0, GROUP_MIN_PEOPLE - headcount);

  const togglePerson = useCallback(
    (person: ThreadPerson) => {
      if (selected.some((p) => p.id === person.id)) {
        setError(null);
        setSelected(selected.filter((p) => p.id !== person.id));
        return;
      }
      if (selected.length + 1 >= GROUP_MAX_PEOPLE) {
        setError("This group is full at 16.");
        return;
      }
      setError(null);
      setSelected([...selected, person]);
    },
    [selected]
  );

  async function handleCreate() {
    if (pending) return;
    const trimmed = title.trim();
    if (trimmed.length < 2 || trimmed.length > GROUP_TITLE_MAX) {
      setError("Group names run 2 to 60 characters.");
      return;
    }
    if (selected.length < GROUP_MIN_PEOPLE - 1) {
      setError("Groups hold 3 to 16 people including you.");
      return;
    }
    setError(null);
    setPending(true);
    try {
      const threadId = await createGroupThread(
        trimmed,
        selected.map((person) => person.id)
      );
      router.replace(`/messages/${threadId}`);
      router.refresh();
    } catch (err) {
      setError(
        err instanceof GroupDmError
          ? err.message
          : "We couldn't start that group just now. Try again."
      );
      setPending(false);
    }
  }

  const canCreate =
    !pending &&
    title.trim().length >= 2 &&
    selected.length >= GROUP_MIN_PEOPLE - 1;

  const hint = full
    ? "That's the whole group — sixteen is the cap."
    : shortBy > 0
      ? `Pick ${shortBy} more ${shortBy === 1 ? "person" : "people"} — groups start at three.`
      : "Tap a classmate to add them, or tap their chip to take them back out.";

  return (
    <form
      onSubmit={(event) => {
        event.preventDefault();
        void handleCreate();
      }}
      aria-label="Start a group"
      className="mt-6 flex animate-fade-up flex-col gap-5"
      noValidate
    >
      <div className="flex flex-col gap-1.5">
        <Label htmlFor="group-title">Group name</Label>
        <Input
          id="group-title"
          type="text"
          value={title}
          maxLength={GROUP_TITLE_MAX}
          disabled={pending}
          onChange={(event) => {
            setTitle(event.target.value);
            setError(null);
          }}
          placeholder="ECS 36A study crew"
          aria-describedby="group-title-hint"
        />
        <Hint id="group-title-hint">
          Everyone in the group sees this name, and anyone in it can change it
          later.
        </Hint>
      </div>

      <div className="flex flex-col gap-2">
        <span className="text-sm font-semibold">Who&rsquo;s in</span>
        <ul
          aria-label="People in this group"
          className="flex flex-wrap items-center gap-2"
        >
          <li>
            <Badge tone={shortBy === 0 ? "accent" : "neutral"}>
              <span aria-live="polite">
                {headcount} of {GROUP_MAX_PEOPLE}
              </span>
            </Badge>
          </li>
          {selected.map((person) => (
            <li key={person.id}>
              <button
                type="button"
                onClick={() => togglePerson(person)}
                disabled={pending}
                aria-label={`Remove ${person.display_name}`}
                className="inline-flex h-8 items-center gap-1 rounded-full bg-brand-soft px-3 text-xs font-semibold text-brand-ink transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand disabled:pointer-events-none disabled:opacity-60"
              >
                {firstNameOf(person.display_name)}
                <X className="size-3.5" aria-hidden />
              </button>
            </li>
          ))}
        </ul>
        <Hint>{hint}</Hint>
      </div>

      <CampusPeoplePicker
        userId={userId}
        label="Search your campus by name or handle"
        placeholder="Search your campus"
        selectedIds={selectedIds}
        onPick={togglePerson}
        disabled={pending}
      />

      {error ? (
        <FieldError className="flex items-center gap-2">
          <AlertCircle className="size-4 shrink-0" aria-hidden />
          {error}
        </FieldError>
      ) : null}

      <Button type="submit" disabled={!canCreate}>
        {pending ? (
          <>
            <Loader2 className="size-4 animate-spin" aria-hidden />
            Starting the group…
          </>
        ) : (
          "Create group"
        )}
      </Button>
    </form>
  );
}
