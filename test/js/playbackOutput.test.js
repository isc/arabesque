import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// What the app sends to make a sound, and where it sends it.
//
// Playback drives the player's own MIDI instrument when one is connected and
// the sampler otherwise, at a velocity that has to stay below a practising
// touch — an instrument answering ▶ Écouter louder than its own keys is what
// feedbacks 15ae51f5 and 70a4f378 reported. And when it is the sampler, it is
// built at most once however many times it is asked for while its samples are
// still coming.

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
// tempo off.
function score(notes = [{ midiNumber: 60, timestamp: 0, note: { Length: { RealValue: 0.25 } } }]) {
  const allNotes = [{
    measureIndex: 0,
    sourceMeasureIndex: 0,
    notes,
    cursorStops: [],
    duration: 1,
  }]
  const osmd = { Sheet: { SourceMeasures: [{ TempoInBPM: 120 }] } }
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
  await pb.play(...score())
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

    // Velocity 40, a piano — well under the mock keyboard the system tests
    // play with, which presses at 80 (test_helper.rb). Playback used to send
    // 89, a forte, then 64, which was still loud enough to have the player
    // turning the instrument down (feedback 70a4f378).
    expect(sent.filter(([status]) => status === 0x90)).toEqual([[0x90, 60, 40]])
  })

  it('plays the sampler at the same level', async () => {
    await playOneNote(null)

    expect(sampler.keysDown).toEqual([{ midi: 60, velocity: 40 / 127 }])
  })

  // The sampler is only assigned once its samples are in, so a second caller
  // arriving during the download would otherwise build a whole second one, and
  // pull a whole second sample set with it.
  it('builds one sampler however many times it is asked for while it loads', async () => {
    const pb = await load(null)

    await Promise.all([pb.play(...score()), pb.play(...score())])

    expect(sampler.built).toBe(1)
  })

  // Feedback b067270f: an arpeggio sign was played as a block chord. A quarter
  // at 120 BPM lasts 500ms, room for the full 40ms step; each note is let go
  // at the chord's end, not 500ms after its own late start.
  it('rolls an arpeggiated chord and holds every note to its end', async () => {
    const arpeggio = { type: 7 }
    const chord = [67, 60, 64].map((midiNumber) => ({ midiNumber, timestamp: 0, note: { Length: { RealValue: 0.25 }, Arpeggio: arpeggio } }))
    const sent = []
    const pb = await load({ midiOutput: { send: (bytes) => sent.push([performance.now(), ...bytes]) } })
    const t0 = performance.now()
    await pb.play(...score(chord))
    vi.advanceTimersByTime(600)

    const at = (status) => sent.filter(([, s]) => s === status).map(([t, , midi]) => [t - t0, midi])
    expect(at(0x90)).toEqual([[0, 60], [40, 64], [80, 67]])
    expect(at(0x80).sort(([, a], [, b]) => a - b)).toEqual([[500, 60], [500, 64], [500, 67]])
  })
})
