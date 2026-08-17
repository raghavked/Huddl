# Hearth launch plan: TestFlight to App Store in three weeks

Written 2026-08-16. Dates assume work starts Monday 2026-08-17; slide
everything together if a blocker slips. Each item is tagged with its
owner: **[R]** is Raghav (things only the account holder can do), **[dev]**
is development work in this repo (done, or doable, by the coding side).

The one-sentence status: the product, the database, the safety systems,
the store copy, the screenshots, and the App Review sandbox are DONE. What
remains is almost entirely account plumbing: Apple enrollment, EAS setup,
mailboxes, DNS, and the legal-name blanks.

## Already done (no action needed)

- App config is store-ready: bundle id `app.uhearth.mobile`, version
  1.0.0, privacy manifests, permission strings, `supportsTablet: false`,
  non-exempt encryption declared, eas.json build profiles.
- Store listing copy, App Privacy questionnaire answers, age rating
  answers, and review notes: `docs/APP_STORE.md`.
- Ten 6.7" App Store screenshots: `mobile/store/screenshots/`.
- App Review sandbox live in production: campus "Hearth Demo Campus (App
  Review)" with account `reviewer@demo.uhearth.app` / `HearthReview-2026!`
  (moderator badge on, four rooms, two catalog courses). No real student
  can join it.
- Auth email templates in the Hearth brand: `supabase/templates/` with a
  dashboard walkthrough in its README.
- Migrations through 0060 applied and verified live; 117-check simulated
  fleet green; 406 tests green; both clients typecheck; production web
  build green.
- Legal documents written (terms, privacy, community standards, DMCA)
  with exactly one kind of blank left (see Day 1).

## Week 1 (Aug 17-23): accounts, first build, phones

### Day 1-2, Mon-Tue

- [R] **Apple Developer Program, Individual** ($99/yr) at
  developer.apple.com. Approval usually lands in 24-48h; start this first
  because everything else queues behind it. (Individual shows your legal
  name on the store page; the sole-proprietor decision is recorded in
  `docs/COMPLIANCE.md`.)
- ~~Fill the legal blanks~~ **DONE 2026-08-16**: the legal documents now
  name Raghav Kedia, doing business as Hearth, 625 Cantrill Dr, Apt 345,
  Davis, CA 95618, governed by California law with venue in Yolo County.
  Both files, parity-verified.
- [R] **Mailboxes**: `hello@uhearth.app` and `dmca@uhearth.app` must
  receive mail (both are printed in the legal docs). Any forwarder works.
- [R] **Supabase production settings** (dashboard, 15 minutes):
  upgrade to Pro (removes the project-pause risk and raises limits),
  enable leaked-password protection (Auth > Providers > Password), set
  Site URL to `https://uhearth.app`, and apply the branded email
  templates + Resend SMTP per `supabase/templates/README.md`.

### Day 3, Wed (needs Apple approval)

- [R] On the Mac, in `mobile/`:
  1. `npm i -g eas-cli && eas login` (create a free Expo account if
     needed)
  2. `eas init` (writes the EAS projectId into app config; this is also
     what makes production push delivery work end to end)
  3. `eas credentials` > iOS > production: let EAS create the
     distribution cert and the APNs key (say yes to everything)
  4. `eas build --platform ios --profile production`
  5. `eas submit --platform ios` (first run walks through creating the
     App Store Connect app record)
- **Never set `HEARTH_PERSONAL_TEAM=1` for these builds.** That flag
  strips push and deep links; it exists only for free-account cable
  testing. A store build with it set ships a broken app.
- [dev] On any build error: paste the log; config fixes come back same
  day.

### Day 4-5, Thu-Fri

- [R] The build appears in TestFlight automatically. Add yourself as an
  internal tester (no review needed, up to 100 internal testers) and run
  the phone checklist:
  - sign up with your real UC Davis email; confirm; verified badge after
    completing the profile
  - the four campus rooms are there; post, react, reply in thread
  - add a course from the catalog; the course room appears
  - DM someone (a second internal-tester account); block them; confirm
    their messages vanish and they are never told
  - send a friend request; accept it from the other side; watch presence
  - report a message; sign into `reviewer@demo.uhearth.app`; triage it
  - push notifications arrive with the app closed
  - a `https://uhearth.app/...` link opens the app (deep links)
  - Look and feel: flip through the twelve colour schemes
- [dev] Anything that fails goes back as a bug; fixes ship to TestFlight
  with a new `eas build && eas submit` (internal testing picks builds up
  with no review).

## Week 2 (Aug 24-30): beta, web, listing

- [R] **External TestFlight group** (up to 10,000 testers, needs a one-time
  Beta App Review, usually ~1 day): create a group, enable the public
  link, and put the review sandbox credentials in the Beta App Review
  notes. Recruit 10-30 UC Davis students; the per-campus playbook in
  `docs/OPERATIONS.md` section 2 starts at "T-minus 2 weeks" and this is
  that moment.
- [R] **Web + privacy URL**: deploy the web app (repo root is a standard
  Next.js app; Vercel's GitHub import works as-is) with env vars
  `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_ANON_KEY` from the
  Supabase dashboard, then point `uhearth.app` DNS at it. The App Store
  listing requires the privacy policy URL
  (`https://uhearth.app/legal/privacy`) to resolve. Also add
  `https://uhearth.app` to Supabase Auth redirect URLs.
- [R] **App Store Connect listing**: paste everything from
  `docs/APP_STORE.md` (name, subtitle, description, keywords, promo
  text, URLs), upload `mobile/store/screenshots/` in numeric order,
  answer App Privacy and the age rating questionnaire from the same doc,
  and put the review-notes block (demo account included) into App Review
  Information.
- [dev] Beta feedback triage: bugs fixed and re-shipped through the week;
  copy and store-listing adjustments as feedback lands.

## Week 3 (Aug 31 - Sep 6): submit, buffer, launch

- Day 15, Mon: [R] **Submit for review** with "Manually release this
  version" selected, so approval and launch day are decoupled. Reviews
  for new apps typically return in 24-48h.
- Day 16-18: buffer for one rejection cycle. The likely asks and their
  ready answers:
  - "How do we log in?" > the sandbox account in the notes.
  - "UGC moderation?" (Guideline 1.2) > report + block on every surface,
    staffed queue, automatic slur flagging, 24h promise in the terms.
  - "Account deletion?" (5.1.1) > Settings > Delete account, live demo.
  - Anything code-level: [dev] same-day fix, resubmit.
- Day 19-21: [R] **Release.** Launch-day playbook is
  `docs/OPERATIONS.md` section 2, Day 1 ("seed the campus"): the first
  posts in the four campus rooms, the first two events, and the visible
  push through week one. Keep TestFlight running as the beta channel for
  the next build.

## Launch blockers, in one list

Everything below blocks SUBMISSION (not development), and every one is
[R]:

1. Apple Developer enrollment approved
2. ~~Legal name/address blanks filled~~ DONE 2026-08-16
3. `hello@` and `dmca@` mailboxes receiving
4. Privacy policy URL live (web deployed + DNS)
5. EAS build submitted to App Store Connect
6. Listing + App Privacy + screenshots entered in Connect

## Standing cautions

- The production database is live and clean: one real account, the
  review sandbox, the seed rooms for nine campuses, and the moderation
  lexicon. Nothing may seed fake students or content into real campuses,
  ever. The review sandbox is the one sanctioned demo space.
- `HEARTH_PERSONAL_TEAM=1` is for cable testing only.
- Every future schema change lands as a numbered migration in
  `supabase/migrations/` and is applied through the same path as always;
  the ledger and the repo must not drift.
