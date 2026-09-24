// The JavaScript errors the app ran into lately, for a feedback report to carry.
//
// A report says what the player saw; the error behind it went to a console
// nobody had open. This keeps a short list for feedback.js to attach as
// `context.errors`: what nobody caught, from the window's `error` and
// `unhandledrejection` events, and what the app caught on purpose but wants to
// hear about, through recordError().
//
// Every page loads it on a <script type="module"> tag of its own, ahead of all
// its other scripts: module and deferred scripts run in document order, so the
// listeners are in place before version.js, the vendor bundles and the page's
// own module graph are evaluated. It imports nothing for the reason version.js
// gives. test/js/errorLog.test.js holds every page to it.
//
// Kept in sessionStorage, so an error on the score page is still there when
// the player goes back to the library to write about it — including a library
// restored from the back/forward cache, which is why it is read back at every
// use rather than held in the module. Per tab and gone with it, which suits
// "what just went wrong"; memory stands in where storage is refused.
//
// Bounded, so a report never grows with an error thrown in a loop: one entry
// per distinct error (same message, same first frame) counting its repeats,
// each cut to a message and a few frames, the last MAX_ENTRIES of them, none
// older than MAX_AGE_MS.

// legacyKeys.js owns this prefix; inlined rather than imported, see above.
const STORAGE_KEY = 'arabesque:recent-errors'

export const MAX_ENTRIES = 10
export const MAX_AGE_MS = 60 * 60 * 1000
const MAX_MESSAGE_LENGTH = 300
const MAX_FRAMES = 5
const MAX_LINE_LENGTH = 200 // a stack frame, the page's path

// Errors that say nothing about the app:
//  - "Script error." is all a browser reveals of a cross-origin script's error:
//    no message, no location;
//  - ResizeObserver's loop notice is benign by spec, and Chrome reports it as
//    an error on ordinary layouts;
//  - a stack made only of extension frames is an extension's own bug (Safari
//    masks their URLs as webkit-masked-url://hidden/).
const SCRIPT_ERROR = /^Script error\.?$/
const RESIZE_OBSERVER_LOOP = /ResizeObserver loop/
const EXTENSION_FRAME = /(?:chrome|moz|safari(?:-web)?)-extension:\/\/|webkit-masked-url:/

// Where storage is refused, and where it accepted a read but refused a write.
let unstored = []

function load() {
  try {
    const list = JSON.parse(sessionStorage.getItem(STORAGE_KEY))
    if (Array.isArray(list)) return list
  } catch {
    /* unavailable or garbled: what this page kept is all there is */
  }
  return unstored
}

function save(list) {
  unstored = list
  try {
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify(list))
  } catch {
    // Full, say: drop the stored copy, or load() would keep answering with it.
    try {
      sessionStorage.removeItem(STORAGE_KEY)
    } catch {
      /* no storage at all */
    }
  }
}

const cut = (text, length) => (text.length > length ? `${text.slice(0, length - 1)}…` : text)

function textOf(value) {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value) ?? String(value)
  } catch {
    return String(value)
  }
}

// An Error, a DOMException, a thrown string, a rejection with anything at all.
// `site` is the "file:line:col" an error event names, for a thrown value that
// carries no stack of its own. Null for noise.
function describe(error, site) {
  const errorLike = typeof error?.message === 'string'
  const name = errorLike && typeof error.name === 'string' ? error.name : ''
  const text = errorLike ? error.message : textOf(error)
  const message = name && text ? `${name}: ${text}` : text || name
  if (RESIZE_OBSERVER_LOOP.test(message)) return null

  let frames = []
  if (errorLike && typeof error.stack === 'string') {
    // V8 opens a stack with the error's own "Name: message" line(s); WebKit and
    // Gecko go straight to the frames.
    const header = [message, text].find((line) => line && error.stack.startsWith(line))
    frames = error.stack
      .slice(header?.length ?? 0)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean)
  }
  if (frames.length === 0 && site) frames = [site]
  if (frames.length === 0 && SCRIPT_ERROR.test(message)) return null
  if (frames.length > 0 && frames.every((frame) => EXTENSION_FRAME.test(frame))) return null

  return {
    message: cut(message, MAX_MESSAGE_LENGTH),
    stack: frames
      .slice(0, MAX_FRAMES)
      .map((frame) => cut(frame.replaceAll(`${location.origin}/`, ''), MAX_LINE_LENGTH)),
  }
}

function record(error, where, site) {
  try {
    const described = describe(error, site)
    if (!described) return
    const list = recentErrors()
    const same = list.findIndex(
      (entry) => entry.message === described.message && entry.stack[0] === described.stack[0],
    )
    const count = same === -1 ? 1 : list.splice(same, 1)[0].count + 1
    list.push({
      ...described,
      where,
      page: cut(location.pathname + location.search, MAX_LINE_LENGTH),
      count,
      at: new Date().toISOString(),
    })
    save(list.slice(-MAX_ENTRIES))
  } catch {
    /* Keeping the record must never be the next error. */
  }
}

// For an error the app catches and gets past, but that a report should still
// mention: logged the way a catch block would, and kept. `where` says what
// failed, in words that read as well in the console as in a report.
export function recordError(error, where) {
  console.error(`${where}:`, error)
  record(error, where)
}

// What feedback.js sends: the entries still within MAX_AGE_MS, least recently
// seen first.
export function recentErrors() {
  const since = Date.now() - MAX_AGE_MS
  return load().filter((entry) => Date.parse(entry.at) >= since)
}

if (typeof window !== 'undefined') {
  window.addEventListener('error', (event) => {
    const site = event.filename ? `${event.filename}:${event.lineno}:${event.colno}` : ''
    record(event.error ?? event.message, 'uncaught', site)
  })
  window.addEventListener('unhandledrejection', (event) => record(event.reason, 'unhandled rejection'))
}
