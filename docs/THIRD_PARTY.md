# Third-party SDK and data-flow audit

Who receives what when a student uses Hearth. Read from the two
`package.json` files and the configuration that points them at servers,
not from memory. Re-run the audit whenever a dependency is added, and
change the privacy policy in the same commit if the answer changes.

## The short version

Hearth sends personal data to exactly four companies, all of them
processors acting on our instructions, none of them for advertising,
analytics or tracking. There is no analytics SDK, no ad SDK, no crash
reporter, no A/B testing service, no social login, and no advertising
identifier access in either client. The iOS privacy manifest declares
`NSPrivacyTracking: false` with an empty tracking-domains list, and that
is true.

## Processors

| Company | What for | What they see | Named in the policy |
| --- | --- | --- | --- |
| Supabase | Database, auth, file storage, API; the whole backend | Everything a student stores: account email, name, messages, posts, files, courses, grade entries. Region: US West (Oregon) | Yes, "When we share" |
| Expo (EAS) | Builds the app binaries; relays push notifications to Apple and Google | Expo push tokens and the notification payloads (a title and a short body, such as "Sam replied in BIS 2A"). No message history | Yes |
| Resend | Sends the auth emails (confirmation, password reset, email change) as Supabase's SMTP provider | The recipient address and the email body, which contains a one-time link and nothing personal beyond the address | Yes |
| Vercel | Hosts the marketing and legal website | Visitor IP addresses and request logs for uhearth.app, as any web host does. No Vercel Analytics or Speed Insights is installed | Yes |

Apple (APNs) and Google (FCM) receive the push payload last, as the
operating system's delivery channel. They are not Hearth processors in
the contractual sense but they are named here for completeness.

## Mobile app dependencies, by what they touch

| Package | Network? | Personal data? | Notes |
| --- | --- | --- | --- |
| `@supabase/supabase-js` | Yes, to our Supabase project only | Yes, everything | The only general-purpose network client in the app |
| `expo-notifications` | Yes, Expo push service | Push token | Token is stored in `profiles` and deleted with the account |
| `expo-image-picker` | No | Reads photos the student explicitly picks | Permission strings in `app.json`; camera and library only, never the whole roll |
| `expo-document-picker` | No | Reads a file the student explicitly picks | For notes uploads |
| `expo-font`, `@expo-google-fonts/*` | No | No | Fonts are bundled at build time, not fetched |
| `expo-linking`, `expo-web-browser` | Opens system browser on tap | No | Universal links to uhearth.app |
| `expo-device`, `expo-constants` | No | Device model, OS version | Used to decide whether push is available; never sent anywhere |
| `@react-native-async-storage/async-storage` | No | Session token, theme, text size, quiet hours | Device-local; cleared on sign-out |
| `expo-image`, `expo-haptics`, `expo-glass-effect`, `expo-symbols`, `expo-splash-screen`, `expo-status-bar`, `expo-system-ui`, `react-native-*` | No | No | Rendering, gestures, animation, safe areas |

## Website dependencies

| Package | Network? | Personal data? |
| --- | --- | --- |
| `@supabase/supabase-js`, `@supabase/ssr` | Yes, to our Supabase project | Auth session for the confirm and password-reset flows |
| `next`, `react`, `react-dom` | No third-party calls | Server-rendered pages; `next/font` self-hosts the fonts so no request reaches Google at runtime |
| `lucide-react`, `clsx`, `date-fns` | No | No |

## Cookies and storage

The website sets Supabase auth session cookies only while someone is
mid-flow on an auth page (confirming an email, resetting a password).
There is no consent banner because there is nothing to consent to: no
advertising, analytics, or cross-site cookie is ever set, which is the
condition under which the ePrivacy rules do not require one. The mobile
app has no cookies; it keeps its session in AsyncStorage on the device.

## How to re-check this in two minutes

```sh
grep -iE "analytics|segment|mixpanel|amplitude|sentry|firebase|facebook|admob|appsflyer|branch|adjust" package.json mobile/package.json
```

An empty result means the claims above still hold. A hit means stop and
update the privacy policy, the iOS privacy manifest, the Play Data safety
form and this file before merging.
