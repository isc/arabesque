// Offline support: an iPad on a music stand, with no network.
//
// The practice data was already local (IndexedDB, best-effort sync), so what
// stood between the app and a wifi-less rehearsal was only its own assets.
//
// Two caches, because they age differently. The shell is versioned by deploy
// and dropped whole when a new one lands. Everything whose filename already
// carries its version — the vendor bundles — and the scores go in a cache that
// outlives deploys: 1.8MB of OpenSheetMusicDisplay and Tone plus the pieces you
// actually play, re-downloaded on every merge to main otherwise, on the metered
// device this feature exists for.
//
// Cache-first everywhere, including the document. That is what makes a cold
// launch instant and an offline one possible, and it means a page is parsed
// against the scripts it shipped with. The cost is that a deploy is picked up
// one navigation late, which is what the update cycle in js/swRegister.js is
// for. Serving the document from the network instead would hand a new page to
// the previous worker's assets — the mismatch js/version.js exists for — and
// waiting for every client to close before activating strands the update
// indefinitely on a one-window app (Tablito's service worker carries the scar).
//
// Scores are the one exception, and they revalidate in the background. Their
// filenames carry no version, but their contents do change: a wrong trill, a
// cadenza re-engraved so it fits a system. Cache-first alone made that
// unfixable — a correction never reached a device that had opened the piece,
// and there was no way to make it, because the .mxl under that name was
// whatever it was the first time. Answering from the cache and refreshing after
// gives up nothing offline (the fetch fails and the cached copy is what was
// served anyway) and costs a conditional GET per opening online, which Pages
// answers with a 304 of a couple hundred bytes. The fix lands on the opening
// after the one that fetched it, which for a notation fix is soon enough.
//
// The alternative was to version the scores cache by a hash of public/scores/
// stamped at deploy time. It is worse on both counts that matter: one deploy in
// seven touches a score, and it would have evicted every cached piece on all of
// them — eagerly, at activation, while the refetch waits for the next opening.
// Update at home, walk to the lesson, and the music stand is empty.
//
// To remove this worker from every device, replace this file's body with
// `self.addEventListener('install', () => self.skipWaiting())` and an activate
// handler that claims clients, deletes every arabesque-* cache and calls
// registration.unregister(), then deploy: swRegister.js fetches sw.js past the
// HTTP cache, so it reaches devices without their having to load a page that
// may itself be broken.
//
// VERSION and SHELL are rewritten at deploy time by scripts/stamp-version.mjs;
// a checkout keeps 'dev' and an empty list, and swRegister.js declines to
// register at 'dev'.
const VERSION = 'a724b3004bb4'
const SHELL = ["./","data.html","data/fingerprints.json","data/scores.json","favicon.svg","index.html","js/account.js","js/app.js","js/autoSync.js","js/bpmStepper.js","js/cassettes.js","js/changelog.js","js/data.js","js/dayRollover.js","js/feedback.js","js/fingeringEditor.js","js/fingeringInjector.js","js/hands.js","js/headerMenu.js","js/i18n.js","js/installPrompt.js","js/journalEntries.js","js/legacyKeys.js","js/library.js","js/locales/en.js","js/locales/fr.js","js/metronomeClick.js","js/midi.js","js/midi_mock.js","js/musicalPeriods.js","js/musicxml.js","js/mxlLoader.js","js/noteExtraction.js","js/perfTrace.js","js/playback.js","js/playbackTiming.js","js/practice.js","js/practiceTracker.js","js/profiles.js","js/screenshot.js","js/storage.js","js/strictMatching.js","js/strictPlaythrough.js","js/supabaseClient.js","js/supabaseConfig.js","js/swRegister.js","js/sync.js","js/tempoMarks.js","js/tempoTrainer.js","js/utils.js","js/version.js","library.html","manifest.webmanifest","practice.html","privacy.html","score.html","styles.css","support.html","vendor/alpinejs.3.14.9.min.js","vendor/jszip.3.10.1.min.js","vendor/node-async-hooks.min.js","vendor/node-events.min.js","vendor/opensheetmusicdisplay.2.1.2.min.js","vendor/tone.14.8.49.min.js","vendor/tonejs-piano.0.2.1.min.js","vendor/webmidi.2.5.3.min.js"]

