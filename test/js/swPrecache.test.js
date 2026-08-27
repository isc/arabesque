import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync, writeFileSync, mkdtempSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { pathToFileURL } from 'node:url'

const ORIGIN = 'https://arabesque.app'
const SW = join(import.meta.dirname, '..', '..', 'public', 'sw.js')

// The install path only does something once a deploy has stamped a manifest in,
// so the worker is loaded from a stamped copy — the checkout's own SHELL is
// empty by design (see scripts/stamp-version.mjs).
async function loadStampedWorker(shell) {
  const source = readFileSync(SW, 'utf8').replace(
    /^const SHELL = \[[^\]]*\]$/m,
    `const SHELL = ${JSON.stringify(shell)}`,
  )
  const path = join(mkdtempSync(join(tmpdir(), 'arabesque-sw-')), 'sw.js')
  writeFileSync(path, source)

  const handlers = new Map()
  vi.stubGlobal('self', {
    location: { href: `${ORIGIN}/sw.js`, origin: ORIGIN },
    addEventListener: (type, fn) => handlers.set(type, fn),
    skipWaiting: () => {},
    clients: { claim: async () => {} },
  })
  await import(pathToFileURL(path).href)
  return handlers
}

describe('precaching the shell', () => {
  let stores
  let fetched

  beforeEach(() => {
    stores = new Map()
    fetched = []
    vi.stubGlobal('caches', {
      open: async (name) => {
        if (!stores.has(name)) stores.set(name, new Map())
        const entries = stores.get(name)
        return {
          entries,
          add: async (request) => entries.set(request.url, { body: 'fetched' }),
          match: async (url) => entries.get(String(url)),
        }
      },
      keys: async () => [...stores.keys()],
      delete: async (name) => stores.delete(name),
    })
    vi.stubGlobal(
      'Request',
      class {
        constructor(url, options) {
          this.url = String(url)
          this.options = options
        }
      },
    )
  })

  afterEach(() => vi.unstubAllGlobals())

  const install = async (handlers) => {
    const waits = []
    handlers.get('install')({ waitUntil: (promise) => waits.push(promise) })
    await Promise.all(waits)
  }

  it('fills each asset from the network, past the HTTP cache', async () => {
    const handlers = await loadStampedWorker(['./', 'js/library.js', 'vendor/tone.14.8.49.min.js'])
    await install(handlers)

    expect([...stores.get('arabesque-shell-dev').keys()]).toEqual([`${ORIGIN}/`, `${ORIGIN}/js/library.js`])
    expect([...stores.get('arabesque-lasting').keys()]).toEqual([`${ORIGIN}/vendor/tone.14.8.49.min.js`])
    // Otherwise the previous deploy's HTTP cache entries would be stored under
    // this version's name and kept until the next one.
    const stored = await (await caches.open('arabesque-shell-dev')).match(`${ORIGIN}/js/library.js`)
    expect(stored).toBeTruthy()
  })

  it('leaves alone what the lasting cache already holds', async () => {
    // A vendor bundle carries its version in its filename, so a copy already
    // there is the right one — re-fetching it cost 1.8MB on every deploy.
    const handlers = await loadStampedWorker(['vendor/tone.14.8.49.min.js', 'js/library.js'])
    stores.set('arabesque-lasting', new Map([[`${ORIGIN}/vendor/tone.14.8.49.min.js`, { body: 'already here' }]]))

    await install(handlers)

    expect(stores.get('arabesque-lasting').get(`${ORIGIN}/vendor/tone.14.8.49.min.js`)).toEqual({
      body: 'already here',
    })
    // The shell is versioned per deploy, so its side is fetched as usual.
    expect(stores.get('arabesque-shell-dev').get(`${ORIGIN}/js/library.js`)).toEqual({ body: 'fetched' })
  })
})
