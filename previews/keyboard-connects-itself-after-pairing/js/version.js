// Guard against a half-updated app.
//
// A page's HTML and its JavaScript are separate cache entries with separate
// lifetimes, so a browser can pair an old document with fresh modules — or the
// reverse — and the two stop agreeing about what exists. Not theoretical: an
// iPad showed "library.playedFull" in the practice journal days after that key
// was renamed to "journal.playedFull", because the back navigation behind the
// C8 shortcut reused a cached pre-rename library.html while the locales had
// already been refetched. A back/forward navigation reuses cached responses
// without revalidating them, so nothing made the mismatch expire.
//
// GitHub Pages serves everything with `max-age=600` and no fingerprint in the
// URLs, so there is nothing to make HTML and JS move together. Instead both
// sides carry the same stamp — this constant and each page's
// <meta name="app-version"> — rewritten in one pass at deploy time by
// scripts/stamp-version.mjs. When they disagree the pairing is stale, and a
// reload fixes it: unlike a back navigation it revalidates the document *and*
// its subresources, so it repairs the mismatch whichever side is behind.
//
// Pages load this on a <script type="module"> tag of its own, ahead of their
// entry script, and it imports nothing — both for the same reason. Static
// imports are hoisted, so a call from inside an entry script would only run
// once the code it is vetting had been fetched and evaluated (on score.html,
// behind 1.4MB of vendor JS too), and importing legacyKeys.js for its
// KEY_PREFIX would run that half of the app — a localStorage migration, on
// import — before deciding whether to trust it.
//
// Left at 'dev' in the repo, which is what both sides say when the app is
// served from a checkout, so the check never fires in development or in tests.
export const APP_VERSION = '475099d600f6'

// legacyKeys.js owns this prefix; inlined rather than imported, see above.
const RELOAD_KEY = 'arabesque:version-reload'

export function checkAppVersion() {
  // A service worker controlling this page owns freshness: it answers the
  // document and its scripts out of one generation's cache, and js/swRegister.js
  // decides when to move to the next. Two reload authorities with two policies
  // would spend each other's single attempt. This one covers every page no
  // worker answers for — before the first install, where registration was
  // refused or evicted, and the pages that deliberately never register.
  if (typeof navigator !== 'undefined' && navigator.serviceWorker?.controller) return

  const pageVersion = document.querySelector('meta[name="app-version"]')?.getAttribute('content')
  if (!pageVersion || pageVersion === APP_VERSION) return

  // One attempt per document per session, and per pair of versions: staleness
  // is per cache entry, so the reload library.html spends must not be charged
  // to practice.html later in the same session, while a deploy that lands
  // mid-session moves the scripts side and deserves its own attempt. Coming
  // back still mismatched means the stale side sat in a cache the reload
  // didn't reach — keep the degraded page rather than reloading it forever.
  const key = `${RELOAD_KEY}:${location.pathname}`
  const pair = `${pageVersion} ${APP_VERSION}`
  try {
    if (sessionStorage.getItem(key) === pair) {
      console.warn(`Arabesque: stale assets (page ${pageVersion}, scripts ${APP_VERSION}) survived a reload.`)
      return
    }
    sessionStorage.setItem(key, pair)
  } catch {
    /* sessionStorage unavailable: without the guard a reload could loop, and a
       loop is worse than a few untranslated strings. */
    return
  }

  location.reload()
}

// Runs on import, the way legacyKeys.js does: pages load this module for the
// effect, and the export is there for feedback.js and the tests.
if (typeof document !== 'undefined') checkAppVersion()
