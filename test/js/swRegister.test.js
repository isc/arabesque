import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { VERSION_STAMP, versionLine } from '../../scripts/stamp-version.mjs'
import { replacedOnce } from '../../scripts/replace-once.mjs'

// A page with a service worker container the test drives: what it was asked to
// register, and the two signals a new worker arriving can send.
function fakePage({ pathname = '/library.html', controlled = false, online = true } = {}) {
  const listeners = new Map()
  const on = (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn])
  const fire = (map, type) => (map.get(type) ?? []).forEach((fn) => fn())

  const registrationListeners = new Map()
  const registration = {
    installing: null,
    addEventListener: (type, fn) => registrationListeners.set(type, [...(registrationListeners.get(type) ?? []), fn]),
    update: vi.fn(async () => {}),
    waiting: null,
    active: { state: 'activated' },
  }
  const register = vi.fn(async () => registration)
  // The caches on the device: the page's own deploy's shell, and the one that
  // outlives deploys.
  const cacheNames = ['arabesque-shell-deadbeef', 'arabesque-lasting']
  const caches = { keys: vi.fn(async () => cacheNames), match: vi.fn(async () => undefined) }

  return {
    register,
    registration,
    cacheNames,
    caches,
    reload: vi.fn(),
    install() {
      vi.stubGlobal('location', { pathname, href: `https://arabesque.app${pathname}`, reload: this.reload })
      vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: on })
      vi.stubGlobal('navigator', {
        onLine: online,
        serviceWorker: { register, controller: controlled ? {} : null, addEventListener: on },
      })
      vi.stubGlobal('caches', caches)
    },
    comeBack: () => fire(listeners, 'visibilitychange'),
    // A new worker reaching 'activated', the way WebKit announces it.
    workerActivated() {
      const worker = { state: 'activated', addEventListener: (_, fn) => worker.listeners.push(fn), listeners: [] }
      registration.installing = worker
      fire(registrationListeners, 'updatefound')
      worker.listeners.forEach((fn) => fn())
    },
    claimed: () => fire(listeners, 'controllerchange'),
  }
}

async function load(page, { version = 'deadbeef' } = {}) {
  page.install()
  vi.resetModules()
  vi.doMock('../../public/js/version.js', () => ({ APP_VERSION: version, checkAppVersion: () => {} }))
  const module = await import('../../public/js/swRegister.js')
  await vi.waitFor(() => expect(page.register).toHaveBeenCalled(), { timeout: 100 }).catch(() => {})
  return module
}

// What was recorded for a report (errorLog.js), as recordError logs it.
const recorded = () => console.error.mock.calls.map(([where, error]) => `${where} ${error.message}`)

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {})
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.doUnmock('../../public/js/version.js')
})

describe('registering the service worker', () => {
  it('registers past the HTTP cache, so a new worker is not hidden by max-age', async () => {
    const page = fakePage()
    await load(page)
    expect(page.register).toHaveBeenCalledOnce()
    expect(page.register.mock.calls[0][1]).toEqual({ updateViaCache: 'none' })
  })

  it('does not register on a branch preview', async () => {
    const page = fakePage({ pathname: '/previews/some-branch/library.html' })
    await load(page)
    expect(page.register).not.toHaveBeenCalled()
  })

  it('does not register from an unstamped checkout', async () => {
    const page = fakePage()
    await load(page, { version: 'dev' })
    expect(page.register).not.toHaveBeenCalled()
  })

  it('does not reload on a first install, which claims the page as it finishes', async () => {
    const page = fakePage({ controlled: false })
    await load(page)
    page.claimed()
    page.workerActivated()
    expect(page.reload).not.toHaveBeenCalled()
  })

  it('reloads a page a worker was already serving, once, whichever signal arrives', async () => {
    const page = fakePage({ controlled: true })
    await load(page)
    page.claimed()
    page.workerActivated()
    expect(page.reload).toHaveBeenCalledOnce()
  })

  it.each(['/score.html', '/data.html'])(
    'leaves %s alone: a reload there loses what was typed or played',
    async (pathname) => {
      const page = fakePage({ pathname, controlled: true })
      await load(page)
      page.claimed()
      expect(page.reload).not.toHaveBeenCalled()
    },
  )

  it('asks for an update as a page that can reload into it opens', async () => {
    const library = fakePage({ controlled: true })
    await load(library)
    expect(library.registration.update).toHaveBeenCalledOnce()
  })

  it.each([
    ['a first install, which has just fetched the worker', { controlled: false }],
    ['the score page, in the middle of a session', { pathname: '/score.html', controlled: true }],
    ['a page opened offline', { controlled: true, online: false }],
  ])('does not ask as %s opens', async (_, options) => {
    const page = fakePage(options)
    await load(page)
    expect(page.registration.update).not.toHaveBeenCalled()
  })

  it('asks again when the app comes back, at most once a minute', async () => {
    vi.useFakeTimers()
    const page = fakePage({ controlled: true })
    await load(page)

    page.comeBack()
    expect(page.registration.update).toHaveBeenCalledOnce()

    vi.advanceTimersByTime(61_000)
    page.comeBack()
    page.comeBack()
    expect(page.registration.update).toHaveBeenCalledTimes(2)
  })

  // The network is often not back yet as the app wakes up.
  it('keeps a failed check for a report, and tries again on the next return', async () => {
    const page = fakePage({ controlled: true })
    const failure = new TypeError('Load failed')
    page.registration.update.mockRejectedValueOnce(failure)
    await load(page)
    await vi.waitFor(() => expect(recorded()).toEqual(['Service worker update check failed: Load failed']))

    page.comeBack()
    expect(page.registration.update).toHaveBeenCalledTimes(2)
  })
})

