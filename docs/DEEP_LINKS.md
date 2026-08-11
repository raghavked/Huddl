# Deep links and universal links

A link to Huddl should land where the student expects. Paste
`https://huddl.app/events/8f2c…` into a group chat and a friend with the app
installed opens the event *in Huddl*, not in a browser tab that asks them to
log in again. A friend without the app opens the same URL and reads the same
event on the web. One link, two good outcomes, no "open in app" banner.

That is the whole feature. This file is the map, the setup, and the honest
list of what has to be true before any of it works.

> **Which doc?** Push payloads and the notification inbox live in
> `docs/OPERATIONS.md` and `mobile/src/lib/push.ts`. This one owns the URL
> language shared by the web app, the native app, and the two files the
> operating systems fetch from our domain.

---

## 1. The link language

Every link Huddl produces — a share sheet, a push payload, an email — is
written in the **web app's URL space**. That is the one address space both
clients understand, and it is the only one that survives being pasted
somewhere Huddl doesn't control.

The native app's routes are not identical to the web's (ours are singular:
`/event/…`, not `/events/…`). The translation lives in one place,
`mobile/src/lib/notification-links.ts`, and every entry point uses it: the
notifications inbox, the push-tap router in the root layout, and universal
links.

| Shared URL | Opens on web | Opens in the app | Native file |
| --- | --- | --- | --- |
| `https://huddl.app/channels/<id>` | Channel | `/channel/<id>` | `mobile/src/app/channel/[id].tsx` |
| `https://huddl.app/clubs/<id>` | Club | `/club/<id>` | `mobile/src/app/club/[id].tsx` |
| `https://huddl.app/courses/<id>` | Course home | `/course/<id>` | `mobile/src/app/course/[id].tsx` |
| `https://huddl.app/events/<id>` | Event | `/event/<id>` | `mobile/src/app/event/[id].tsx` |
| `https://huddl.app/messages/<id>` | DM thread | `/dm/<id>` | `mobile/src/app/dm/[id].tsx` |
| `https://huddl.app/u/<handle>` | Profile | `/u/<handle>` | `mobile/src/app/u/[handle].tsx` |

Query strings and fragments are ignored by the mapping. Deeper course paths
collapse to the course home — `/courses/<id>/grades` opens `/course/<id>`,
because grades are a tab inside that screen on native rather than a route of
their own.

**Claimed but sent to the browser on purpose.** These sit inside a claimed
prefix and have no native twin, so the app would open onto a dead end (or,
worse, try to load a channel whose id is literally `new`):

| URL | Why it stays on the web |
| --- | --- |
| `/channels/browse` | The channel directory is a web-only screen. |
| `/channels/new` | The new-channel form is web-only. |
| `/messages/new-group` | The group-DM composer is web-only. |

**Not claimed at all.** Everything else — the marketing home page, `/login`,
`/signup`, `/verify`, `/legal/*`, `/auth/*`, `/onboarding`, `/setup`,
`/settings`, the top-level list pages, `/decks/*` — opens in the browser. This
is deliberate. The rule is: *claim only what the app can route.* A universal
link that opens the app onto a not-found screen is a worse experience than a
web page that loads.

`/decks/<id>` is the one obvious gap. It is shareable and the app has
`mobile/src/app/deck/[id].tsx`, but `routeForLink` doesn't know about decks
yet. Add `decks` to the regex there first, then add `/decks/*` to both the
AASA components and the Android intent filter — in that order.

### The custom scheme still exists

`huddl://` is unchanged and still the fastest way to test routing without any
domain setup. It takes **native** paths, not web ones, because nothing
translates it:

```
huddl://event/8f2c…      # opens the event
huddl://dm/1a4b…         # opens the DM thread
```

Universal links are the shareable public face; the scheme is the back door for
development and for the OS itself.

---

## 2. What each side declares

### The app — `mobile/app.json`

**iOS** gets an associated-domains entitlement. Expo's prebuild turns this key
into `com.apple.developer.associated-domains` in the entitlements file:

```json
"ios": {
  "associatedDomains": ["applinks:huddl.app"]
}
```

**Android** gets an auto-verified intent filter, one `data` entry per claimed
prefix. `autoVerify` is what removes the "open with" dialog:

