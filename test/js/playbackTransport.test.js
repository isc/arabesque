import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'

// The playback transport: ⏸ / ▶, the tempo the piece is heard at, and the bar
// it is heard from. All three are what feedback 50e2418d asked for, and all
// three come down to the same thing — rebuilding the schedule from a bar line —
// so they are tested together, on the timers rather than through the browser.

// Four measures of one whole note each. At 120 BPM a whole note is 2s, so the
// bar lines fall at 0, 2000, 4000 and 6000 ms.
function score(measureCount = 4) {
  const allNotes = Array.from({ length: measureCount }, (_, i) => ({
    measureIndex: i,
    sourceMeasureIndex: i,
    notes: [{ midiNumber: 60 + i, timestamp: i, note: { Length: { RealValue: 1 } } }],
    cursorStops: [0],
  }))
  const sourceMeasures = allNotes.map(() => ({ Duration: { RealValue: 1 }, TempoInBPM: 120 }))
  return [allNotes, { Sheet: { SourceMeasures: sourceMeasures }, cursor }]
}

// Enough of OSMD's cursor to say where it was left: reset/next is how both
// engines put it on a given stop.
let cursor
let sent

function notesStarted() {
  return sent.filter(([status]) => status === 0x90).map(([, note]) => note)
}

async function load() {
  vi.resetModules()
  sent = []
  cursor = {
    steps: 0,
    shown: false,
    cursorElement: null,
    reset() { this.steps = 0 },
    next() { this.steps++ },
    show() { this.shown = true },
    hide() { this.shown = false },
  }
  const playback = await import('../../public/js/playback.js')
  // An instrument to send to, so nothing waits on the sampler's samples.
  return playback.initPlayback({ midiOutput: { send: (bytes) => sent.push([...bytes]) } })
}

describe('playback transport', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    // isTestEnv() reads document.cookie; scheduleCursorAdvances looks the score
    // SVG up to scroll it, and finds nothing here.
    vi.stubGlobal('document', { cookie: '', querySelector: () => null })
    vi.stubGlobal('window', { scrollY: 0 })
    vi.stubGlobal('localStorage', { getItem: () => null, setItem: () => {} })
  })

  afterEach(() => {
    vi.useRealTimers()
    vi.unstubAllGlobals()
  })

  it('holds the piece at the bar it has reached, and picks it up there', async () => {
    const pb = await load()
    await pb.play(...score())
    vi.advanceTimersByTime(2500) // into the second bar

    pb.pause()

    expect(pb.transport).toBe('paused')
    expect(pb.currentMeasureIndex).toBe(1)
    // Nothing left ringing, and nothing more scheduled.
    sent = []
    vi.advanceTimersByTime(10000)
    expect(notesStarted()).toEqual([])

    await pb.play(...score())
    vi.advanceTimersByTime(1)

    expect(pb.transport).toBe('playing')
    expect(notesStarted()).toEqual([61])
  })

  it('resumes at the bar clicked while paused, and moves the cursor there', async () => {
    const pb = await load()
    await pb.play(...score())
    vi.advanceTimersByTime(100)
    pb.pause()

    pb.seekToMeasure(3)

    expect(pb.currentMeasureIndex).toBe(3)
    // One cursor stop per bar, so the fourth bar is three advances in.
    expect(cursor.steps).toBe(3)
    expect(cursor.shown).toBe(true)

    sent = []
    await pb.play(...score())
    vi.advanceTimersByTime(1)

    expect(notesStarted()).toEqual([63])
  })

  it('jumps straight to the bar clicked while it plays', async () => {
    const pb = await load()
    await pb.play(...score())
    vi.advanceTimersByTime(100)
    sent = []

    pb.seekToMeasure(2)
    vi.advanceTimersByTime(1)

    expect(pb.transport).toBe('playing')
    expect(notesStarted()).toEqual([62])
  })

  it('plays at the tempo asked for, from the first bar', async () => {
    const pb = await load()
    pb.setTempo(240) // twice the written tempo: a bar now lasts 1s
    await pb.play(...score())

    vi.advanceTimersByTime(1001)

    expect(notesStarted()).toEqual([60, 61])
  })

  it('takes a tempo changed mid-piece from the bar being played', async () => {
    const pb = await load()
    await pb.play(...score())
    vi.advanceTimersByTime(2000) // the second bar has just started
    sent = []

    pb.setTempo(240)
    vi.advanceTimersByTime(1)
    // The bar it was on is replayed at the new tempo rather than the piece
    // going back to the top.
    expect(notesStarted()).toEqual([61])

    vi.advanceTimersByTime(1000)
    expect(notesStarted()).toEqual([61, 62])
  })

  it('puts the piece away on ⏹, so ▶ starts it from the top', async () => {
    const pb = await load()
    await pb.play(...score())
    vi.advanceTimersByTime(2500)
    pb.pause()

    pb.stop()

    expect(pb.transport).toBe('stopped')
    expect(pb.currentMeasureIndex).toBe(0)
    sent = []
    await pb.play(...score())
    vi.advanceTimersByTime(1)
    expect(notesStarted()).toEqual([60])
  })

  it('ends the listening when the last note has sounded', async () => {
    const pb = await load()
    let ended = 0
    pb.setOnPlaybackEnd(() => ended++)
    await pb.play(...score())

    vi.advanceTimersByTime(9000)

    expect(ended).toBe(1)
    expect(pb.transport).toBe('stopped')
  })
})
