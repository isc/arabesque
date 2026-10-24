// Page side of the offline cache (see sw.js for the worker itself).
//
// Registers the worker, and decides when a page picks up a new one.
//
// Only on the app's own pages: the landing page is where someone arrives to
// read about Arabesque, and precaching the app under a visitor who is going to
// bounce is a cost with no return. Coverage is unaffected — once registered,
// the worker answers for the whole origin, whichever page did it.
import { APP_VERSION } from './version.js'
import { onForeground } from './utils.js'
import { recordError } from './errorLog.js'

// Reloading is how a page leaves the generation it was parsed with, and it is
// safe only where nothing would be lost. An allow-list rather than a list of
// exclusions, so a page added later is left alone until someone says otherwise:
// score.html holds a practice session and a cursor in the middle of a piece,
// and data.html holds a sign-in code typed from an email — the one flow whose
// every step is an app switch, which is exactly what triggers an update check.
// Both reach the new generation the next time the library is opened.
const RELOAD_SAFE = ['library.html', 'practice.html']

const UPDATE_CHECK_COOLDOWN_MS = 60_000

let reloading = false

function registerServiceWorker() {
  // 'dev' is an unstamped checkout (see version.js). A cache-first worker over
  // a local server would answer with yesterday's edit, and there would be no
  // deploy to move it on.
  if (APP_VERSION === 'dev') return
  // A branch preview is opened to see its latest push, which a cache-first
  // worker shows one reload late; see sw.js.
  if (location.pathname.includes('/previews/')) return
  if (!('serviceWorker' in navigator)) return

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
  // evening a deploy behind on its one failed check (feedback 59befcb6).
  let lastCheck = 0
  const check = () => {
    if (!navigator.onLine || Date.now() - lastCheck < UPDATE_CHECK_COOLDOWN_MS) return
    lastCheck = Date.now()
    registration.update().catch((error) => {
      lastCheck = 0
      recordError(error, 'Service worker update check failed')
    })
  }
  if (checkNow) check()
  onForeground(check)
}

registerServiceWorker()
