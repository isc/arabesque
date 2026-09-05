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
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, signedInEmail } from './supabaseConfig.js'
import { CHANGELOG } from './changelog.js'
import { getLang } from './i18n.js'
import { KEY_PREFIX } from './legacyKeys.js'
import { APP_VERSION as BUILD } from './version.js'

export const feedbackEnabled = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)

// Which build the feedback was written against: the commit the deploy stamped
// (version.js). Unstamped outside a deploy, and there the latest changelog date
// still says roughly what the reporter was looking at.
const APP_VERSION = BUILD === 'dev' ? (CHANGELOG[0]?.date ?? 'unknown') : BUILD

// What the e-mail field opens with, and why it isn't blank: six of one
// evening's eight reports arrived with no address, from someone who has one.
// Retyping it is the whole friction.
//
// The address given for sync (supabaseConfig.js) is the default; what is stored
// here is only a departure from it — a field edited or emptied before sending.
// So the account stays the source of truth, and changing it changes the
// default, while a report deliberately sent anonymously stays anonymous: an
// emptied field is remembered as an empty string, which is an answer.
const REMEMBERED_EMAIL_KEY = `${KEY_PREFIX}feedback-email`

export function defaultFeedbackEmail() {
  try {
    const remembered = localStorage.getItem(REMEMBERED_EMAIL_KEY)
    if (remembered !== null) return remembered
  } catch {
    /* no localStorage: the account's address is all there is */
  }
  return signedInEmail() ?? ''
}

function rememberFeedbackEmail(address) {
  try {
    if (address === (signedInEmail() ?? '')) localStorage.removeItem(REMEMBERED_EMAIL_KEY)
    else localStorage.setItem(REMEMBERED_EMAIL_KEY, address)
  } catch {
    /* no localStorage: the next report just starts from the account again */
  }
}

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
export async function submitFeedback({ message, email, category, context }) {
  if (!feedbackEnabled) throw new Error('Feedback disabled (missing configuration)')
  const address = (email ?? '').trim()
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
      email: address || null,
      category: category || null,
      context,
    }),
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(detail || `HTTP ${res.status}`)
  }
  // Remembering belongs to the sending, not to the form: a report that failed
  // to leave is no decision about the address (and the field still holds it for
  // the retry), while any future sender gets the memory for free.
  rememberFeedbackEmail(address)
}
