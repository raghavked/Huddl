# Hearth email: uhearth.app

The app sends three emails, all through Supabase Auth: the signup
confirmation, the resend of that confirmation, and the password reset. Nothing
else in the product emails anyone. This file is the one-time setup that makes
those arrive from `hello@uhearth.app` instead of Supabase's shared sender, and
makes `hello@uhearth.app` a real mailbox the legal documents can point at.

Sending and receiving are two different systems on purpose. Resend sends;
it does not host inboxes. Receiving is a forwarding rule at the domain.

## 1. Receiving: make hello@uhearth.app real (Squarespace, ~5 minutes)

The domain lives at Squarespace, and Squarespace domains include email
forwarding for free. No Google Workspace needed to start.

1. Squarespace → Domains → uhearth.app → **Email forwarding**.
2. Add: `hello@uhearth.app` → your personal Gmail.
3. Squarespace inserts the MX records itself. Send a test from another
   account and check it lands.

Reply-from-that-address (so answers come from hello@, not your Gmail) can be
added later in Gmail: Settings → Accounts → "Send mail as", using Resend's
SMTP once step 2 exists. Optional; receiving is what the documents require.

## 2. Sending: Resend

1. Resend dashboard → **Domains** → Add domain → `uhearth.app`.
2. Resend shows DNS records: SPF (TXT), DKIM (TXT, usually three CNAMEs or
   one TXT), and optionally DMARC. Add each one in Squarespace → Domains →
   uhearth.app → **DNS settings**, exactly as shown.
3. Wait for Resend to show the domain **Verified** (minutes to an hour).
4. Resend → **API keys** is not what Supabase SMTP wants. Create SMTP
   credentials instead: Resend → Settings → **SMTP**. Host
   `smtp.resend.com`, port `465`, username `resend`, password is the key it
   shows you.

## 3. Point Supabase Auth at it

Dashboard → Project **Hearth** → Authentication → **Emails** → SMTP settings:

| Field | Value |
| --- | --- |
| Enable custom SMTP | on |
| Sender email | `hello@uhearth.app` |
| Sender name | `Hearth` |
| Host | `smtp.resend.com` |
| Port | `465` |
| Username | `resend` |
| Password | the SMTP key from Resend |

Then Authentication → **Emails** → Templates: paste
`supabase/email-templates/confirm-signup.html` into **Confirm signup** and
`supabase/email-templates/reset-password.html` into **Reset password**. The
same confirm template covers the "resend confirmation" flow; it is the same
message. Leave Magic Link and the others on the defaults, since nothing in
the app triggers them.

Subjects worth setting while you're there:

- Confirm signup: `Confirm your school email`
- Reset password: `Reset your Hearth password`

## 4. The two URL settings that break silently

Authentication → **URL Configuration**:

- **Site URL**: `https://uhearth.app`
- **Redirect URLs**: add `https://uhearth.app/auth/confirm`,
  `https://uhearth.app/reset-password`, and `hearth://` for the native app.

These currently reflect the old domain or the Supabase default. Every link in
every auth email is built from them, so the emails above go to the wrong
place until this is set. This is the step to do first if doing them out of
order.

## 5. Prove it end to end

1. Sign up in the app with a real university address.
2. The confirmation should arrive from `hello@uhearth.app`, in the cream and
   ember template, and the link should land on uhearth.app and confirm.
3. Ask for a password reset from the login screen and walk it through.
4. Email `hello@uhearth.app` from another account and see it arrive in the
   forwarding inbox.

While unverified-domain sending is in effect, Resend only delivers to the
account owner's address. If a test signup with a second address gets nothing,
check the domain shows Verified before debugging anything else.

## What deliberately does not exist

- No marketing email system, no digests, no notification emails. Push covers
  notifications; the product sends exactly the three auth emails. The privacy
  policy's claims stay simple because this stays simple.
- No inbound processing. `hello@uhearth.app` is read by a person, which is
  what the legal documents promise ("A human reads it").
- Resend becomes a processor the moment step 3 is saved: it handles student
  email addresses on Hearth's behalf. The privacy policy's "When we share"
  section names Supabase and Expo today. Add Resend to that sentence in
  `mobile/src/lib/legal-content.ts` and `src/app/legal/content.ts` in the
  same sitting as the SMTP switch. The parity test will hold you to editing
  both.
