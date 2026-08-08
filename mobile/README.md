# Huddl — native app

The Expo (React Native) client for Huddl, sharing the Supabase backend
with the web PWA at the repo root. Hearth design system, five-tab shell,
realtime chat — built with Expo SDK 57, expo-router, and strict
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

## Ship it to the App Store

App identity is already configured (`app.json`: name Huddl, scheme
`huddl`, iOS bundle id / Android package `app.huddl.mobile`, ember
adaptive-icon background). From here:

1. `npm install -g eas-cli && eas login` (free Expo account)
2. `eas build:configure` — accepts the existing app.json identity
3. `eas build --platform ios --profile production` — cloud build, needs
   your Apple Developer account ($99/yr) when prompted
4. `eas submit --platform ios` — uploads to App Store Connect /
   TestFlight
5. Same flow with `--platform android` for Google Play

Before review: replace the template icon/splash PNGs in `assets/` with
Huddl-branded exports (the ember mark from `public/icons/` at the root
is the source of truth), and fill in App Store privacy details — the
schema's privacy posture is documented in `docs/BRAND.md` and the root
README.

## v1 scope

Home feed, channels + realtime channel chat (optimistic sends), DMs
with unread dots, clubs (join), events (RSVP, capacity-aware), settings
(sign out). Not yet ported from web: threads, reactions, notes upload,
schedule-photo onboarding, phone verification, search, typing
indicators. Sign-up happens on the web (university-email verification);
the native app signs in to an existing account.
