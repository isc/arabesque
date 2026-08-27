// Screen Wake Lock shim for the iOS native wrapper.
//
// WebKit grants navigator.wakeLock.request() in Safari proper only — not in a
// WKWebView (webkit.org/b/254545) — and the refusal is silent, so the iPad
// fell asleep mid-piece. This script is injected at document start and
// replaces navigator.wakeLock with one the native side honours through
// webkit.messageHandlers.wakeLock:
//
//   { held: true|false }
//
// See ios/README.md, "Keeping the screen on", for why native follows the page
// rather than simply disabling the idle timer.
;(function (global) {
  'use strict'

  function createWakeLockShim(postToNative) {
    const sentinels = new Set()

    function report() {
      postToNative({ held: sentinels.size > 0 })
    }

    function release(sentinel) {
      if (sentinels.delete(sentinel)) {
        sentinel.released = true
        if (typeof sentinel.onrelease === 'function') sentinel.onrelease({ type: 'release', target: sentinel })
        report()
      }
      return Promise.resolve()
    }

    // Unlike the real API, a sentinel is not dropped when the document is
    // hidden: iOS ignores the idle timer setting while the app is in the
    // background and applies it again on the way back, so there is nothing to
    // reclaim — and a page that never lost its lock is spared re-asking.
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
      report()
      return Promise.resolve(sentinel)
    }

    // Native resets the idle timer on every navigation, since a page being
    // replaced gets no chance to give its lock back. A document restored from
    // the back/forward cache comes back holding one all the same — so say it
    // again rather than letting a score reopened with Back fall asleep.
    function resync() {
      if (sentinels.size > 0) report()
    }

    return { request, resync }
  }

  function installWakeLockShim(shim, target) {
    target.navigator.wakeLock = { request: (type) => shim.request(type) }
    target.addEventListener('pageshow', (event) => {
      if (event && event.persisted) shim.resync()
    })
  }

  const bridge = global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.wakeLock
  if (bridge) {
    installWakeLockShim(createWakeLockShim((message) => bridge.postMessage(message)), global)
  }
})(typeof window !== 'undefined' ? window : globalThis)
