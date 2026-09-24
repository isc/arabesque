import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

// The buffer of recent errors a feedback report carries (public/js/errorLog.js).
// The suite runs in node, so each test gets a fresh module — a page load — over
// a sessionStorage and a location of its own.

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const pages = readdirSync(PUBLIC_DIR).filter((name) => name.endsWith('.html'))
const STORAGE_KEY = 'arabesque:recent-errors'

const fakeSessionStorage = () => {
  const store = new Map()
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
  }
}

// A page being loaded at `path`: the module evaluated afresh, the way every
// page load evaluates it, with a window to install its listeners on.
async function loadPage(path = '/score.html?url=scores/x.mxl') {
  const url = new URL(path, 'https://arabesque.app')
  vi.stubGlobal('location', { origin: url.origin, pathname: url.pathname, search: url.search })
  vi.stubGlobal('window', new EventTarget())
  vi.resetModules()
  return import('../../public/js/errorLog.js')
}

// A V8 stack, the shape Chrome gives error.stack.
function errorAt(message, frames, ErrorType = Error) {
  const error = new ErrorType(message)
  error.stack = [`${error.name}: ${message}`, ...frames.map((frame) => `    at ${frame}`)].join('\n')
  return error
}

const APP_FRAME = 'draw (https://arabesque.app/js/app.js:120:7)'

const dispatch = (type, properties) => window.dispatchEvent(Object.assign(new Event(type), properties))

// recordError logs what it keeps; the test output has no use for it.
beforeEach(() => vi.spyOn(console, 'error').mockImplementation(() => {}))
afterEach(() => vi.restoreAllMocks())

