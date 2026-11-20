import { describe, it, expect } from 'vitest'
import { clicksPerBeat, metronomeTicks } from '../../public/js/metronomeClick.js'

// The length of a quarter-note beat at ♩ = bpm.
const beat = (bpm) => 60_000 / bpm

describe('clicksPerBeat', () => {
  it('clicks the beat alone while it comes at least once a second', () => {
    expect(clicksPerBeat(beat(120))).toBe(1)
    expect(clicksPerBeat(beat(60))).toBe(1)
  })

  // Feedback 0dee8c99: the C minor prelude at ♩ = 30, two seconds between clicks.
  it('splits a slower beat in eighths, then in sixteenths', () => {
    expect(clicksPerBeat(beat(59))).toBe(2)
    expect(clicksPerBeat(beat(30))).toBe(2)
    expect(clicksPerBeat(beat(29))).toBe(4)
    expect(clicksPerBeat(beat(20))).toBe(4)
  })

  it('leaves a beat of no length whole rather than halve it forever', () => {
    expect(clicksPerBeat(beat(0))).toBe(1)
    expect(clicksPerBeat(NaN)).toBe(1)
  })
})

describe('metronomeTicks', () => {
  it('clicks every beat, and only the beats, at a brisk tempo', () => {
    expect(metronomeTicks({ beatMs: beat(120), lastBeat: 3 })).toEqual([
      { atMs: 0, beat: 0, kind: 'accent' },
      { atMs: 500, beat: 1, kind: 'beat' },
      { atMs: 1000, beat: 2, kind: 'beat' },
      { atMs: 1500, beat: 3, kind: 'beat' },
    ])
  })

  it('puts the subdivisions between the beats, and none after the last', () => {
    expect(metronomeTicks({ beatMs: beat(30), lastBeat: 2 })).toEqual([
      { atMs: 0, beat: 0, kind: 'accent' },
      { atMs: 1000, beat: 0, kind: 'subdivision' },
      { atMs: 2000, beat: 1, kind: 'beat' },
      { atMs: 3000, beat: 1, kind: 'subdivision' },
      { atMs: 4000, beat: 2, kind: 'beat' },
    ])
  })
})
