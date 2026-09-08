# Store runbook: Apple and Google, step by step

Written 2026-09-08. This is the account-side sequence for getting Hearth
onto TestFlight, the App Store, and Google Play. Everything in the repo is
already store-ready for both platforms (see "What the repo already carries"
at the end); what follows is the part only the account holder can click
through, in the order that avoids waiting on yourself.

Conventions: **[R]** is you at a browser or the Mac. **[dev]** is a repo
change, done on request. Commands run from `mobile/` unless stated.

---

## Part 1. Apple

### 1.1 Enroll in the Apple Developer Program (day 0; approval takes 24 to 48 hours)

1. On an iPhone or the Mac, sign in to the Apple ID you will own the app
   with. Two-factor authentication must be on (Settings > your name >
   Sign-In & Security).
2. Go to https://developer.apple.com/programs/enroll/ and choose
   **Individual / Sole Proprietor**. The store page will show your legal
   name; that decision is recorded in `docs/COMPLIANCE.md`.
3. Apple may ask you to verify identity through the **Apple Developer
   app** on the iPhone (government ID scan). Do it there if prompted; the
   web flow alone sometimes stalls at "pending".
4. Pay the $99/year fee. Approval lands by email, usually within two days.
5. When approved, open https://developer.apple.com/account and copy your
   **Team ID** (Membership details, ten characters). You will need it
   twice below.

### 1.2 Two settings that need the Team ID (5 minutes, do while waiting on nothing)

- **[R] Vercel > project `uhearth` > Settings > Environment Variables**:
  add `APPLE_TEAM_ID` = your Team ID, for Production. Redeploy (Deployments
  > latest > Redeploy). This makes
  `https://uhearth.app/.well-known/apple-app-site-association` serve the
  real document, which is what lets `https://uhearth.app/...` links open
  the app. Until it is set the route deliberately 404s.
- **[R] Supabase > Authentication > URL Configuration**: Site URL
  `https://uhearth.app`; Redirect URLs include `https://uhearth.app/**`
  and `https://uhearth-raghav14.vercel.app/**` (only if not done already).

### 1.3 Create the App ID and the App Store Connect record (10 minutes)

1. https://developer.apple.com/account/resources/identifiers > **+** >
   App IDs > App. Description "Hearth", Bundle ID **Explicit**
   `app.uhearth.mobile`. Tick capabilities **Push Notifications** and
   **Associated Domains**. Register. (If you use the EAS path below, EAS
   offers to do this for you; doing it by hand first is harmless.)
2. https://appstoreconnect.apple.com > My Apps > **+** > New App:
   Platform iOS, Name **Hearth**, Primary Language English (U.S.),
   Bundle ID `app.uhearth.mobile`, SKU `hearth-ios`, User Access Full.
3. On the new app's page, App Information shows **Apple ID** (a number,
   about ten digits). Paste it into `mobile/eas.json` at
   `submit.production.ios.ascAppId`, replacing the placeholder. Commit
   that (it is not a secret).

### 1.4 Build and upload. Pick ONE path.

Both paths produce the same binary from the same `app.json`. The EAS path
needs no Xcode at all and manages certificates, the APNs key, and build
numbers for you; it is the recommended one. The Xcode path is the manual
equivalent for when you want to see the archive happen on your own Mac.

#### Path A: EAS (recommended, works from any machine)

```bash
cd mobile
npm i -g eas-cli
eas login                      # free Expo account; create one if needed
eas init                       # writes the EAS projectId into app config
                               # (this also activates production push)
eas credentials                # iOS > production: say yes to letting EAS
                               #   create the distribution certificate,
                               #   the provisioning profile, and the APNs key
eas build --platform ios --profile production
eas submit --platform ios --profile production
```

