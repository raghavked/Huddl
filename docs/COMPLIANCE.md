# Hearth compliance checklist

What the code and the documents now say, and what is left that only the
operator can do. Written after an audit that read the three legal documents
against the schema rather than on their own, which is how the two errors at
the top of this file were found.

This file is not legal advice and nobody who wrote it is a lawyer. It is a
list of things to hand to one.

## Fixed in the app

| Was | Now |
| --- | --- |
| Terms said "your grades never touch Hearth"; the app has a grade estimator | Discloses self-entered marks as private to the student, and separates "we never pull from your university" from "you can type your own" |
| No copyright position at all, on a product whose core feature is uploading coursework | Notice-and-takedown, counter notice, and repeat-infringer termination in the Terms, echoed in the Guidelines |
| "We review reports within 24 hours", unconditional, in 3 documents and 8 places in the clients | "A person reads every report, usually within a day", safety first, in all eleven |
| No governing law, venue, indemnity, liability cap, or termination right | All present, with `[STATE]` and `[COUNTY, STATE]` to fill |
| No retention periods, no data location, no GDPR or CCPA rights section | All present. Data location named as Oregon, US |
| Age floor 13, with the Guidelines admitting under-18 users | 16, asserted in both signup captions as well as the Terms |
| `notes` bucket took any file under 25 MB | 16 coursework content types (migration 0049), generated from one table both clients are written from |
| No iOS privacy manifest, an App Store blocker since 2024 | `ios.privacyManifests` in `mobile/app.json`: no tracking, four required-reason APIs declared |
| Legal entity and DMCA agent unnamed | "[FULL LEGAL NAME], doing business as Hearth" and dmca@uhearth.app in both copies; name, address, state and county fill in after the FBN filing |

## Blocking, before anyone outside your campus can sign up

1. **File the Fictitious Business Name statement and fill the last four
   placeholders.** The operator chose the sole proprietor route, so the
   documents now name "[FULL LEGAL NAME], doing business as Hearth" as
   operator, controller and DMCA agent. File the FBN statement with the
   county clerk (roughly $50, then a four-week newspaper publication,
   renewed every five years), then fill `[FULL LEGAL NAME]`, `[ADDRESS]`,
   `[STATE]` and `[COUNTY, STATE]` in both
   `mobile/src/lib/legal-content.ts` and `src/app/legal/content.ts`. The
   name must match government ID and the FBN statement exactly.
2. **Register the DMCA agent** at dmca.copyright.gov. It costs about six
   dollars and has to be renewed every three years. This matters more than
   the policy text: publishing a takedown procedure without a registered
   agent does not get you the section 512 safe harbour, and without the safe
   harbour you are directly liable for a textbook chapter a student uploads.
   The registered details must match what the Terms say.
3. **Make the mailboxes real.** `hello@uhearth.app` and `dmca@uhearth.app`
   have to receive mail and be read; the Terms now name both. Two forwarding
   rules to the same inbox is enough. A contact address that bounces is a
   GDPR failure and an App Store rejection.
4. **Have a lawyer read all three documents.** `docs/LEGAL.md` has said this
   since they were drafted and it is still true. The liability cap, the
   indemnity and the governing law clause are the parts most worth an hour of
   someone's time.

## Before the App Store

5. **Enroll in the Apple Developer Program as an Individual**, USD 99 a
   year at developer.apple.com, with a two-factor Apple ID on
   hello@uhearth.app. No D-U-N-S number and no entity needed, and approval
   is usually same-day. The accepted consequence, recorded below under
   decisions: the App Store seller line shows the personal legal name, not
   "Hearth", and no fictitious business name filing changes that. If the
   LLC is ever formed, converting the account to an Organization is an
   Apple support process, not a button. The iOS privacy manifest that used
   to be this list item is done: `ios.privacyManifests` in
   `mobile/app.json` declares no tracking, no tracking domains, and the
   four required-reason APIs, and Expo folds it into
   `PrivacyInfo.xcprivacy` at prebuild.
6. **App Store Connect**, none of which lives in this repo: the privacy
   nutrition label, an age rating consistent with a 16+ social app carrying
   user content, the privacy policy URL, and a support URL.
7. Guideline 1.2 (user-generated content) wants a way to report, a way to
   block, published terms, and a contact. All four exist. Guideline
   5.1.1(v) wants in-app account deletion; `delete_own_account()` is wired
   to Settings.

## Before Google Play

8. The Data safety form. The honest answers are unusually easy here: no
   analytics SDK, no advertising SDK, no location, no contacts, no
   advertising identifier. Verifiable from `package.json`, which is the
   whole dependency list.

## Infrastructure and configuration

9. **Accept the Supabase DPA** in the dashboard under Legal Documents. The
   privacy policy now says data leaving the UK or EU is covered by "the data
   processing terms we have in place with our host". That sentence is only
   true once the DPA is accepted. It was deliberately written without naming
   the standard contractual clauses, because asserting a mechanism you have
   not signed is the same class of error as the grades claim.
10. **Leaked password protection is off** in Supabase Auth. One toggle, and
    no migration can reach it. It rejects passwords known to be breached.
