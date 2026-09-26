import { describe, it, expect, beforeEach, vi } from 'vitest'

// The window installPrompt.js listens on and dispatches to (the suite runs in
// node). Fresh per test, because the module latches state at import time and
// each case wants its own.
function fakeWindow() {
  const listeners = new Map()
  return {
    addEventListener: (type, fn) => listeners.set(type, [...(listeners.get(type) ?? []), fn]),
    dispatchEvent: (event) => (listeners.get(event.type) ?? []).forEach((fn) => fn(event)),
    // The event object is passed through, not copied: preventDefault() and
    // prompt() record onto `this`, and a spread would send them a clone.
    fire: (type, event = {}) => {
      event.type = type
      ;(listeners.get(type) ?? []).forEach((fn) => fn(event))
    },
    CustomEvent: class {
      constructor(type, init) {
        this.type = type
        this.detail = init?.detail
      }
    },
  }
}

async function loadModule() {
  const win = fakeWindow()
  vi.stubGlobal('window', win)
  vi.stubGlobal('CustomEvent', win.CustomEvent)
  vi.resetModules()
  return { win, module: await import('../../public/js/installPrompt.js') }
}

// A stand-in for what Chrome hands over, tracking whether it was fired and
// whether preventDefault() — which is what suppresses Chrome's own infobar —
// was called on it.
function browserOffer() {
  return { prevented: false, prompted: false,
    preventDefault() { this.prevented = true },
    prompt() { this.prompted = true; return Promise.resolve() } }
}

describe('the install offer', () => {
  beforeEach(() => vi.unstubAllGlobals())

  it('is not available until the browser makes one', async () => {
    const { module } = await loadModule()
    expect(module.installAvailable()).toBe(false)
  })

  // The event fires once and can arrive before Alpine boots, so it has to be
  // held from import time — otherwise the menu misses it for the whole visit.
  it('is held from import time, before anything asks', async () => {
    const { win, module } = await loadModule()
    win.fire('beforeinstallprompt', browserOffer())

    expect(module.installAvailable()).toBe(true)
  })

  it('takes the event over from Chrome, so no infobar appears', async () => {
    const { win } = await loadModule()
    const offer = browserOffer()
    win.fire('beforeinstallprompt', offer)

    expect(offer.prevented).toBe(true)
  })

  it('announces every change, so a menu already built can follow', async () => {
    const { win, module } = await loadModule()
    const seen = []
    win.addEventListener(module.INSTALL_AVAILABLE_EVENT, (e) => seen.push(e.detail))

    win.fire('beforeinstallprompt', browserOffer())
    win.fire('appinstalled')

    expect(seen).toEqual([true, false])
  })

  it('goes away once the app is installed', async () => {
    const { win, module } = await loadModule()
    win.fire('beforeinstallprompt', browserOffer())
    win.fire('appinstalled')

    expect(module.installAvailable()).toBe(false)
  })

  it('hands the held event to the browser when asked', async () => {
    const { win, module } = await loadModule()
    const offer = browserOffer()
    win.fire('beforeinstallprompt', offer)

    await module.promptInstall()

    expect(offer.prompted).toBe(true)
  })

  // Chrome invalidates the event once prompted, whatever the answer, so a menu
  // entry left behind would do nothing at all.
  it('is spent by prompting, whatever the answer', async () => {
    const { win, module } = await loadModule()
    win.fire('beforeinstallprompt', browserOffer())

    await module.promptInstall()

    expect(module.installAvailable()).toBe(false)
  })

  it('does nothing when asked with no offer in hand', async () => {
    const { module } = await loadModule()
    await expect(module.promptInstall()).resolves.toBeUndefined()
  })

  it('survives a browser that refuses to prompt', async () => {
    const { win, module } = await loadModule()
    const offer = browserOffer()
    offer.prompt = () => Promise.reject(new Error('not allowed'))
    win.fire('beforeinstallprompt', offer)

    await expect(module.promptInstall()).resolves.toBeUndefined()
  })
})
