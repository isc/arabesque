// Pitch detection for the mic mode (non-MIDI input) — prototype.
//
// No Web Audio dependency, so everything here is unit-testable in node.
// micInput.js owns the browser glue (getUserMedia, AnalyserNode) and feeds
// audio frames into these functions.
//
// Monophonic only: MPM finds a single fundamental per frame. Polyphony
// (chords, two hands) needs a different approach entirely (e.g. an Onsets
// and Frames-style transcription model) — see ROADMAP.

import { PitchDetector } from '../vendor/pitchy.4.1.0.bundle.min.js'

// One detector per buffer size (it preallocates FFT scratch space).
const detectors = new Map()

// Wraps pitchy's McLeod Pitch Method detector. Returns the detected
// fundamental in Hz, or null when the detection isn't confident enough or
// falls outside the accepted range — for note validation, a miss is much
// cheaper than a false positive.
//
// maxFreq stops at ~C7: mic detection of the top piano octave is unreliable,
// and staying below C8 keeps a stray high detection from ever hitting the
// app's C8 navigate-back key.
export function detectPitch(buffer, sampleRate, { minFreq = 27.5, maxFreq = 2200, minClarity = 0.9 } = {}) {
  let detector = detectors.get(buffer.length)
  if (!detector) {
    detector = PitchDetector.forFloat32Array(buffer.length)
    detectors.set(buffer.length, detector)
  }
  const [frequency, clarity] = detector.findPitch(buffer, sampleRate)
  if (clarity < minClarity || frequency < minFreq || frequency > maxFreq) return null
  return frequency
}

export function freqToMidi(frequency) {
  return Math.round(69 + 12 * Math.log2(frequency / 440))
}

export function computeRms(buffer) {
  let sum = 0
  for (let i = 0; i < buffer.length; i++) sum += buffer[i] * buffer[i]
  return Math.sqrt(sum / buffer.length)
}

// Below this loudness a frame is silence, whatever pitch it seems to carry.
export const MIN_RMS = 0.01

// Turns a per-frame stream of { midi, rms } observations into debounced
// Note On / Note Off events. A note fires after minOnFrames consecutive
// frames of the same pitch (kills single-frame glitches) and releases after
// offFrames frames where that pitch is no longer heard (decay, damper, or
// another note taking over). Monophonic: confirming a new note releases the
// previous one.
//
// The same key struck again never changes the pitch — the new note takes over
// from the old one's decay without a gap — so it is told apart by loudness
// instead: a frame reattackRatio times louder than every one of the last
// reattackFrames is a fresh strike. Comparing against several frames, not
// just the previous one, keeps the slow swell of beating strings from reading
// as a strike; it also means a key repeated faster than that span is heard
// once.
export function createNoteTracker({
  onNoteOn,
  onNoteOff,
  minOnFrames = 2,
  offFrames = 3,
  minRms = MIN_RMS,
  reattackFrames = 3,
  reattackRatio = 2,
} = {}) {
  let activeNote = null
  let candidate = null
  let candidateCount = 0
  let missCount = 0
  let recentRms = [] // the held note's loudness over its last few frames

  function release() {
    if (activeNote !== null) onNoteOff(activeNote)
    activeNote = null
    missCount = 0
  }

  function noteOn(note) {
    release()
    activeNote = note
    candidate = null
    candidateCount = 0
    recentRms = []
    onNoteOn(note)
  }

  function push({ midi, rms }) {
    const heard = rms >= minRms && midi != null ? midi : null

    if (heard !== null && heard === activeNote) {
      if (recentRms.length === reattackFrames && rms >= Math.min(...recentRms) * reattackRatio) {
        noteOn(heard)
        return
      }
      missCount = 0
      candidate = null
      candidateCount = 0
      recentRms.push(rms)
      if (recentRms.length > reattackFrames) recentRms.shift()
      return
    }

    if (heard === null) {
      candidate = null
      candidateCount = 0
    } else if (heard === candidate) {
      candidateCount++
    } else {
      candidate = heard
      candidateCount = 1
    }

    if (candidate !== null && candidateCount >= minOnFrames) {
      noteOn(candidate)
      return
    }

    if (activeNote !== null && ++missCount >= offFrames) release()
  }

  // Release whatever is held — called when the mic is switched off.
  return { push, flush: release }
}