```json
"android": {
  "intentFilters": [
    {
      "action": "VIEW",
      "autoVerify": true,
      "category": ["BROWSABLE", "DEFAULT"],
      "data": [{ "scheme": "https", "host": "huddl.app", "pathPrefix": "/events/" }]
    }
  ]
}
```

Both are **native** configuration. They land in a binary at build time, so
changing them needs a new `eas build` — an OTA update will not move them.

One asymmetry worth knowing: iOS can express exclusions inside a claimed
prefix and Android cannot. The three web-only paths above are excluded in the
AASA; on Android they are still handed to the app, and the app has to send
them somewhere sensible itself (see §5).

### The domain — two route handlers

| Path | File | Serves |
| --- | --- | --- |
| `/.well-known/apple-app-site-association` | `src/app/.well-known/apple-app-site-association/route.ts` | The AASA document iOS fetches |
| `/.well-known/assetlinks.json` | `src/app/.well-known/assetlinks.json/route.ts` | The Digital Asset Links statement Android fetches |

Both are Next.js route handlers rather than static files in `public/`, for one
reason: the identifiers they contain are secrets-adjacent deployment facts, not
source code, and they belong in the environment.

Both send `Content-Type: application/json` (the AASA has no `.json` extension —
that is correct, Apple wants it bare) and a one-day cache header with a week of
`stale-while-revalidate`.

**Both return 404 when their env var is missing or malformed, and the 404 is
`no-store`.** This is the important design decision in these two files. iOS
caches the AASA it fetches through Apple's CDN, so a document containing
`TEAMID.app.huddl.mobile` or a half-typed fingerprint doesn't merely fail — it
fails *and sticks*, on every device that saw it, long after the fix ships. A
missing file fails cleanly and retries. So the handlers validate before they
serve: the team ID must match `^[A-Z0-9]{10}$`, each fingerprint must be 32
colon-separated hex pairs. Anything else, no document.

---

## 3. The two environment variables

Neither is public. Set both in the Vercel project (Production **and** Preview)
and in `.env.local` if you want to see the files locally.

### `APPLE_TEAM_ID`

Ten alphanumeric characters, e.g. `A1B2C3D4E5`.

> developer.apple.com → Account → **Membership details** → Team ID.

It also appears as the prefix of the App ID in Certificates, Identifiers &
Profiles. The AASA pairs it with the bundle identifier to form the app ID
`<APPLE_TEAM_ID>.app.huddl.mobile`; if the bundle identifier in `app.json`
ever changes, change it in the AASA route too.

### `ANDROID_CERT_SHA256`

The SHA-256 fingerprint of the certificate that signs the installed app —
uppercase hex, colon-separated, 32 pairs. **Comma-separate several**; the
handler dedupes and serves them all.

> Play Console → your app → Test and release → Setup → **App signing**.

Take the fingerprint under *App signing key certificate* (the one Google
re-signs with, which is what users install) **and** the one under *Upload key
certificate* (which signs internal-track builds you install yourself). Both
belong in the list, or your internal testers get the browser while production
users get the app.

For a locally-signed or EAS-managed keystore:

```bash
eas credentials            # Android → production → shows the fingerprint
keytool -list -v -keystore <path.jks> -alias <alias>   # SHA-256 line
```

---

## 4. Verifying

### The documents themselves

```bash
curl -i https://huddl.app/.well-known/apple-app-site-association
curl -i https://huddl.app/.well-known/assetlinks.json
```

Look for `200`, `content-type: application/json`, and **no redirect** — Apple
does not follow them, and a single `301` from `huddl.app` to `www.huddl.app`
is enough to break the whole feature silently.

### iOS

Apple's App Search validation tool is retired; the CDN copy is the real source
of truth, because that is what devices actually read:

```bash
curl -s https://app-site-association.cdn-apple.com/a/v1/huddl.app
```

An empty or stale response means Apple hasn't crawled the new document yet.
This can take hours after first publish, and it is the single most common
reason universal links "don't work" on day one.

On a Mac with the device connected, or in the simulator:

```bash
sudo swcutil dl -d huddl.app     # force a fetch, print the result
swcutil show --domain huddl.app  # what this machine currently believes
```

