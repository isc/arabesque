// Web MIDI API shim for the iOS native wrapper.
//
// Safari/iOS has no navigator.requestMIDIAccess. This script is injected by
// the WKWebView at document start and emulates just enough of the Web MIDI
// API for public/js/midi.js to work unchanged. MIDI collection happens on the
// native side (CoreMIDI); events flow through two globals the native code
// calls via evaluateJavaScript:
//
//   window.__pianoTrainerMIDI.setPorts([{ id, name, type }])  full port list
//   window.__pianoTrainerMIDI.receiveMIDI(id, bytes, timeStamp)
//
// JS-to-native messages go through webkit.messageHandlers.midiBridge:
//   { type: 'ready' }                       ask native for the port list
//   { type: 'send', id, data: [bytes] }     send to a MIDI output
;(function (global) {
  'use strict'

  function createWebMIDIShim(postToNative) {
    const inputs = new Map()
    const outputs = new Map()
    const access = { inputs, outputs, sysexEnabled: false, onstatechange: null }

    let resolveFirstPorts
    const firstPorts = new Promise((resolve) => {
      resolveFirstPorts = resolve
    })

    const now = () => (typeof performance !== 'undefined' ? performance.now() : Date.now())

    function makePort(info) {
      const port = {
        id: String(info.id),
        name: info.name || 'MIDI device',
        manufacturer: info.manufacturer || '',
        type: info.type,
        state: 'connected',
        connection: 'open',
        onmidimessage: null,
        onstatechange: null,
        open: () => Promise.resolve(port),
        close: () => Promise.resolve(port),
      }
      if (info.type === 'output') {
        port.send = (data) => postToNative({ type: 'send', id: port.id, data: Array.from(data, (b) => b & 0xff) })
      }
      return port
    }

    function dispatchStateChange(port) {
      if (typeof access.onstatechange === 'function') access.onstatechange({ port })
    }

    // Native pushes the full current port list; diff it against known ports so
    // existing port objects keep their identity (midi.js compares them with ===).
    function setPorts(list) {
      const seen = new Set()
      for (const info of list) {
        const map = info.type === 'input' ? inputs : outputs
        const id = String(info.id)
        seen.add(info.type + ':' + id)
        const existing = map.get(id)
        if (existing) {
          existing.name = info.name || existing.name
          continue
        }
        const port = makePort(info)
        map.set(id, port)
        dispatchStateChange(port)
      }
      for (const [kind, map] of [
        ['input', inputs],
        ['output', outputs],
      ]) {
        for (const [id, port] of Array.from(map)) {
          if (seen.has(kind + ':' + id)) continue
          map.delete(id)
          port.state = 'disconnected'
          port.connection = 'closed'
          dispatchStateChange(port)
        }
      }
      resolveFirstPorts()
    }

    function receiveMIDI(id, bytes, timeStamp) {
      const input = inputs.get(String(id))
      if (!input || typeof input.onmidimessage !== 'function') return
      input.onmidimessage({ data: Uint8Array.from(bytes), timeStamp: timeStamp === undefined ? now() : timeStamp })
    }

    // Resolve once the native side has pushed its port list, so the app's
    // silent auto-connect at page load sees devices that are already plugged
    // in. The timeout keeps the promise from hanging if native never answers.
    function requestMIDIAccess() {
      postToNative({ type: 'ready' })
      const timeout = new Promise((resolve) => setTimeout(resolve, 1500))
      return Promise.race([firstPorts, timeout]).then(() => access)
    }

    return { access, requestMIDIAccess, setPorts, receiveMIDI }
  }

  function installWebMIDIShim(shim, target) {
    target.navigator.requestMIDIAccess = () => shim.requestMIDIAccess()
    target.__pianoTrainerMIDI = {
      setPorts: (list) => shim.setPorts(list),
      receiveMIDI: (id, bytes, timeStamp) => shim.receiveMIDI(id, bytes, timeStamp),
    }
  }

  const bridge = global.webkit && global.webkit.messageHandlers && global.webkit.messageHandlers.midiBridge
  if (bridge) {
    const shim = createWebMIDIShim((message) => bridge.postMessage(message))
    installWebMIDIShim(shim, global)
    bridge.postMessage({ type: 'ready' })
  }

  // Exposed for tests (test/js/webmidiShim.test.js runs this file in a vm).
  global.__createWebMIDIShim = createWebMIDIShim
  global.__installWebMIDIShim = installWebMIDIShim
})(typeof window !== 'undefined' ? window : globalThis)
