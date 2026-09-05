// User feedback → Supabase (no backend to deploy).
//
// The app is hosted statically on GitHub Pages, so there is no server to
// receive feedback. Instead the browser POSTs straight to Supabase's PostgREST
// API, exactly like Tablito. A Postgres trigger then emails each new row via
// Resend — see `supabase/feedback.sql` for the table, RLS and trigger DDL you
// apply by hand on a fresh, piano-trainer-only Supabase project.
//
// The Supabase URL + publishable key live in supabaseConfig.js (safe to expose;
// RLS guards writes). If they're ever blanked, `feedbackEnabled` is false and
// the feedback button hides — the rest of the app is unaffected.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabaseConfig.js'
import { CHANGELOG } from './changelog.js'
import { getLang } from './i18n.js'
import { APP_VERSION as BUILD } from './version.js'

export const feedbackEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)

// Which build the feedback was written against: the commit the deploy stamped
// (version.js). Unstamped outside a deploy, and there the latest changelog date
// still says roughly what the reporter was looking at.
const APP_VERSION = BUILD === 'dev' ? (CHANGELOG[0]?.date ?? 'unknown') : BUILD

// Non-identifying environment captured with every submission, so a bug report
// carries the context to reproduce it. No personal data, no stored identifiers.
export function buildBaseContext() {
  return {
    app_version: APP_VERSION,
    locale: getLang(),
    user_agent: typeof navigator !== 'undefined' ? navigator.userAgent : '',
    viewport:
      typeof window !== 'undefined'
        ? { w: window.innerWidth, h: window.innerHeight }
        : null,
  }
}

// POST one feedback row. Throws on a non-2xx response so the caller can show an
// error state; the Supabase trigger handles the email asynchronously.
// `screenshot` is a data URL of the score the reporter was looking at, or null.
// It rides in its own column rather than in `context` so the listing query can
// leave the big value on disk — see supabase/feedback.sql.
export async function submitFeedback({ message, email, category, context, screenshot = null }) {
  if (!feedbackEnabled) throw new Error('Feedback disabled (missing configuration)')
  const res = await fetch(`${SUPABASE_URL}/rest/v1/feedback`, {
    method: 'POST',
    headers: {
      apikey: SUPABASE_PUBLISHABLE_KEY,
      Authorization: `Bearer ${SUPABASE_PUBLISHABLE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify({
      message,
      email: email && email.trim() ? email.trim() : null,
      category: category || null,
      context,
      screenshot,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(detail || `HTTP ${res.status}`)
  }
}
