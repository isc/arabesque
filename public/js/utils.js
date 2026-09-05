import { t, locale } from './i18n.js'
import { TWO_HANDS } from './hands.js'

// Built once: the active locale is fixed for the page lifetime (switching
// language reloads), so the verbose-date formatter needn't rebuild per call.
const VERBOSE_DATE_FORMATTER = new Intl.DateTimeFormat(locale(), { weekday: 'long', day: 'numeric', month: 'long' })

export function isTestEnv() {
  return document.cookie.includes('test-env')
}

// Runs `fn` once the browser has nothing better to do. The one policy for
// "wanted, but not at the cost of what the page is doing right now" — a warm-up
// import, an endpoint whose answer only feeds an optional control. Resolved per
// call rather than once at module load: this module is imported by the node
// test environment too, where there is no window to read it off.
export function onIdle(fn) {
  if (typeof requestIdleCallback === 'function') return requestIdleCallback(fn)
  return setTimeout(fn, 0)
}

// The page coming back to the foreground: a tab switched back to, or — the case
// that matters on an iPad — an app resumed, since the wrapper's webview is
// suspended and woken rather than reloaded. Everything that waits for this
// wants the same triggers, so they are written once here.
//
// visibilitychange carries the tab. It does not carry the app: a library page
// woken with the wrapper kept the evening before's practice under
// "aujourd'hui" until a navigation rebuilt it, so nothing on the page had
// heard. What the wrapper does hear is didBecomeActive, and it now forwards it
// as this event (ios/Arabesque/ViewController.swift). No visibility guard on
// that one — the app becoming active is the signal, and what WKWebView reports
// for document.visibilityState across a suspension is the very thing that
// could not be relied on.
//
// Both can fire for a single return. Every caller is idempotent — a day key
// that hasn't changed, a sync inside its throttle window, a wake lock already
// held — so the duplicate costs a comparison.
export const NATIVE_FOREGROUND_EVENT = 'arabesque:foreground'

export function onForeground(fn) {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') fn()
  })
  document.addEventListener(NATIVE_FOREGROUND_EVENT, fn)
}

// Pixel offset for the currently-visible sticky bars (topbar + modebar +
// optional mode-context band), used both by scrollToMeasure() and by the
// CSS scroll-margin-top via the --pt-sticky-offset variable.
// Headroom kept above the auto-scrolled measure. Has to cover the fingering
// numerals that hover above the top staff line (~20px) plus a few pixels
// breathing — otherwise the modebar clips them right where the eyes look.
const STICKY_BREATHING_PX = 28

function getStickyOffset() {
  let offset = STICKY_BREATHING_PX
  for (const el of document.querySelectorAll('.pt-topbar, .pt-modebar, .pt-context')) {
    if (getComputedStyle(el).display === 'none') continue
    offset += el.getBoundingClientRect().height
  }
  return offset
}

export function applyStickyOffset() {
  document.documentElement.style.setProperty('--pt-sticky-offset', `${getStickyOffset()}px`)
}

// Vertical band scanned above the reference line to catch fingerings, dynamics
// and tempo markings — anything that hovers above the top staff line. Kept
// smaller than the tightest system spacing (~109px here) so we don't grab the
// previous system's content.
const SYSTEM_TOP_LOOKUP_PX = 80

// Topmost y (viewport space) of the score content sitting just above
// `referenceTop` — i.e. the visual top of the system the reference line belongs
// to, rather than the bare staff line. Falls back to referenceTop when nothing
// is found above.
function findSystemTopAnchor(referenceTop, svg) {
  let topmost = referenceTop
  for (const ann of svg.querySelectorAll('text')) {
    const r = ann.getBoundingClientRect()
    // +1 absorbs sub-pixel rounding so a text whose bottom == referenceTop isn't excluded.
    if (r.bottom > referenceTop + 1) continue
    if (r.top < referenceTop - SYSTEM_TOP_LOOKUP_PX) continue
    if (r.top < topmost) topmost = r.top
  }
  return topmost
}

// Scroll the document so the system whose top staff line is at `referenceTop`
// (viewport space — a measure rect or the playback cursor) sits just below the
// sticky bars, leaving getStickyOffset() of headroom for the above-staff
// markings. Shared by the measure cursor (musicxml.js) and the playback cursor
// (playback.js) so both autoscroll paths behave identically.
export function scrollSystemIntoView(referenceTop, svg) {
  if (!svg) return
  const anchorTop = findSystemTopAnchor(referenceTop, svg)
  const targetY = window.scrollY + anchorTop - getStickyOffset()
  window.scrollTo({ top: Math.max(0, targetY), behavior: 'smooth' })
}

// Canonical link to the score page for a library score URL ("scores/<file>").
export function scorePageUrl(url) {
  return `score.html?url=${encodeURIComponent(url)}`
}

export function formatDuration(ms) {
  const totalSeconds = Math.floor(ms / 1000)
  const totalMinutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (totalMinutes === 0) return `${seconds}s`
  if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${hours}h ${minutes}m`
}

// Captions a run of the score with the hands that played it. Two hands is the
// plain case and captions nothing: an unlabelled run is the piece played whole.
export function withHands(text, hands) {
  return hands === TWO_HANDS ? text : `${text} · ${t(`hands.${hands}`)}`
}

// Captions a group of runs (see hands' playthroughGroups): "… · mode strict ·
// main droite", each qualifier only when it isn't the default.
export function withRunKind(text, { hands, strict }) {
  return withHands(strict ? `${text} · ${t('score.strictRuns')}` : text, hands)
}

export function statusLabel(status) {
  return status ? t(`status.${status}`) : status
}

function daysAgo(date) {
  const today = new Date()
  today.setHours(0, 0, 0, 0)
  const compareDate = new Date(date)
  compareDate.setHours(0, 0, 0, 0)
  return { compareDate, diffDays: Math.floor((today - compareDate) / (1000 * 60 * 60 * 24)) }
}

// Compact relative date for table cells. formatDate is the verbose
// counterpart ("vendredi 8 mai") used for headings.
export function formatRelativeDate(date) {
  if (!date) return ''
  const { diffDays } = daysAgo(date)
  if (diffDays === 0) return t('date.today')
  if (diffDays === 1) return t('date.yesterday')
  if (diffDays < 30) return t('date.daysAgo', { n: diffDays })
  if (diffDays < 365) return t('date.monthsAgo', { n: Math.floor(diffDays / 30) })
  const years = Math.floor(diffDays / 365)
  return t(years > 1 ? 'date.yearsAgo' : 'date.yearAgo', { n: years })
}

// "vendredi 8 mai" — the long form, whatever the day. formatDate() below is
// the same thing with a relative shortcut for the two most recent days.
export function formatVerboseDate(date) {
  return VERBOSE_DATE_FORMATTER.format(new Date(date))
}

export function formatDate(date) {
  const { compareDate, diffDays } = daysAgo(date)
  if (diffDays === 0) return t('date.today')
  if (diffDays === 1) return t('date.yesterday')
  return formatVerboseDate(compareDate)
}
