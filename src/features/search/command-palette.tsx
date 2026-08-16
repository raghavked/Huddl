"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Bell,
  CalendarDays,
  GraduationCap,
  Home,
  LayoutGrid,
  MessageCircle,
  Search,
  Settings,
  UserRound,
  Users,
  UsersRound,
  type LucideIcon,
} from "lucide-react";
import { Avatar } from "@/components/avatar";
import { RoomTile } from "@/components/room-tile";
import { controlClasses } from "@/components/ui";
import { roomKindLabel, roomTitle } from "@/lib/room-identity";
import { cn } from "@/lib/utils";
import {
  usePaletteData,
  type PaletteChannel,
  type PalettePerson,
} from "./use-palette-data";

/** Dispatch this event on `window` to open the palette from anywhere. */
export const OPEN_PALETTE_EVENT = "hearth:open-palette";

const KBD =
  "inline-flex h-5 min-w-5 items-center justify-center rounded-md border border-border bg-surface-2 px-1.5 font-mono text-[10px]";

type GotoPage = { label: string; href: string; icon: LucideIcon };

/* Same destinations and icons as the sidebar, flattened for quick jumps. */
const GOTO_PAGES: GotoPage[] = [
  { label: "Home", href: "/home", icon: Home },
  { label: "Channels", href: "/channels", icon: LayoutGrid },
  { label: "Messages", href: "/messages", icon: MessageCircle },
  { label: "Courses", href: "/courses", icon: GraduationCap },
  { label: "Clubs", href: "/clubs", icon: UsersRound },
  { label: "Events", href: "/events", icon: CalendarDays },
  { label: "People", href: "/people", icon: Users },
  { label: "Friends", href: "/friends", icon: UserRound },
  { label: "Notifications", href: "/notifications", icon: Bell },
  { label: "Settings", href: "/settings", icon: Settings },
];

type PaletteItem =
  | { type: "page"; key: string; href: string; page: GotoPage }
  | { type: "channel"; key: string; href: string; channel: PaletteChannel }
  | { type: "person"; key: string; href: string; person: PalettePerson };

type PaletteSection = { label: string; start: number; items: PaletteItem[] };

function isEditableTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  const tag = target.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

function hasMatch(haystacks: (string | null)[], query: string): boolean {
  return haystacks.some((h) => h?.toLowerCase().includes(query));
}

/**
 * Cmd+K quick switcher. Mount once in the app shell. It listens globally,
 * renders nothing while closed, and fetches its channel/people data the first
 * time it opens.
 */
