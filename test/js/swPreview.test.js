import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'
import { ORIGIN, loadWorker, stubSelf, dispatch, fakeCaches } from './support/serviceWorker.js'

// The worker a branch preview registered before previews went without one: the
// next update check installs this file, which only removes itself (sw.js).
describe('a branch preview’s worker', () => {
  const at = '/previews/some-branch/sw.js'
  let handlers

  beforeAll(async () => {
    handlers = await loadWorker({ at, shell: ['library.html', 'vendor/tone.14.8.49.min.js'] })
  })

  beforeEach(() => {
    stubSelf({ at })
    vi.stubGlobal('caches', fakeCaches())
    vi.stubGlobal('fetch', vi.fn())
  })

  it('installs without precaching anything', async () => {
    await dispatch(handlers, 'install')
    expect(caches.stores.size).toBe(0)
    expect(fetch).not.toHaveBeenCalled()
  })

  it('unregisters, leaving every cache as it was', async () => {
    // Production's shell, which a preview's worker used to drop with its own.
    caches.stores.set('arabesque-shell-production', new Map([[`${ORIGIN}/library.html`, { body: 'production' }]]))
    caches.stores.set('arabesque-lasting', new Map([[`${ORIGIN}/vendor/tone.14.8.49.min.js`, { body: 'kept' }]]))

    await dispatch(handlers, 'activate')

    expect(self.registration.unregister).toHaveBeenCalledOnce()
    expect([...caches.stores.keys()].sort()).toEqual(['arabesque-lasting', 'arabesque-shell-production'])
    expect(caches.stores.get('arabesque-lasting').size).toBe(1)
  })

  it('leaves every request to the network', () => {
    expect(handlers.has('fetch')).toBe(false)
  })
})