describe('errorLog', () => {
  let storage

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-09-24T20:00:00Z'))
    storage = fakeSessionStorage()
    vi.stubGlobal('sessionStorage', storage)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('keeps what an error says, where it was thrown from, and on which page', async () => {
    const { recordError, recentErrors } = await loadPage()
    const error = errorAt('x is undefined', [APP_FRAME, 'play (https://arabesque.app/js/app.js:80:3)'], TypeError)
    recordError(error, 'Score could not be played')

    expect(recentErrors()).toEqual([
      {
        message: 'TypeError: x is undefined',
        // The origin is the same on every frame; the path is what says where.
        stack: ['at draw (js/app.js:120:7)', 'at play (js/app.js:80:3)'],
        where: 'Score could not be played',
        page: '/score.html?url=scores/x.mxl',
        count: 1,
        at: '2026-09-24T20:00:00.000Z',
      },
    ])
    // And still says it in the console, where the catch block it replaces did.
    expect(console.error).toHaveBeenCalledWith('Score could not be played:', error)
  })

  it('counts an error that comes back rather than listing it again', async () => {
    const { recordError, recentErrors } = await loadPage()
    recordError(errorAt('boom', [APP_FRAME]), 'here')
    vi.advanceTimersByTime(5000)
    recordError(errorAt('boom', [APP_FRAME]), 'here')

    const [entry] = recentErrors()
    expect(recentErrors()).toHaveLength(1)
    expect(entry.count).toBe(2)
    expect(entry.at).toBe('2026-09-24T20:00:05.000Z')
  })

  it('tells apart the same message thrown from two places', async () => {
    const { recordError, recentErrors } = await loadPage()
    recordError(errorAt('boom', [APP_FRAME]), 'here')
    recordError(errorAt('boom', ['other (https://arabesque.app/js/library.js:3:1)']), 'there')
    expect(recentErrors().map((entry) => entry.count)).toEqual([1, 1])
  })

  it('keeps the last ten distinct errors, an old one that came back among them', async () => {
    const { recordError, recentErrors, MAX_ENTRIES } = await loadPage()
    for (let i = 0; i < MAX_ENTRIES; i++) recordError(new Error(`error ${i}`), 'loop')
    recordError(new Error('error 0'), 'loop')
    recordError(new Error('error 10'), 'loop')

    const messages = recentErrors().map((entry) => entry.message)
    expect(messages).toHaveLength(MAX_ENTRIES)
    expect(messages[0]).toBe('Error: error 2')
    expect(messages.slice(-2)).toEqual(['Error: error 0', 'Error: error 10'])
  })

  it('cuts a long message and a deep stack down', async () => {
    const { recordError, recentErrors } = await loadPage()
    const frames = Array.from({ length: 12 }, (_, i) => `f${i} (https://arabesque.app/js/app.js:${i}:1)`)
    frames[0] = `${'deep'.repeat(100)} (https://arabesque.app/js/app.js:1:1)`
    recordError(errorAt('m'.repeat(1000), frames), 'here')

    const [entry] = recentErrors()
    expect(entry.message).toHaveLength(300)
    expect(entry.message.endsWith('…')).toBe(true)
    expect(entry.stack).toHaveLength(5)
    expect(entry.stack[0]).toHaveLength(200)
  })

  it('describes whatever was thrown or rejected, not only Errors', async () => {
    const { recordError, recentErrors } = await loadPage()
    recordError('a string', 'a')
    recordError({ code: 42 }, 'b')
    recordError({ message: 'no stack' }, 'c')
    recordError(undefined, 'd')
    expect(recentErrors().map((entry) => [entry.message, entry.stack])).toEqual([
      ['a string', []],
      ['{"code":42}', []],
      ['no stack', []],
      ['undefined', []],
    ])
  })

  it('records what nobody caught, thrown or rejected', async () => {
    const { recentErrors } = await loadPage()
    dispatch('error', { error: errorAt('boom', [APP_FRAME], TypeError), message: 'Uncaught TypeError: boom' })
    dispatch('unhandledrejection', { reason: errorAt('lost', [APP_FRAME], RangeError) })
    // A thrown non-Error has no stack: the event's location stands in for one.
    dispatch('error', {
      error: 'plain',
      message: 'Uncaught plain',
      filename: 'https://arabesque.app/library.html',
      lineno: 4,
      colno: 2,
    })

    expect(recentErrors().map(({ message, where, stack }) => ({ message, where, stack }))).toEqual([
      { message: 'TypeError: boom', where: 'uncaught', stack: ['at draw (js/app.js:120:7)'] },
      { message: 'RangeError: lost', where: 'unhandled rejection', stack: ['at draw (js/app.js:120:7)'] },
      { message: 'plain', where: 'uncaught', stack: ['library.html:4:2'] },
    ])
  })

  it('ignores errors that say nothing about the app', async () => {
    const { recordError, recentErrors } = await loadPage()
    // What a cross-origin script's error is reduced to.
    dispatch('error', { error: null, message: 'Script error.', filename: '', lineno: 0, colno: 0 })
    dispatch('error', {
      error: null,
      message: 'ResizeObserver loop completed with undelivered notifications.',
    })
    recordError(errorAt('ext', ['run (chrome-extension://abcdef/content.js:1:1)']), 'x')
    recordError(errorAt('ext', ['run (webkit-masked-url://hidden/:1:1)']), 'x')
    expect(recentErrors()).toEqual([])

    // An extension frame on top of the app's own is still the app's business.
    recordError(errorAt('mixed', ['run (chrome-extension://abcdef/content.js:1:1)', APP_FRAME]), 'x')
    expect(recentErrors()).toHaveLength(1)
  })

  it('hands what one page recorded to the next page of the tab', async () => {
    const score = await loadPage('/score.html')
    score.recordError(new Error('on the score page'), 'score')

    const library = await loadPage('/library.html')
    expect(library.recentErrors().map((entry) => [entry.message, entry.page])).toEqual([
      ['Error: on the score page', '/score.html'],
    ])
  })

  it('forgets errors older than an hour', async () => {
    const { recordError, recentErrors, MAX_AGE_MS } = await loadPage()
    recordError(new Error('old'), 'x')
    vi.advanceTimersByTime(MAX_AGE_MS / 2)
    recordError(new Error('newer'), 'x')
    vi.advanceTimersByTime(MAX_AGE_MS / 2 + 1)
    expect(recentErrors().map((entry) => entry.message)).toEqual(['Error: newer'])
  })

  it('keeps them in memory when sessionStorage is unavailable', async () => {
    vi.stubGlobal('sessionStorage', undefined)
    const { recordError, recentErrors } = await loadPage()
    recordError(new Error('kept anyway'), 'x')
    expect(recentErrors().map((entry) => entry.message)).toEqual(['Error: kept anyway'])
  })

  // Safari's old private mode: reads work, every write throws.
  it('keeps them in memory, not in a stale stored copy, when storage refuses writes', async () => {
    const { recordError, recentErrors } = await loadPage()
    recordError(new Error('stored'), 'x')
    storage.setItem = () => {
      throw new DOMException('Quota exceeded', 'QuotaExceededError')
    }
    recordError(new Error('not stored'), 'x')
    expect(recentErrors().map((entry) => entry.message)).toEqual(['Error: stored', 'Error: not stored'])
  })

  it('shrugs off a stored value it cannot read', async () => {
    storage.setItem(STORAGE_KEY, 'not json')
    const { recordError, recentErrors } = await loadPage()
    expect(recentErrors()).toEqual([])
    recordError(new Error('fresh'), 'x')
    expect(recentErrors()).toHaveLength(1)
  })
})

describe('the feedback context', () => {
  beforeEach(() => vi.stubGlobal('sessionStorage', fakeSessionStorage()))
  afterEach(() => vi.unstubAllGlobals())

  it('carries the recent errors, and no key at all when there are none', async () => {
    const { recordError } = await loadPage()
    const { buildBaseContext } = await import('../../public/js/feedback.js')
    expect(buildBaseContext()).not.toHaveProperty('errors')

    recordError(new Error('before the report'), 'x')
    expect(buildBaseContext().errors.map((entry) => entry.message)).toEqual(['Error: before the report'])
  })
})

// The listeners only catch what is thrown after they are installed, and a page
// that does not load them at all sends reports without its errors. Module and
// deferred scripts run in document order, so first among them is first to run;
// an inline classic script runs during parsing, before any of them could.
describe('every page', () => {
  it.each(pages)('%s loads the error log ahead of its other scripts', (page) => {
    const html = readFileSync(join(PUBLIC_DIR, page), 'utf8')
    const scripts = html.match(/<script\b[^>]*>/g).filter((tag) => /\bsrc=|type="module"/.test(tag))
    expect(scripts[0]).toBe('<script type="module" src="js/errorLog.js">')
  })
})