export function CommandPalette() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const navSourceRef = useRef<"keyboard" | "pointer">("keyboard");
  const { channels, people } = usePaletteData(open);

  // Cmd+K / Ctrl+K toggles; the custom window event opens it from anywhere.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k")
        return;
      if (open) {
        event.preventDefault();
        setOpen(false);
        return;
      }
      if (isEditableTarget(event.target)) return;
      event.preventDefault();
      setOpen(true);
    }
    const handleOpen = () => setOpen(true);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener(OPEN_PALETTE_EVENT, handleOpen);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener(OPEN_PALETTE_EVENT, handleOpen);
    };
  }, [open]);

  // Fresh state and a scroll-locked page each time it opens.
  useEffect(() => {
    if (!open) return;
    setQuery("");
    setActiveIndex(0);
    navSourceRef.current = "keyboard";
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [open]);

  const { sections, flat } = useMemo(() => {
    const q = query.trim().toLowerCase();
    const pages = q
      ? GOTO_PAGES.filter((p) => p.label.toLowerCase().includes(q))
      : GOTO_PAGES;
    const channelHits = q
      ? channels.filter((c) =>
          hasMatch([c.slug, c.name, c.courseCode, c.courseTitle], q)
        )
      : channels.slice(0, 5);
    const personHits = q
      ? people.filter((p) => hasMatch([p.displayName, p.handle], q))
      : [];

    const sections: PaletteSection[] = [];
    const flat: PaletteItem[] = [];
    const push = (label: string, items: PaletteItem[]) => {
      if (items.length === 0) return;
      sections.push({ label, start: flat.length, items });
      flat.push(...items);
    };
    push(
      "Go to",
      pages.map(
        (page): PaletteItem => ({
          type: "page",
          key: `page-${page.href.slice(1)}`,
          href: page.href,
          page,
        })
      )
    );
    push(
      "Your rooms",
      channelHits.map(
        (channel): PaletteItem => ({
          type: "channel",
          key: `channel-${channel.id}`,
          href: `/channels/${channel.id}`,
          channel,
        })
      )
    );
    push(
      "People",
      personHits.map(
        (person): PaletteItem => ({
          type: "person",
          key: `person-${person.id}`,
          href: `/u/${person.handle}`,
          person,
        })
      )
    );
    return { sections, flat };
  }, [query, channels, people]);

  // Selection resets on a new query and clamps if the list shrinks under it.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);
  useEffect(() => {
    setActiveIndex((i) => (i >= flat.length ? 0 : i));
  }, [flat.length]);

  // Keep the keyboard-selected option in view (never fight the mouse).
  useEffect(() => {
    if (!open || navSourceRef.current !== "keyboard") return;
    listRef.current
      ?.querySelector('[aria-selected="true"]')
      ?.scrollIntoView({ block: "nearest" });
  }, [open, activeIndex, flat]);

  const go = useCallback(
    (href: string) => {
      setOpen(false);
      router.push(href);
    },
    [router]
  );

  if (!open) return null;

  const activeItem = flat[activeIndex];
  const activeOptionId = activeItem
    ? `palette-option-${activeItem.key}`
    : undefined;

  function handlePanelKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (flat.length === 0) return;
      navSourceRef.current = "keyboard";
      const delta = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((i) => (i + delta + flat.length) % flat.length);
      return;
    }
    if (event.key === "Enter") {
      if (event.nativeEvent.isComposing) return;
      event.preventDefault();
      if (activeItem) go(activeItem.href);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center px-4 pb-8 pt-24 md:pt-32">
      <div
        aria-hidden
        className="absolute inset-0 animate-fade-in bg-foreground/20"
        onClick={() => setOpen(false)}
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Quick search"
        onKeyDown={handlePanelKeyDown}
        className="relative flex w-full max-w-lg animate-scale-in flex-col overflow-hidden rounded-card bg-surface shadow-lift"
      >
        <div className="border-b border-border p-3">
          <div className="relative">
            <Search
              className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted"
              aria-hidden
            />
            <label htmlFor="palette-input" className="sr-only">
              Quick search
            </label>
            <input
              id="palette-input"
              type="text"
              role="combobox"
              aria-expanded="true"
              aria-controls="palette-results"
              aria-activedescendant={activeOptionId}
              aria-autocomplete="list"
              autoFocus
              autoComplete="off"
              spellCheck={false}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Jump to a page, channel, or classmate"
              className={controlClasses("pl-10")}
            />
          </div>
        </div>

        <div
          ref={listRef}
          id="palette-results"
          role="listbox"
          aria-label="Results"
          className="max-h-80 overflow-y-auto p-2"
        >
          {flat.length === 0 ? (
            <p className="px-3 py-8 text-center text-sm text-muted">
              No matches for &ldquo;{query.trim()}&rdquo;. Try a different
              page, channel, or name.
            </p>
          ) : (
            sections.map((section) => (
              <div key={section.label} role="group" aria-label={section.label}>
                <p
                  aria-hidden
                  className="px-3 pb-1 pt-2.5 text-[10px] font-bold uppercase tracking-widest text-muted/70"
                >
                  {section.label}
                </p>
                {section.items.map((item, offset) => {
                  const index = section.start + offset;
                  const active = index === activeIndex;
                  return (
                    <div
                      key={item.key}
                      id={`palette-option-${item.key}`}
                      role="option"
                      aria-selected={active}
                      className={cn(
                        "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium",
                        active
                          ? "bg-brand-soft text-brand-ink"
                          : "text-foreground"
                      )}
                      onMouseEnter={() => {
                        navSourceRef.current = "pointer";
                        setActiveIndex(index);
                      }}
                      onMouseDown={(event) => event.preventDefault()}
                      onClick={() => go(item.href)}
                    >
                      {item.type === "page" ? (
                        <>
                          <item.page.icon
                            className={cn(
                              "size-4 shrink-0",
                              active ? "text-brand" : "text-muted"
                            )}
                            aria-hidden
                          />
                          <span className="truncate">{item.page.label}</span>
                        </>
                      ) : item.type === "channel" ? (
                        <>
                          <RoomTile
                            kind={item.channel.kind}
                            name={item.channel.name}
                            slug={item.channel.slug}
                            size="sm"
                          />
                          <span className="truncate">
                            {roomTitle(item.channel.name, item.channel.slug)}
                          </span>
                          <span
                            className={cn(
                              "ml-auto shrink-0 text-xs font-normal",
                              active ? "text-brand-ink/70" : "text-muted"
                            )}
                          >
                            {item.channel.kind === "course" &&
                            item.channel.courseCode
                              ? item.channel.courseCode
                              : roomKindLabel(item.channel.kind)}
                          </span>
                        </>
                      ) : (
                        <>
                          <Avatar
                            name={item.person.displayName}
                            src={item.person.avatarUrl}
                            size="xs"
                          />
                          <span className="truncate">
                            {item.person.displayName}
                          </span>
                          <span
                            className={cn(
                              "ml-auto shrink-0 text-xs font-normal",
                              active ? "text-brand-ink/70" : "text-muted"
                            )}
                          >
                            @{item.person.handle}
                          </span>
                        </>
                      )}
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center gap-4 border-t border-border px-4 py-2.5 text-xs text-muted">
          <span className="flex items-center gap-1">
            <kbd className={KBD}>↑</kbd>
            <kbd className={KBD}>↓</kbd>
            <span className="ml-0.5">to navigate</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className={KBD}>↵</kbd>
            <span className="ml-0.5">to open</span>
          </span>
          <span className="flex items-center gap-1">
            <kbd className={KBD}>esc</kbd>
            <span className="ml-0.5">to close</span>
          </span>
        </div>
      </div>
    </div>
  );
}

/**
 * Faux search field that opens the palette. The coordinator drops this in the
 * sidebar and the mobile top bar; pass `className` to fit either spot.
 */
export function SearchTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      aria-keyshortcuts="Meta+K Control+K"
      onClick={() => window.dispatchEvent(new Event(OPEN_PALETTE_EVENT))}
      className={cn(
        "flex min-h-11 w-full items-center gap-2 rounded-full border border-border bg-surface-2 px-3.5 py-2 text-sm text-muted transition-colors hover:bg-surface-3 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand",
        className
      )}
    >
      <Search className="size-4 shrink-0" aria-hidden />
      <span className="flex-1 truncate text-left">Search</span>
      <kbd className={cn(KBD, "max-sm:hidden")} aria-hidden>
        ⌘K
      </kbd>
    </button>
  );
}
