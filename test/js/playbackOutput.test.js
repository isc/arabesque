import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// What the app sends to make a sound, and where it sends it.
//
// Two facets of one routing decision. Playback drives the player's own MIDI
// instrument when one is connected and the sampler otherwise, at a velocity
// that has to stay below a practising touch — an instrument answering
// ▶ Écouter louder than its own keys is what feedback 15ae51f5 reported. And
// the app can be asked to make all of the sound itself, which takes playback
// off the instrument and puts the player's own keys and pedal on the sampler.

const sampler = vi.hoisted(() => ({ keysDown: [], keysUp: [], pedal: [], built: 0 }))

vi.mock('@tonejs/piano', () => ({
  Piano: class {
    constructor() { sampler.built++ }
    toDestination() { return this }
    async load() {}
    keyDown(arg) { sampler.keysDown.push(arg) }
    keyUp(arg) { sampler.keysUp.push(arg) }
    pedalDown() { sampler.pedal.push('down') }
    pedalUp() { sampler.pedal.push('up') }
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

// A fresh copy of the modules each time: playback keeps its sampler, and the
// setting is read through a stubbed localStorage.
let playback, appSound

async function load(midiState) {
  const store = new Map()
  vi.stubGlobal('localStorage', {
    getItem: (k) => store.get(k) ?? null,
    setItem: (k, v) => store.set(k, String(v)),
  })
  vi.resetModules()
  appSound = await import('../../public/js/appSound.js')
  playback = await import('../../public/js/playback.js')
  return playback.initPlayback(midiState)
}

async function playOneNote(midiState) {
  const pb = await load(midiState)
  await pb.play(...score())
  vi.advanceTimersByTime(1)
}

describe('playback output', () => {
  beforeEach(() => {
    sampler.keysDown = []
    sampler.keysUp = []
    sampler.pedal = []
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

  it('takes playback off the instrument once the app is making the sound', async () => {
    const sent = []
    const state = { midiOutput: { send: (bytes) => sent.push([...bytes]) } }
    const pb = await load(state)
    appSound.setAppSoundEnabled(true)

    await pb.play(...score())
    vi.advanceTimersByTime(1)

    expect(sent).toEqual([])
    expect(sampler.keysDown).toEqual([{ midi: 60, velocity: 0.5 }])
  })

  it('sounds the keys and pedal the player works, at their own touch', async () => {
    await load({ midiOutput: { send: () => {} } })
    appSound.setAppSoundEnabled(true)
    // The samples are fetched on the first note and arrive a tick later; that
    // note is dropped rather than played late.
    playback.echoNoteOn(64, 100)
    await vi.runOnlyPendingTimersAsync()

    playback.echoNoteOn(64, 100)
    playback.echoPedal(true)
    playback.echoNoteOff(64)
    playback.echoPedal(false)

    expect(sampler.keysDown).toEqual([{ midi: 64, velocity: 100 / 127 }])
    expect(sampler.keysUp).toEqual([{ midi: 64 }])
    expect(sampler.pedal).toEqual(['down', 'up'])
  })

  it('leaves the player their own instrument until they ask otherwise', async () => {
    await load({ midiOutput: { send: () => {} } })

    playback.echoNoteOn(64, 100)
    playback.echoPedal(true)

    expect(sampler.keysDown).toEqual([])
    expect(sampler.pedal).toEqual([])
  })

  // Turning the setting off with keys down would otherwise leave them ringing
  // with nothing left to lift them.
  it('still releases a key it sounded after the setting goes off', async () => {
    await load({ midiOutput: { send: () => {} } })
    appSound.setAppSoundEnabled(true)
    playback.echoNoteOn(64, 100)
    await vi.runOnlyPendingTimersAsync()
    playback.echoNoteOn(64, 100)

    appSound.setAppSoundEnabled(false)
    playback.echoNoteOff(64)

    expect(sampler.keysUp).toEqual([{ midi: 64 }])
  })

  // The sampler is only assigned once its samples are in, so a second caller
  // arriving during the download used to build a whole second one — and the
  // player pressing keys is one caller per note.
  it('builds one sampler however many notes arrive while it loads', async () => {
    await load({ midiOutput: { send: () => {} } })
    appSound.setAppSoundEnabled(true)

    playback.echoNoteOn(60, 100)
    playback.echoNoteOn(62, 100)
    playback.echoNoteOn(64, 100)
    await vi.runOnlyPendingTimersAsync()

    expect(sampler.built).toBe(1)
  })
})
