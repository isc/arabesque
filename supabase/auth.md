# Auth config — the sign-in email

⚠ Like the rest of this project, there is NO migration system. This config is
applied by hand on the Arabesque Supabase instance and this file is the
canonical record. It is not SQL: auth settings live in the project config, not
in the database, so they go through the Management API rather than `psql`.

Signing in is a **one-time code and nothing else**. The email deliberately
carries no link: a link signs in whichever browser opens it, which on iOS is
Safari rather than the wrapper's webview, so it would strand the session on the
wrong side of a storage boundary. `detectSessionInUrl: false` in
`public/js/supabaseClient.js` is the client-side half of the same decision — if
this template ever regains a `{{ .ConfirmationURL }}`, that line is what keeps
the link from half-working.

## Settings

| Key | Value | Why |
|---|---|---|
| `mailer_otp_length` | `8` | What `data.otpPlaceholder` promises |
| `mailer_otp_exp` | `3600` | One hour, as `data.otpHint` says |
| `rate_limit_email_sent` | `2` per hour | Supabase's default; enough to sign in on two devices |
| `smtp_host` | `smtp.resend.com` | Sending goes through Resend |
| `smtp_admin_email` | `onboarding@resend.dev` | ⚠ Resend's shared sandbox sender — it only delivers to the Resend account's own address, so **nobody else can sign in** until `arabesque.app` is verified in Resend and this becomes an address on that domain. See NAMING.md for the DNS records that verification needs. |

## Template

Subject (`mailer_subjects_magic_link`):

```
Your Arabesque sign-in code
```

Body (`mailer_templates_magic_link_content`) — bilingual, because Supabase
serves one template per email type and cannot pick by language:

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

## Applying it

The token is the one the Supabase CLI keeps outside the repo; see
`~/.claude/SUPABASE.md`. Never print it.

```bash
curl -sX PATCH "https://api.supabase.com/v1/projects/mtihhulokbhhvkomlmmk/config/auth" \
  -H "Authorization: Bearer $(cat ~/.supabase/access-token)" \
  -H 'Content-Type: application/json' \
  --data-binary @- <<'JSON'
{ "mailer_subjects_magic_link": "…", "mailer_templates_magic_link_content": "…" }
JSON
```

Read the current state back with the same URL and `GET`.
