# Auth email templates

The four emails Supabase Auth sends, in the app's own design: cream page,
warm card, ember button, system type. Generated from one shell so the set
cannot drift apart; the copy is the app's voice, and the reset email reuses
the exact sentence the web reset screen shows ("Reset links work once, and
they don't stay good for long"), so the email and the screen agree.

All four hang everything off `{{ .ConfirmationURL }}` because both clients
use link-based flows, not one-time codes. The change-email template also
prints `{{ .Email }}`, the address the account is moving from.

## Where each one goes

Dashboard: Authentication → Emails → Templates. Paste the file's whole
contents into the matching slot, and set the subject line:

| File | Dashboard slot | Subject |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | Confirm your email for Hearth |
| `magic-link.html` | Magic Link | Your sign-in link for Hearth |
| `reset-password.html` | Reset Password | Reset your Hearth password |
| `change-email.html` | Change Email Address | Confirm your new email for Hearth |

The Magic Link slot is filled even though neither client sends magic links
today, so the slot never falls back to Supabase's default design if that
ever changes.

For local development the same files wire into `supabase/config.toml`:

```toml
[auth.email.template.confirmation]
subject = "Confirm your email for Hearth"
content_path = "./supabase/templates/confirm-signup.html"

[auth.email.template.magic_link]
subject = "Your sign-in link for Hearth"
content_path = "./supabase/templates/magic-link.html"

[auth.email.template.recovery]
subject = "Reset your Hearth password"
content_path = "./supabase/templates/reset-password.html"

[auth.email.template.email_change]
subject = "Confirm your new email for Hearth"
content_path = "./supabase/templates/change-email.html"
```

## Before these go live

1. Verify `uhearth.app` in Resend, then point Supabase at Resend's SMTP
   (Project Settings → Authentication → SMTP): host `smtp.resend.com`,
   port 465, username `resend`, password = a Resend API key, sender
   `Hearth <hello@uhearth.app>`. Until custom SMTP is set, Supabase's
   built-in sender has tight rate limits and a generic from-address.
2. Set the Site URL and redirect allow-list (Authentication → URL
   Configuration) to `https://uhearth.app` and the app scheme, so
   `{{ .ConfirmationURL }}` resolves to the real domain.
3. Send yourself all four (sign up, reset, change email) and read them on a
   phone. Email clients are the one place this design cannot be verified
   from the repo.

## Editing rules

These are email HTML, which is its own dialect: tables for layout, every
style inline, no web fonts, `bgcolor` doubled with CSS because Outlook
reads one and everything else reads the other. Edit the generator
(`emails.py` produced them from one shell) or edit all four in step; a
change to one file only is how the set starts drifting.
