// Page side of the offline cache (see sw.js for the worker itself).
//
// Registers the worker, and decides when a page picks up a new one.
//
// Only on the app's own pages: the landing page is where someone arrives to
// read about Arabesque, and precaching the app under a visitor who is going to
// bounce is a cost with no return. Coverage is unaffected — once registered,
// the worker answers for the whole origin, whichever page did it. feedback.js
// imports this module too, for updateReport(): a page that reaches it
// registers the worker.
import { APP_VERSION } from './version.js'
import { onForeground } from './utils.js'
import { recordError, watchStall } from './errorLog.js'

// Reloading is how a page leaves the generation it was parsed with, and it is
// safe only where nothing would be lost. An allow-list rather than a list of
// exclusions, so a page added later is left alone until someone says otherwise:
// score.html holds a practice session and a cursor in the middle of a piece,
// and data.html holds a sign-in code typed from an email — the one flow whose
// every step is an app switch, which is exactly what triggers an update check.
// Both reach the new generation the next time the library is opened.
const RELOAD_SAFE = ['library.html', 'practice.html']

const UPDATE_CHECK_COOLDOWN_MS = 60_000

// A check only fetches sw.js — update() settles before the precache starts —
// so one still unsettled after this long is stuck rather than slow.
const UPDATE_CHECK_STALL_MS = 30_000

// How long a feedback report waits on the browser for updateReport().
const REPORT_TIMEOUT_MS = 1000

// The tab's last update check, { at, outcome, page }: what the cooldown is
// counted from, and what a report says of it. Kept in sessionStorage the way
// errorLog.js keeps its list, so a report sent from the score page still says
// what the library asked before it; memory stands in where storage is refused.
// legacyKeys.js owns the prefix; inlined, as errorLog.js does.
const LAST_CHECK_KEY = 'arabesque:sw-last-check'
let unstoredCheck = null

function lastUpdateCheck() {
  try {
    return JSON.parse(sessionStorage.getItem(LAST_CHECK_KEY)) ?? unstoredCheck
  } catch {
    return unstoredCheck
  }
}

function keepUpdateCheck(entry) {
  unstoredCheck = entry
  try {
    sessionStorage.setItem(LAST_CHECK_KEY, JSON.stringify(entry))
  } catch {
    /* memory it is */
  }
}

let reloading = false

// The registration this page watches; null until register() answers, and on a
// page no worker serves.
let watchedRegistration = null

// Whether this page is one a worker is meant to serve.
function workerInPlay() {
  // 'dev' is an unstamped checkout (see version.js). A cache-first worker over
  // a local server would answer with yesterday's edit, and there would be no
  // deploy to move it on.
  if (APP_VERSION === 'dev') return false
  // A branch preview is opened to see its latest push, which a cache-first
  // worker shows one reload late; see sw.js.
  if (location.pathname.includes('/previews/')) return false
  return 'serviceWorker' in navigator
}

function registerServiceWorker() {
  if (!workerInPlay()) return

  // Whether this page was already being served by a worker, read once, now:
  // clients.claim() sets it before either update signal below fires, so asking
  // then would call a first install an update and reload a page that has just
  // finished filling its cache.
  const wasControlled = Boolean(navigator.serviceWorker.controller)
  const mayReload = wasControlled && RELOAD_SAFE.some((page) => location.pathname.endsWith(page))

  const reload = () => {
    if (reloading || !mayReload) return
    reloading = true
    location.reload()
  }

  // updateViaCache: 'none' — sw.js must be fetched past the HTTP cache, or
  // Pages' max-age=600 would hide a new worker for as long as it lasts, which
  // is the staleness this whole mechanism exists to end.
  navigator.serviceWorker
    .register(new URL('sw.js', location.href), { updateViaCache: 'none' })
    .then((registration) => watch(registration, reload, mayReload))
    .catch(() => {
      /* Refused (private mode, storage full, a webview without support): the
         app keeps working straight off the network, and version.js stays the
         net for the mismatch this would have prevented. */
    })
}