`eas submit` signs in with your Apple ID the first time (or use an App
Store Connect API key: Users and Access > Integrations > App Store
Connect API > Team Keys > Generate, role App Manager, download the .p8
once; EAS asks for the key, key ID, and issuer ID). The build lands in
TestFlight automatically a few minutes after processing.

Commit the `extra.eas.projectId` that `eas init` writes into
`app.json`; it is not a secret.

#### Path B: Xcode on the Mac (manual archive)

Requirements: macOS with **Xcode 16.1 or newer** (Expo SDK 57 / React
Native 0.86 needs it), launched once to accept the licence, with your
paid Apple ID added under Xcode > Settings > Accounts.

```bash
cd mobile
npm ci
npm run prebuild               # regenerates ios/ from app.json (clean)
open ios/Hearth.xcworkspace    # the workspace, never the .xcodeproj
```

In Xcode:

1. Select the **Hearth** target > **Signing & Capabilities**. Team: your
   paid team (not "Personal Team"). Leave "Automatically manage signing"
   on. Confirm the capabilities list already shows **Push Notifications**
   and **Associated Domains** (`applinks:uhearth.app`); prebuild adds both
   from `app.json`. Never set `HEARTH_PERSONAL_TEAM=1` for a store build;
   that flag exists only for free-account cable testing and strips both
   capabilities.
2. **General** tab: Version `1.0.0`, Build `1`. Every upload to App Store
   Connect needs a strictly higher Build number; on this path you bump
   `ios.buildNumber` in `app.json` yourself before each `npm run prebuild`
   (the EAS path does this automatically).
3. Product > Destination > **Any iOS Device (arm64)**.
4. Product > **Archive**. When the Organizer opens: **Distribute App** >
   **App Store Connect** > Upload > keep the defaults (upload symbols,
   manage version and build number off, automatic signing) > Upload.
5. App Store Connect emails when processing finishes (5 to 30 minutes).

If the archive fails with a provisioning error mentioning
`aps-environment` or `associated-domains`, Xcode is signing with a free
Personal Team; switch the Team in step 1.

### 1.5 TestFlight (same day as the first upload)

1. App Store Connect > Hearth > TestFlight. The build appears under iOS
   builds. First time, answer the export compliance prompt: the app uses
   only standard encryption (`ITSAppUsesNonExemptEncryption` is already
   `false` in `app.json`, so this prompt may not even appear).
2. **Internal Testing** > + group "Team" > add yourself. No review
   needed. Install TestFlight on the phone and run the phone checklist in
   `docs/LAUNCH_PLAN.md` (Day 4-5).
3. **External Testing** > + group "UC Davis beta" > enable **Public
   Link**, cap it at whatever you can support (start with 100). The
   first external build goes through Beta App Review (about a day); put
   the review-sandbox credentials from `docs/APP_STORE.md` in the Test
   Information notes.

### 1.6 Listing, privacy, review notes, submit

Everything to paste is in `docs/APP_STORE.md`: name, subtitle, category,
keywords, description, promotional text, support URL
`https://uhearth.app`, privacy URL `https://uhearth.app/legal/privacy`,
the App Privacy questionnaire answers, the age rating answers, and the
App Review Information block (demo account
`reviewer@demo.uhearth.app`). Screenshots: upload
`mobile/store/screenshots/` in numeric order to the 6.7" slot (Apple
scales it to the smaller slots). Choose **Manually release this version**
so approval and launch day are separate decisions, then Submit for
Review.

---

## Part 2. Google Play, personal developer account

### 2.1 What a personal account means in 2026 (read before paying)

- One-time **$25** registration fee. Paid with a card on a Google
  Payments profile.
- **Identity verification is mandatory**: a government photo ID, a
  verified phone number, and a verified contact email. The contact email
  is shown publicly on your store listing; use `hello@uhearth.app` once
  that mailbox receives mail, otherwise a dedicated Gmail.