On device: Settings → Developer → **Universal Links** → Diagnostics, paste a
URL, and it tells you which app (if any) claims it.

**For development builds**, iOS can skip the CDN entirely. Use
`applinks:huddl.app?mode=developer` in `associatedDomains` on a dev build,
enable Settings → Developer → **Associated Domains Development**, and the
device fetches the file straight from the domain. Never ship that suffix in a
store build.

### Android

```bash
# What the system thinks about our claim
adb shell pm get-app-links app.huddl.mobile

# Ask it to re-verify (also happens automatically at install)
adb shell pm verify-app-links --re-verify app.huddl.mobile

# Fire a link at the device the way a browser would
adb shell am start -a android.intent.action.VIEW \
  -c android.intent.category.BROWSABLE \
  -d "https://huddl.app/events/8f2c0000-0000-4000-8000-000000000000"
```

`get-app-links` should print `huddl.app: verified`. `none` means the statement
wasn't reachable; `legacy_failure` usually means the fingerprint doesn't match
the certificate that signed the installed build.

Google's verifier will also tell you what it sees:

```
https://digitalassetlinks.googleapis.com/v1/statements:list?source.web.site=https://huddl.app&relation=delegate_permission/common.handle_all_urls
```

---

## 5. The honest part

**None of this works yet, and that is expected.** Four things have to be true
at once, and today none of them are:

1. **The env vars are set.** Until then both routes return 404 and neither OS
   has anything to verify. Nothing else is broken — links open the website,
   which is a perfectly good outcome.
2. **`huddl.app` serves them over public HTTPS.** Apple's CDN and Google's
   verifier both crawl from the outside. They cannot reach `localhost`, and
   they cannot get past Vercel's password protection on a preview deployment.
   Preview URLs will never verify; only the real domain does.
3. **A native build carries the entitlement and the intent filter.** These are
   `app.json` keys compiled into the binary. The build that is currently in
   TestFlight predates them.
4. **The app is installed from a build whose signing certificate is in
   `assetlinks.json`** (Android), or installed at all (iOS re-checks
   associated domains on install and periodically after).

Order of operations for launch: set the env vars → deploy the web app → verify
both documents with `curl` → cut a new native build → install it → run the
`swcutil` and `adb` checks above.

### Open item: the app-side translation

The OS half is done. The app half — turning the incoming web path into a
native route — is not yet wired, and universal links will land on a not-found
screen until it is.

Expo Router's hook for this is a `+native-intent` file at the top of the app
directory, whose `redirectSystemPath` runs on both the cold-start URL and every
link received while running. It should delegate to the mapping that already
exists rather than growing a second copy of it:

```tsx
// mobile/src/app/+native-intent.ts  — not written yet
import { routeForLink } from "@/lib/notification-links";

export function redirectSystemPath({ path }: { path: string }): string {
  try {
    // `path` arrives as the full URL for universal links.
    const { pathname } = new URL(path, "https://huddl.app");
    return (routeForLink(pathname) as string | null) ?? path;
  } catch {
    return path;
  }
}
```

Two notes for whoever picks this up: `routeForLink` returns `Href`, so the
cast (or a widening helper) is unavoidable under typed routes; and throwing
here crashes the app, hence the `try`/`catch`. This is also where Android's
missing exclusions belong — `/channels/browse`, `/channels/new` and
`/messages/new-group` should be sent to their list screen rather than parsed
as ids.

### Smaller things to reconcile

- **`.env.example`** doesn't mention `APPLE_TEAM_ID` or `ANDROID_CERT_SHA256`
  yet. Add them, commented out, next to `SITE_URL`.
- **The middleware matcher** in `src/middleware.ts` doesn't exclude
  `.well-known/`, so both documents take a Supabase `getUser()` round trip
  they don't need. Harmless today (anonymous requests set no cookies, so the
  CDN still caches), but adding `\\.well-known/` to the matcher's negative
  lookahead makes the crawl faster and removes any chance of a `Set-Cookie`
  landing on a cacheable response.
- **Only the apex domain is claimed.** If `www.huddl.app` or a staging host
  ever serves the app, each one needs its own `applinks:` entry, its own
  `data` entry, and its own copy of both documents on that host.
