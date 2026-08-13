# Huddl legal layer

Three documents, written specifically for Huddl (campus communities, university-email
verification, user-entered course data, user-generated content, Supabase-hosted
storage, no ads, no data sale):

| Document | Updated | Covers |
| --- | --- | --- |
| Terms of Service | August 2026 | Eligibility (16+, enrolled at or affiliated with a supported university), account rules, content ownership and license, DMCA notice-and-takedown and repeat-infringer termination, enforcement, independence from universities, account deletion, liability and indemnity, governing law, changes |
| Privacy Policy | August 2026 | What we collect and what we never collect, the private-to-you data (grade estimator, blocks, saved messages, review history), campus-scoped visibility, Supabase hosting in us-west-2 and transfers out of the UK and EU, sharing (service providers only: Supabase hosting, Expo push delivery), retention periods, GDPR and CCPA rights, in-app deletion, age (16+), changes |
| Community Guidelines | August 2026 | Harassment, hate, impersonation, spam/scams, sexual content, self-harm response (988 lifeline), academic honesty, privacy of others, enforcement, how to report |

> **Status: launch drafts pending attorney review before public launch.**
> This note lives only in this file; it never appears in app UI. Wording
> changes from counsel should be applied to both copies listed below.

## Where the documents live

The copy exists in exactly two places, and they must stay identical:

- **Native (source of truth):** `mobile/src/lib/legal-content.ts`, which exports
  `TERMS_OF_SERVICE`, `PRIVACY_POLICY`, `COMMUNITY_GUIDELINES`, each a
  `LegalDoc` (`{ title, updated, sections: { heading, body }[] }`).
  - Screens: `mobile/src/app/legal/terms.tsx`, `privacy.tsx`,
    `guidelines.tsx`: pushed screens at routes `/legal/*` (back chevron,
    title, updated line, sections). The guidelines screen ends with the
    "Report it" section rendered as a card: long-press → Report, and
    Settings → Blocked people.
  - Entry points: signup caption links to `/legal/terms` and
    `/legal/privacy`; Settings → "Community guidelines" links to
    `/legal/guidelines`.
- **Web (duplicated strings):** `src/app/legal/content.ts`. The web tsconfig
  cannot import from `mobile/`, so the strings are duplicated verbatim; both
  files carry a comment saying so. Any wording change is a two-file change,
  and `src/app/legal/content.test.ts` now fails the build if only one side
  gets it. That test exists because the two copies *had* silently come apart:
  the native text had been revised to disclose the public avatar link, the
  survival of a forwarded message, and the one-way nature of a block, while
  the web privacy policy still told students that someone they blocked
  "can't message you or see your posts", a sentence whose second half was
  never true on either client.
  - Pages: `src/app/legal/terms/page.tsx`, `privacy/page.tsx`,
    `guidelines/page.tsx`: public server components (not in the middleware's
    protected prefixes) sharing the shell in `src/app/legal/legal-page.tsx`,
    with per-page metadata titles.

## Acceptance mechanics

- **The act:** both signup screens show, under the create-account button:
  *"By creating an account you agree to our Terms of Service and Privacy
  Policy."* with working links (native: `router.push` to `/legal/*`; web:
  `<Link>`). There is no checkbox; creating the account is the agreement.
- **The record:** `profiles.accepted_terms_at` (added in migration
  `0020_trust_legal_rate_limits.sql`) is stamped with
  `new Date().toISOString()` when onboarding saves the profile:
  - native: the `patch` object in `mobile/src/app/onboarding.tsx`
  - web: the `.update()` payload in `src/features/auth/onboarding-form.tsx`
- **Known gap:** both onboarding flows have a "Skip for now" path that
  bypasses the profile save, so a skipper's `accepted_terms_at` stays null
  until their next profile save. The signup caption remains the operative
  act of agreement; the timestamp is evidence, not the agreement itself.

## Moderation promises the documents make

These are commitments in user-facing legal copy, and product and ops must
keep them true:

- **In-app reporting with categories** on any message or profile. Categories
  match the live `reports.category` check constraint (migration 0020):
  harassment, spam, hate, impersonation, sexual_content, self_harm,
  academic_dishonesty, other.
- **Human review of every report**, aimed at within a day, with safety
  reports taken first. This was an unconditional "within 24 hours" in all
  three documents and in the report screen. It was changed because it is a
  binding promise to users and a representation to Apple, and a volunteer
  student moderator queue cannot guarantee a deadline. If the report screen's
  confirmation copy is edited, it has to keep saying the weaker true thing.
- **Blocking:** instant and silent, managed under Settings → Blocked people.
  It is **one-way, not mutual**, and the copy has to keep saying so. What a
  block does: no new DM thread can be opened in either direction
  (`is_blocked_either`, 0019), their notifications to you are silenced, and
  since 0042 their direct messages are dropped from your reads by the
  `dm_messages` SELECT policy. What it deliberately does not do: refuse their
  send, or hide *your* messages from *them*. Both would tell them they'd been
  blocked, which is the one thing all three documents promise never happens.
  Their other content (channel messages, board posts) is filtered by the
  clients off the block list.
