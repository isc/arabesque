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
// Left at 'dev' in the repo, which is what both sides say when the app is
// served from a checkout — so the check never fires in development or in tests.
import { KEY_PREFIX } from './legacyKeys.js'

export const APP_VERSION = 'dev'

const RELOAD_KEY = `${KEY_PREFIX}version-reload`

// Call first thing in a page's entry script. Returns true when a reload was
// triggered (the page keeps booting meanwhile; the reload supersedes it).
export function checkAppVersion(doc = document) {
  const pageVersion = doc.querySelector('meta[name="app-version"]')?.getAttribute('content')
  if (!pageVersion || pageVersion === APP_VERSION) return false

  // One attempt per mismatched pair: if the page comes back still mismatched —
  // the stale side sat in a cache the reload didn't reach — keep the degraded
  // page rather than reloading it forever.
  const pair = `${pageVersion} ${APP_VERSION}`
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === pair) {
      console.warn(`Arabesque: stale assets (page ${pageVersion}, scripts ${APP_VERSION}) survived a reload.`)
      return false
    }
    sessionStorage.setItem(RELOAD_KEY, pair)
  } catch {
    /* sessionStorage unavailable: without the guard a reload could loop, and a
       loop is worse than a few untranslated strings. */
    return false
  }

  location.reload()
  return true
}
