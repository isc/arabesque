import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { readFileSync } from 'node:fs'
import { onDayChange } from '../../public/js/dayRollover.js'
import { NATIVE_FOREGROUND_EVENT } from '../../public/js/utils.js'

// The page globals dayRollover.js touches (the suite runs in node).
function fakePage() {
  const listeners = new Map()
  const fire = (type) => (listeners.get(type) ?? []).forEach((fn) => fn())
  const document = {
    visibilityState: 'visible',
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
  }
  return {
    document,
    comeBack: (state = 'visible') => {
      document.visibilityState = state
      fire('visibilitychange')
    },
    // What the iOS wrapper dispatches on didBecomeActive.
    wake: () => fire(NATIVE_FOREGROUND_EVENT),
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

  // The wrapper's webview gets no visibilitychange to build on across a
  // suspension, so the app forwards didBecomeActive itself. This is the trigger
  // that answers an iPad woken the morning after a session — the case the whole
  // module exists for.
  it('fires when the native wrapper says the app woke on a later day', () => {
    vi.setSystemTime(new Date(2026, 7, 26, 8, 30, 0))
    page.wake()
    expect(handler).toHaveBeenCalledOnce()
  })

  it('stays quiet when the native wrapper wakes on the same day', () => {
    vi.setSystemTime(new Date(2026, 7, 25, 22, 30, 0))
    page.wake()
    expect(handler).not.toHaveBeenCalled()
  })

  // Both triggers can arrive for one return, and what hangs off the handler
  // walks the whole session store.
  it('fires once when the native wake and visibilitychange both arrive', () => {
    vi.setSystemTime(new Date(2026, 7, 26, 8, 30, 0))
    page.wake()
    page.comeBack()
    expect(handler).toHaveBeenCalledOnce()
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

  // A device landing in another timezone moves the wall clock without any
  // elapsed time to wait for, and without leaving the foreground.
  it('notices a clock jump into the next day', () => {
    vi.setSystemTime(new Date(2026, 7, 26, 4, 0, 0))
    vi.advanceTimersByTime(60 * 1000)
    expect(handler).toHaveBeenCalledOnce()
  })
})

// The wrapper's half of the contract is a string in a Swift file that nothing
// else reads: rename the event on one side and the day rollover goes back to
// waiting a minute on an iPad, with no error anywhere to say so.
describe("the wrapper's foreground event", () => {
  it('is the one ViewController dispatches on didBecomeActive', () => {
    const swift = readFileSync(new URL('../../ios/Arabesque/ViewController.swift', import.meta.url), 'utf8')
    expect(swift).toContain(`new Event('${NATIVE_FOREGROUND_EVENT}')`)
  })
})