11. **The Supabase project is on the Free plan.** Two consequences worth
    knowing. Free projects pause after a week of inactivity, which is a
    service problem for a launched app and sits awkwardly with the Terms
    saying we work hard to keep Hearth available. And there is no backup
    retention window you can point at, which is why the retention section
    says a deleted message "can sit in our host's routine backups for a short
    while" rather than naming a number. Move to a paid plan and you can state
    a real figure.
12. **When the web app is deployed, name the host as a processor.** Today it
    is not deployed anywhere, so the policy naming Supabase and Expo is
    complete. A Vercel deployment adds a processor that handles IP addresses,
    and the "When we share" section has to grow by one name.

## The no-entity path, examined

Can Hearth launch under its own name with no LLC? Mostly, cheaply, and
legally, with one hard stop exactly where it matters most. Written down so
the trade was made knowingly.

- **What works.** A sole proprietor can do business as "Hearth" by filing a
  Fictitious Business Name statement with the county clerk (roughly $50,
  fee varies by county), publishing it in an approved local newspaper once
  a week for four consecutive weeks, and renewing every five years. That
  allows a bank account under the trade name, contracts signed "doing
  business as Hearth", and the name on the landing page. The DMCA safe
  harbour works for individuals too: the agent registration would name the
  person rather than uHearth LLC. The legal documents would say
  "[FULL LEGAL NAME], doing business as Hearth" wherever they now say
  uHearth LLC, a two-line change on request.
- **What it costs instead.** Almost nothing, which is the honest appeal:
  about $100 once against the LLC's $920 first year, because California's
  $800 franchise tax binds LLCs, not sole proprietors.
- **The hard stop.** Apple. An Individual developer account displays the
  developer's personal legal name as the seller on every App Store listing,
  and no fictitious-name filing changes that. Organization enrollment is
  the only way the listing reads "uHearth LLC", and organizations must be
  legal entities with a D-U-N-S number. The stated goal, launching under
  the Hearth name rather than a personal one, fails at the most visible
  surface the app has.
- **The unpriced cost.** No liability shield. A moderated user-content
  platform whose community includes minors, with copyright exposure the
  safe harbour narrows but does not erase, would be operating against
  personal assets.
- **One EU footnote.** A free, non-monetized app can declare non-trader
  status under the DSA, so an individual's address and phone stay off the
  EU storefront. The moment the app monetizes, trader status becomes
  mandatory and an individual account's contact details go public on the
  listing. An entity absorbs that too.
- **The sensible hybrid.** A closed TestFlight beta can run on an
  Individual account while the LLC and D-U-N-S are in flight, since a
  beta's seller line is visible only to invited testers. Public release
  waits for the Organization account. This loses nothing except the urge
  to skip the two-week wait.

## Decisions taken, so a future reader knows they were deliberate

- **Sole proprietor at launch, not uHearth LLC.** Chosen by the operator
  in August 2026 after the analysis below. The documents name the person
  doing business as Hearth, the DMCA agent registers as an individual, and
  Apple enrollment is Individual, which puts the personal legal name on
  the App Store seller line. The operating agreement is parked, and the
  entity question reopens at real scale, when the app monetizes (the DSA
  trader rules would then publish an individual's contact details in the
  EU storefront), or on the first legal threat, whichever comes first.
- **Minimum age 16, not 13 or 18.** Chosen by the operator. It puts the app
  above the GDPR digital-consent age in nearly every member state and out of
  most of the state minor-social-media regimes. It does not remove under-18
  users entirely, so the Guidelines still say the community includes them.
- **"Usually within a day", not "within 24 hours".** A volunteer student
  moderator queue cannot guarantee a deadline, and the old wording was a
  binding promise to users and a representation to Apple.
- **Applied migrations keep their em dashes** and their original text. They
  record what was run against the database.

## Verifiably true today, and worth keeping true

- No analytics, advertising or tracking SDK of any kind, in either client.
  The "no advertising trackers" claim can be checked against `package.json`
  in about ten seconds. Do not let the first analytics dependency in without
  changing the policy in the same commit.
- Data export and account deletion are both real, both in-app, and both
  database functions (`export_my_data`, `delete_own_account`).
- Campus scoping, the block, and the privacy of the grade estimator are
  enforced by row-level security, not by client code.
- No phone numbers are collected anywhere, since the Twilio badge was
  retired.

## Watch list, not urgent

- **The name.** Resolved in the strong direction: the app was renamed from
  Huddl to Hearth in August 2026, retiring the likelihood-of-confusion risk
  against Hudl (hudl.com). One caution remains: "hearth" is a common English
  word and other products use it, so a trademark search is still worth doing
  before spending on branding. The domain is uhearth.app, which is more
  distinctive than the bare word.
- **University names.** Using "UC Davis" to say which campus a community
  belongs to is nominative use and the Terms disclaim affiliation, which is
  the right posture. Do not use any university's logo, seal, or wordmark, and
  do not imply endorsement. UC's licensing office is active.
- **FERPA does not apply to you.** It binds schools and their contractors.
  Stay on that side of the line: do not market Hearth as school-affiliated,
  do not accept a feed of institutional records, and keep the course list
  something students type.
- **CCPA thresholds are not met** at current scale. Revisit at 100,000 users
  or if the business model ever changes. The rights section already grants
  the substance.
- **Under-18 users still exist** at a 16+ floor. If Hearth ever opens beyond a
  single verified campus, or lets adults outside the campus start
  conversations, that changes and the minor-safety analysis has to be redone.
