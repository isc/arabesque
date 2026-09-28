import { describe, it, expect, beforeEach, vi } from 'vitest'
import { ORIGIN, loadWorker, dispatch, fakeCaches } from './support/serviceWorker.js'

describe('precaching the shell', () => {
  beforeEach(() => {
    vi.stubGlobal('caches', fakeCaches())
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



  it('fills each asset from the network, past the HTTP cache', async () => {
    const handlers = await loadWorker({ shell: ['./', 'js/library.js', 'vendor/tone.14.8.49.min.js'] })
    await dispatch(handlers, 'install')

    expect([...caches.stores.get('arabesque-shell-dev').keys()]).toEqual([`${ORIGIN}/`, `${ORIGIN}/js/library.js`])
    expect([...caches.stores.get('arabesque-lasting').keys()]).toEqual([`${ORIGIN}/vendor/tone.14.8.49.min.js`])
    // Otherwise the previous deploy's HTTP cache entries would be stored under
    // this version's name and kept until the next one.
    const stored = await (await caches.open('arabesque-shell-dev')).match(`${ORIGIN}/js/library.js`)
    expect(stored).toBeTruthy()
  })

  it('leaves alone what the lasting cache already holds', async () => {
    // A vendor bundle carries its version in its filename, so a copy already
    // there is the right one — re-fetching it cost 1.8MB on every deploy.
    const handlers = await loadWorker({ shell: ['vendor/tone.14.8.49.min.js', 'js/library.js'] })
    caches.stores.set('arabesque-lasting', new Map([[`${ORIGIN}/vendor/tone.14.8.49.min.js`, { body: 'already here' }]]))

    await dispatch(handlers, 'install')

    expect(caches.stores.get('arabesque-lasting').get(`${ORIGIN}/vendor/tone.14.8.49.min.js`)).toEqual({
      body: 'already here',
    })
    // The shell is versioned per deploy, so its side is fetched as usual.
    expect(caches.stores.get('arabesque-shell-dev').get(`${ORIGIN}/js/library.js`)).toEqual({ body: 'fetched' })
  })
})