const SHELL_CACHE = `arabesque-shell-${VERSION}`
const LASTING_CACHE = 'arabesque-lasting'

// Which cache answers for a path. Kept next to each other because they are one
// decision; what is precached at install is a separate one, in
// scripts/stamp-version.mjs.
const isScore = (pathname) => pathname.includes('/scores/')
const lasting = (pathname) => isScore(pathname) || pathname.includes('/vendor/')
const cacheFor = (pathname) => (lasting(pathname) ? LASTING_CACHE : SHELL_CACHE)

self.addEventListener('install', (event) => {
  event.waitUntil(precache().then(() => self.skipWaiting()))
})

// One request per asset rather than cache.addAll(), which is atomic: a single
// failure — routine on the weak wifi where an offline cache is worth most —
// would reject the whole precache and leave the device with no cache at all for
// this version. What fails here is cached on first use instead.
//
// `cache: 'reload'` so what is fetched comes from the network rather than from
// the previous deploy's HTTP cache entries, which would be stored under this
// version's name and kept until the next one — but only for what is actually
// missing. Everything in the lasting cache is already right by construction
// (its filename carries its version), and re-fetching it made a deploy cost
// 1.8MB of vendor bundles the device had all along.
async function precache() {
  await Promise.all(
    SHELL.map(async (asset) => {
      const url = new URL(asset, self.location.href)
      const cache = await caches.open(cacheFor(url.pathname))
      if (await cache.match(url, { ignoreVary: true })) return
      await cache.add(new Request(url, { cache: 'reload' })).catch(() => {})
    }),
  )
}

self.addEventListener('activate', (event) => {
  event.waitUntil(dropOldShells().then(() => self.clients.claim()))
})

async function dropOldShells() {
  const keys = await caches.keys()
  const stale = keys.filter((key) => key.startsWith('arabesque-') && key !== SHELL_CACHE && key !== LASTING_CACHE)
  await Promise.all(stale.map((key) => caches.delete(key)))
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET') return

  const url = new URL(request.url)
  // Supabase, and the esm.sh bundle it comes from, are somebody else's origin
  // and somebody else's freshness. Signing in and syncing need a network anyway.
  if (url.origin !== self.location.origin) return
  // 3.2MB of landing video nobody needs offline.
  if (url.pathname.includes('/video/')) return

  if (isScore(url.pathname)) {
    event.respondWith(staleWhileRevalidate(request, cacheFor(url.pathname), (work) => event.waitUntil(work)))
    return
  }
  // score.html?url=… is the same document whichever score it is about, so a
  // navigation ignores the query.
  event.respondWith(cacheFirst(request, cacheFor(url.pathname), request.mode === 'navigate'))
})

// ignoreVary as well: Pages answers with Vary headers that a navigation request
// does not reproduce, and a cached entry that cannot be matched is a cache miss
// with extra steps.
async function cacheFirst(request, cacheName, ignoreSearch = false) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request, { ignoreSearch, ignoreVary: true })
  if (cached) return cached

  const response = await fetch(request)
  // A 404 or a 5xx is not worth keeping; both are passed through and retried.
  if (response.ok) cache.put(request, response.clone())
  return response
}

// How the scores are served, and only the scores — see the note at the top of
// this file. A miss is an ordinary cache-first fetch; a hit is answered from the
// cache and the copy replaced behind it.
//
// `keepAlive` is the event's waitUntil: a worker is free to stop the moment it
// has answered, and the refresh has to outlive that answer or it is cancelled
// and the correction never lands.
async function staleWhileRevalidate(request, cacheName, keepAlive) {
  const cache = await caches.open(cacheName)
  const cached = await cache.match(request, { ignoreVary: true })
  if (!cached) return cacheFirst(request, cacheName)

  keepAlive(refresh(request, cache))
  return cached
}

// Offline, or the server having a bad day, leaves the cached copy exactly as it
// was — which is the copy the page was already given. Nothing to report and
// nobody to report it to, so the failure is swallowed rather than left to
// surface as an unhandled rejection inside waitUntil.
async function refresh(request, cache) {
  try {
    const response = await fetch(request)
    if (response.ok) await cache.put(request, response)
  } catch {}
}
