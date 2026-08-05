# Huddl UI v2 — design system reference

v2 keeps the huddl brand (campus coral, warm neutrals, sentence case, empty
states that recruit — see `BRAND.md`) and rebuilds the visual layer on top of
it: soft elevation instead of flat hairline boxes, a coral→sunset gradient
signature, frosted glass in the shell, and one motion curve everywhere.

Everything below ships from `src/app/globals.css` and `src/components/ui/`.

## Tokens

Color tokens are unchanged in spirit (see `BRAND.md` §4) with three additions:

- `brand-2` — sunset amber. **Gradients only** (`.bg-gradient-brand`,
  `.text-gradient-brand`); never a flat fill or text color on its own.
- `brand-fg` — dark brand *ink*, not white: the text/icon color on `bg-brand`
  and `.bg-gradient-brand` fills (AA on both gradient stops, both themes).
- `brand-ink` — readable brand-colored text on soft/neutral fills
  (`bg-brand-soft` chips, active nav, dock labels). Use it wherever coral
  *text* sits on a light fill; `text-brand` is for icons only there.
- `on-solid` — white foreground for saturated status fills
  (`bg-accent`/`bg-success`/`bg-danger` solids).

New non-color tokens:

| Utility | What it is |
| --- | --- |
| `shadow-soft` | Resting elevation for cards, buttons, pills |
| `shadow-lift` | Hover/floating elevation (docks, popovers, hover cards) |
| `rounded-card` | 1.25rem — the card radius |
| `animate-fade-up` | Entrance for page headers and hero content |
| `animate-fade-in` | Entrance for overlays/panels |
| `animate-scale-in` | Entrance for small popping elements |
| `.glass` | Frosted translucent surface (shell chrome only) |
| `.bg-gradient-brand` | Coral→amber 135° gradient fill |
| `.text-gradient-brand` | Gradient-clipped text (marketing headlines only) |

Theme: light is default; dark applies via system preference or the
`data-theme` override on `<html>` set by `<ThemeToggle />`
(`src/components/theme-toggle.tsx`), persisted as `huddl-theme` in
localStorage. Never branch on theme in components — tokens handle it.

## Primitives (`@/components/ui`)

```tsx
import {
  Button, buttonClasses,      // variants: primary | gradient | secondary |
                              //   soft | ghost | danger | danger-ghost
                              // sizes: sm | md | lg | icon
  Card, cardClasses,          // padding: none | sm | md | lg; interactive
  Label, Input, Textarea, Select, Hint, FieldError, controlClasses,
  Badge,                      // tone: brand | accent | neutral | success |
                              //   warning | danger; solid
  PageHeader,                 // title, eyebrow?, description?, action?,
                              //   backHref?, backLabel?
  SectionHeader,              // title, href?, linkLabel?
  Segmented,                  // pill link-tabs; items: {href,label,icon?,prefix?}
} from "@/components/ui";
```

- **Links that look like buttons:** `<Link className={buttonClasses({ variant: "primary" })}>`.
- **Cards that are links:** `<Link className={cardClasses({ interactive: true })}>`.
- `Button` renders a real `<button>` (default `type="button"` — pass
  `type="submit"` in forms).

## Layout patterns

- **Page container:** `mx-auto max-w-3xl px-4 py-6 md:py-10` (wide directory /
  browse pages may use `max-w-4xl`). Chat/DM rooms keep their own full-height
  scroll layout.
- **Every page starts with `<PageHeader />`** — title (sentence case),
  optional coral eyebrow naming the area ("Channels", "Settings"), optional
  description, the page's single primary action on the right, `backHref` on
  detail/sub pages.
- **Sections** inside a page use `<SectionHeader />` + `mt-8` rhythm.
- **List rows:** `Card` (or `cardClasses({ interactive: true })` on a Link)
  with an icon tile on the left: `flex size-10 items-center justify-center
  rounded-xl bg-brand-soft text-brand` (accent-soft/accent for trust or
  calendar-ish rows). Icon tiles are `rounded-xl` in v2, not circles.
- **Grids of cards:** `grid gap-3 sm:grid-cols-2` (or 3) with `Card
  interactive`.
- **Forms:** stack `<Label>` + control + `<Hint>`/`<FieldError>` with
  `flex flex-col gap-1.5`, groups spaced `gap-5`; submit is `<Button
  type="submit">` with a pending state (`Loader2` + `animate-spin`).
- **Entrance motion:** `PageHeader` animates itself. For the first content
  block on a page, `animate-fade-up` is welcome; don't animate long lists
  item-by-item.

## Shell

- Desktop (`md+`): fixed 16rem sidebar (`src/components/shell/sidebar.tsx`) —
  nav groups "You" / "Campus", unread badge on Notifications, user card +
  `<ThemeToggle />` in the footer. Content area is `md:pl-64`; there is **no
  desktop top bar** — pages own their headers.
- Mobile: frosted `MobileTopBar` (wordmark, campus chip, bell, settings,
  avatar) + floating `MobileDock` pill tabs. Content bottom padding `pb-28`
  clears the dock.

## Rules (unchanged from BRAND.md, restated)

- Tokens only — no raw hex, no grays outside the set. Check both themes.
- One coral primary action per view; `gradient` variant is for hero/marketing
  CTAs and may appear in-app only as *the* single page CTA on setup/empty
  screens.
- `lucide-react` only, `size-4`/`size-5`, `text-muted` unless meaningful.
- Focus visible on everything interactive
  (`focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand`).
- Empty states use `<EmptyState />` and recruit; async actions show pending
  state; touch targets ≥ 44px on mobile.
