import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// What the app sends to make a sound, and where it sends it.
//
// Playback drives the player's own MIDI instrument when one is connected and
// the sampler otherwise, at a velocity that has to stay below a practising
// touch — an instrument answering ▶ Écouter louder than its own keys is what
// feedback 15ae51f5 reported. And when it is the sampler, it is built at most
// once however many times it is asked for while its samples are still coming.

const sampler = vi.hoisted(() => ({ keysDown: [], built: 0 }))

vi.mock('@tonejs/piano', () => ({
  Piano: class {
    constructor() { sampler.built++ }
    toDestination() { return this }
    async load() {}
    keyDown(arg) { sampler.keysDown.push(arg) }
    keyUp() {}
    pedalDown() {}
    pedalUp() {}
  },
}))

// One measure holding one quarter note, plus the OSMD sheet playback reads the
// tempo and measure lengths off.
function score() {
  const allNotes = [{
    measureIndex: 0,
    sourceMeasureIndex: 0,
    notes: [{ midiNumber: 60, timestamp: 0, note: { Length: { RealValue: 0.25 } } }],
    cursorStops: [],
  }]
  const osmd = { Sheet: { SourceMeasures: [{ Duration: { RealValue: 1 }, TempoInBPM: 120 }] } }
  return [allNotes, osmd]
}

// A fresh copy of the module each time: playback keeps its sampler.
async function load(midiState) {
  vi.resetModules()
  const { initPlayback } = await import('../../public/js/playback.js')
  return initPlayback(midiState)
}

async function playOneNote(midiState) {
  const pb = await load(midiState)
  await pb.togglePlayback(...score())
  vi.advanceTimersByTime(1)
}

describe('playback output', () => {
  beforeEach(() => {
    sampler.keysDown = []
    sampler.built = 0
    vi.useFakeTimers()
    // isTestEnv() reads document.cookie; without the test-env marker playback
    // loads the (mocked) sampler, which is what the sampler case needs to see.
    vi.stubGlobal('document', { cookie: '' })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('sends notes to the MIDI instrument below a practising touch', async () => {
    const sent = []
    await playOneNote({ midiOutput: { send: (bytes) => sent.push([...bytes]) } })

    // Velocity 64, a step under a practising touch — the mock keyboard the
    // system tests play with presses at 80 (test_helper.rb), and playback used
    // to send 89, a forte.
    expect(sent.filter(([status]) => status === 0x90)).toEqual([[0x90, 60, 64]])
  })

  it('plays the sampler at the same level', async () => {
    await playOneNote(null)

    expect(sampler.keysDown).toEqual([{ midi: 60, velocity: 0.5 }])
  })

  // The sampler is only assigned once its samples are in, so a second caller
  // arriving during the download would otherwise build a whole second one, and
  // pull a whole second sample set with it.
  it('builds one sampler however many times it is asked for while it loads', async () => {
    const pb = await load(null)

    await Promise.all([pb.togglePlayback(...score()), pb.togglePlayback(...score())])

    expect(sampler.built).toBe(1)
  })
})
