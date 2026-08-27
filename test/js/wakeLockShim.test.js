import { beforeEach, describe, expect, it } from 'vitest'

import { loadShim } from './support/loadShim.js'

describe('wakelock-shim', () => {
  let window, posted, listeners

  beforeEach(() => {
    ;({ window, posted, listeners } = loadShim('wakelock-shim.js', 'wakeLock'))
  })

  it('says nothing until the page asks for a lock', () => {
    expect(posted).toEqual([])
    expect('wakeLock' in window.navigator).toBe(true)
  })

  it('tells native the screen must stay on while a sentinel is held', async () => {
    const sentinel = await window.navigator.wakeLock.request('screen')
    const released = []
    sentinel.onrelease = (event) => released.push(event)

    expect(posted).toEqual([{ held: true }])
    expect(sentinel.released).toBe(false)

    // Releasing twice is one release: the second call has nothing to give back.
    await sentinel.release()
    await sentinel.release()

    expect(sentinel.released).toBe(true)
    expect(released).toHaveLength(1)
    expect(posted).toEqual([{ held: true }, { held: false }])
  })

  it('keeps the screen on until the last sentinel is released', async () => {
    const first = await window.navigator.wakeLock.request('screen')
    const second = await window.navigator.wakeLock.request('screen')

    await first.release()
    expect(posted.at(-1)).toEqual({ held: true })

    await second.release()
    expect(posted.at(-1)).toEqual({ held: false })
  })

  it('says it again for a document restored from the back/forward cache', async () => {
    await window.navigator.wakeLock.request('screen')

    listeners.pageshow({ persisted: true })
    expect(posted).toEqual([{ held: true }, { held: true }])

    listeners.pageshow({ persisted: false })
    expect(posted).toHaveLength(2)
  })

  it('stays quiet on a restore with no lock held', () => {
    listeners.pageshow({ persisted: true })
    expect(posted).toEqual([])
  })

  it('rejects a lock type it cannot provide', async () => {
    // The rejection is built inside the vm, so it is that realm's TypeError:
    // match on the message rather than on the constructor.
    await expect(window.navigator.wakeLock.request('system')).rejects.toThrow(/not a valid enum value/)
    expect(posted).toEqual([])
  })
})
