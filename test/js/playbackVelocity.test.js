import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// Playback drives whatever makes the sound: the player's own MIDI instrument when
// one is connected, the sampler otherwise. Both are fed the same velocity, and it
// has to stay below a practising player's touch — an instrument that answers
// ▶ Écouter louder than its own keys is what feedback 15ae51f5 reported.

const sampler = vi.hoisted(() => ({ keysDown: [] }))

vi.mock('@tonejs/piano', () => ({
  Piano: class {
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

async function playOneNote(midiState) {
  vi.resetModules()
  const { initPlayback } = await import('../../public/js/playback.js')
  const playback = initPlayback(midiState)
  await playback.togglePlayback(...score())
  vi.advanceTimersByTime(1)
}

describe('playback velocity', () => {
  beforeEach(() => {
    sampler.keysDown = []
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
})
