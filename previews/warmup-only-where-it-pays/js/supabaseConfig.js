// Supabase project config — URL + publishable (anon) key.
//
// These are SAFE to commit and expose client-side: the publishable key grants
// only what Row-Level Security allows — anonymous INSERT into `feedback`, and
// nothing on the per-user sync tables (training_sessions / user_fingerings)
// without an authenticated session (see supabase/sync.sql). The real secrets
// (Resend API key, SMTP password) live in Supabase, never in this repo.
//
// Kept in its own tiny module (no heavy imports) so feedback.js can read the
// constants without dragging in the @supabase/supabase-js client, which only
// the data page (supabaseClient.js) needs.
export const SUPABASE_URL = 'https://mtihhulokbhhvkomlmmk.supabase.co'
export const SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_vIltAWqwpRCJ5_b6Wle3bA_dNgnMRz4'

export const supabaseConfigured = Boolean(SUPABASE_URL && SUPABASE_PUBLISHABLE_KEY)

// Where supabase-js persists the session. Pinned rather than left to the
// library's default (`sb-<ref>-auth-token`, derived from the URL) so the name is
// our contract instead of a reverse-engineered one — signedInOnThisDevice()
// below reads it directly. Same string the default produced, so sessions
// already stored carry over untouched.
export const AUTH_STORAGE_KEY = 'sb-mtihhulokbhhvkomlmmk-auth-token'

// Whether an account is signed in on this device, which is the whole condition
// for syncing (see autoSync.js). Deliberately reads storage rather than asking
// the client: the score and library pages consult it to decide whether to load
// @supabase/supabase-js at all, so it cannot be the thing that loads it.
//
// A stored session can still be expired — the client settles that when a sync
// actually runs. What matters here is that a signed-out device never pays for
// the bundle, and that no copy of this fact can go stale: supabase-js owns the
// key, removing it on sign-out and when a refresh finally fails.
export function signedInOnThisDevice() {
  try {
    return !!localStorage.getItem(AUTH_STORAGE_KEY)
  } catch {
    return false // no localStorage: treat as signed out
  }
}
