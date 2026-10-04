// The service worker (public/sw.js) under test, and just enough of the browser
// around it: a `self` to install its handlers on, and the Cache API.
import { vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'
import { SW_SHELL, shellLine } from '../../../scripts/stamp-version.mjs'
import { replacedOnce } from '../../../scripts/replace-once.mjs'

export const ORIGIN = 'https://arabesque.app'
const SW = join(import.meta.dirname, '..', '..', '..', 'public', 'sw.js')

// Loads the worker and returns its event handlers by type. With `shell`, from a
// copy stamped with that precache list the way a deploy stamps it — the
// checkout's own list is empty by design, so the install path does nothing
// until a deploy has written one in.
export async function loadWorker({ shell } = {}) {
  const handlers = stubSelf()
  if (!shell) {
    await import(pathToFileURL(SW).href)
    return handlers
  }
  const dir = mkdtempSync(join(tmpdir(), 'arabesque-sw-'))
  try {
    const path = join(dir, 'sw.js')
    writeFileSync(path, replacedOnce(readFileSync(SW, 'utf8'), SW_SHELL, shellLine(shell), SW))
    await import(pathToFileURL(path).href)
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
  return handlers
}

// The worker's global scope: what it reads of itself, and where it installs
// its handlers — collected into `handlers`. Stubbed again for each test by a
// file that loads the worker once: vitest puts stubbed globals back before
// every test.
export function stubSelf(handlers = new Map()) {
  vi.stubGlobal('self', {
    location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN },
    addEventListener: (type, fn) => handlers.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  })
  return handlers
}

// Fires `type` at the worker and settles everything it asked the browser to
// wait for.
export async function dispatch(handlers, type) {
  const waits = []
  handlers.get(type)({ waitUntil: (work) => waits.push(work) })
  await Promise.all(waits)
}

// Requests and URLs alike, the query dropped when the lookup ignores it.
const cacheKey = (target, options) => {
  const url = new URL(target.url ?? target)
  return options?.ignoreSearch ? url.origin + url.pathname : url.href
}

// The Cache API as far as the worker uses it: what it looks up, in which
// cache, and what it decides to keep. `stores` lays the caches open to the
// test, by name, each a Map of URL to what it holds.
export function fakeCaches() {
  const stores = new Map()
  return {
    stores,
    open: async (name) => {
      if (!stores.has(name)) stores.set(name, new Map())
      const entries = stores.get(name)
      return {
        add: async (request) => entries.set(cacheKey(request), { body: 'fetched' }),
        put: async (request, response) => entries.set(cacheKey(request), response),
        match: async (request, options) =>
          [...entries].find(([stored]) => cacheKey(stored, options) === cacheKey(request, options))?.[1],
      }
    },
    keys: async () => [...stores.keys()],
    delete: async (name) => stores.delete(name),
  }
}
