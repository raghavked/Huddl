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

- **University-verified communities** — sign up with your school email
  (launching at UC Davis, then the UC system, then CSUs)
- **Course homes with rooms** — every course opens a main chat plus
  student-created rooms: lectures, discussion, study groups, notes
- **Class calendar + syllabus import** — paste a syllabus, preview the
  parsed dates on-device, and the whole class gets the calendar; new exams
  and due dates notify every classmate
- **Personal study plan** — private check-offs over the shared calendars,
  grouped by urgency, with recommended study blocks before every exam
- **Chat power** — image attachments, polls with live results, @mentions,
  pinned messages, edits, threads, reactions, typing indicators
- **Device push** — DMs, mentions, replies, and class dates reach the
  phone via Expo push, fanned out by a database trigger
- **Safety by default** — blocking, categorized reporting with a 24-hour
  review promise, server-side rate limits, and in-app account deletion
- **Campus channels** — general, study-buddies, campus-events, asks-and-offers
  on every campus, plus student-created topic channels
- **Clubs & organizations** — found a club, get a chat channel + roster +
  events board; open joining, officer roles
- **Direct messages** — 1:1 threads with read state, presence, and
  notifications
- **Note sharing** — per-course files with uploader credit and signed downloads
- **Study sessions & meetups** — events with RSVPs, capacity, course/club links
- **Public profiles & people directory** — majors, grad years, shared courses,
  optional phone-verification trust badge
- **Privacy by design** — campus-scoped visibility with RLS on every table;
  audited storage events generate user-facing notifications, enforced by
  database triggers

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
   key. Phone verification runs in `stub` mode without Twilio credentials.
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
src/features/         Feature modules (auth, chat, dm, clubs, events, notes, ...)
src/lib/              Shared contracts: types, supabase clients, auth, utils
src/components/ui/    UI v2 primitives (button, card, field, badge, headers)
src/components/shell/ App shell: desktop sidebar, mobile top bar + dock
src/components/       Shared UI (avatar, empty state, logo, theme toggle)
docs/                 Brand guide, UI v2 design system, operations playbook
```

## Operating model

Huddl launches campus-by-campus (density before breadth): UC Davis first, then
the rest of the UC system, then CSUs. See `docs/OPERATIONS.md` for the launch
playbook and revenue model, and `docs/BRAND.md` for the brand system.
