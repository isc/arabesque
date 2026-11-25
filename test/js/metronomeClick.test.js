import { describe, it, expect } from 'vitest'
import { clicksPerBeat, barPulse, clickTrack } from '../../public/js/metronomeClick.js'
import { barLength, barOffsets } from '../../public/js/noteExtraction.js'

// The length of a quarter-note beat at ♩ = bpm, and of a whole note.
const beat = (bpm) => 60_000 / bpm
const whole = (bpm) => 4 * beat(bpm)

const meter = (signature) => {
  const [numerator, denominator] = signature.split('/').map(Number)
  return { numerator, denominator }
}

// Bars of the note model, in score order: `durations` in whole notes, from
// the score's first bar, or from a later one after a full bar.
const bars = (signature, durations, { later = false } = {}) => {
  const timeSignature = meter(signature)
  const score = durations.map((duration) => ({ duration, timeSignature }))
  if (later) score.unshift({ duration: barLength(timeSignature), timeSignature })
  const offsets = barOffsets(score)
  return score.map((bar, i) => ({ ...bar, barOffset: offsets[i] })).slice(later ? 1 : 0)
}

// The clicks as one line each: when, which kind, and "·" for the count-in.
const heard = ({ clicks }) =>
  clicks.map(({ atMs, kind, countIn }) => `${Math.round(atMs)} ${kind}${countIn ? ' ·' : ''}`)

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

  it('splits a dotted beat in its three eighths, then in sixteenths', () => {
    expect(clicksPerBeat(900, 3)).toBe(1)
    expect(clicksPerBeat(1500, 3)).toBe(3)
    expect(clicksPerBeat(3000, 3)).toBe(3)
    expect(clicksPerBeat(3001, 3)).toBe(6)
  })

  it('leaves a beat of no length whole rather than split it forever', () => {
    expect(clicksPerBeat(beat(0))).toBe(1)
    expect(clicksPerBeat(NaN)).toBe(1)
  })
})

describe('barPulse', () => {
  it('beats simple time in quarters, 2/2 included', () => {
    expect(barPulse(meter('4/4'), whole(120))).toEqual({ beat: 1 / 4, perBeat: 1 })
    expect(barPulse(meter('2/2'), whole(120))).toEqual({ beat: 1 / 4, perBeat: 1 })
    expect(barPulse(meter('3/4'), whole(40))).toEqual({ beat: 1 / 4, perBeat: 2 })
  })

  it('beats compound time in dotted quarters, split in their eighths when slow', () => {
    expect(barPulse(meter('6/8'), whole(120))).toEqual({ beat: 3 / 8, perBeat: 1 })
    expect(barPulse(meter('6/8'), whole(60))).toEqual({ beat: 3 / 8, perBeat: 3 })
    expect(barPulse(meter('12/8'), whole(60))).toEqual({ beat: 3 / 8, perBeat: 3 })
    // ♩ = 20: a dotted quarter of 4.5s, its eighths of 1.5s.
    expect(barPulse(meter('9/8'), whole(20))).toEqual({ beat: 3 / 8, perBeat: 6 })
  })

  it('beats 3/8 once a bar while the bar takes at most a second, in eighths past that', () => {
    expect(barPulse(meter('3/8'), whole(90))).toEqual({ beat: 3 / 8, perBeat: 1 })
    expect(barPulse(meter('3/8'), whole(89))).toEqual({ beat: 1 / 8, perBeat: 1 })
    expect(barPulse(meter('3/8'), whole(29))).toEqual({ beat: 1 / 8, perBeat: 2 })
  })

  it('counts a bar that names no time signature in 4/4', () => {
    expect(barPulse(undefined, whole(120))).toEqual({ beat: 1 / 4, perBeat: 1 })
  })
})

