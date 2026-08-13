// Automatic sync triggers.
//
// Syncing follows the account: once signed in, a sync fires when a practice
// session ends, when the tab comes back, and when a page that displays synced
// data opens. There is no separate switch — signing in has no other purpose,
// so wanting an account and not wanting sync isn't a state worth offering.
//
// Every trigger here is best-effort: silent when nobody is signed in or when
// the network fails. The data page stays the one place that reports a sync's
// outcome.
import { lastSyncAt, runSync } from './sync.js'
import { signedInOnThisDevice } from './supabaseConfig.js'

// How long each trigger waits behind the previous sync. A tab coming back or a
// page opening brings nothing new of our own, so one round-trip a minute is
// plenty. A session that just ended *is* new data: push it right away, only
// collapsing bursts (a run of short Hanon playthroughs).
const MIN_INTERVAL_MS = { 'session ended': 5000 }
const DEFAULT_MIN_INTERVAL_MS = 60000

const onIdle = window.requestIdleCallback ?? ((fn) => setTimeout(fn, 0))

let deps = null
let onSynced = null
let inFlight = null
let lastAttemptAt = 0

// Wires a page in. `syncOnOpen` is for pages that display synced data;
// `onSynced` receives each successful sync's summary so the page can redraw.
export function initAutoSync(pageDeps, { syncOnOpen = false, onSynced: callback = null } = {}) {
  deps = pageDeps
  onSynced = callback

  // Only on the way back in. Going away has nothing of its own to push — an
  // unfinished session isn't pushable (runSync skips it) and a finished one
  // already fired its own trigger — so syncing there would spend the round-trip
  // *and* the throttle window that the return needs to pull with.
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') triggerSync('tab back')
  })

  if (syncOnOpen) triggerSync('page opened')

  // Fetching @supabase/supabase-js lazily is what keeps it off pages of signed
  // out users — but paying for the CDN waterfall at the end of a playthrough
  // would put it right on the result screen. Warm it while idle instead.
  if (signedInOnThisDevice()) onIdle(() => import('./supabaseClient.js').catch(() => {}))
}

// Time since the last sync *attempt*, in-memory or persisted by a previous page
// (the throttle has to survive navigation: library → score → library would
// otherwise sync three times over).
function msSinceLastSync() {
  const persisted = Date.parse(lastSyncAt() ?? '')
  return Date.now() - Math.max(lastAttemptAt, Number.isNaN(persisted) ? 0 : persisted)
}

// Imported on demand (see initAutoSync). The user id comes from the local
// session, so runSync doesn't have to ask the server who we are.
async function signedInClient() {
  const { supabase } = await import('./supabaseClient.js')
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session ? { supabase, userId: data.session.user.id } : null
}

// Syncs now, past the throttle and without consulting the mirrored flag — it
// asks the session itself. Collapses concurrent callers onto the same
// round-trip. Resolves to the runSync summary, or null when nobody is
// signed in; rejects on a sync error so a caller with UI can report it.
export function requestSync() {
  if (inFlight) return inFlight
  inFlight = (async () => {
    const client = await signedInClient()
    if (!client) return null
    const summary = await runSync({ ...client, ...deps })
    onSynced?.(summary)
    return summary
  })().finally(() => {
    lastAttemptAt = Date.now()
    inFlight = null
  })
  return inFlight
}

// Fire-and-forget sync for an automatic trigger: no-op unless an account is
// signed in and the previous sync is old enough, and never rejects.
export function triggerSync(reason) {
  if (!signedInOnThisDevice() || inFlight) return
  if (msSinceLastSync() < (MIN_INTERVAL_MS[reason] ?? DEFAULT_MIN_INTERVAL_MS)) return
  requestSync().catch((err) => console.warn(`Automatic sync (${reason}) failed:`, err))
}
