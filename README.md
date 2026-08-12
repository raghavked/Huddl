# Huddl

**Your campus, in one huddle.** Huddl is an all-in-one communication platform for
college students — realtime course and campus channels with a
community-first, campus-by-campus operating model. Huddl is its own
standalone platform: every room, thread, and notification is built in-house
on our own backend.

Every account is verified with a university email, so each campus is a real,
closed community. Courses are **fully user-managed**: students add their own
classes, and the campus course catalog autocompletes codes and titles as they
type. Adding a class opens its chat channel automatically — the first student
in creates it for everyone who follows, and dropping a class quietly removes
you. Student organizations and clubs get dedicated spaces with their own chat,
roster and events.

## Features

### Your campus

- **University-verified communities** — sign up with your school email
  (launching at UC Davis, then the UC system, then CSUs)
- **Campus channels** — general, study-buddies, campus-events, asks-and-offers
  on every campus, plus student-created topic channels and a browsable directory
- **Campus search** — people, channels, courses, clubs and events in one query,
  with your recent searches kept on-device
- **The campus board** — rides home for break, a lost water bottle, a couch
  that needs a new apartment, a tutor: seven boards, closable rather than
  deletable so a post that got what it wanted stays readable
- **Profiles & people directory** — majors, grad years, shared courses, photos,
  an optional phone-verification trust badge, and what you're into: interests
  you can filter the directory by, plus a line about what you're looking for

### Your classes

- **Course homes** — six doorways per class: calendar, rooms, flashcards,
  pinned links, grades, and study partners
- **Course rooms** — a main chat plus student-created rooms for lectures,
  discussion, study groups, notes
- **Class calendar + syllabus import** — paste a syllabus, preview the
  parsed dates on-device, and the whole class gets the calendar; new exams
  and due dates notify every classmate
- **Course details, kept up by the class** — instructor, meeting times,
  location, and pinned links (syllabus, textbook, office hours)
- **Weekly series** — one entry for a lab that meets every Tuesday, expanded
  across the term and editable as a set
- **Your own reminders** — pick the lead time per due date, from fifteen
  minutes to two weeks out
- **Personal study plan** — private check-offs over the shared calendars,
  grouped by urgency, with recommended study blocks before every exam
- **Course colours** — assign each class a tint and it carries across the
  calendar, the plan and the hubs
- **Semester overview** — the whole term on one screen, with a GPA estimate
  that tells you when it isn't weighted rather than guessing at your units
- **Archive a finished class** — shelve it without dropping it; the chat and
  notes stay put, and the shelf groups by term

### Study tools

- **Shared flashcard decks** — any classmate adds cards, with a three-button
  spaced-repetition study mode and private per-student review state
- **Paste-import for decks** — paste a study guide, get cards
- **Focus sessions** — set a goal, start a timer, and see who else on campus
  is studying right now
- **Private grade tracker** — weighted categories, a course estimate rescaled
  by what's actually been graded, and what-if targets; visible only to you
- **Study buddies** — opt in per course with a note, find the classmates who
  did the same, message them in a tap
- **Note sharing** — per-course files with uploader credit, signed downloads,
  tags to find them by, and a thanks the uploader actually feels

### Talking

- **Chat power** — image attachments, polls with live results, @mentions,
  pinned messages, edits, threads, reactions, typing indicators, in-room search
- **Direct messages** — 1:1 threads with read state and presence
- **Group DMs** — name a thread, add classmates, leave when you're done
- **Saved messages** — private bookmarks on any message, with a shelf to read
  them back
- **Forwarding** — pass a message to another room or a classmate, with the
  original author still credited
- **Availability polls** — propose a few times, everyone taps the ones that
  work, and the winner is obvious
- **Write while offline** — drafts survive leaving the room, and a message
  sent with no signal queues and goes out when there is one
- **Device push, on your terms** — DMs, mentions, replies, class dates and
  events reach the phone, with per-kind toggles, quiet hours, a digest that
  sends one push instead of twelve, and a weekly digest

