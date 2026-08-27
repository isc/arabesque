import { readFileSync } from 'node:fs'
import vm from 'node:vm'

// Runs one of the iOS wrapper's injected shims the way the WKWebView does: as
// a plain script at document start, with the message handler it talks to
// available under webkit.messageHandlers. Returns the sandbox itself as the
// window, everything the shim posted to native, and the listeners it
// registered, so a test can fire the page events the shim reacts to.
export function loadShim(fileName, handlerName, globals = {}) {
  const source = readFileSync(new URL(`../../../ios/Arabesque/Resources/${fileName}`, import.meta.url), 'utf8')
  const posted = []
  const listeners = {}
  const sandbox = {
    navigator: {},
    addEventListener: (type, handler) => (listeners[type] = handler),
    webkit: { messageHandlers: { [handlerName]: { postMessage: (message) => posted.push(message) } } },
    ...globals,
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(source, sandbox)
  return { window: sandbox, posted, listeners }
}
