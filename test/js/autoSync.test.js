import { describe, it, expect, beforeEach, vi } from 'vitest'
import 'fake-indexeddb/auto'
import { initStorage } from '../../public/js/storage.js'
import { initPracticeTracker } from '../../public/js/practiceTracker.js'
import { setSyncSignedIn } from '../../public/js/sync.js'

// The module under test only ever reaches Supabase through this one import,
// which the real page loads lazily from a CDN.
const getSession = vi.fn(async () => ({ data: { session: { user: { id: 'user-1' } } } }))
vi.mock('../../public/js/supabaseClient.js', () => ({
  supabase: { auth: { getSession: () => getSession() } },
  authRedirectUrl: () => '',
}))

// runSync itself is covered by sync.test.js; here we only care about *when*
// autoSync decides to call it.
const SUMMARY = { pushed: 1, pulled: 0, fingeringsPushed: 0, fingeringsPulled: 0 }
const runSync = vi.fn(async () => SUMMARY)
vi.mock('../../public/js/sync.js', async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, runSync: (...args) => runSync(...args) }
})

// The page globals sync.js and autoSync.js touch (the suite runs in node).
function installBrowserGlobals() {
  const store = new Map()
  globalThis.localStorage = {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
    removeItem: (k) => store.delete(k),
  }
  const listeners = new Map()
  globalThis.window = {}
  globalThis.document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  }
  return (state) => {
    globalThis.document.visibilityState = state
    ;(listeners.get('visibilitychange') ?? []).forEach((fn) => fn())
  }
}

describe('autoSync', () => {
  let deps
  let autoSync
  let setVisibility

  beforeEach(async () => {
    vi.resetModules()
    runSync.mockClear()
    getSession.mockClear()
    setVisibility = installBrowserGlobals()
    indexedDB = new IDBFactory()
    const storage = initStorage()
    await storage.init()
    deps = { storage, practiceTracker: initPracticeTracker(storage) }
    // Fresh module state (the throttle is module-level) for every test.
    autoSync = await import('../../public/js/autoSync.js')
    setSyncSignedIn(true)
  })

  it('does nothing when no account is signed in on this device', () => {
    setSyncSignedIn(false)
    autoSync.initAutoSync(deps, { syncOnOpen: true })
    autoSync.triggerSync('test')
    expect(runSync).not.toHaveBeenCalled()
  })

  it('syncs on open when automatic sync is on', async () => {
    autoSync.initAutoSync(deps, { syncOnOpen: true })
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))
  })

  it('does not sync on open unless the page asks for it', () => {
    autoSync.initAutoSync(deps)
    expect(runSync).not.toHaveBeenCalled()
  })

  it('takes the user id from the local session, sparing runSync a round-trip', async () => {
    autoSync.initAutoSync(deps)
    await autoSync.requestSync()
    expect(runSync).toHaveBeenCalledWith(expect.objectContaining({ userId: 'user-1' }))
  })

  it('skips a second trigger inside the throttle window', async () => {
    autoSync.initAutoSync(deps)
    autoSync.triggerSync('first')
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))
    autoSync.triggerSync('second')
    expect(runSync).toHaveBeenCalledTimes(1)
  })

  it('lets a just-ended session through the idle throttle', async () => {
    autoSync.initAutoSync(deps)
    autoSync.triggerSync('tab back')
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))

    // 10s on: still inside the idle window, well past the session-ended one.
    const realNow = Date.now.bind(Date)
    vi.spyOn(Date, 'now').mockImplementation(() => realNow() + 10000)

    autoSync.triggerSync('tab back')
    expect(runSync).toHaveBeenCalledTimes(1)

    autoSync.triggerSync('session ended')
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(2))
    Date.now.mockRestore()
  })

  it('collapses concurrent callers onto a single round-trip', async () => {
    autoSync.initAutoSync(deps)
    const [a, b] = await Promise.all([autoSync.requestSync(), autoSync.requestSync()])
    expect(runSync).toHaveBeenCalledTimes(1)
    expect(a).toBe(b)
  })

  it('does not sync when nobody is signed in', async () => {
    getSession.mockResolvedValueOnce({ data: { session: null } })
    autoSync.initAutoSync(deps)
    expect(await autoSync.requestSync()).toBeNull()
    expect(runSync).not.toHaveBeenCalled()
  })

  it('hands each successful sync to the page', async () => {
    const seen = []
    autoSync.initAutoSync(deps, { onSynced: (s) => seen.push(s) })
    await autoSync.requestSync()
    expect(seen).toEqual([SUMMARY])
  })

  it('syncs when the tab comes back, not when it leaves', async () => {
    autoSync.initAutoSync(deps)
    setVisibility('hidden')
    expect(runSync).not.toHaveBeenCalled()
    setVisibility('visible')
    await vi.waitFor(() => expect(runSync).toHaveBeenCalledTimes(1))
  })

  it('swallows a failing automatic sync', async () => {
    runSync.mockRejectedValueOnce(new Error('offline'))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    autoSync.initAutoSync(deps)
    autoSync.triggerSync('test')
    await vi.waitFor(() => expect(warn).toHaveBeenCalled())
    warn.mockRestore()
  })
})
