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
// A deploy puts its stamp in the URL of its scripts (scripts/stamp-version.mjs),
// so a fresh document can no longer be handed an older deploy's. What that leaves
// is an old document: served from memory with its old scripts or, for one memory
// has dropped, the current copy, since neither Pages nor the worker reads the
// stamp. So this file keeps its bare URL, and both sides carry the same stamp —
// this constant and each page's <meta name="app-version"> — rewritten in one pass
// at deploy time. When they disagree the pairing is stale, and a reload fixes it:
// unlike a back navigation it revalidates the document *and* its subresources, so
// it repairs the mismatch whichever side is behind.
//
// That bare URL lets a copy of this file outlive its deploy's modules, so they
// import APP_VERSION from it and nothing else (test/js/stampVersion.test.js): a
// new export asked of an old copy would stop their whole graph from linking.
//
// Pages load this on a <script type="module"> tag of its own, ahead of their
// entry script, and it imports nothing statically: it has to run when the entry
// script's graph could not be loaded or linked (checkBoot below).
//
// Left at 'dev' in the repo, which is what both sides say when the app is
// served from a checkout, so the check never fires in development or in tests.
export const APP_VERSION = 'b03346fd3fa9'

// legacyKeys.js owns this prefix; inlined rather than imported, see above.
const RELOAD_KEY = 'arabesque:version-reload'

const pageStamp = () => document.querySelector('meta[name="app-version"]')?.getAttribute('content')

// False once `value` has already had its attempt at `key` this session, and
// where sessionStorage is unavailable: without the guard a reload could loop.
function spendAttempt(key, value) {
  try {
    if (sessionStorage.getItem(key) === value) return false
    sessionStorage.setItem(key, value)
    return true
  } catch {
    return false
  }
}

// Into the error log, for the next report to show. The log is imported here
// rather than at the top (see there): it is the first script of every page, so
// this reaches a module already running.
const record = (error, where) =>
  import('./errorLog.js?v=b03346fd3fa9')
    .then(({ recordError }) => recordError(error, where))
    .catch(() => {})

// Under a service worker as well. A worker answers a page and its scripts out
// of one deploy's cache, and this check used to leave pages it serves alone —
// until an iPad ran a day-old deploy's scripts under the new score page, behind
// the new deploy's worker, for half an hour (feedback 13c5d005). WebKit's
// memory cache does that: it hands a page a copy it still holds without asking
// the worker, and a reload is what makes it ask.
export function checkAppVersion() {
  const pageVersion = pageStamp()
  if (!pageVersion || pageVersion === APP_VERSION) return

  // One attempt per document per session, and per pair of versions: staleness
  // is per cache entry, so the reload library.html spends must not be charged
  // to practice.html later in the same session, while a deploy that lands
  // mid-session moves the scripts side and deserves its own attempt. Coming
  // back still mismatched means the stale side sat in a cache the reload
  // didn't reach — keep the degraded page rather than reloading it forever.
  if (!spendAttempt(`${RELOAD_KEY}:${location.pathname}`, `${pageVersion} ${APP_VERSION}`)) {
    console.warn(`Arabesque: stale assets (page ${pageVersion}, scripts ${APP_VERSION}) survived a reload or cannot reload.`)
    return
  }
  return record(new Error(`page ${pageVersion}, scripts ${APP_VERSION}`), 'Stale assets').finally(() => location.reload())
}

// A page whose scripts never ran. One module failing to load or to link takes
// its whole graph down, and what is left has no menu to report it from, and in
// the iOS app no reload button either (feedback 88e8152f). Module scripts run
// before `load`, and Alpine's own script, which startAlpine() adds, holds it back
// too, so a page with bindings and no Alpine by then is such a page. A page that
// never started holds nothing to lose: it reloads once, and if that was not
// enough it says so and offers what the menu would have.
export function checkBoot() {
  if (!document.querySelector('[x-data]') || window.Alpine) return
  const first = spendAttempt(`${RELOAD_KEY}:boot:${location.pathname}`, pageStamp() ?? '')
  return record(new Error(`${location.pathname} did not start`), 'Boot failure').finally(
    first ? () => location.reload() : showBootFailure,
  )
}

// Written here rather than in the locales: i18n.js imports them, and any of the
// three may be what failed. The language follows the same rule as i18n.js.
const BOOT_FAILURE_TEXT = {
  fr: {
    title: 'Cette page n’a pas pu se charger.',
    hint: 'Le rapport contient les erreurs de la page, la description de l’appareil et l’adresse e-mail déjà donnée pour les avis, s’il y en a une.',
    reload: 'Recharger',
    report: 'Envoyer un rapport',
    sent: 'Rapport envoyé, merci.',
    failed: 'Le rapport n’a pas pu partir.',
  },
  en: {
    title: 'This page could not load.',
    hint: 'The report holds the page’s errors, a description of the device and the email address already given for feedback, if any.',
    reload: 'Reload',
    report: 'Send a report',
    sent: 'Report sent, thank you.',
    failed: 'The report could not be sent.',
  },
}

function bootFailureText() {
  let lang = null
  try {
    lang = localStorage.getItem('arabesque:lang') // i18n.js's LANG_KEY, inlined, see above
  } catch {
    /* localStorage unavailable: the browser's language it is */
  }
  return BOOT_FAILURE_TEXT[lang ?? navigator.language.slice(0, 2).toLowerCase()] ?? BOOT_FAILURE_TEXT.en
}

function showBootFailure() {
  const text = bootFailureText()
  const panel = document.createElement('dialog')
  panel.className = 'pt-boot-failure'
  panel.dataset.testid = 'boot-failure'
  panel.open = true
  panel.innerHTML = `
    <article class="pt-stack">
      <h2>${text.title}</h2>
      <p class="pt-hint">${text.hint}</p>
      <div class="pt-data-actions">
        <button type="button">${text.reload}</button>
        <button type="button" class="outline secondary">${text.report}</button>
      </div>
      <p role="status"></p>
    </article>`
  const [reload, report] = panel.querySelectorAll('button')
  const status = panel.querySelector('[role="status"]')
  reload.addEventListener('click', () => location.reload())
  report.addEventListener('click', async () => {
    report.disabled = true
    try {
      const { buildBaseContext, defaultFeedbackEmail, submitFeedback } = await import('./feedback.js?v=b03346fd3fa9')
      await submitFeedback({
        message: `${text.title} (${location.pathname})`,
        email: defaultFeedbackEmail(),
        category: 'bug',
        context: await buildBaseContext(),
      })
      status.textContent = text.sent
    } catch (error) {
      record(error, 'Boot failure report')
      status.textContent = text.failed
      report.disabled = false
    }
  })
  document.body.append(panel)
}

// Runs on import, the way legacyKeys.js does: pages load this module for the
// effect, and the exports are there for feedback.js and the tests. At `load`,
// because a reload sent while the scripts were still arriving left memory's
// copies in place more often than not, this file's included, and spent the only
// attempt (replayed in WebKit, feedback 88e8152f); sent after it, they went to
// the worker. A stale page that reloads has no need of the second check.
if (typeof document !== 'undefined') {
  window.addEventListener('load', () => checkAppVersion() ?? checkBoot())
}
