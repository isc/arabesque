// Mic mode (non-MIDI input) — prototype.
//
// Listens to the microphone, detects the played pitch (pitchDetection.js)
// and emits synthetic MIDI Note On/Off messages through the provided
// callback — the same path cassette replay uses — so validation, training,
// strict mode and recording all work unchanged.

import { detectPitch, freqToMidi, computeRms, createNoteTracker } from './pitchDetection.js'
import { NOTE_ON, NOTE_OFF } from './midi.js'
import { t } from './i18n.js'

// 4096 samples ≈ 93 ms at 44.1 kHz — long enough to resolve the lowest
// piano strings, short enough to keep note-on latency playable.
const FFT_SIZE = 4096
const FRAME_MS = 40

const state = {
  micActive: false,
}

let audioContext = null
let mediaStream = null
let frameTimer = null
let tracker = null

export function initMicInput() {
  return { start, stop, state }
}

async function start(emitMidiMessage) {
  if (state.micActive) return true

  if (!navigator.mediaDevices?.getUserMedia) {
    alert(t('errors.micUnsupported'))
    return false
  }

  try {
    // Voice-call processing (echo cancellation & co) eats piano partials —
    // ask for the raw signal.
    mediaStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false },
    })
  } catch (e) {
    console.error('Accès micro refusé:', e)
    alert(t('errors.micDenied'))
    return false
  }

  audioContext = new AudioContext()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = FFT_SIZE
  audioContext.createMediaStreamSource(mediaStream).connect(analyser)

  tracker = createNoteTracker({
    onNoteOn: (midiNote, rms) => emitMidiMessage([NOTE_ON, midiNote, velocityFromRms(rms)]),
    onNoteOff: (midiNote) => emitMidiMessage([NOTE_OFF, midiNote, 0]),
  })

  const samples = new Float32Array(FFT_SIZE)
  frameTimer = setInterval(() => {
    analyser.getFloatTimeDomainData(samples)
    const frequency = detectPitch(samples, audioContext.sampleRate)
    tracker.push({ midi: frequency === null ? null : freqToMidi(frequency), rms: computeRms(samples) })
  }, FRAME_MS)

  state.micActive = true
  console.log('Micro connecté (mode micro)')
  return true
}

function stop() {
  if (!state.micActive) return
  clearInterval(frameTimer)
  frameTimer = null
  tracker.flush() // release any held note so validation doesn't hang
  tracker = null
  mediaStream.getTracks().forEach((track) => track.stop())
  mediaStream = null
  audioContext.close()
  audioContext = null
  state.micActive = false
  console.log('Micro déconnecté')
}

// The mic gives loudness, not key velocity — a rough monotonic mapping is
// enough (velocity only feeds recordings, validation ignores it).
function velocityFromRms(rms) {
  return Math.max(20, Math.min(110, Math.round(Math.sqrt(rms) * 300)))
}