- **Closed testing gate**: personal accounts must run a **closed test
  with at least 12 opted-in testers for 14 consecutive days** before
  Google grants production access. Plan the beta cohort accordingly: the
  same UC Davis students you recruit for TestFlight can be the 12.
- **Two-step verification** must be on for the Google account.
- Choose the account's Google identity carefully: it cannot be
  transferred to a different Google account later without a support
  case. A dedicated account (for example `hearth.davis@gmail.com`) is
  cleaner than a personal one.

### 2.2 Create the account (20 minutes, then a wait for verification)

1. Sign in to the chosen Google account, with 2-step verification on.
2. Go to https://play.google.com/console/signup.
3. Account type: **Yourself** (personal). Developer name: **Hearth**
   (public, editable later). Contact email and phone: the ones you will
   verify. Country: United States.
4. Answer the "about you" questions honestly (how many apps you plan to
   ship, whether you plan to earn money: "no ads, no sales" for now).
5. Pay the $25. Then complete **identity verification** from the console
   home card: upload the ID, confirm the phone by code, click the
   verification link emailed to the contact address. Approval usually
   takes a few hours to a few days; the console shows "Verified" under
   Account details when done.

### 2.3 Create the app record and answer the declarations (30 minutes)

1. Play Console > **Create app**: Name **Hearth**, default language
   English (United States), App (not Game), **Free**. Accept the
   declarations. Create.
2. Left nav > **Set up your app** checklist; work through it:
   - **Privacy policy**: `https://uhearth.app/legal/privacy` (needs the
     DNS step in `docs/LAUNCH_PLAN.md` done so the URL resolves).
   - **App access**: "All or some functionality is restricted". Add an
     instruction set: signup is limited to verified university emails;
     reviewers sign in with `reviewer@demo.uhearth.app` /
     `HearthReview-2026!` (the isolated App Review campus).
   - **Ads**: No.
   - **Content rating** (IARC questionnaire): category Social
     Networking / Communication. User-generated content: Yes, with
     moderation and reporting. Users can interact or exchange content:
     Yes. Shares location: No. Purchases: No. Expected result: Teen.
   - **Target audience**: 16-17 and 18 and over (the Terms set the age
     floor at 16). Not designed for children. No appeal to children.
   - **News app**: No. **COVID-19 contact tracing**: No.
     **Government app**: No. **Financial features**: None.
     **Health**: none.
   - **Data safety**: mirrors the App Privacy answers in
     `docs/APP_STORE.md`. Collected and linked to the user, for app
     functionality, not shared with third parties, not used for
     tracking: **Email address**, **Name**, **User IDs** (profile id
     and university), **Photos** (only if the user attaches one),
     **Messages** (chat, DMs, board posts), **Other user-generated
     content** (notes, flashcards, private grade entries). Data is
     encrypted in transit; users can request deletion (Settings > Delete
     account) and export (Settings > Privacy > Your data). No location,
     no contacts, no device identifiers for advertising.
   - **Advertising ID**: the app does not use it.
3. **Store listing** (Grow > Store presence > Main store listing):
   - App name **Hearth**; short description (80 chars) **Your campus,
     gathered.**; full description: the description block from
     `docs/APP_STORE.md`.
   - App icon: `mobile/store/play/icon-512.png`.
   - Feature graphic: `mobile/store/play/feature-graphic-1024x500.png`.
   - Phone screenshots: `mobile/store/play/screenshots/` (ten, 1080x1920,
     numbered; upload in order). 7-inch and 10-inch tablet slots can be
     left empty since `supportsTablet` is off.
   - Category **Social**. Tags: education, students. Contact email
     `hello@uhearth.app`, website `https://uhearth.app`.

### 2.4 Build, and the one upload that must be manual

The first artifact for a brand-new app has to be uploaded through the
Console by hand (Google enables the publishing API for an app only after
its first upload). Every later upload can go through `eas submit`.

