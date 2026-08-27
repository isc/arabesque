import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest'

const ORIGIN = 'https://arabesque.app'

// Just enough of the Cache API for the worker's routing decisions: what it
// looks up, in which cache, and what it decides to keep.
const key = (target, options) => {
  const url = new URL(target.url ?? target)
  return options?.ignoreSearch ? url.origin + url.pathname : url.href
}

function fakeCaches() {
  const stores = new Map()
  return {
    stores,
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const entries = stores.get(name)
      return {
        entries,
        add: async (request) => entries.set(key(request), { body: `precached ${key(request)}` }),
        put: async (request, response) => entries.set(key(request), response),
        match: async (request, options) =>
          [...entries].find(([stored]) => key(stored, options) === key(request, options))?.[1],
      }
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  }
}

const request = (path, { mode = 'same-origin', method = 'GET' } = {}) => ({
  url: path.startsWith('http') ? path : `${ORIGIN}${path}`,
  method,
  mode,
})

describe('the service worker', () => {
  let handlers
  let network

  beforeAll(async () => {
    handlers = new Map()
    vi.stubGlobal('self', {
      location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN },
      addEventListener: (type, fn) => handlers.set(type, fn),
      skipWaiting: () => {},
      clients: { claim: async () => {} },
    })
    await import('../../public/sw.js')
  })

  beforeEach(() => {
    vi.stubGlobal('caches', fakeCaches())
    network = vi.fn(async () => ({ ok: true, body: 'from network', clone: () => ({ body: 'from network' }) }))
    vi.stubGlobal('fetch', network)
  })

  // What the worker answered, or null when it declined the request outright —
  // which leaves the browser to go to the network itself.
  async function respond(req) {
    let answered = null
    handlers.get('fetch')({ request: req, respondWith: (value) => (answered = value) })
    return answered === null ? null : await answered
  }

  const seed = async (cacheName, url, body) => {
    const cache = await caches.open(cacheName)
    await cache.put({ url }, { body })
  }

  it('declines what is not its business', async () => {
    expect(await respond(request('/library.html', { method: 'POST' }))).toBeNull()
    expect(await respond(request('https://esm.sh/@supabase/supabase-js@2.45.4'))).toBeNull()
    expect(await respond(request('/video/hero.fr.mp4'))).toBeNull()
    expect(network).not.toHaveBeenCalled()
  })

  it('answers a navigation from the shell, whatever the query says', async () => {
    await seed('arabesque-shell-dev', `${ORIGIN}/score.html`, 'the score page')
    const response = await respond(request('/score.html?url=scores/bwv847.mxl', { mode: 'navigate' }))
    expect(response.body).toBe('the score page')
    expect(network).not.toHaveBeenCalled()
  })

  it('answers the bare origin, which is the URL the iOS wrapper opens', async () => {
    await seed('arabesque-shell-dev', `${ORIGIN}/`, 'the landing page')
    const response = await respond(request('/', { mode: 'navigate' }))
    expect(response.body).toBe('the landing page')
    expect(network).not.toHaveBeenCalled()
  })

  it('falls back to the network for a page it has not cached', async () => {
    const response = await respond(request('/library.html', { mode: 'navigate' }))
    expect(response.body).toBe('from network')
    expect(network).toHaveBeenCalledOnce()
  })

  it('serves a cached asset without touching the network', async () => {
    await seed('arabesque-shell-dev', `${ORIGIN}/js/library.js`, 'the library module')
    const response = await respond(request('/js/library.js'))
    expect(response.body).toBe('the library module')
    expect(network).not.toHaveBeenCalled()
  })

  it.each(['/scores/bwv847.mxl', '/vendor/opensheetmusicdisplay.2.1.2.min.js'])(
    'keeps %s in the cache a deploy does not throw away',
    async (path) => {
      await respond(request(path))
      expect(caches.stores.get('arabesque-lasting').has(`${ORIGIN}${path}`)).toBe(true)
      expect(await caches.keys()).not.toContain('arabesque-shell-dev')
    },
  )

  it('does not keep a failed response', async () => {
    network.mockResolvedValueOnce({ ok: false, body: 'not found', clone: () => ({}) })
    await respond(request('/js/typo.js'))
    expect(caches.stores.get('arabesque-shell-dev').size).toBe(0)
  })

  it('drops the caches of previous deploys, and keeps the lasting one', async () => {
    await seed('arabesque-shell-older', `${ORIGIN}/js/library.js`, 'old')
    await seed('arabesque-shell-dev', `${ORIGIN}/js/library.js`, 'current')
    await seed('arabesque-lasting', `${ORIGIN}/scores/bwv847.mxl`, 'a score')
    await seed('somebody-elses-cache', `${ORIGIN}/x`, 'not ours')

    const waits = []
    handlers.get('activate')({ waitUntil: (promise) => waits.push(promise) })
    await Promise.all(waits)

    expect((await caches.keys()).sort()).toEqual(['arabesque-lasting', 'arabesque-shell-dev', 'somebody-elses-cache'])
  })
})
