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
npx expo start         # scan the QR with Expo Go, or press i / a
```

`npx tsc --noEmit` type-checks; `npx expo export --platform ios`
verifies the full Hermes bundle without a native toolchain.

## What's in the app

The full product: signup + email verification + onboarding straight into
adding courses; user-managed courses with campus-catalog autocomplete;
course homes (main chat, rooms, shared class calendar, syllabus import,
notes, classmates, study sessions); the personal study plan; channel and
DM chat with photos, polls, @mentions, pins, edits, threads, reactions,
typing, presence, unread dots, mute, and in-room search; global campus
search; channel browse + topic channel creation; clubs (directory, club
homes, founding); events (create, edit, RSVP, calendar export); people
directory + profiles with photos; notifications center + device push;
safety (block, report, rate limits) and legal screens with in-app
account deletion.

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
