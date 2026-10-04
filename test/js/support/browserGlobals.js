// Browser globals for a suite that runs in node, written once and whole.
//
// A fake with only the members the test at hand happened to need turns every
// other use into a silent no-op: profiles.js walks storage with key(i) and
// length, legacyKeys.js does at import time inside a catch that swallows
// everything, and against a fake without them both simply do nothing — a test
// of removing a profile would remove none of its keys, and pass.
import { vi } from 'vitest'

// The Storage interface: get, set, remove, clear, and the key(i)/length walk.
export function fakeStorage(entries = {}) {
  const store = new Map(Object.entries(entries))
  return {
    getItem: (key) => (store.has(key) ? store.get(key) : null),
    setItem: (key, value) => store.set(key, String(value)),
    removeItem: (key) => store.delete(key),
    clear: () => store.clear(),
    key: (index) => [...store.keys()][index] ?? null,
    get length() {
      return store.size
    },
  }
}

// Fresh for the test, and put back before the next one (unstubGlobals in
// vitest.config.js). Each returns the fake it installed.
const install = (name, value) => {
  vi.stubGlobal(name, value)
  return value
}
export const installLocalStorage = (entries) => install('localStorage', fakeStorage(entries))
export const installSessionStorage = (entries) => install('sessionStorage', fakeStorage(entries))

// A document with real event dispatch, visible to start with. The returned
// `setVisibility` changes visibilityState and fires visibilitychange, as the
// browser does when the app goes to the background and comes back.
export function installDocument() {
  const document = install('document', Object.assign(new EventTarget(), { visibilityState: 'visible', cookie: '' }))
  const setVisibility = (state) => {
    document.visibilityState = state
    document.dispatchEvent(new Event('visibilitychange'))
  }
  return { document, setVisibility }
}