describe('clickTrack', () => {
  describe('4/4', () => {
    it('counts a bar in, then accents every downbeat', () => {
      const track = clickTrack(bars('4/4', [1, 1]), 120)
      expect(track.countInMs).toBe(2000)
      expect(track.countInBeats).toBe(4)
      expect(heard(track)).toEqual([
        '0 accent ·', '500 beat ·', '1000 beat ·', '1500 beat ·',
        '2000 accent', '2500 beat', '3000 beat', '3500 beat',
        '4000 accent', '4500 beat', '5000 beat', '5500 beat',
      ])
    })

    it('counts a bar, then on into the bar a quarter pickup ends: in on 4', () => {
      const track = clickTrack(bars('4/4', [1 / 4, 1]), 120)
      expect(track.countInMs).toBe(3500)
      expect(track.countInBeats).toBe(4)
      expect(heard(track)).toEqual([
        '0 accent ·', '500 beat ·', '1000 beat ·', '1500 beat ·',
        '2000 accent ·', '2500 beat ·', '3000 beat ·',
        '3500 beat',
        '4000 accent', '4500 beat', '5000 beat', '5500 beat',
      ])
    })

    // A drill's fragment on the fourth beat: four beats counted, and in.
    it('counts a bar, then goes straight into a run starting partway into its bar', () => {
      const track = clickTrack(bars('4/4', [1, 1]), 120, 3 / 4)
      expect(track.countInMs).toBe(2000)
      expect(heard(track)).toEqual([
        '0 accent ·', '500 beat ·', '1000 beat ·', '1500 beat ·',
        '2000 beat',
        '2500 accent', '3000 beat', '3500 beat', '4000 beat',
      ])
    })

    it('keeps the click on the beat under a pickup that is not a whole beat', () => {
      const track = clickTrack(bars('4/4', [1 / 8, 1]), 120)
      // The eighth comes in between the fourth beat and the downbeat.
      expect(track.countInMs).toBe(3750)
      expect(heard(track).slice(4)).toEqual([
        '2000 accent ·', '2500 beat ·', '3000 beat ·', '3500 beat ·',
        '4000 accent', '4500 beat', '5000 beat', '5500 beat',
      ])
    })
  })

  describe('3/8', () => {
    it('clicks once a bar at a brisk tempo', () => {
      const track = clickTrack(bars('3/8', [3 / 8, 3 / 8]), 120)
      expect(track.countInBeats).toBe(1)
      expect(heard(track)).toEqual(['0 accent ·', '750 accent', '1500 accent'])
    })

    it('counts its three eighths once the bar is over a second', () => {
      const track = clickTrack(bars('3/8', [3 / 8, 3 / 8]), 60)
      expect(track.countInBeats).toBe(3)
      expect(heard(track)).toEqual([
        '0 accent ·', '500 beat ·', '1000 beat ·',
        '1500 accent', '2000 beat', '2500 beat',
        '3000 accent', '3500 beat', '4000 beat',
      ])
    })

    // Für Elise: two sixteenths before the first bar line.
    it('brings the pickup in on the third eighth, and the bar lines on the accent', () => {
      const track = clickTrack(bars('3/8', [1 / 8, 3 / 8]), 60)
      expect(track.countInMs).toBe(2500)
      expect(heard(track)).toEqual([
        '0 accent ·', '500 beat ·', '1000 beat ·',
        '1500 accent ·', '2000 beat ·',
        '2500 beat',
        '3000 accent', '3500 beat', '4000 beat',
      ])
    })

    it('leaves a pickup between the clicks when the bar is clicked once', () => {
      const track = clickTrack(bars('3/8', [1 / 8, 3 / 8, 3 / 8]), 120)
      expect(track.countInMs).toBe(1250)
      expect(heard(track)).toEqual(['0 accent ·', '750 accent ·', '1500 accent', '2250 accent'])
    })
  })

  describe('6/8', () => {
    it('clicks on 1 and 4, and counts two beats in', () => {
      const track = clickTrack(bars('6/8', [3 / 4, 3 / 4]), 120)
      expect(track.countInBeats).toBe(2)
      expect(heard(track)).toEqual([
        '0 accent ·', '750 beat ·',
        '1500 accent', '2250 beat',
        '3000 accent', '3750 beat',
      ])
    })

    it('splits each beat in its three eighths when slow', () => {
      const track = clickTrack(bars('6/8', [3 / 4]), 60)
      expect(track.countInBeats).toBe(2)
      expect(heard(track).slice(6)).toEqual([
        '3000 accent', '3500 subdivision', '4000 subdivision',
        '4500 beat', '5000 subdivision', '5500 subdivision',
      ])
    })

    it('counts on into the bar an eighth pickup ends, the pickup between the clicks', () => {
      const track = clickTrack(bars('6/8', [1 / 8, 3 / 4]), 120)
      expect(track.countInMs).toBe(2750)
      expect(heard(track)).toEqual([
        '0 accent ·', '750 beat ·',
        '1500 accent ·', '2250 beat ·',
        '3000 accent', '3750 beat',
      ])
    })
  })

  it('counts a run in on the time signature of its first bar', () => {
    const run = [...bars('6/8', [3 / 4], { later: true }), ...bars('2/4', [1 / 2], { later: true })]
    const track = clickTrack(run, 120)
    expect(track.countInBeats).toBe(2)
    expect(heard(track)).toEqual([
      '0 accent ·', '750 beat ·',
      '1500 accent', '2250 beat',
      '3000 accent', '3500 beat',
    ])
  })

  it('starts a shorter bar on its downbeat, the score’s first excepted', () => {
    const run = bars('6/8', [3 / 4, 1 / 2, 3 / 4], { later: true })
    expect(heard(clickTrack(run, 120)).slice(2)).toEqual([
      '1500 accent', '2250 beat',
      '3000 accent', '3750 beat',
      '4000 accent', '4750 beat',
    ])
  })

  // The Turkish March, on its way into the second section: bar 8 ends the
  // first on its downbeat, bar 9 is the pickup to the second.
  const turkishMarch = () => bars('2/4', [1 / 4, 1 / 4, 1 / 2], { later: true })

  it('carries a short bar on from the short one before it', () => {
    expect(heard(clickTrack(turkishMarch(), 120)).slice(2)).toEqual([
      '1000 accent',
      '1500 beat',
      '2000 accent', '2500 beat',
    ])
  })

  it('counts a run opening on such a bar into it as into a pickup', () => {
    const track = clickTrack(turkishMarch().slice(1), 120)
    expect(track.countInMs).toBe(1500)
    expect(heard(track)).toEqual([
      '0 accent ·', '500 beat ·',
      '1000 accent ·',
      '1500 beat',
      '2000 accent', '2500 beat',
    ])
  })

  // Für Elise's first ending is a full bar, and the repeat goes back to the
  // pickup: it comes in on the third eighth again.
  it('brings the score’s pickup in on its beat wherever it is played', () => {
    const [pickup, bar] = bars('3/8', [1 / 8, 3 / 8])
    expect(heard(clickTrack([bar, pickup, bar], 60)).slice(3)).toEqual([
      '1500 accent', '2000 beat', '2500 beat',
      '3000 beat',
      '3500 accent', '4000 beat', '4500 beat',
    ])
  })

  // The Nocturne op. 9 no. 2: bar 32 runs on into the eighth that leads back
  // to the theme, written as its second half.
  it('counts a bar that runs past its time signature on to the next bar line', () => {
    const run = bars('12/8', [13 / 8, 3 / 2], { later: true })
    expect(heard(clickTrack(run, 120)).slice(4)).toEqual([
      '3000 accent', '3750 beat', '4500 beat', '5250 beat',
      '6000 beat',
      '6250 accent', '7000 beat', '7750 beat', '8500 beat',
    ])
  })

  it('never leaves more than a second between two clicks', () => {
    for (const signature of ['2/4', '3/4', '4/4', '2/2', '6/4', '3/8', '6/8', '9/8', '12/8']) {
      const full = barLength(meter(signature))
      // Bars of every shape: a pickup, the bar a section ends on part of, and
      // one running on into the next bar's pickup.
      for (const first of [1 / 16, 1 / 8, 1 / 4, full / 2, full + 1 / 8]) {
        const run = bars(signature, [first, full, full / 2, full])
        for (let bpm = 20; bpm <= 240; bpm++) {
          const times = clickTrack(run, bpm).clicks.map((click) => click.atMs)
          const gaps = times.slice(1).map((t, i) => t - times[i])
          expect(Math.max(...gaps), `${signature} from a bar of ${first} at ♩ = ${bpm}`).toBeLessThanOrEqual(1000 + 1e-6)
        }
      }
    }
  })
})
