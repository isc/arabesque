import { describe, it, expect, beforeEach, vi } from 'vitest'

import { initMidi } from '../../public/js/midi.js'

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
    vi.stubGlobal('alert', () => {})
    // isTestEnv() reads document.cookie and would short-circuit connectMIDI
    // into its mock keyboard; this suite exercises the real path.
    vi.stubGlobal('document', { cookie: '' })
  })

  it('still listens for devices that arrive later', async () => {
    const access = fakeAccess({ inputs: [] })
    stubNavigator(access)

    const midi = initMidi()
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

    const midi = initMidi()
    await midi.connectMIDI({ silent: true, autoSelectFirst: true })

    expect(typeof piano.onmidimessage).toBe('function')
    expect(typeof access.onstatechange).toBe('function')
  })
})
