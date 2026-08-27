import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// A page with a service worker container the test drives: what it was asked to
// register, and the two signals a new worker arriving can send.
function fakePage({ pathname = '/library.html', controlled = false } = {}) {
  const listeners = new Map()
  const on = (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn])
  const fire = (map, type) => (map.get(type) ?? []).forEach((fn) => fn())

  const registrationListeners = new Map()
  const registration = {
    installing: null,
    addEventListener: (type, fn) => registrationListeners.set(type, [...(registrationListeners.get(type) ?? []), fn]),
    update: vi.fn(async () => {}),
  }
  const register = vi.fn(async () => registration)

  return {
    register,
    registration,
    reload: vi.fn(),
    install() {
      vi.stubGlobal('location', { pathname, href: `https://arabesque.app${pathname}`, reload: this.reload })
      vi.stubGlobal('document', { visibilityState: 'visible', addEventListener: on })
      vi.stubGlobal('navigator', {
        serviceWorker: { register, controller: controlled ? {} : null, addEventListener: on },
      })
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
  await import('../../public/js/swRegister.js')
  await vi.waitFor(() => expect(page.register).toHaveBeenCalled(), { timeout: 100 }).catch(() => {})
}

describe('registering the service worker', () => {
  afterEach(() => {
    vi.unstubAllGlobals()
    vi.doUnmock('../../public/js/version.js')
  })

  it('registers past the HTTP cache, so a new worker is not hidden by max-age', async () => {
    const page = fakePage()
    await load(page)
    expect(page.register).toHaveBeenCalledOnce()
    expect(page.register.mock.calls[0][1]).toEqual({ updateViaCache: 'none' })
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

  it('asks for an update when the app comes back, at most once a minute', async () => {
    vi.useFakeTimers()
    try {
      const page = fakePage({ controlled: true })
      await load(page)

      page.comeBack()
      page.comeBack()
      expect(page.registration.update).toHaveBeenCalledOnce()

      vi.advanceTimersByTime(61_000)
      page.comeBack()
      expect(page.registration.update).toHaveBeenCalledTimes(2)
    } finally {
      vi.useRealTimers()
    }
  })
})