function watch(registration, reload, checkNow) {
  watchedRegistration = registration
  navigator.serviceWorker.addEventListener('controllerchange', reload)
  // WebKit does not always fire controllerchange on an already-open page, which
  // with a cache-first worker would leave it on the old shell until every window
  // of it is closed. reload() is idempotent, so both signals firing is one reload.
  registration.addEventListener('updatefound', () => {
    const incoming = registration.installing
    incoming?.addEventListener('statechange', () => {
      if (incoming.state === 'activated') reload()
    })
  })

  // register() never asks again once a worker is installed, so the page does:
  // as a page that can take the update at once opens, and when the app comes
  // back, since a page left open for days opens nothing. The cooldown keeps a
  // flurry of app switches from being a flurry of requests. A failed check,
  // often the network not back from sleep, lifts it: the iPad once spent an
  // evening a deploy behind on its one failed check (feedback 59befcb6). So
  // does one skipped offline, which never asked.
  const check = () => {
    const last = lastUpdateCheck()
    const asked = last && last.outcome !== 'offline' && last.outcome !== 'failed'
    if (asked && Date.now() - last.at < UPDATE_CHECK_COOLDOWN_MS) return
    const entry = { at: Date.now(), outcome: navigator.onLine ? 'pending' : 'offline', page: location.pathname }
    keepUpdateCheck(entry)
    if (entry.outcome === 'offline') return
    // Unless another page of the tab has asked since: its check is the last.
    const settle = (outcome) => lastUpdateCheck()?.at === entry.at && keepUpdateCheck({ ...entry, outcome })
    const update = registration.update()
    watchStall(update, { what: 'Service worker update check', where: 'Service worker', ms: UPDATE_CHECK_STALL_MS })
    update.then(
      () => settle(registration.installing || registration.waiting ? 'found' : 'nothing new'),
      (error) => {
        settle('failed')
        recordError(error, 'Service worker update check failed')
      },
    )
  }
  if (checkNow) check()
  onForeground(check)
}

// Where this page stands in the update cycle, for a feedback report. The iPad
// has twice been seen a deploy behind for hours, and Safari on macOS and iOS
// 17 and 18 could be made to stay behind by none of the ways tried, so the
// next report has to say which it was. Read against app_version:
//
//   - caches: sw.js keeps each deploy's shell as arabesque-shell-<stamp>. Only
//     the page's own: no newer worker was found. A newer one too: one is
//     installing, or stuck there (workers). Only a newer one: it activated and
//     this page never reloaded.
//   - shell_scripts: the stamp of the copy of version.js the caches hold. Not
//     the shell's own: the cache itself holds another deploy's scripts, which
//     a reload cannot get past (version.js).
//   - workers: installing/waiting/active, each one's state or '-'; null if
//     register() never answered.
//   - controlled: whether a worker serves this page at all.
//   - last_check: what the tab last asked, from which page, and what came of
//     it — 'offline' is a check skipped, 'pending' one that never settled or
//     whose page went before it did.
//
// 'unanswered' if the browser does not say within a second, which says
// something too. Null where no worker is in play.
export async function updateReport() {
  if (!workerInPlay()) return null
  let timer
  const unanswered = new Promise((resolve) => (timer = setTimeout(() => resolve('unanswered'), REPORT_TIMEOUT_MS)))
  return Promise.race([readUpdateState(), unanswered])
    .catch((error) => String(error))
    .finally(() => clearTimeout(timer))
}

// The stamp a deploy wrote into the cached version.js (scripts/stamp-version.mjs).
async function cachedStamp() {
  const cached = await caches.match(new URL('version.js', import.meta.url), { ignoreVary: true })
  return cached ? ((await cached.text()).match(/^export const APP_VERSION = '([^']*)'$/m)?.[1] ?? null) : null
}

async function readUpdateState() {
  const registration = watchedRegistration
  const last = lastUpdateCheck()
  return {
    controlled: Boolean(navigator.serviceWorker.controller),
    workers: registration && ['installing', 'waiting', 'active'].map((slot) => registration[slot]?.state ?? '-').join('/'),
    caches: (await caches.keys()).filter((key) => key.startsWith('arabesque-')),
    shell_scripts: await cachedStamp(),
    last_check: last && { seconds_ago: Math.round((Date.now() - last.at) / 1000), outcome: last.outcome, page: last.page },
  }
}

registerServiceWorker()
