import { describe, it, expect } from 'vitest'
import { playthroughOf, computeSessionDuration } from '../../public/js/practiceTime.js'

const BASE = new Date('2026-06-10T10:00:00.000Z').getTime()

// Lay out {dur, gapBefore} segments on a timeline starting at BASE: the cursor
// advances by each gap, then by each measure duration. Both duration functions
// now share one normalization, so their fixtures share one builder.
function buildMeasures(segments) {
  let cursor = BASE
  const measures = segments.map(({ dur, gapBefore = 0 }, i) => {
    cursor += gapBefore
    const startedAt = new Date(cursor).toISOString()
    cursor += dur
    return { sourceMeasureIndex: i, attempts: [{ startedAt, durationMs: dur, clean: true }] }
  })
  return { measures, endedAt: cursor }
}

describe('playthroughOf (interruption normalization)', () => {
  // completedAt sits right after the last measure.
  function buildPlaythrough(segments) {
    const { measures, endedAt } = buildMeasures(segments)
    return {
      playthroughStartedAt: new Date(BASE).toISOString(),
      completedAt: new Date(endedAt).toISOString(),
      measures,
    }
  }

  it('leaves an uninterrupted playthrough unchanged (equals wall-clock)', () => {
    const session = buildPlaythrough([
      { dur: 5000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
    ])
    // 5×5000 measures + 4×1000 gaps = 29000
    expect(playthroughOf(session).durationMs).toBe(29000)
  })

  it('does not penalize slow-but-continuous playing', () => {
    // Slow measures (12s) and slowish-but-normal gaps (3s): nothing clamped.
    const session = buildPlaythrough([
      { dur: 12000 },
      { dur: 12000, gapBefore: 3000 },
      { dur: 12000, gapBefore: 3000 },
      { dur: 12000, gapBefore: 3000 },
    ])
    const raw =
      new Date(session.completedAt).getTime() -
      new Date(session.playthroughStartedAt).getTime()
    expect(playthroughOf(session).durationMs).toBe(raw)
  })

  it('clamps an interruption that lands inside a measure', () => {
    // Measure 2 ballooned to 200s (interrupted mid-measure before completing).
    const session = buildPlaythrough([
      { dur: 5000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 200000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
    ])
    // Aberrant measure → longest normal measure (5000). Same as uninterrupted.
    expect(playthroughOf(session).durationMs).toBe(29000)
  })

  it('clamps an interruption that lands between two measures', () => {
    // A 5-minute pause before measure 3 (phone call after finishing measure 2).
    const session = buildPlaythrough([
      { dur: 5000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 300000 },
      { dur: 5000, gapBefore: 1000 },
    ])
    // Aberrant gap → median normal gap (1000). Same as uninterrupted.
    expect(playthroughOf(session).durationMs).toBe(29000)
  })

  it('falls back to raw duration when attempts lack timing', () => {
    const session = {
      playthroughStartedAt: new Date(BASE).toISOString(),
      completedAt: new Date(BASE + 42000).toISOString(),
      measures: [{ sourceMeasureIndex: 0, attempts: [{ clean: true }] }],
    }
    expect(playthroughOf(session).durationMs).toBe(42000)
  })
})

describe('computeSessionDuration (practice time credited to a session)', () => {
  // A session has no playthrough window: the duration comes from the attempts.
  function buildSession(segments) {
    return { startedAt: new Date(BASE).toISOString(), measures: buildMeasures(segments).measures }
  }

  it('spans first attempt to last when nothing is aberrant', () => {
    const session = buildSession([
      { dur: 5000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
    ])
    // 4×5000 + 3×1000 = 23000, i.e. the raw span.
    expect(computeSessionDuration(session)).toBe(23000)
  })

  it('is zero without any attempt', () => {
    expect(computeSessionDuration({ measures: [] })).toBe(0)
    expect(computeSessionDuration({})).toBe(0)
  })

  it('discounts a score left open mid-measure', () => {
    // The real case behind this: one attempt ran 79 minutes on measure 0
    // while the score sat open, and the journal credited the whole of it —
    // ten minutes of practice reported as 1h33.
    const session = buildSession([
      { dur: 5000 },
      { dur: 4736000, gapBefore: 1000 }, // walked away
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 1000 },
    ])
    // The marathon attempt is replaced by the longest normal measure (5000),
    // leaving the same 23000 as an uninterrupted session.
    expect(computeSessionDuration(session)).toBe(23000)
  })

  it('discounts a pause taken between two measures', () => {
    const session = buildSession([
      { dur: 5000 },
      { dur: 5000, gapBefore: 1000 },
      { dur: 5000, gapBefore: 3_600_000 }, // walked away
      { dur: 5000, gapBefore: 1000 },
    ])
    expect(computeSessionDuration(session)).toBe(23000)
  })

  it('does not penalize slow-but-continuous practice', () => {
    const session = buildSession([
      { dur: 12000 },
      { dur: 12000, gapBefore: 3000 },
      { dur: 12000, gapBefore: 3000 },
    ])
    expect(computeSessionDuration(session)).toBe(42000)
  })
})