```bash
cd mobile
eas build --platform android --profile production
# first time: EAS asks to generate an upload keystore; say yes and let
# EAS keep it. Never move it to the repo; *.jks is gitignored anyway.
```

When the build finishes, download the `.aab` from the build page on
expo.dev, then in Play Console:

1. **Testing > Internal testing > Create new release**. On the app
   signing prompt, accept **Play App Signing** (Google holds the release
   key; EAS's keystore becomes the upload key). Upload the `.aab`.
   Release name `1.0.0 (1)`, release notes "First internal build." >
   Next > Save > Review release > Start rollout to Internal testing.
2. **Testers** tab: create an email list with your own address, save,
   copy the opt-in link, open it on an Android phone, install.

### 2.5 Deep links on Android (5 minutes, after the first upload)

Play Console > Setup > **App signing** > copy the **SHA-256 certificate
fingerprint** under "App signing key certificate" AND the one under
"Upload key certificate". In Vercel > `uhearth` > Environment Variables
add `ANDROID_CERT_SHA256` = both fingerprints, comma-separated, uppercase
as shown. Redeploy. `https://uhearth.app/.well-known/assetlinks.json`
then serves the statement that lets `https://uhearth.app/...` links open
the app without the chooser dialog.

### 2.6 Automate later uploads with a service account (10 minutes)

1. https://console.cloud.google.com > create a project "Hearth Play" (or
   reuse one) > **IAM & Admin > Service Accounts > Create**: name
   `eas-submit`. Keys tab > **Add key > JSON**; the file downloads once.
2. Save it as `mobile/play-service-account.json`. It is gitignored;
   treat it like a password.
3. Play Console > **Users and permissions > Invite new users**: the
   service account's email address; app permissions on Hearth: "Release
   to testing tracks", "Manage testing tracks and edit tester lists",
   "Release to production" (add when production is unlocked). Send.
4. From then on:

```bash
eas build --platform android --profile production
eas submit --platform android --profile production   # internal track, draft
```

Promote drafts in the Console (Internal > Promote release > Closed
testing) so you decide what the 12 testers see.

### 2.7 The 14-day closed test, then production

1. **Testing > Closed testing > Create track** "UC Davis beta". Promote
   the internal build into it. Add a tester email list (or a Google Group)
   with at least **12** addresses; each must open the opt-in link and
   install. Twelve *opted-in* testers is the count that matters, so
   recruit 15 to 20.
2. Keep the test running for **14 consecutive days**. Ship fixes into the
   same track; the clock does not reset for new builds.
3. When the dashboard offers **Apply for production access**, answer the
   short questionnaire (what testers did, what you changed). Google
   reviews it, typically within a week.
4. Production > Create release > promote the latest closed-testing build
   > roll out. First production reviews take a few days for new
   developer accounts.

---

## What the repo already carries (no action needed)

- `mobile/app.json`: bundle id and package `app.uhearth.mobile`, version
  `1.0.0`, iOS privacy manifest, permission strings, associated domain,
  `ITSAppUsesNonExemptEncryption: false`, Android adaptive + monochrome
  icons, verified `https://uhearth.app` intent filters, and
  `RECORD_AUDIO` blocked so the Play data-safety form never asks about a
  microphone the app does not use.
- `mobile/eas.json`: `production` builds an iOS archive and an Android
  app bundle with remote auto-incremented build numbers; `preview` builds
  installable internal artifacts (an APK on Android); `submit.production`
  targets App Store Connect (paste the numeric app id) and Play's internal
  track as a draft (needs `play-service-account.json`).
- Store copy, privacy answers, age rating, review notes:
  `docs/APP_STORE.md`. iPhone screenshots: `mobile/store/screenshots/`.
  Play assets: `mobile/store/play/`.
- Deep-link documents for both platforms, served live the moment
  `APPLE_TEAM_ID` and `ANDROID_CERT_SHA256` exist in Vercel.
- Every asset wears the ember bubble mark in its chosen colorway.
