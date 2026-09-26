// Screen Wake Lock shim for the iOS native wrapper.
//
// WebKit exposes navigator.wakeLock in a WKWebView but grants nothing
// (webkit.org/b/254545), and the refusal is silent — the app has no console to
// log to — so the iPad fell asleep mid-piece. This script is injected at
// document start and replaces the API with one that records what the page
// holds, for the native side to read off window.__arabesqueWakeLock.
//
// See ios/README.md, "Keeping the screen on", for why native follows the page
// rather than simply disabling the idle timer, and why it polls this rather
// than being told.
;(function (global) {
  'use strict'

  function createWakeLockShim() {
    const sentinels = new Set()

    function release(sentinel) {
      if (sentinels.delete(sentinel)) {
        sentinel.released = true
        if (typeof sentinel.onrelease === 'function') sentinel.onrelease({ type: 'release', target: sentinel })
      }
      return Promise.resolve()
    }

    // Unlike the real API, a sentinel is not dropped when the document is
    // hidden: iOS ignores the idle timer setting while the app is in the
    // background and applies it again on the way back, so there is nothing to
    // reclaim — and a page that never lost its lock is spared re-asking. Same
    // for a document sitting in the back/forward cache: it comes back holding
    // what it held, with nothing to say.
    function request(type) {
      if (type !== undefined && type !== 'screen') {
        return Promise.reject(new TypeError(`'${type}' is not a valid enum value of type WakeLockType`))
      }
      const sentinel = {
        type: 'screen',
        released: false,
        onrelease: null,
        release: () => release(sentinel),
      }
      sentinels.add(sentinel)
      return Promise.resolve(sentinel)
    }

    return {
      request,
      get held() {
        return sentinels.size > 0
      },
    }
  }

  function installWakeLockShim(shim, target) {
    // Defined, not assigned: navigator.wakeLock is a readonly attribute, so
    // `navigator.wakeLock = …` throws in strict mode and the shim would never
    // install — leaving the page on the implementation that grants nothing. An
    // own data property shadows the accessor WebKit puts on Navigator.prototype.
    Object.defineProperty(target.navigator, 'wakeLock', {
      configurable: true,
      enumerable: true,
      value: { request: (type) => shim.request(type) },
    })
    // What native polls. Per document, deliberately: a lock dies with the page
    // that took it, so the answer is only ever about the page on screen now.
    target.__arabesqueWakeLock = shim
  }

  // Only inside the wrapper, the one place this file is ever injected and the
  // only one where a real wake lock does nothing.
  if (global.webkit && global.webkit.messageHandlers) {
    installWakeLockShim(createWakeLockShim(), global)
  }
})(typeof window !== 'undefined' ? window : globalThis)
