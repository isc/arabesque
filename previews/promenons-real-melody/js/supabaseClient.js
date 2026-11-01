// Browser Supabase client for auth + cloud sync.
//
// Imported on demand: by the data page always, and by the app's other pages
// only once an account is signed in on this device (autoSync.js), so a
// signed-out player's library and score pages never pull in the
// @supabase/supabase-js bundle. Where it comes from, and when, is written in
// the privacy policy (privacy.hostingBody): it names esm.sh as the one party
// that sees the player's IP address. The client persists the session in
// localStorage and auto-refreshes the token.
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
        // Ignore any token that reaches us in the URL: signing in happens only
        // through the code, in verifyOtp on the data page. Enforcement rather
        // than bookkeeping — a link signs in whichever browser opens it, which
        // on iOS is Safari and not the wrapper's webview, so it would strand the
        // session on the wrong side of a storage boundary. If the email template
        // ever regains a link (supabase/auth.md records the code-only one), this
        // line is what stops it from half-working.
        //
        // flowType is left at the library's default: with no link to redeem, it
        // makes no difference which one is in force.
        detectSessionInUrl: false,
        // No lock across pages. By default every auth call — getSession, which
        // each sync starts with, included — waits on a Web Lock shared by the
        // whole origin, with no time limit. WebKit lets go of a page's lock
        // only once the page has run what follows the call holding it, and a
        // page put in the back/forward cache runs nothing: the library, left
        // for a score two seconds after refreshing the token, kept the lock,
        // and the iPad synced nothing more until the app was quit (26 October;
        // storage.js has the same freeze for IndexedDB). This is what the
        // library runs where Web Locks don't exist, and what later versions do
        // by default: calls on one page still queue behind each other
        // (_acquireLock), and two pages refreshing at once get the same new
        // token from the server.
        lock: (name, acquireTimeout, fn) => fn(),
      },
    })
  : null

// A sign-in waiting for its code. Reading the code means leaving for the mail
// app, and coming back reloads the page — routinely so in the iOS wrapper's
// webview. Without this the form would be gone and the code useless.
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
