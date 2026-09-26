import { describe, it, expect, vi, afterEach } from 'vitest'
import {
  GRADUATED,
  RANDOM,
  BPM_STEP,
  STREAK,
  createTempoPlan,
  createTempoTrainer,
  isCleanRun,
  summarizeRuns,
} from '../../public/js/tempoTrainer.js'

const CLEAN = { total: 10, hit: 10, offTempoEarly: 0, offTempoLate: 0, missed: 0, wrongNotes: 0 }
const WOBBLY = { ...CLEAN, hit: 9, offTempoLate: 1 }
const MISSED = { ...CLEAN, hit: 9, missed: 1 }
const WRONG = { ...CLEAN, wrongNotes: 1 }
const SLOPPY = { ...CLEAN, hit: 8, offTempoEarly: 2 }

describe('isCleanRun', () => {
  it('allows a wobble but not a miss, a wrong note or too much off-tempo', () => {
    expect(isCleanRun(CLEAN)).toBe(true)
    expect(isCleanRun(WOBBLY)).toBe(true)
    expect(isCleanRun(MISSED)).toBe(false)
    expect(isCleanRun(WRONG)).toBe(false)
    expect(isCleanRun(SLOPPY)).toBe(false)
    expect(isCleanRun({ ...CLEAN, total: 0, hit: 0 })).toBe(false)
  })
})

describe('graduated plan', () => {
  function plan() {
    return createTempoPlan({ mode: GRADUATED, bpm: 100 })
  }

  function play(p, verdict) {
    return p.record({ ...verdict, bpm: p.nextBpm() })
  }

  it('raises the tempo a step after a streak of clean runs', () => {
    const p = plan()
    for (let i = 1; i < STREAK; i++) {
      expect(play(p, CLEAN)).toBe(true)
      expect(p.cleanStreak).toBe(i)
      expect(p.bpm).toBe(100)
    }
    play(p, CLEAN)
    expect(p.cleanStreak).toBe(0)
    expect(p.nextBpm()).toBe(100 + BPM_STEP)
  })

  it('starts the streak over on a failed run', () => {
    const p = plan()
    play(p, CLEAN)
    play(p, CLEAN)
    expect(play(p, MISSED)).toBe(false)
    expect(p.cleanStreak).toBe(0)
    play(p, CLEAN)
    play(p, CLEAN)
    expect(p.nextBpm()).toBe(100)
    play(p, CLEAN)
    expect(p.nextBpm()).toBe(100 + BPM_STEP)
  })

  it('lowers the tempo a step after a streak of failed runs, never below the start', () => {
    const p = plan()
    for (let i = 0; i < STREAK; i++) play(p, CLEAN)
    expect(p.bpm).toBe(100 + BPM_STEP)
    for (let i = 0; i < STREAK - 1; i++) play(p, WRONG)
    expect(p.bpm).toBe(100 + BPM_STEP)
    play(p, WRONG)
    expect(p.bpm).toBe(100)
    for (let i = 0; i < STREAK; i++) play(p, WRONG)
    expect(p.bpm).toBe(100)
  })

  it('keeps every run with the tempo it was played at', () => {
    const p = plan()
    for (let i = 0; i < STREAK + 1; i++) play(p, CLEAN)
    expect(p.runs.map((run) => run.bpm)).toEqual([100, 100, 100, 105])
  })
})

describe('random plan', () => {
  it('draws from the tempi around the target, never the same twice running', () => {
    // A generator that always asks for the first choice: with the last tempo
    // taken out of the choices, that is what forces a change.
    const p = createTempoPlan({ mode: RANDOM, bpm: 100, random: () => 0 })
    const drawn = []
    for (let i = 0; i < 6; i++) {
      const bpm = p.nextBpm()
      drawn.push(bpm)
      p.record({ ...CLEAN, bpm })
    }
    expect(drawn).toEqual([70, 85, 70, 85, 70, 85])
    expect(p.bpm).toBe(100)
  })

  it('covers the whole spread', () => {
    let i = 0
    const p = createTempoPlan({ mode: RANDOM, bpm: 100, random: () => [0, 0.3, 0.6, 0.99][i++ % 4] })
    const drawn = new Set()
    for (let k = 0; k < 8; k++) {
      const bpm = p.nextBpm()
      drawn.add(bpm)
      p.record({ ...CLEAN, bpm })
    }
    expect([...drawn].sort((a, b) => a - b)).toEqual([70, 85, 100, 110])
  })
})

describe('summarizeRuns', () => {
  it('counts the runs, the clean ones, the tempo range and the best streak', () => {
    const runs = [
      { bpm: 100, clean: true },
      { bpm: 100, clean: true },
      { bpm: 100, clean: false },
      { bpm: 100, clean: true },
      { bpm: 100, clean: true },
      { bpm: 100, clean: true },
      { bpm: 105, clean: false },
    ]
    expect(summarizeRuns(runs)).toEqual({ count: 7, cleanCount: 5, fromBpm: 100, toBpm: 105, bestStreak: 3 })
    expect(summarizeRuns([])).toEqual({ count: 0, cleanCount: 0, fromBpm: null, toBpm: null, bestStreak: 0 })
  })
})

describe('the loop', () => {
  afterEach(() => vi.useRealTimers())

  // Each run resolves at once with the verdict queued for it; the loop's own
  // pauses are the only time that passes.
  function trainerWith(results, onRun) {
    vi.useFakeTimers()
    const played = []
    const plan = createTempoPlan({ mode: GRADUATED, bpm: 100 })
    const runOnce = vi.fn((bpm) => {
      played.push(bpm)
      const next = results.shift()
      return Promise.resolve(next.aborted ? next : { verdict: { ...next, bpm } })
    })
    const trainer = createTempoTrainer({ plan, runOnce, onRun, pauseMs: 1000 })
    return { trainer, played, runOnce }
  }

  it('plays run after run with a pause between them, at the tempo the plan hands out', async () => {
    const onRun = vi.fn()
    const { trainer, played } = trainerWith([CLEAN, CLEAN, CLEAN, CLEAN, { aborted: true }], onRun)
    const done = trainer.start()
    await vi.advanceTimersByTimeAsync(999)
    expect(played).toEqual([100])
    await vi.advanceTimersByTimeAsync(1)
    expect(played).toEqual([100, 100])
    await vi.advanceTimersByTimeAsync(3000)
    // Three clean runs raised the tempo; the aborted fifth run ended the loop.
    expect(played).toEqual([100, 100, 100, 105, 105])
    expect(onRun).toHaveBeenCalledTimes(4)
    expect(await done).toMatchObject({ count: 4, cleanCount: 4, fromBpm: 100, toBpm: 105, bestStreak: 4 })
  })

  it('ends between runs when stopped during the pause', async () => {
    const { trainer, played } = trainerWith([CLEAN, CLEAN])
    const done = trainer.start()
    await vi.advanceTimersByTimeAsync(500)
    trainer.stop()
    expect(await done).toMatchObject({ count: 1 })
    await vi.advanceTimersByTimeAsync(5000)
    expect(played).toEqual([100])
  })

  it('does not count a run stopped midway', async () => {
    const { trainer } = trainerWith([CLEAN, { aborted: true }])
    const done = trainer.start()
    await vi.advanceTimersByTimeAsync(1000)
    expect(await done).toMatchObject({ count: 1 })
  })
})