### Clubs, events, and your week

- **Clubs & organizations** — found a club, get a chat channel + roster +
  events board; open joining, officer roles
- **Club announcements** — officers post to the whole club; everyone gets told
- **Study sessions & meetups** — events with RSVPs, capacity, course/club
  links, reminders about an hour out, and calendar export
- **Your calendar** — one month view merging class due dates with the events
  you've said yes to

### Made to live in

- **The hearth design language** — warm cream and espresso, an ember that
  glows rather than shouts, a candle-lit dark theme, hand-drawn marks where a
  lesser app would put a spinner (`docs/DESIGN.md`)
- **Display preferences** — light, dark or system, plus a text size that every
  screen respects
- **A real first run** — a three-panel welcome and a starter checklist that
  ticks over as you go

### Safe by default

- **Safety built in** — blocking, categorized reporting on messages, people
  and board posts with a 24-hour review promise, server-side rate limits, and
  in-app account deletion
- **A real moderation queue** — campus moderators triage reports in-app, with
  the reported content in front of them; the flag is a service-role write, so
  nobody can promote themselves
- **Privacy by design** — campus-scoped visibility with RLS on every table;
  audited storage events generate user-facing notifications, enforced by
  database triggers
- **Reciprocal privacy toggles** — turn off read receipts or typing indicators
  and you stop seeing them too, which is the only version that's honest
- **Take your data with you** — one tap exports everything Huddl holds that's
  yours as a single JSON document, the other half of the deletion promise

## Stack

- [Next.js 15](https://nextjs.org) (App Router) + TypeScript + Tailwind CSS 4,
  shipped as a **mobile-exclusive PWA** — one phone-width experience at every
  viewport, installable from the home screen; type is Bricolage Grotesque
  (display) + Plus Jakarta Sans (body) via `next/font`
- [Supabase](https://supabase.com): Auth (email verification), Postgres with
  row-level security on every table, Realtime, Storage
- Vitest for unit tests

## Getting started

1. Create a Supabase project and run each file in `supabase/migrations/` in
   order, then `supabase/seed.sql` (SQL editor or `supabase db push`).
2. `cp .env.example .env.local` and fill in the project URL and publishable
   key. No other service is needed to run the app locally.
3. **Supabase auth configuration** — in the Supabase dashboard (Authentication →
   URL Configuration) set the **Site URL** to your `${SITE_URL}` and add both
   `${SITE_URL}/auth/confirm` and `${SITE_URL}/auth/callback` to the redirect
   allowlist so email confirmation (PKCE `?code=` links) and OAuth callbacks
   resolve correctly.
4. Install and run:

```bash
npm install
npm run dev
```

Checks: `npm run build && npm run lint && npm test`.

## Repository layout

The repo holds two clients over one Supabase backend: the Next.js
mobile-exclusive PWA at the root, and the native Expo app (App Store /
Play Store track) in `mobile/` — see `mobile/README.md` for running it.

```
supabase/migrations/  Full schema: tables, RLS policies, triggers, RPCs
supabase/seed.sql     Universities + default campus channels (no sample content)
src/app/              App Router routes: (auth), (app) shell, marketing landing
src/features/         Feature modules (chat, dm, clubs, events, notes,
                      flashcards, focus, grades, study, saved, schedule, ...)
src/lib/              Shared contracts: types, supabase clients, auth, utils
src/components/ui/    Hearth primitives (button, card, field, badge, headers)
src/components/shell/ App shell: mobile top bar + dock
src/components/       Shared UI (avatar, empty state, illustrations, logo)
mobile/               The native Expo app — its own toolchain, same backend
docs/                 DESIGN.md (the design language), UI.md (its web side),
                      brand guide, operations playbook, legal + store kits
```

## Operating model

Huddl launches campus-by-campus (density before breadth): UC Davis first, then
the rest of the UC system, then CSUs. See `docs/OPERATIONS.md` for the launch
playbook and revenue model, and `docs/BRAND.md` for the brand system.