- **Removal and bans:** content removal, warnings, suspension, or permanent
  ban for violations; immediate ban for hate, threats, or sexualizing minors.
- **Rate limits:** the docs mention "gentle rate limits", backed by the
  posting and reporting limits in migration 0020.
- **In-app account deletion that wipes data:** Settings → Delete account
  calls `delete_own_account()` (migration 0021), which sweeps the user's
  storage folders (avatars, notes, schedules, chat-uploads) and deletes the
  auth user, cascading through profiles to every table. The docs describe
  this as immediate and permanent with no archive. Keep it that way.
  **What it deliberately does not erase**, and the Privacy Policy now says
  so: twelve foreign keys onto `profiles` are `ON DELETE SET NULL` rather
  than `CASCADE`, so shared artefacts outlive the account with the author's
  name taken off: `decks`, `cards`, `course_calendar_items`, `course_links`,
  `club_announcements`, `clubs`, `channels`, `dm_threads.created_by`,
  `messages.pinned_by`, `reports.reported_user_id`, and the two
  `forwarded_author_id` columns. That is the right design (deleting an
  account should not empty a study group's deck or wipe a deadline off
  everyone else's calendar) but it is a disclosure, not a detail. If a future
  migration changes one of these to `CASCADE`, or adds a new `SET NULL`
  reference, the "Leaving Huddl" and "Deleting your data" sections have to
  move with it. Query to re-derive the list:

  ```sql
  select c.conrelid::regclass, a.attname, c.confdeltype
  from pg_constraint c
  join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
  where c.contype = 'f' and c.confrelid = 'public.profiles'::regclass
    and c.confdeltype <> 'c';
  ```

## Other factual claims to keep true

- No ads, and student data is never sold.
- No integration with university systems; course data is entered by users.
- Everything posted is campus-scoped and unreachable from the open internet,
  **with one disclosed exception**: the `avatars` bucket is public, because a
  profile photo is fetched by URL with no session. The Privacy Policy names
  it. Changing or removing a photo empties the whole folder
  (`src/lib/avatar-storage.ts`, and the native twin in `account.tsx`) so that
  "removing your photo deletes the file" stays true. Before that, the web
  uploader wrote a new timestamped key each time and never removed the last,
  leaving every photo a student had ever set live at its own public URL.
- Push tokens are stored only for notification delivery and can be turned off.
- **The verified badge: no phone, no SMS, no third party.** Migration 0047
  retired the phone badge and replaced it with one earned from things Huddl
  already holds: a confirmed university email plus a complete profile
  (`profile_is_complete`: display name distinct from the auto-generated
  handle, photo, major, graduation year). `profiles.verified_at` is recomputed
  by a trigger on every profile write and on email confirmation, is outside
  the authenticated UPDATE grant, and so cannot be self-awarded. The old
  apparatus is gone: `phone_verifications`, `has_verified_phone()` and
  `profiles.phone_verified_at` were dropped, and no phone number is collected
  or shared with anyone. **Supabase and Expo are now the only two
  processors.** If that ever changes, the "When we share" sentence changes
  with it.
  The badge's honesty depends on email confirmation actually working, which
  depends on custom SMTP (docs/OPERATIONS.md §3c) being configured.
- **Group DMs.** Threads hold 3–16 people (`create_group_thread`, 0028). The
  documents used to say a direct message could "only ever be read by the two
  people in it", which was false of every group thread and was also on the
  marketing FAQ. All three now describe thread participants instead.
- Contact address used throughout: **hello@huddl.app**. This mailbox must
  exist and be monitored before launch.
- The guidelines reference the 988 Suicide & Crisis Lifeline (US).

## Pre-launch checklist

- [ ] Attorney review of all three documents (both copies updated in sync)
- [ ] hello@huddl.app mailbox live and monitored
- [ ] 24-hour report-review rotation actually staffed
- [x] `/legal/*` in `src/app/sitemap.ts`: done. The sitemap and robots.txt
      are both built from `src/lib/protected-routes.ts`, so a page cannot be
      advertised in one and forbidden in the other
- [x] **In-app reporting with categories, on both clients.** Closed. The web
      report form used to file every report with no `category` at all, so
      everything a browser sent reached the queue as "Something else"; a
      direct message and a profile could not be reported from the web; and
      the web moderation queue never called `reported_content`, so a
      moderator in a browser was asked to judge words they could not read.
      All four web surfaces (channel message, direct message, profile, board
      post) now file one of the eight categories from
      `src/lib/moderation.ts`, which is the single list the check constraint,
      the queue and every picker read
