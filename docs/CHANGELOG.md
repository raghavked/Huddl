# Huddl development log

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
