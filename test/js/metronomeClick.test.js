import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// What the click sends, and where. Why it is a setting rather than something
// detected is in metronomeClick.js; what this pins is the bytes and the choice
// of destination.

// The page globals the module touches (the suite runs in node). `audio` is the
// context the module builds, so a test can tell a blip from silence.
let audio

function installBrowserGlobals() {
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  })
  const noopNode = { connect: () => noopNode }
  vi.stubGlobal('window', {
    AudioContext: class {
      constructor() {
        this.state = 'running'
        this.currentTime = 0
        this.destination = {}
        this.oscillators = 0
        audio = this
      }
      resume() {}
      createOscillator() {
        this.oscillators++
        return { frequency: {}, connect: () => noopNode, start: () => {}, stop: () => {} }
      }
      createGain() {
        return {
          gain: { setValueAtTime: () => {}, exponentialRampToValueAtTime: () => {} },
          connect: () => noopNode,
        }
      }
    },
  })
}

let click

beforeEach(async () => {
  audio = null
  installBrowserGlobals()
  // A fresh copy of the module each time: it keeps one AudioContext, and its
  // destination, for the life of the page it runs on.
  vi.resetModules()
  click = await import('../../public/js/metronomeClick.js')
})

afterEach(() => {
  vi.unstubAllGlobals()
})

// A piano that records what it is sent, and can be unplugged.
function piano() {
  const sent = []
  return { sent, state: { midiOutput: { send: (bytes, at) => sent.push({ bytes: [...bytes], at }) } } }
}

describe('metronome click', () => {
  it('is off until it is turned on, and goes back off', () => {
    expect(click.midiClickEnabled()).toBe(false)
    click.setMidiClickEnabled(true)
    expect(click.midiClickEnabled()).toBe(true)
    click.setMidiClickEnabled(false)
    expect(click.midiClickEnabled()).toBe(false)
  })

  it('sends the accent and the beat as wood blocks on the percussion channel', () => {
    const { sent, state } = piano()
    click.initMetronomeClick(state)
    click.setMidiClickEnabled(true)
    click.prepareClick()

    click.playClick({ accent: true })
    click.playClick({ accent: false })

    // 0x99/0x89 are note-on/note-off on channel 10; 76 and 77 the high and low
    // wood blocks, the accent taking the higher one.
    expect(sent.map((m) => m.bytes)).toEqual([
      [0x99, 76, 100],
      [0x89, 76, 0],
      [0x99, 77, 80],
      [0x89, 77, 0],
    ])
    // The release carries a timestamp, so it is the instrument that holds it
    // rather than a timer of ours (see RELEASE_MS).
    expect(sent[1].at).toBeGreaterThan(0)
    // Nothing came out of the device's own speaker.
    expect(audio.oscillators).toBe(0)
  })

  it('blips on the device when the setting is off, even with a piano connected', () => {
    const { sent, state } = piano()
    click.initMetronomeClick(state)
    click.prepareClick()

    click.playClick({ accent: true })

    expect(sent).toEqual([])
    expect(audio.oscillators).toBe(1)
  })

  it('falls back to the device when the piano is unplugged mid-run', () => {
    const { state } = piano()
    click.initMetronomeClick(state)
    click.setMidiClickEnabled(true)
    click.prepareClick()

    state.midiOutput = null
    click.playClick({ accent: false })

    expect(audio.oscillators).toBe(1)
  })

  it('does not move the click out from under a player mid-run', () => {
    const { sent, state } = piano()
    click.initMetronomeClick(state)
    click.prepareClick()

    click.setMidiClickEnabled(true)
    click.playClick({ accent: false })

    expect(sent).toEqual([])
    expect(audio.oscillators).toBe(1)
  })
})
