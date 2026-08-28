import { beforeEach, describe, expect, it } from 'vitest'

import { loadShim } from './support/loadShim.js'

describe('wakelock-shim', () => {
  let window

  // The navigator WebKit hands the shim: wakeLock is a readonly attribute, an
  // accessor on the prototype with no setter. Assigning to it throws in strict
  // mode, which is the shim never installing at all.
  function webkitNavigator(realWakeLock = { request: () => Promise.reject(new Error('refused')) }) {
    return Object.create(
      Object.defineProperty({}, 'wakeLock', { get: () => realWakeLock, configurable: true }))
  }

  beforeEach(() => {
    ;({ window } = loadShim('wakelock-shim.js', null, { navigator: webkitNavigator() }))
  })

  it('takes over the readonly navigator.wakeLock WebKit already exposes', () => {
    expect(window.__arabesqueWakeLock.held).toBe(false)
    expect(window.navigator.wakeLock.request).not.toBe(undefined)
  })

  it('holds the screen for native to read while a sentinel is out', async () => {
    const sentinel = await window.navigator.wakeLock.request('screen')
    const released = []
    sentinel.onrelease = (event) => released.push(event)

    expect(window.__arabesqueWakeLock.held).toBe(true)
    expect(sentinel.released).toBe(false)

    // Releasing twice is one release: the second call has nothing to give back.
    await sentinel.release()
    await sentinel.release()

    expect(sentinel.released).toBe(true)
    expect(released).toHaveLength(1)
    expect(window.__arabesqueWakeLock.held).toBe(false)
  })

  it('keeps the screen on until the last sentinel is released', async () => {
    const first = await window.navigator.wakeLock.request('screen')
    const second = await window.navigator.wakeLock.request('screen')

    await first.release()
    expect(window.__arabesqueWakeLock.held).toBe(true)

    await second.release()
    expect(window.__arabesqueWakeLock.held).toBe(false)
  })

  it('keeps a lock a hidden or page-cached document never lost', async () => {
    // The real API drops a sentinel when the document is hidden; here there is
    // nothing to reclaim, and native polls the document on screen anyway.
    const sentinel = await window.navigator.wakeLock.request('screen')

    expect(sentinel.released).toBe(false)
    expect(window.__arabesqueWakeLock.held).toBe(true)
  })

  it('rejects a lock type it cannot provide', async () => {
    // The rejection is built inside the vm, so it is that realm's TypeError:
    // match on the message rather than on the constructor.
    await expect(window.navigator.wakeLock.request('system')).rejects.toThrow(/not a valid enum value/)
    expect(window.__arabesqueWakeLock.held).toBe(false)
  })

  it('stays out of a browser that has no wrapper behind it', () => {
    const { window: browser } = loadShim('wakelock-shim.js', null, {
      navigator: webkitNavigator({ marker: 'the real one' }),
      webkit: undefined,
    })

    expect(browser.__arabesqueWakeLock).toBe(undefined)
    expect(browser.navigator.wakeLock).toEqual({ marker: 'the real one' })
  })
})
