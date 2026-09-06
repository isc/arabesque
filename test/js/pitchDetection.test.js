import { describe, it, expect } from 'vitest'
import { detectPitch, freqToMidi, computeRms, createNoteTracker } from '../../public/js/pitchDetection.js'

const SAMPLE_RATE = 44100
const BUFFER_SIZE = 4096

function sine(frequency, { amplitude = 0.5, length = BUFFER_SIZE } = {}) {
  const buffer = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    buffer[i] = amplitude * Math.sin((2 * Math.PI * frequency * i) / SAMPLE_RATE)
  }
  return buffer
}

// Harmonic-rich tone, closer to a real piano: strong upper partials are the
// classic trap for autocorrelation (octave errors).
function pianoLike(frequency, { length = BUFFER_SIZE } = {}) {
  const partials = [1, 0.6, 0.4, 0.25, 0.15, 0.08]
  const buffer = new Float32Array(length)
  for (let i = 0; i < length; i++) {
    let sample = 0
    partials.forEach((amp, k) => {
      sample += amp * Math.sin((2 * Math.PI * frequency * (k + 1) * i) / SAMPLE_RATE)
    })
    buffer[i] = sample * 0.3
  }
  return buffer
}

// Deterministic pseudo-random noise (LCG) so the test can't flake.
function noise({ amplitude = 0.3, length = BUFFER_SIZE } = {}) {
  const buffer = new Float32Array(length)
  let seed = 42
  for (let i = 0; i < length; i++) {
    seed = (seed * 1103515245 + 12345) % 2147483648
    buffer[i] = amplitude * ((seed / 1073741824) - 1)
  }
  return buffer
}

describe('detectPitch', () => {
  it('detects a pure sine at A4', () => {
    const detected = detectPitch(sine(440), SAMPLE_RATE)
    expect(Math.abs(detected - 440)).toBeLessThan(2)
  })

  it('detects the fundamental of a harmonic-rich tone (no octave error)', () => {
    const detected = detectPitch(pianoLike(220), SAMPLE_RATE)
    expect(Math.abs(detected - 220)).toBeLessThan(2)
  })

  it('detects a low note (A1, 55 Hz)', () => {
    const detected = detectPitch(pianoLike(55), SAMPLE_RATE)
    expect(Math.abs(detected - 55)).toBeLessThan(1)
  })

  it('detects a high note (B6, ~1976 Hz)', () => {
    const detected = detectPitch(sine(1975.5), SAMPLE_RATE)
    expect(Math.abs(detected - 1975.5)).toBeLessThan(10)
  })

  it('resolves adjacent semitones in the low register (A1 vs A#1)', () => {
    const a1 = detectPitch(pianoLike(55), SAMPLE_RATE)
    const aSharp1 = detectPitch(pianoLike(58.27), SAMPLE_RATE)
    expect(freqToMidi(a1)).toBe(33)
    expect(freqToMidi(aSharp1)).toBe(34)
  })

  it('returns null on silence', () => {
    expect(detectPitch(new Float32Array(BUFFER_SIZE), SAMPLE_RATE)).toBeNull()
  })

  it('returns null on noise', () => {
    expect(detectPitch(noise(), SAMPLE_RATE)).toBeNull()
  })

  it('ignores pitches above the piano detection range', () => {
    // ~C8 (4186 Hz) is above maxFreq — must not be reported (and must never
    // trigger the app's C8 navigate-back key).
    expect(detectPitch(sine(4186), SAMPLE_RATE)).toBeNull()
  })
})

describe('freqToMidi', () => {
  it('maps reference frequencies to MIDI numbers', () => {
    expect(freqToMidi(440)).toBe(69) // A4
    expect(freqToMidi(261.63)).toBe(60) // C4
    expect(freqToMidi(27.5)).toBe(21) // A0
  })

  it('rounds to the nearest semitone', () => {
    expect(freqToMidi(445)).toBe(69) // slightly sharp A4
    expect(freqToMidi(430)).toBe(69) // slightly flat A4
  })
})

describe('computeRms', () => {
  it('is 0 for silence and ~amplitude/√2 for a sine', () => {
    expect(computeRms(new Float32Array(BUFFER_SIZE))).toBe(0)
    expect(computeRms(sine(440, { amplitude: 0.5 }))).toBeCloseTo(0.5 / Math.SQRT2, 2)
  })
})

describe('createNoteTracker', () => {
  function trackerWithLog(options = {}) {
    const events = []
    const tracker = createNoteTracker({
      onNoteOn: (midi) => events.push(['on', midi]),
      onNoteOff: (midi) => events.push(['off', midi]),
      ...options,
    })
    return { tracker, events }
  }

  const LOUD = 0.1

  it('fires note-on only after minOnFrames consistent frames', () => {
    const { tracker, events } = trackerWithLog({ minOnFrames: 2 })
    tracker.push({ midi: 60, rms: LOUD })
    expect(events).toEqual([])
    tracker.push({ midi: 60, rms: LOUD })
    expect(events).toEqual([['on', 60]])
  })

  it('ignores a single-frame glitch', () => {
    const { tracker, events } = trackerWithLog({ minOnFrames: 2 })
    tracker.push({ midi: 60, rms: LOUD })
    tracker.push({ midi: null, rms: 0 })
    tracker.push({ midi: 72, rms: LOUD })
    tracker.push({ midi: null, rms: 0 })
    expect(events).toEqual([])
  })

  it('releases the note after offFrames of silence', () => {
    const { tracker, events } = trackerWithLog({ minOnFrames: 2, offFrames: 3 })
    tracker.push({ midi: 60, rms: LOUD })
    tracker.push({ midi: 60, rms: LOUD })
    tracker.push({ midi: null, rms: 0 })
    tracker.push({ midi: null, rms: 0 })
    expect(events).toEqual([['on', 60]])
    tracker.push({ midi: null, rms: 0 })
    expect(events).toEqual([['on', 60], ['off', 60]])
  })

  it('switching notes releases the previous one first', () => {
    const { tracker, events } = trackerWithLog({ minOnFrames: 2 })
    tracker.push({ midi: 60, rms: LOUD })
    tracker.push({ midi: 60, rms: LOUD })
    tracker.push({ midi: 62, rms: LOUD })
    tracker.push({ midi: 62, rms: LOUD })
    expect(events).toEqual([['on', 60], ['off', 60], ['on', 62]])
  })

  it('treats frames below minRms as silence even when a pitch is reported', () => {
    const { tracker, events } = trackerWithLog({ minOnFrames: 2, minRms: 0.01 })
    tracker.push({ midi: 60, rms: 0.001 })
    tracker.push({ midi: 60, rms: 0.001 })
    expect(events).toEqual([])
  })

  it('flush releases the active note', () => {
    const { tracker, events } = trackerWithLog({ minOnFrames: 2 })
    tracker.push({ midi: 60, rms: LOUD })
    tracker.push({ midi: 60, rms: LOUD })
    tracker.flush()
    expect(events).toEqual([['on', 60], ['off', 60]])
    tracker.flush()
    expect(events).toHaveLength(2)
  })
})
