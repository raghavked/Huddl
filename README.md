# Huddl

**Your campus, in one huddle.** Huddl is an all-in-one communication platform for
college students — Discord-style course and campus channels with a
community-first, campus-by-campus operating model.

Every account is verified with a university email, so each campus is a real,
closed community. Course enrollment drives channel membership automatically:
connect **Canvas by Instructure** and your course channels appear, or upload a
picture of your schedule (processed **on your device**, with a notification
audit trail if you choose to store it), or pick courses manually. Student
organizations and clubs get Band-style spaces with their own chat, roster and
events.

## Features

- **University-verified communities** — sign up with your school email
  (launching at UC Davis, then the UC system, then CSUs)
- **Course channels** — auto-created and auto-joined from Canvas sync,
  schedule-image confirm, or manual picking
- **Campus channels** — general, study-buddies, campus-events, asks-and-offers
  on every campus, plus student-created topic channels
- **Clubs & organizations** — found a club, get a chat channel + roster +
  events board; open joining, officer roles
- **Real-time chat** — threads, reactions, edits, soft deletes (Supabase
  Realtime)
- **Direct messages** — 1:1 threads with read state and notifications
- **Note sharing** — per-course files with uploader credit and signed downloads
- **Study sessions & meetups** — events with RSVPs, capacity, course/club links
- **Public profiles & people directory** — majors, grad years, shared courses,
  optional phone-verification trust badge
- **Privacy by design** — schedule images OCR'd in-browser; every storage or
  access event generates a user-facing notification, enforced by database
  triggers

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
