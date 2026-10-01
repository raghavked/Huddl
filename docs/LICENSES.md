# Licenses for what Hearth ships

Everything Hearth draws on screen that it did not make itself, with the
license it is used under. Kept so the "are the fonts and icons licensed"
question has a one-file answer, and so the next asset added gets a row
here in the same commit.

## Typefaces

| Face | Where | License | Source |
| --- | --- | --- | --- |
| Bricolage Grotesque | Display headings, both clients | SIL Open Font License 1.1 | Google Fonts (`next/font/google` on the web, `@expo-google-fonts/bricolage-grotesque` on mobile) |
| Plus Jakarta Sans | Body and UI text, both clients | SIL Open Font License 1.1 | Google Fonts (`next/font/google` on the web, `@expo-google-fonts/plus-jakarta-sans` on mobile) |
| JetBrains Mono | Codes and identifiers, web only | SIL Open Font License 1.1 | Google Fonts (`next/font/google`) |

The OFL permits bundling, embedding and commercial use without a fee and
without attribution in the product itself. The one condition, that the
fonts are not sold on their own, is met.

## Icons

| Set | Where | License |
| --- | --- | --- |
| Lucide | Website (`lucide-react`) | ISC |
| Feather (via `@expo/vector-icons`) | Mobile app | MIT |
| SF Symbols (via `expo-symbols`) | Mobile app, iOS only | Apple's SF Symbols terms: usable only inside apps running on Apple platforms, which is the only place they are rendered |

## Images and illustrations

Hearth ships no stock photography and no third-party illustration. The
logo (the ember bubble), the app icon, the splash art, the Open Graph
image and the store screenshots are original work made for Hearth and
owned by the operator. The screenshot and preview sets were rendered from
the app itself against fixture data, so no real person appears in them.
The five placeholder SVGs that came with the Next.js starter template were
removed in October 2026; nothing referenced them.

## Code

Every runtime dependency in `package.json` and `mobile/package.json` is
MIT, ISC, BSD or Apache 2.0 licensed. The ones a reviewer tends to ask
about: `next`, `react`, `react-native`, `expo` and its modules,
`@supabase/supabase-js` and `@supabase/ssr` are all MIT. None of these
licenses requires a notice screen in the app, though attribution is
given in the website footer as a courtesy.

## What is not here

No analytics, advertising or tracking SDK is installed in either client,
so there is no license for one to record. See `docs/THIRD_PARTY.md` for
the full audit of what talks to whom.
