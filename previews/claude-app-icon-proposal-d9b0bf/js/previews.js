// Branch previews, opened from inside the app.
//
// Every pull request is deployed under previews/<slug>/, on the same origin as
// production (CLAUDE.md, "Branch previews"). The link the pull request carries
// opens in Safari, which has no Web MIDI: on the iPad a preview could be looked
// at, never played. The iOS app keeps arabesque.app in its webview and injects
// its MIDI shim into every page it loads there, a preview's included, so a
// preview reached from a page of the app plays like production does. This
// module is that way in, and the way back:
// - the settings menu lists the previews still open (previews/index.json, which the
//   preview workflows rebuild: scripts/preview-index.sh), each one opening the
//   page you are on in that build;
// - a preview's pages carry a strip that says so, with the same page in
//   production a tap away. A preview whose pull request closed under the
//   player sends them there by itself (404.html).
//
// The menu lists them on a device that asked for it — five taps on the version
// line of the support page — and on a preview, where the way back has to be.
// Not for everybody in the app: for a player off the App Store, a build nobody
// has reviewed, writing into their practice journal, is a trap.

import { APP_VERSION } from './version.js'
import { t } from './i18n.js?v=8e1545852b35'
import { KEY_PREFIX } from './legacyKeys.js?v=8e1545852b35'

// This build's root, production's or a preview's: the module sits in its js/.
const BUILD_ROOT = new URL('../', import.meta.url)

// A build's root, read: the preview's slug, null in production, and the root
// of production.
export function readBuildRoot(root) {
  const preview = root.pathname.match(/^(.*\/)previews\/([^/]+)\/$/)
  return preview ? { slug: preview[2], siteRoot: new URL(preview[1], root) } : { slug: null, siteRoot: root }
}

const { slug, siteRoot: SITE_ROOT } = readBuildRoot(BUILD_ROOT)

// The preview this page belongs to, or null in production.
export const previewSlug = slug

// The page `page` is — path within its build, query, hash — in the build at
// `root`. Read when it is followed, not when it is drawn: the library keeps its
// filters in the query (library.js), and the score its piece.
export function samePageIn(root, page = location, from = BUILD_ROOT) {
  return new URL(page.pathname.slice(from.pathname.length) + page.search + page.hash, root).href
}

export const productionUrl = () => samePageIn(SITE_ROOT)
export const previewUrl = (slug) => samePageIn(new URL(`previews/${slug}/`, SITE_ROOT))

// [{number, title, slug}], newest first, or null when it could not be read —
// offline, or before the workflows first wrote it. Past the HTTP cache: Pages
// keeps a file ten minutes, and a pull request opened since would be missing.
// Production's worker leaves previews/ to the network (sw.js).
export async function openPreviews() {
  try {
    const response = await fetch(new URL('previews/index.json', SITE_ROOT), { cache: 'no-cache' })
    if (!response.ok) return null
    const list = await response.json()
    return Array.isArray(list) ? list : null
  } catch {
    return null
  }
}

const WANTED_KEY = `${KEY_PREFIX}previews`

function asked() {
  try {
    return localStorage.getItem(WANTED_KEY) === '1'
  } catch {
    return false
  }
}

export const previewsWanted = () => previewSlug !== null || asked()

// Turns the menu's list on or off on this device, and says which. Shared with
// every preview: same origin, same localStorage.
function togglePreviewsWanted() {
  const wanted = !asked()
  try {
    if (wanted) localStorage.setItem(WANTED_KEY, '1')
    else localStorage.removeItem(WANTED_KEY)
  } catch {
    return false
  }
  return wanted
}

// Inside a page's own markup rather than over it, at the very top, so that it
// scrolls away with the page: a preview is opened to try a change, and a strip
// pinned over the score would change what is being tried. The settings menu has the
// way back too, for once it has.
const STRIP_HTML = `
<div class="pt-preview-strip" role="note">
  <span data-icon="preview" data-i18n="previews.strip">Préversion</span>
  <strong class="pt-preview-strip__name"></strong>
  <a href="" data-i18n="previews.back">Revenir à la version publiée</a>
</div>`

// One of the mounts startAlpine() runs (alpineBoot.js), with the menu's: its
// text is translated with the rest of the static chrome.
export function mountPreviewStrip() {
  if (!previewSlug) return
  document.body.insertAdjacentHTML('afterbegin', STRIP_HTML)
  const strip = document.body.firstElementChild
  const name = strip.querySelector('.pt-preview-strip__name')
  const back = strip.querySelector('a')
  name.textContent = previewSlug
  back.addEventListener('click', () => (back.href = productionUrl()))
  openPreviews().then((list) => {
    const entry = list?.find((preview) => preview.slug === previewSlug)
    if (entry) name.textContent = `#${entry.number} ${entry.title}`
  })
}

const TAPS_TO_TOGGLE = 5
const TAP_WINDOW_MS = 3000

// The support page's version line: which build this is, and, tapped five times
// in a row, the switch for the menu's list — the "build number" of Android's
// developer options, which whoever is looking for it knows to try.
export function mountVersionLine(line) {
  const nativeApp = globalThis.__arabesqueApp
  line.textContent = `Version ${APP_VERSION}${nativeApp ? ` · app ${nativeApp.version} (${nativeApp.build})` : ''}`
  const status = line.appendChild(document.createElement('span'))
  let taps = []
  line.addEventListener('click', () => {
    const now = Date.now()
    taps = [...taps.filter((at) => now - at < TAP_WINDOW_MS), now]
    if (taps.length < TAPS_TO_TOGGLE) return
    taps = []
    status.textContent = ` · ${t(togglePreviewsWanted() ? 'previews.shown' : 'previews.hidden')}`
  })
}
