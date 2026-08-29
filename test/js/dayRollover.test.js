import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { onDayChange } from '../../public/js/dayRollover.js'

// The page globals dayRollover.js touches (the suite runs in node).
function fakePage() {
  const listeners = new Map()
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  }
  return {
    document,
    comeBack: (state = 'visible') => {
      document.visibilityState = state
      ;(listeners.get('visibilitychange') ?? []).forEach((fn) => fn())
    },
  }
}

describe('onDayChange', () => {
  let page
  let handler

  beforeEach(() => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date(2026, 7, 25, 22, 0, 0)) // 25 Aug 2026, 22:00 local
    page = fakePage()
    vi.stubGlobal('document', page.document)
    handler = vi.fn()
    onDayChange(handler)
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('fires when the app comes back on a later day', () => {
    vi.setSystemTime(new Date(2026, 7, 26, 8, 30, 0))
    page.comeBack()
    expect(handler).toHaveBeenCalledOnce()
  })

  it('stays quiet when the app comes back the same day', () => {
    vi.setSystemTime(new Date(2026, 7, 25, 22, 30, 0))
    page.comeBack()
    expect(handler).not.toHaveBeenCalled()
  })

  it('stays quiet while the app is in the background', () => {
    vi.setSystemTime(new Date(2026, 7, 26, 8, 30, 0))
    page.comeBack('hidden')
    expect(handler).not.toHaveBeenCalled()
  })

  it('fires on its own past midnight, night after night, with the page left open', () => {
    vi.advanceTimersByTime(2 * 60 * 60 * 1000) // 22:00 → 00:00
    expect(handler).toHaveBeenCalledOnce()
    vi.advanceTimersByTime(24 * 60 * 60 * 1000)
    expect(handler).toHaveBeenCalledTimes(2)
  })

  it('fires once per new day, not once per poll', () => {
    vi.advanceTimersByTime(3 * 60 * 60 * 1000) // well past midnight
    expect(handler).toHaveBeenCalledOnce()
  })

  // The case the poll exists for: an app suspended overnight and woken the next
  // morning, where the foreground event may never arrive — so the poll's period
  // is how long the journal keeps showing yesterday under "aujourd'hui", and a
  // second is the budget. A device landing in another timezone looks the same
  // from here: the wall clock moves with no elapsed time to wait for.
  it('catches up within a second of the clock reaching the next day', () => {
    vi.setSystemTime(new Date(2026, 7, 26, 8, 30, 0))
    vi.advanceTimersByTime(999)
    expect(handler).not.toHaveBeenCalled()
    vi.advanceTimersByTime(1)
    expect(handler).toHaveBeenCalledOnce()
  })
})
