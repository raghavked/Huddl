# Huddl — native app

The Expo (React Native) client for Huddl, sharing the Supabase backend
with the web PWA at the repo root. Hearth design system, five-tab shell,
realtime everything — built with Expo SDK 57, expo-router, and strict
TypeScript.

## Run it

```bash
cd mobile
cp .env.example .env   # same Supabase project as the web app
npm install
npm start              # Metro, for a device that already has a dev build
```

`npm run typecheck` type-checks; `npm run bundle:ios` builds the full
Hermes bundle and verifies the whole app compiles without a native
toolchain — that one runs anywhere, including Linux and CI.

**Expo Go will not run this app.** Huddl uses native modules that are
not in the Go client (`@expo/ui`, `expo-glass-effect`, `expo-dev-client`)
and push notifications need a real build. Use a development build, below.

## Launch on an iPhone over USB-C

This is the fastest loop: build once, then every save reloads on the
phone in about a second.

**You need a Mac.** An iOS binary can only be produced by Xcode, so this
section does not work from Linux or Windows — that is Apple's rule, not
Expo's. On those machines use `eas build --profile development --platform
ios` instead, which builds in the cloud and gives you a QR to install
from.

**One-time setup**

1. Xcode from the App Store, then launch it once to accept the licence
   and let it finish installing components.
2. ```bash
   xcode-select --install                     # command line tools
   sudo gem install cocoapods                 # or: brew install cocoapods
   ```
3. Plug the iPhone in with the USB-C cable and **tap Trust** on the phone.
4. On the phone: Settings → Privacy & Security → **Developer Mode** → on.
   The phone restarts. (iOS 16+; the toggle only appears once a Mac with
   Xcode has been connected.)
5. In Xcode → Settings → Accounts, add your Apple ID. A free account is
   enough — apps signed with one expire after 7 days, which is fine for
   development.

**Every time**

```bash
cd mobile
npm install
npm run device          # builds, installs over the cable, starts Metro
```

`npm run device` runs `expo run:ios --device`. On first run it generates
the native `ios/` project, installs pods, builds, and installs to the
phone — allow ten to fifteen minutes. After that it is under a minute,
and you usually do not need it at all: leave the app installed and just
run `npm start`, then open Huddl on the phone.

If more than one device is attached, Expo prompts you to pick. To skip
the prompt: `npx expo run:ios --device "Raghav's iPhone"`.

**Reading logs from the terminal**

Metro prints JS logs where you ran `npm start`. For native-side logs
(push registration, crashes, keychain), leave this running in a second
tab:

```bash
xcrun devicectl device console --device <udid>   # Xcode 15+
```

`xcrun xctrace list devices` prints the UDIDs of everything attached.

**Testing what only works on a real device**

- **Push notifications** — a simulator never receives them. Sign in,
  accept the permission prompt, and confirm a row lands in `push_tokens`.
  Note that quiet hours and the two-minute coalesce window mean a second
  notification is *deliberately* deferred to the digest; see
  `docs/OPERATIONS.md` §3a before reporting a missing push as a bug.
- **The camera** — the simulator has no camera, so photo capture in chat
  and the avatar picker can only be tested here.
- **Haptics**, and how the ember reads under real daylight.

**When it goes wrong**

| Symptom | Fix |
| --- | --- |
| `Signing for "Huddl" requires a development team` | Open `ios/Huddl.xcworkspace`, target Huddl → Signing & Capabilities → pick your team, then re-run |
| `Unable to boot device` / device not listed | Unlock the phone, re-Trust, confirm Developer Mode is on |
| Build fails right after a dependency change | `npm run prebuild` to regenerate `ios/` from `app.json`, then `npm run device` |
| App installs but shows a white screen | Metro is not reachable — same Wi-Fi, or `npx expo start --dev-client --tunnel` |
| `.env` changes do nothing | `EXPO_PUBLIC_*` is inlined at bundle time; restart Metro with `npx expo start --clear` |

The `ios/` and `android/` folders are generated and git-ignored on
purpose — `app.json` is the source of truth, and `npm run prebuild`
rebuilds them from it. Never hand-edit them expecting the change to last.

**Release build on the phone**, to check performance honestly (Hermes
optimised, no dev overlay, no Metro):

```bash
npm run device:release
```

## Run in the iOS simulator

No cable, no signing, no paid Apple account — the fastest way to click
through the whole app. **Still a Mac**, because the binary is compiled by
Xcode either way.

> **Apply migrations 0039 and 0040 to whatever Supabase project the app
> points at, before you run it.** This is not optional housekeeping — the
> app reads two columns those migrations add, so against an un-migrated
> database it does not degrade, it breaks:
>
> - `focus_sessions.is_private` is in `FOCUS_SELECT`, so **the whole focus
>   feature fails**, including the strip on the home tab.
> - `profiles.dm_privacy` is in the privacy screen's query, so **the privacy
>   screen fails** — including the typing switch that used to work.
>
> 0039 also carries the fix that makes quiet hours saveable for the first
> time, and closes a chat-photo read leak. Use a dev or branch project for
> simulator testing rather than production.

```bash
cd mobile
cp .env.example .env    # same Supabase project as the web app
npm install
npm run preflight       # typecheck + bundle; catches a broken app before Xcode does
npm run simulator       # builds and boots on the default simulator
```

`npm run simulator` wraps `expo run:ios` with no `--device`, so it picks a
booted simulator (or boots the last-used one). To choose a specific device,
open Xcode's device menu first, or pass it through: `npx expo run:ios
--device "iPhone 16 Pro"`. `npm run simulator:release` does the same with the
optimised Hermes build, for an honest look at performance.

**Run `npm run preflight` first, every time.** It is the platform-independent
half of a simulator run — `tsc` plus the iOS bundle — so it turns a red screen
you'd otherwise hit two minutes into an Xcode build into a one-line failure
here. It runs anywhere, including CI, and exits non-zero on the first problem.

If the build fails at the native step (pods, signing, a stale
`ios/` directory) rather than in preflight, reset the native project:

```bash
npm run prebuild        # regenerates ios/ and android/ from app.json, then re-pods
npm run simulator
```

## What's in the app

The full product: signup + email verification + onboarding straight into
adding courses, then a three-panel welcome and a starter checklist;
user-managed courses with campus-catalog autocomplete; course homes as a
six-doorway grid (calendar, rooms, flashcards, pinned links, grades,
study partners) over the main chat, notes, classmates and study
sessions; syllabus import; shared flashcard decks with spaced repetition
and paste-import; the personal study plan and the merged month calendar;
focus sessions with a campus "studying now" list; a private grade
tracker; study-buddy opt-ins; archiving a finished class to a shelf;
channel and DM chat with photos, polls, @mentions, pins, edits, threads,
reactions, typing, presence, unread dots, mute, saved messages and
in-room search; group DMs (create, rename, add, leave); global campus
search; channel browse + topic channel creation; clubs (directory, club
homes, founding, officer announcements); events (create, edit, RSVP,
reminders, calendar export); people directory + profiles with photos;
notifications center + device push with per-kind toggles; display
preferences (theme and text size) that every screen honors; safety
(block, report, rate limits) and legal screens with in-app account
deletion.

## Ship it to the App Store

Identity, icons, splash, permission strings, and build profiles are all
configured (`app.json` + `eas.json`; brand assets in `assets/images/`
are generated from the Bricolage wordmark). From here:

1. `npm install -g eas-cli && eas login` (free Expo account)
2. `eas init` — links the project and writes the EAS projectId into
   app.json (this also activates production push delivery)
3. `eas build --platform ios --profile production` — cloud build, needs
   your Apple Developer account ($99/yr) when prompted
4. `eas submit --platform ios` — uploads to App Store Connect /
   TestFlight
5. Same flow with `--platform android` for Google Play

Listing copy, age-rating guidance, review notes (demo account), the
screenshot plan, and the pre-submission checklist live in
`docs/APP_STORE.md` at the repo root.
