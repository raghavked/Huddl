# Huddl legal layer

Three documents, written specifically for Huddl (campus communities, university-email
verification, user-entered course data, user-generated content, Supabase-hosted
storage, no ads, no data sale):

| Document | Updated | Covers |
| --- | --- | --- |
| Terms of Service | August 2026 | Eligibility (13+, enrolled at or affiliated with a supported university), account rules, content ownership and license, enforcement, independence from universities, account deletion, plain-words liability, changes |
| Privacy Policy | August 2026 | What we collect and what we never collect, campus-scoped visibility, Supabase hosting, sharing (service providers only — Supabase hosting, Expo push delivery), retention and in-app deletion, age, changes |
| Community Guidelines | August 2026 | Harassment, hate, impersonation, spam/scams, sexual content, self-harm response (988 lifeline), academic honesty, privacy of others, enforcement, how to report |

> **Status: launch drafts pending attorney review before public launch.**
> This note lives only in this file — it never appears in app UI. Wording
> changes from counsel should be applied to both copies listed below.

## Where the documents live

The copy exists in exactly two places, and they must stay identical:

- **Native (source of truth):** `mobile/src/lib/legal-content.ts` — exports
  `TERMS_OF_SERVICE`, `PRIVACY_POLICY`, `COMMUNITY_GUIDELINES`, each a
  `LegalDoc` (`{ title, updated, sections: { heading, body }[] }`).
  - Screens: `mobile/src/app/legal/terms.tsx`, `privacy.tsx`,
    `guidelines.tsx` — pushed screens at routes `/legal/*` (back chevron,
    title, updated line, sections). The guidelines screen ends with the
    "Report it" section rendered as a card: long-press → Report, and
    Settings → Blocked people.
  - Entry points: signup caption links to `/legal/terms` and
    `/legal/privacy`; Settings → "Community guidelines" links to
    `/legal/guidelines`.
- **Web (duplicated strings):** `src/app/legal/content.ts` — the web tsconfig
  cannot import from `mobile/`, so the strings are duplicated verbatim; both
  files carry a comment saying so. Any wording change is a two-file change.
  - Pages: `src/app/legal/terms/page.tsx`, `privacy/page.tsx`,
    `guidelines/page.tsx` — public server components (not in the middleware's
    protected prefixes) sharing the shell in `src/app/legal/legal-page.tsx`,
    with per-page metadata titles.

## Acceptance mechanics

- **The act:** both signup screens show, under the create-account button:
  *"By creating an account you agree to our Terms of Service and Privacy
  Policy."* with working links (native: `router.push` to `/legal/*`; web:
  `<Link>`). There is no checkbox — creating the account is the agreement.
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

These are commitments in user-facing legal copy — product and ops must keep
them true:

- **In-app reporting with categories** on any message or profile. Categories
  match the live `reports.category` check constraint (migration 0020):
  harassment, spam, hate, impersonation, sexual_content, self_harm,
  academic_dishonesty, other.
- **Human review within 24 hours** of every report. (Also promised in the
  report screen's confirmation copy — the docs and the app agree.)
- **Blocking:** instant, silent, mutual invisibility (`blocks` +
  `is_blocked_either`, migration 0019), managed under Settings → Blocked
  people.
- **Removal and bans:** content removal, warnings, suspension, or permanent
  ban for violations; immediate ban for hate, threats, or sexualizing minors.
- **Rate limits:** the docs mention "gentle rate limits" — backed by the
  posting and reporting limits in migration 0020.
- **In-app account deletion that wipes data:** Settings → Delete account
  calls `delete_own_account()` (migration 0021), which sweeps the user's
  storage folders (avatars, notes, schedules, chat-uploads) and deletes the
  auth user, cascading through profiles to every table. The docs describe
  this as immediate and permanent with no archive — keep it that way.

## Other factual claims to keep true

- No ads, and student data is never sold.
- No integration with university systems; course data is entered by users.
- Everything posted is campus-scoped; nothing is public to the open internet.
- Push tokens are stored only for notification delivery and can be turned off.
- Contact address used throughout: **hello@huddl.app** — this mailbox must
  exist and be monitored before launch.
- The guidelines reference the 988 Suicide & Crisis Lifeline (US).

## Pre-launch checklist

- [ ] Attorney review of all three documents (both copies updated in sync)
- [ ] hello@huddl.app mailbox live and monitored
- [ ] 24-hour report-review rotation actually staffed
- [ ] Consider adding `/legal/*` to `src/app/sitemap.ts`
