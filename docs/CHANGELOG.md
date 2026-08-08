# Huddl development log

## Round 8 — chat power, trust, and the legal layer

Nine agents over four live migrations (0019–0022, plus the 0023
performance sweep):

- **Chat power, both clients**: image attachments in channels and DMs
  (private `chat-uploads` bucket, signed URLs, lightbox/full-screen
  viewers), polls that live in the message stream (single vote, live
  results over realtime, creator close), @mentions with composer
  autocomplete + server-trigger notifications, pinned messages (any
  member, via RPC), and message edit/delete on native.
- **Device push**: `push_tokens` per device; a pg_net trigger fans every
  notification row out to Expo's push API. Native registers on sign-in,
  routes notification taps by link, and has a push-settings screen.
- **Safety**: blocking end to end (server-guarded DMs, muted
  notifications, client filtering everywhere, blocked-people list),
  categorized reporting (8 categories, 24-hour review promise),
  server-side rate limits (30 messages/min, 10 reports/hour), and
  in-app account deletion (`delete_own_account`, storage swept).
- **Legal**: Terms of Service, Privacy Policy, and Community Guidelines
  written for Huddl specifically, rendered in both clients from one
  content source, linked at signup, acceptance stamped at onboarding
  (`accepted_terms_at`); docs/LEGAL.md tracks the attorney-review
  checklist.
- **Events grow up**: native event creation (study session / meetup,
  optional course link), course homes list upcoming study sessions and
  announce new ones in the course chat; profile photos upload to the
  avatars bucket with a shared Avatar component.
- **Web parity**: rooms, class calendar, syllabus import, and the study
  plan as web pages (ported pure libs + 28 new tests); attachments,
  polls, mentions, pins, and block filtering in web chat.
- **Security/perf sweep**: trigger functions revoked off the RPC surface,
  all 53 RLS policies rewritten to evaluate `auth.uid()` once per
  statement, hot-path FK indexes added. Remaining advisor item for the
  dashboard: enable leaked-password protection (Auth setting).

Verification: mobile strict tsc + iOS Hermes export (3.8 MB); web tsc,
ESLint, 95 Vitest tests, production build with the new
rooms/calendar/syllabus/plan/legal routes.

## Round 7 — the study layer, and courses become homes

Two fleets on top of a live-backend round (migrations 0016–0018 applied
to production Supabase):

- **User-managed courses with catalog autocomplete**: `catalog_courses` /
  `catalog_offerings` seeded with 95 real UC Davis courses (142 term
  rows) from the registrar/catalog sources; `search_catalog` typeahead
  and a relaxed `enroll_from_catalog` — the catalog suggests, it never
  gates. Students add, edit, and drop courses entirely themselves; the
  Canvas connector and schedule-photo OCR are deleted from the web app
  (routes, features, API, tesseract.js dependency), and all product copy
  is rewritten for the user-owned model.
- **Course rooms**: many channels per course via `channels.is_main` and
  the `create_course_room` RPC — Lectures, Discussion, Study group,
  Notes, or custom rooms; the native Channels tab groups rooms under
  their course, and every course home has a Rooms doorway.
- **Class calendar + syllabus import**: shared `course_calendar_items`
  (RLS-scoped to classmates) with an on-device syllabus parser
  (`mobile/src/lib/syllabus.ts`) — paste text, preview and edit the
  found dates, land them in one batch; only an item-count audit row is
  stored. Hand-added exams/due dates notify every classmate via a
  database trigger.
- **Study plan**: private `study_checkoffs` over the shared calendars;
  `/plan` groups Overdue / Today / Tomorrow / This week / Later, adds
  recommended study blocks 7/3/1 days before exams, and a plan card on
  Home always knows what's next.
- **Notifications center**: `/notifications` with realtime inserts,
  mark-read + deep links, unread bell badge on Home backed by a
  head-only count hook.

Verification: mobile strict tsc clean, iOS Hermes export (3.5 MB); web
tsc/ESLint clean, 39 Vitest tests, production build (Canvas/schedule
routes gone). Root ESLint now ignores `mobile/` (own toolchain), matching
the root tsconfig exclude.

## Round 6 — native app (App Store track)

