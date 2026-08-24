import { readFileSync } from 'node:fs'
import vm from 'node:vm'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const shimSource = readFileSync(new URL('../../ios/Arabesque/Resources/webmidi-shim.js', import.meta.url), 'utf8')

// Runs the shim the way the WKWebView does: as a plain script at document
// start, with a webkit.messageHandlers.midiBridge handler available.
function loadShim() {
  const posted = []
  const sandbox = {
    navigator: {},
    setTimeout: (fn, ms) => setTimeout(fn, ms),
    performance: { now: () => 42 },
    webkit: { messageHandlers: { midiBridge: { postMessage: (message) => posted.push(message) } } },
  }
  sandbox.window = sandbox
  vm.createContext(sandbox)
  vm.runInContext(shimSource, sandbox)
  return { window: sandbox, posted }
}

describe('webmidi-shim', () => {
  let window, posted

  beforeEach(() => {
    ;({ window, posted } = loadShim())
  })

  it('announces itself to the native side on load', () => {
    expect(posted).toEqual([{ type: 'ready' }])
  })

  it('resolves requestMIDIAccess with the ports pushed by native', async () => {
    const accessPromise = window.navigator.requestMIDIAccess()
    window.__pianoTrainerMIDI.setPorts([
      { id: 101, name: 'FP-30X', type: 'input' },
      { id: 102, name: 'FP-30X', type: 'output' },
    ])
    const access = await accessPromise

    const inputs = Array.from(access.inputs.values())
    expect(inputs).toHaveLength(1)
    expect(inputs[0]).toMatchObject({ id: '101', name: 'FP-30X', type: 'input', state: 'connected' })
    expect(Array.from(access.outputs.values())).toHaveLength(1)
  })

  it('resolves requestMIDIAccess after a timeout when native never answers', async () => {
    vi.useFakeTimers()
    try {
      const accessPromise = window.navigator.requestMIDIAccess()
      await vi.advanceTimersByTimeAsync(1500)
      const access = await accessPromise
      expect(access.inputs.size).toBe(0)
    } finally {
      vi.useRealTimers()
    }
  })

  it('dispatches incoming MIDI to the input onmidimessage handler', async () => {
    window.__pianoTrainerMIDI.setPorts([{ id: 101, name: 'FP-30X', type: 'input' }])
    const access = await window.navigator.requestMIDIAccess()
    const input = Array.from(access.inputs.values())[0]

    const events = []
    input.onmidimessage = (event) => events.push(event)
    window.__pianoTrainerMIDI.receiveMIDI(101, [144, 60, 100])

    expect(events).toHaveLength(1)
    expect(Array.from(events[0].data)).toEqual([144, 60, 100])
    expect(events[0].timeStamp).toBe(42)
  })

  it('fires onstatechange with the same port object on disconnect and reconnect', async () => {
    window.__pianoTrainerMIDI.setPorts([{ id: 101, name: 'FP-30X', type: 'input' }])
    const access = await window.navigator.requestMIDIAccess()
    const input = Array.from(access.inputs.values())[0]

    const events = []
    access.onstatechange = (event) => events.push(event)

    window.__pianoTrainerMIDI.setPorts([])
    expect(events).toHaveLength(1)
    expect(events[0].port).toBe(input)
    expect(events[0].port.state).toBe('disconnected')
    expect(access.inputs.size).toBe(0)

    window.__pianoTrainerMIDI.setPorts([{ id: 101, name: 'FP-30X', type: 'input' }])
    expect(events).toHaveLength(2)
    expect(events[1].port.state).toBe('connected')
    expect(events[1].port.type).toBe('input')
  })

  it('does not fire onstatechange when the port list is unchanged', async () => {
    window.__pianoTrainerMIDI.setPorts([{ id: 101, name: 'FP-30X', type: 'input' }])
    const access = await window.navigator.requestMIDIAccess()

    const events = []
    access.onstatechange = (event) => events.push(event)
    window.__pianoTrainerMIDI.setPorts([{ id: 101, name: 'FP-30X', type: 'input' }])

    expect(events).toHaveLength(0)
    expect(access.inputs.size).toBe(1)
  })

  it('forwards output.send to the native side', async () => {
    window.__pianoTrainerMIDI.setPorts([{ id: 102, name: 'FP-30X', type: 'output' }])
    const access = await window.navigator.requestMIDIAccess()
    const output = Array.from(access.outputs.values())[0]

    output.send([0xb0, 123, 0])
    expect(posted).toContainEqual({ type: 'send', id: '102', data: [176, 123, 0] })
  })
})
