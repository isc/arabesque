import { describe, it, expect, beforeEach, vi } from 'vitest'

// midi.js holds the connection and its callbacks at module scope, so each test
// takes a fresh copy of the module rather than what the one before it left
// connected (see the vi.resetModules() below).
const freshMidi = async () => (await import('../../public/js/midi.js')).initMidi()

// A MIDI port that turns up after the page has loaded — the normal case on
// iOS, where Bluetooth MIDI is paired from inside the app, and the reason the
// library page's "play the opening notes to open a score" feature was dead
// there while note validation worked.
function fakePort(name) {
  return { id: name, name, type: 'input', state: 'connected', onmidimessage: null }
}

function fakeAccess({ inputs = [] } = {}) {
  return {
    inputs: new Map(inputs.map((p) => [p.id, p])),
    outputs: new Map(),
    onstatechange: null,
  }
}

describe('connectMIDI with no device at page load', () => {
  // `navigator` is getter-only in Node, hence stubGlobal rather than assignment.
  const stubNavigator = (access) =>
    vi.stubGlobal('navigator', { requestMIDIAccess: async () => access })

  beforeEach(() => {
    vi.resetModules()
    vi.stubGlobal('alert', () => {})
    // isTestEnv() reads document.cookie and would short-circuit connectMIDI
    // into its mock keyboard; this suite exercises the real path.
    vi.stubGlobal('document', { cookie: '' })
  })

  it('still listens for devices that arrive later', async () => {
    const access = fakeAccess({ inputs: [] })
    stubNavigator(access)

    const midi = await freshMidi()
    const played = []
    midi.setCallbacks({ onNotePlayed: (_, note) => played.push(note) })

    const result = await midi.connectMIDI({ silent: true, autoSelectFirst: true })
    expect(result).toEqual({ status: 'no_devices' })

    // The whole point: the listener exists despite the early return.
    expect(typeof access.onstatechange).toBe('function')

    const piano = fakePort('AURES 2')
    access.onstatechange({ port: piano })

    expect(typeof piano.onmidimessage).toBe('function')
    piano.onmidimessage({ data: [0x90, 60, 80] })
    expect(played).toEqual([60])
  })

  it('connects straight away when a device is already there', async () => {
    const piano = fakePort('FP-30')
    const access = fakeAccess({ inputs: [piano] })
    stubNavigator(access)

    const midi = await freshMidi()
    await midi.connectMIDI({ silent: true, autoSelectFirst: true })

    expect(typeof piano.onmidimessage).toBe('function')
    expect(typeof access.onstatechange).toBe('function')
  })

  // Connecting the keyboard is only half of it: the page keeps its own copy of
  // "connected / not connected" for the header, and a connection made outside
  // connectMIDI() has to say so — otherwise pairing in the iOS Bluetooth sheet
  // leaves the header still offering to connect until the user asks a second
  // time. That second tap is what feedback 1ef775cc was about.
  it('tells the page when a keyboard connects or drops on its own', async () => {
    const access = fakeAccess({ inputs: [] })
    stubNavigator(access)

    const midi = await freshMidi()
    const seen = []
    midi.setCallbacks({ onConnectionChange: () => seen.push({ ...midi.state }) })

    await midi.connectMIDI({ silent: true, autoSelectFirst: true })
    expect(seen).toHaveLength(0)

    const piano = fakePort('AURES 2')
    access.onstatechange({ port: piano })

    expect(seen).toHaveLength(1)
    expect(seen[0].midiConnected).toBe(true)
    expect(seen[0].midiInput.name).toBe('AURES 2')

    piano.state = 'disconnected'
    access.onstatechange({ port: piano })

    expect(seen).toHaveLength(2)
    expect(seen[1].midiConnected).toBe(false)
  })
})
