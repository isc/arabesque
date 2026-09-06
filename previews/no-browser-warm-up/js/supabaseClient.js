// Browser Supabase client for auth + cloud sync (data page only).
//
// Imported solely by the data page so the library/score pages don't pull in the
// @supabase/supabase-js bundle. The client persists the session in localStorage
// and auto-refreshes the token; detectSessionInUrl lets it pick up the
// magic-link token when the user lands back on data.html after clicking it.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.45.4'
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, AUTH_STORAGE_KEY, supabaseConfigured } from './supabaseConfig.js'

export const supabase = supabaseConfigured
  ? createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
      auth: {
        persistSession: true,
        // Pinned, not defaulted: the presence of this key is what the score and
        // library pages read to decide whether to sync (supabaseConfig.js), so
        // its name is a contract rather than an implementation detail.
        storageKey: AUTH_STORAGE_KEY,
        autoRefreshToken: true,
        detectSessionInUrl: true,
        // Implicit flow (session tokens in the URL hash), NOT pkce: Supabase's
        // email magic link is a /auth/v1/verify link that redirects back with
        // `#access_token=…`. PKCE would need a code-verifier stored in the same
        // browser that requested the link, which breaks magic links opened on
        // another device (or triggered server-side).
        //
        // A link still only signs in the browser that opens it, which is the
        // wrong one whenever the mail is read elsewhere — on iOS decisively so,
        // since the wrapper's webview has its own storage and hands links to
        // Safari. That is why the same email also carries a code (see
        // pendingSignIn below, and verifyOtp on the data page).
        flowType: 'implicit',
      },
    })
  : null

// Where the magic-link email should send the user back to — the data page on
// whatever origin they started from (works on localhost and GitHub Pages, both
// allow-listed in the project's auth config).
export function authRedirectUrl() {
  return new URL('data.html', window.location.href).href
}

// A sign-in waiting for its code. The same email carries a link and a code, and
// the code is the half that works when the link cannot reach us (see the note
// on flowType above): reading it means leaving for the mail app, and coming
// back reloads the page — routinely so in the iOS wrapper's webview. Without
// this the form would be gone and the code useless.
//
// Not a secret: the code itself is never stored, and the address is the one
// already typed into the form.
const PENDING_SIGNIN_KEY = 'arabesque:pending-signin'

export function pendingSignIn() {
  try {
    return localStorage.getItem(PENDING_SIGNIN_KEY)
  } catch {
    return null
  }
}

// Pass an address to remember it, null to forget it.
export function setPendingSignIn(email) {
  try {
    if (email) localStorage.setItem(PENDING_SIGNIN_KEY, email)
    else localStorage.removeItem(PENDING_SIGNIN_KEY)
  } catch {
    /* no localStorage: the form just won't survive a reload */
  }
}
