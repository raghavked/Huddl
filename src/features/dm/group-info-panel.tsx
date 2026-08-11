"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  AlertCircle,
  ChevronRight,
  Loader2,
  LogOut,
  Pencil,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import {
  Badge,
  Button,
  Input,
  Label,
  cardClasses,
} from "@/components/ui";
import { CampusPeoplePicker } from "@/features/dm/campus-people-picker";
import {
  addToGroupThread,
  fetchThreadPeople,
  leaveGroupThread,
  renameGroupThread,
  sortPeople,
} from "@/features/dm/group-actions";
import {
  GROUP_MAX_PEOPLE,
  GROUP_TITLE_MAX,
  GroupDmError,
  type ThreadPerson,
} from "@/features/dm/group-dm";

/**
 * The group's own panel: who's in it, what it's called, and the two things
 * only a member can do — add someone else, or slip out. It opens over the
 * room from the header, so the conversation stays one tap behind.
 *
 * The room owns the title and the roster; this panel writes through the
 * callbacks so the header updates the moment a write lands (and rolls back
 * with it when one doesn't).
 */
export function GroupInfoPanel({
  threadId,
  userId,
  title,
  people,
  onTitleChange,
  onPeopleChange,
  onClose,
}: {
  threadId: string;
  userId: string;
  /** The group's name as the header shows it. */
  title: string;
  /** Everyone in the group, you included. */
  people: ThreadPerson[];
  onTitleChange: (title: string) => void;
  onPeopleChange: (people: ThreadPerson[]) => void;
  onClose: () => void;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<"info" | "add">("info");
  const [error, setError] = useState<string | null>(null);

  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(title);
  const [renaming, setRenaming] = useState(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [leaving, setLeaving] = useState(false);

  // Focus lands in the panel when it opens, so a keyboard or screen reader
  // is inside the dialog rather than still back in the conversation.
  const panelRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    panelRef.current?.focus();
  }, []);

  // Open with a fresh roster: someone may have joined or left while the
  // room sat open. A failed refresh just keeps what the server rendered.
  useEffect(() => {
    let active = true;
    fetchThreadPeople(threadId)
      .then((roster) => {
        if (active && roster.length > 0) onPeopleChange(roster);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [threadId]);

  // Escape closes the panel (or backs out of "add people" first).
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopPropagation();
      if (mode === "add") setMode("info");
      else onClose();
    }
    document.addEventListener("keydown", onKeyDown, true);
    return () => document.removeEventListener("keydown", onKeyDown, true);
  }, [mode, onClose]);

  const memberIds = useMemo(
    () => new Set(people.map((person) => person.id)),
    [people]
  );
  const full = people.length >= GROUP_MAX_PEOPLE;

  /* ------------------------------ rename ------------------------------ */

  function startRename() {
    setError(null);
    setTitleDraft(title);
    setEditingTitle(true);
  }

  function cancelRename() {
    setTitleDraft(title);
    setEditingTitle(false);
    setError(null);
  }

  async function handleRename() {
    if (renaming) return;
    const next = titleDraft.trim();
    if (next === title) {
      setEditingTitle(false);
      return;
    }
    const previous = title;
    setError(null);
    setRenaming(true);
    // Optimistic: the new name is up before the round trip finishes.
    onTitleChange(next);
    try {
      const saved = await renameGroupThread(threadId, titleDraft);
      onTitleChange(saved);
      setEditingTitle(false);
      router.refresh();
    } catch (err) {
      onTitleChange(previous);
      setTitleDraft(previous);
      setError(
        err instanceof GroupDmError
          ? err.message
          : "We couldn't rename the group just now. Try again."
      );
    } finally {
      setRenaming(false);
    }
  }

  /* ---------------------------- add people ---------------------------- */

  const handleAdd = useCallback(
    async (person: ThreadPerson) => {
      if (addingId) return;
      const previous = people;
      setError(null);
      setAddingId(person.id);
      onPeopleChange(sortPeople([...people, person]));
      try {
        await addToGroupThread(threadId, person.id);
        router.refresh();
      } catch (err) {
        onPeopleChange(previous);
        setError(
          err instanceof GroupDmError
            ? err.message
            : `We couldn't add ${person.display_name} just now. Try again.`
        );
      } finally {
        setAddingId(null);
      }
    },
    [addingId, people, onPeopleChange, threadId, router]
  );

  /* ------------------------------ leaving ----------------------------- */

  async function handleLeave() {
    if (leaving) return;
    const sure = window.confirm(
      "Leave this group? You'll stop getting its messages, and everyone else keeps the chat."
    );
    if (!sure) return;
    setError(null);
    setLeaving(true);
    try {
      await leaveGroupThread(threadId);
      router.replace("/messages");
      router.refresh();
    } catch (err) {
      setError(
        err instanceof GroupDmError
          ? err.message
          : "We couldn't leave that group just now. Try again."
      );
      setLeaving(false);
    }
  }

  /* ------------------------------ render ------------------------------ */

  const errorNote = error ? (
    <p
      role="alert"
      className="flex items-center gap-2 rounded-xl bg-danger/10 px-3 py-2 text-xs text-danger"
    >
      <AlertCircle className="size-4 shrink-0" aria-hidden />
      <span className="flex-1">{error}</span>
      <button
        type="button"
        onClick={() => setError(null)}
        aria-label="Dismiss error"
        className="rounded-full p-1 transition-colors hover:bg-danger/10"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </p>
  ) : null;

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center pt-12">
      <div
        aria-hidden
        className="absolute inset-0 animate-fade-in bg-foreground/30"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-label={mode === "add" ? "Add people" : "Group info"}
        className="relative flex max-h-[88dvh] w-full max-w-md animate-scale-in flex-col overflow-hidden rounded-t-card border-x border-t border-border bg-surface shadow-lift outline-none"
      >
        <header className="flex shrink-0 items-center gap-2 border-b border-border px-4 py-3">
          {mode === "add" ? (
            <button
              type="button"
              onClick={() => {
                setMode("info");
                setError(null);
              }}
              aria-label="Done adding people"
              className="-ml-2 rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            >
              <X className="size-5" aria-hidden />
            </button>
          ) : null}
          <h2 className="min-w-0 flex-1 truncate text-base font-bold">
            {mode === "add" ? "Add people" : "Group info"}
          </h2>
          <Badge tone={full ? "brand" : "neutral"}>
            {people.length} of {GROUP_MAX_PEOPLE}
          </Badge>
          {mode === "info" ? (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close group info"
              className="-mr-2 rounded-full p-2 text-muted transition-colors hover:bg-surface-2 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-brand"
            >
              <X className="size-5" aria-hidden />
            </button>
          ) : null}
        </header>

        <div className="flex-1 overflow-y-auto px-4 py-4">
          {mode === "add" ? (
            <div className="flex flex-col gap-3">
              {errorNote}
              {full ? (
                <div className="py-8 text-center">
                  <Users className="mx-auto size-6 text-muted" aria-hidden />
                  <p className="mt-2 text-sm font-semibold">
                    This group is full at 16
                  </p>
                  <p className="mx-auto mt-1 max-w-xs text-xs text-muted">
                    Someone has to leave before another classmate can join.
                  </p>
                </div>
              ) : (
                <>
                  <p className="text-xs text-muted">
                    Everyone in {title} is on your campus — that&rsquo;s the
                    only rule. Pick someone to add them right away.
                  </p>
                  <CampusPeoplePicker
                    userId={userId}
                    label="Search your campus by name or handle"
                    placeholder="Name or handle"
                    excludeIds={memberIds}
                    onPick={(person) => void handleAdd(person)}
                    pendingId={addingId}
                    autoFocus
                  />
                </>
              )}
            </div>
          ) : (
            <div className="flex flex-col gap-4">
              {editingTitle ? (
                <div className="flex flex-col gap-2">
                  <Label htmlFor="group-rename">Group name</Label>
                  <Input
                    id="group-rename"
                    type="text"
                    value={titleDraft}
                    maxLength={GROUP_TITLE_MAX}
                    disabled={renaming}
                    onChange={(event) => setTitleDraft(event.target.value)}
                    placeholder="ECS 36A study crew"
                  />
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      disabled={renaming}
                      onClick={() => void handleRename()}
                    >
                      {renaming ? (
                        <>
                          <Loader2 className="size-4 animate-spin" aria-hidden />
                          Saving…
                        </>
                      ) : (
                        "Save name"
                      )}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={renaming}
                      onClick={cancelRename}
                    >
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="flex items-start gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="text-lg font-bold text-balance">{title}</p>
                    <p className="mt-0.5 text-xs text-muted">
                      {people.length}{" "}
                      {people.length === 1 ? "person" : "people"} · anyone here
                      can rename it
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={startRename}
                    aria-label="Rename group"
                    className="flex size-11 shrink-0 items-center justify-center rounded-full bg-brand-soft text-brand-ink transition-colors hover:bg-brand hover:text-brand-fg focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand"
                  >
                    <Pencil className="size-4" aria-hidden />
                  </button>
                </div>
              )}

              {errorNote}

              <div className="flex flex-col gap-2">
                <h3 className="text-xs font-semibold uppercase tracking-widest text-muted">
                  In this group
                </h3>
                <ul aria-label="People in this group" className="flex flex-col gap-2">
                  {people.map((person) => (
                    <li key={person.id}>
                      <Link
                        href={`/u/${person.handle}`}
                        className={cardClasses({
                          padding: "none",
                          interactive: true,
                          className: "flex items-center gap-3 px-3.5 py-2.5",
                        })}
                      >
                        <Avatar
                          name={person.display_name}
                          src={person.avatar_url}
                          size="md"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-sm font-semibold">
                              {person.display_name}
                            </span>
                            {person.id === userId ? (
                              <Badge tone="accent">You</Badge>
                            ) : null}
                          </span>
                          <span className="block truncate text-xs text-muted">
                            @{person.handle}
                          </span>
                        </span>
                        <ChevronRight
                          className="size-4 shrink-0 text-muted"
                          aria-hidden
                        />
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>

              <Button
                variant="secondary"
                disabled={full}
                onClick={() => {
                  setError(null);
                  setMode("add");
                }}
              >
                <UserPlus className="size-4" aria-hidden />
                {full ? "This group is full" : "Add people"}
              </Button>

              <div className="flex flex-col gap-2 border-t border-border pt-4">
                <p className="text-xs text-muted">
                  Everyone else keeps the chat and its history. You just stop
                  hearing about it.
                </p>
                <Button
                  variant="danger-ghost"
                  disabled={leaving}
                  onClick={() => void handleLeave()}
                >
                  {leaving ? (
                    <Loader2 className="size-4 animate-spin" aria-hidden />
                  ) : (
                    <LogOut className="size-4" aria-hidden />
                  )}
                  Leave group
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
