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
    duration: 1,
  }))
  return [allNotes, { Sheet: { SourceMeasures: [{ TempoInBPM: 120 }] }, cursor }]
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
    const moves = []
    pb.setOnTransportChange(() => moves.push(pb.transport))
    await pb.play(...score())
    expect(moves).toEqual(['playing'])

    vi.advanceTimersByTime(9000)

    expect(moves).toEqual(['playing', 'stopped'])
    expect(pb.transport).toBe('stopped')
  })

  // The page mirrors the transport and the bar it is held at. It is told from
  // the engine, once per move, rather than asking after every control it
  // offers — a control added later cannot forget to ask.
  it('says so whenever the transport or the held bar moves', async () => {
    const pb = await load()
    const moves = []
    pb.setOnTransportChange(() => moves.push([pb.transport, pb.currentMeasureIndex]))

    await pb.play(...score())
    vi.advanceTimersByTime(2500)
    pb.pause()
    pb.seekToMeasure(3)
    pb.setTempo(240)
    pb.stop()

    expect(moves).toEqual([
      ['playing', 0],
      ['paused', 1],
      ['paused', 3],
      ['stopped', 0],
    ])
  })

  // A measure that ends on grace notes has them after its last note, not before
  // it: the cadenza of Chopin's Op. 9 No. 2 follows its fermata chord. They go at
  // the grace-note pace, squeezed only when that would run past the bar line.
  describe('grace notes that follow their note', () => {
    // One bar of a whole note (2s at 120 BPM), then `count` grace notes after it.
    function barEndingOnGraces(count) {
      const [allNotes, osmd] = score(1)
      for (let i = 0; i < count; i++) {
        allNotes[0].notes.push({
          midiNumber: 70 + (i % 10),
          timestamp: (i + 1) * 0.0001,
          isGrace: true,
          isAfterGrace: true,
        })
      }
      return [allNotes, osmd]
    }

    it('plays them one grace note apart after it', async () => {
      const pb = await load()
      await pb.play(...barEndingOnGraces(3))

      vi.advanceTimersByTime(79)
      expect(notesStarted()).toEqual([60])
      vi.advanceTimersByTime(2) // 81ms
      expect(notesStarted()).toEqual([60, 70])
      vi.advanceTimersByTime(160) // 241ms
      expect(notesStarted()).toEqual([60, 70, 71, 72])
    })

    it('squeezes them to end with the bar when there is no room for them', async () => {
      const pb = await load()
      // 49 grace notes at 80ms would take 3.9s of a 2s bar: 40ms each instead.
      await pb.play(...barEndingOnGraces(49))

      vi.advanceTimersByTime(1959)
      expect(notesStarted()).toHaveLength(49)
      vi.advanceTimersByTime(2) // 1961ms: the last one, before the bar line
      expect(notesStarted()).toHaveLength(50)
    })
  })
})