New `mobile/` Expo app (SDK 57, expo-router, TypeScript strict) sharing
the same Supabase backend: hearth tokens and fonts ported natively,
AsyncStorage-persisted auth, five-tab shell, and real screens — home
feed, channels + realtime chat room with optimistic sends, messages +
DM room with unread dots, clubs with join, events with RSVP, settings
with sign-out. Verified by full iOS Hermes bundle export. App identity
app.huddl.mobile; EAS build/submit are the remaining user-side steps.

## Round 5 — mobile-exclusive

Huddl is a mobile app, full stop: the desktop sidebar is gone, every
viewport gets the phone shell, and on larger screens the app renders as a
centered phone-width column with soft edges. Chat/DM room heights and
loading ghosts follow the single-shell math.

## Round 4 fleet — live-feeling features

- **Typing indicators** in channels and DMs (Realtime broadcast, throttled,
  TTL-pruned, layout-stable) and **presence** (online dot on the DM header).
- **In-channel message search**: header trigger + inline panel, debounced
  ilike query scoped by RLS, escaped metacharacters.
- **Content reporting**: `reports` table (migration 0015, reporter-scoped
  RLS, service-role triage), server action, and a Report action with a
  two-tap reason picker on others' messages.
- **Add to calendar**: RFC 5545 `.ics` route (escaping, UTC, line folding)
  plus a quiet secondary button on the event page.

A running record of the major development rounds on the
`claude/huddl-ui-development` line. Verification for every round: TypeScript
strict, ESLint, the Vitest suite, and a production build; visual rounds also
ship rendered screenshots in both themes.

## v3 — "hearth" (current)

The homey revision, guided by impeccable's craft-floor rules and the
ui-ux-pro-max checklists (both vendored from source and applied by hand):

- **Palette**: warm cream paper + espresso ink, ember/terracotta primary
  with clay softs, fern accent, candle-lit dark theme (warm browns, not
  blue-black). Every pair AA-checked in both themes.
- **De-AI pass**: gradient text and gradient utilities retired; the
  eyebrow/kicker pattern removed app-wide (PageHeader no longer has the
  prop); sparkle motifs replaced with hand-drawn steam curls, crumb dots,
  and stitch dashes; no gray text on colored surfaces (unread rows tint
  from the surface hue); browser surfaces themed (caret-color,
  accent-color, scrollbars, selection).
- **Landing**: gradient hero replaced with a hand-drawn ember underline;
  section kickers deleted; closing CTA is one calm ember panel.

## Round 3 fleet — features

- **Cmd+K quick switcher** (`src/features/search`): navigate anywhere,
  jump to your channels, find campus people; full combobox semantics.
- **Unread DM badges**: `unread_dm_thread_count()` RPC (migration 0014,
  security-invoker, hardened) feeding the sidebar badge and dock dot.
- **SEO & sharing**: robots, sitemap, OpenGraph/Twitter card images via
  `next/og`, `metadataBase` + social metadata.
- **Tests**: 51 → 80 (time-format branches under fake timers, file-size
  seams, phone normalization, avatar tone determinism).
- **A11y**: audit + 16 files of attribute-level fixes (role=log feeds,
  named form landmarks, live regions, honest disclosure semantics).

## Round 2 fleet — app surfaces

- Branded 404, client error boundary, dependency-free global-error.
- 15 route-level `loading.tsx` skeletons mirroring real layouts
  (chat/DM ghosts replicate the full-height composition exactly).
- Illustration scenes wired into seven marquee empty states.

## v2 → v2.1 — UI system

- Design tokens with soft elevation, motion, and glass; component library
  (`src/components/ui/`); all-new shell (desktop sidebar, mobile glass
  top bar + floating dock); theme toggle (light/system/dark, no-flash
  boot, browser-chrome sync); every screen reskinned on the primitives.
- Type system: Bricolage Grotesque display over Plus Jakarta Sans body
  (open-source via `next/font`) — which surfaced and fixed a latent bug
  where body text silently fell back to system fonts.
- Contrast + consistency audit rounds with computed WCAG ratios.

## Backend

- Live Supabase project (all 14 migrations applied, seeded demo campus).
- Demo login for previews: `alex.rivera@ucdavis.edu` / `huddl-demo-2026`.
