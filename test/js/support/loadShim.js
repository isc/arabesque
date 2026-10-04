import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Runs one of the iOS wrapper's injected shims the way the WKWebView does: as
// a plain script at document start, with webkit.messageHandlers in place —
// carrying the handler the shim talks to, when it talks to one. Returns the
// sandbox itself as the window, and everything the shim posted to native.
//
// The sandbox's timers look the test's up when they are called, not when the
// shim is loaded, so vi.useFakeTimers() switched on in a test reaches them.
export function loadShim(fileName, handlerName = null, globals = {}) {
  const source = readFileSync(new URL(`../../../ios/Arabesque/Resources/${fileName}`, import.meta.url), 'utf8')
  const posted = []
  const sandbox = {
    navigator: {},
    setTimeout: (...args) => setTimeout(...args),
    clearTimeout: (id) => clearTimeout(id),
    webkit: {
      messageHandlers: handlerName ? { [handlerName]: { postMessage: (message) => posted.push(message) } } : {},
    },
    ...globals,
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  return { window: sandbox, posted }
}