// What a feedback report says of the update cycle (feedback.js): the iPad has
// stayed a deploy behind in ways Safari would not reproduce, and the reports
// could not tell which.
describe('where a page stands in the update cycle', () => {
  const library = () => fakePage({ controlled: true })

  it('says whether a worker serves the page, its workers, the caches and the last check', async () => {
    const page = library()
    const { updateReport } = await load(page)
    await vi.waitFor(() => expect(page.registration.update).toHaveBeenCalled())
    expect(await updateReport()).toEqual({
      controlled: true,
      workers: '-/-/activated',
      caches: ['arabesque-shell-deadbeef', 'arabesque-lasting'],
      shell_scripts: null,
      last_check: { seconds_ago: 0, outcome: 'nothing new', page: '/library.html' },
    })
  })

  // A shell holding another deploy's scripts than the one it is named after.
  it('says which deploy the cached scripts are from, read the way a deploy stamps them', async () => {
    const page = library()
    const source = readFileSync(join(import.meta.dirname, '..', '..', 'public', 'js', 'version.js'), 'utf8')
    page.caches.match.mockImplementation(async (url) =>
      String(url).endsWith('/js/version.js')
        ? new Response(replacedOnce(source, VERSION_STAMP, versionLine('cafebabe')))
        : undefined,
    )
    const { updateReport } = await load(page)
    expect((await updateReport()).shell_scripts).toBe('cafebabe')
  })

  it('says when the last check found a worker, and that one is still installing', async () => {
    const page = library()
    page.registration.update.mockImplementation(async () => {
      page.registration.installing = { state: 'installing', addEventListener: () => {} }
      page.cacheNames.push('arabesque-shell-cafebabe')
    })
    const { updateReport } = await load(page)
    await vi.waitFor(() => expect(page.registration.update).toHaveBeenCalled())
    expect(await updateReport()).toMatchObject({
      workers: 'installing/-/activated',
      caches: ['arabesque-shell-deadbeef', 'arabesque-lasting', 'arabesque-shell-cafebabe'],
      last_check: { outcome: 'found' },
    })
  })

  it('records a check that never settles, which nothing else would', async () => {
    vi.useFakeTimers()
    const page = library()
    page.registration.update.mockReturnValue(new Promise(() => {}))
    const { updateReport } = await load(page)
    await vi.advanceTimersByTimeAsync(30_000)
    expect(recorded()).toEqual(['Service worker: Service worker update check still pending after 30s'])
    expect((await updateReport()).last_check).toMatchObject({ seconds_ago: 30, outcome: 'pending' })
  })

  it('does not record a check that settled in time', async () => {
    vi.useFakeTimers()
    await load(library())
    await vi.advanceTimersByTimeAsync(30_000)
    expect(recorded()).toEqual([])
  })

  it('says a check was skipped offline', async () => {
    const { updateReport } = await load(fakePage({ controlled: true, online: false }))
    expect((await updateReport()).last_check.outcome).toBe('offline')
  })

  it('says so when the browser does not answer', async () => {
    vi.useFakeTimers()
    const page = library()
    const { updateReport } = await load(page)
    page.caches.keys.mockReturnValue(new Promise(() => {}))
    const report = updateReport()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await report).toBe('unanswered')
  })

  it.each([
    ['an unstamped checkout', '/library.html', 'dev'],
    ['a branch preview', '/previews/some-branch/library.html', 'deadbeef'],
  ])('has nothing to say from %s, where no worker is in play', async (_, pathname, version) => {
    const { updateReport } = await load(fakePage({ pathname, controlled: true }), { version })
    expect(await updateReport()).toBeNull()
  })
})
