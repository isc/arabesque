# Auth config — the sign-in email

⚠ Like the rest of this project, there is NO migration system. This file is the
canonical record of the settings that decide **how the sign-in email is sent and
what it says** — not of every auth setting the project has. `site_url` and the
redirect allow-list are deliberately outside it: nothing consumes a redirect now
that the email carries no link (see NAMING.md for their history). It is not SQL:
auth settings live in the project config, not in the database, so they go
through the Management API rather than `psql`. Apply this file with:

```bash
node scripts/apply-auth-config.mjs          # show what differs, change nothing
node scripts/apply-auth-config.mjs --apply  # push this file to the project
```

⚠⚠ **Never PATCH a single auth setting by hand.** The Management API groups
these fields, and a PATCH that names one member of a group **silently clears
the others**. Sending `smtp_admin_email` alone wiped the SMTP host, port, user
and password *and* reset the email subject and template to Supabase's defaults —
which put the magic link back into production. That is what the script above is
for: it always sends each group whole, and reads the result back. On
2026-09-08 this cost an outage of exactly that shape.

Signing in is a **one-time code and nothing else**. The email deliberately
carries no link: a link signs in whichever browser opens it, which on iOS is
Safari rather than the wrapper's webview, so it would strand the session on the
wrong side of a storage boundary. `detectSessionInUrl: false` in
`public/js/supabaseClient.js` is the client-side half of the same decision — if
a template ever regains a `{{ .ConfirmationURL }}`, that line is what keeps the
link from half-working.

⚠ **`signInWithOtp` sends one of two templates, and the app never chooses
which.** An address Supabase already knows gets *magic link*; an address it has
never seen gets *confirm signup* — the same button, the same wording in the app,
a different email. So both must carry the code, and each block below is applied
to both of the keys named above it. Leaving *confirm signup* at Supabase's
default is what App Review rejected on 2026-09-10 (Guideline 2.1(a), "no code
was sent in the email we received"): every returning player signed in, and every
first-time one — the reviewer included — received a bare `{{ .ConfirmationURL }}`.
The few who clicked it confirmed their address in Safari and came back to an app
still signed out, because `detectSessionInUrl: false` is doing its job.

Two is the whole reachable set only because `signInWithOtp` is the only call the
app makes. GoTrue has four more template pairs — invite, recovery, email_change,
reauthentication — and each becomes reachable the day the control that sends it
ships; they are not sign-in emails and must not be given this body. The applier
holds the line: it reads Supabase's own record of which templates have been
customised and reports any that this file does not name.

## Settings

| Key | Value | Why |
|---|---|---|
| `mailer_otp_length` | `8` | What `data.otpPlaceholder` promises |
| `mailer_otp_exp` | `3600` | One hour, as `data.otpHint` says |
| `rate_limit_email_sent` | `30` per hour | **Per project, not per user** — every sign-in across every account shares it. Supabase's default of 2 is meant for its built-in provider; on custom SMTP it is ours to set, and 2 would let the whole app issue two codes an hour. Well inside Resend's free tier (100/day). |
| `smtp_host` | `smtp.resend.com` | Sending goes through Resend |
| `smtp_port` | `465` | Implicit TLS |
| `smtp_user` | `resend` | Resend's SMTP username is literally this |
| `smtp_pass` | *(the Resend API key)* | Kept in Supabase Vault as `resend_api_key`, never here. The send-only key is the right privilege level; `feedback.sql` uses the same one through the HTTP API. |
| `smtp_sender_name` | `Arabesque` | The display name on the From line |
| `smtp_admin_email` | `bonjour@arabesque.app` | The domain is verified in Resend (`eu-west-1`), so this reaches anyone. It replaced `onboarding@resend.dev`, Resend's shared sandbox sender, which delivers only to the Resend account's own address — while that was in place nobody but the account owner could sign in at all. |

## Sending domain

`arabesque.app` is verified in Resend, region `eu-west-1`. The DNS records that
carry that verification live in the OVH zone and are documented once, in
NAMING.md ("Messagerie du domaine") — including why the apex needed no change.

## Template

One email for both types — a player must not be able to tell which of the two
they were sent.

Subject (`mailer_subjects_magic_link`, `mailer_subjects_confirmation`):

```
Your Arabesque sign-in code
```

Body (`mailer_templates_magic_link_content`, `mailer_templates_confirmation_content`) —
bilingual, because Supabase serves one template per email type and cannot pick
by language:

```html
<h2>Your Arabesque sign-in code</h2>
<p>Enter this code in the app:</p>
<p style="font-size:28px;font-weight:bold;letter-spacing:4px">{{ .Token }}</p>
<p>It expires in one hour and can only be used once.</p>
<hr>
<p>Votre code de connexion Arabesque : <strong>{{ .Token }}</strong>. Saisissez-le dans l'app ; il expire dans une heure et ne sert qu'une fois.</p>
```

Per-language emails would need a
[Send Email Hook](https://supabase.com/docs/guides/auth/auth-hooks/send-email-hook)
and our own sending. If that is ever worth it, the language can ride on
`redirect_to`, which the hook payload carries and which we build ourselves —
user metadata will not do, since `signInWithOtp`'s `options.data` only lands on
a user at creation.

## If the sign-in email stops arriving

Five things have broken it, all silently — none produced an error the player
could see. In the order they are cheap to check:

1. **A hand-written PATCH cleared a group.** `node scripts/apply-auth-config.mjs`
   prints the drift. This is what happened on 2026-09-08.
2. **The sender is not on a verified domain.** Anything on `resend.dev` only
   ever reaches the Resend account's own address, so every other player gets
   nothing. Check `smtp_admin_email` against the verified domain in Resend.
3. **The per-project rate limit is exhausted.** `rate_limit_email_sent` is shared
   by every account, not per user — at Supabase's default of 2/hour the whole app
   sends two codes an hour and the rest vanish.
4. **The Vault key was rotated in Resend and not here.** Then SMTP auth fails and
   the feedback notification dies with it. `feedback.sql` explains how to read
   `net._http_response` for the Resend side of that.
5. **Only one of the two templates was set.** Nothing looks wrong from an
   account that already exists — the break is invisible to anyone who has ever
   signed in, and total for everyone who has not. Test with an address the
   project has never seen: `select email, confirmed_at from auth.users` says
   whether a first sign-in ever completed.

## Reading the live config

`scripts/apply-auth-config.mjs` with no flag prints how the project differs from
this file, and is the way to apply it (see the top). To look at the raw config
instead:

```bash
curl -s "https://api.supabase.com/v1/projects/mtihhulokbhhvkomlmmk/config/auth" \
  -H "Authorization: Bearer $(cat ~/.supabase/access-token)"
```

The token is the one the Supabase CLI keeps outside the repo; see
`~/.claude/SUPABASE.md`. Never print it.

There is deliberately no `curl … -X PATCH` recipe here. A hand-written PATCH is
how the 2026-09-08 outage happened: it named two fields of the mailer group and
silently cleared the SMTP block along with them. Write through the script, which
sends each group whole and verifies the result.
