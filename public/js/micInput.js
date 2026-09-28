// Mic mode (non-MIDI input) — prototype.
//
// Listens to the microphone, detects the played pitch (pitchDetection.js)
// and emits synthetic MIDI Note On/Off messages through the provided
// callback — the path a keyboard's own messages take — so validation,
// training and strict mode all work unchanged.

import { detectPitch, freqToMidi, computeRms, createNoteTracker, MIN_RMS } from './pitchDetection.js'
import { NOTE_ON, NOTE_OFF } from './midi.js'
import { lastClick } from './metronomeClick.js'
import { recordError } from './errorLog.js'
import { t } from './i18n.js'

// 4096 samples ≈ 93 ms at 44.1 kHz — long enough to resolve the lowest
// piano strings, short enough to keep note-on latency playable.
const FFT_SIZE = 4096
const FRAME_MS = 40

// How long after a metronome click its pitch is taken for the click rather
// than the piano: the click itself (60 ms), the analysis window it lingers in,
// and the trip from speaker to microphone.
const CLICK_ECHO_MS = 250

// Nothing downstream reads velocity; a Note On only needs it above zero.
const VELOCITY = 64

let audioContext = null
let mediaStream = null
let frameTimer = null
let tracker = null

// Resolves to whether the microphone is now listening.
//
// onEnded: the microphone went away on its own (unplugged, permission
// revoked, taken by a phone call), so the page can stop saying it listens.
// isPageSounding: the page's own sound is coming out of the speakers — the
// sampler playing the score — and whatever the microphone hears is that.
export async function start({ onMessage, onEnded, isPageSounding }) {
  if (mediaStream) return true

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
    // A refusal is the player's answer; anything else (no microphone, one
    // held by another app) is worth hearing about.
    if (e.name === 'NotAllowedError') console.warn('Microphone access refused')
    else recordError(e, 'micInput.start')
    alert(t('errors.micDenied'))
    return false
  }

  audioContext = new AudioContext()
  // Created after an await, so possibly outside the gesture's reach: Safari
  // then starts it suspended, and a suspended graph analyses silence.
  audioContext.resume()
  const analyser = audioContext.createAnalyser()
  analyser.fftSize = FFT_SIZE
  audioContext.createMediaStreamSource(mediaStream).connect(analyser)
  mediaStream.getAudioTracks()[0].onended = () => {
    stop()
    onEnded()
  }

  tracker = createNoteTracker({
    onNoteOn: (midiNote) => onMessage([NOTE_ON, midiNote, VELOCITY]),
    onNoteOff: (midiNote) => onMessage([NOTE_OFF, midiNote, 0]),
  })

  const samples = new Float32Array(FFT_SIZE)
  frameTimer = setInterval(() => {
    // Skipped rather than reported as silence, which would release a note
    // the player is holding.
    if (isPageSounding()) return
    analyser.getFloatTimeDomainData(samples)
    const rms = computeRms(samples)
    // Most frames are silence between notes: no pitch to look for there.
    const frequency = rms < MIN_RMS ? null : detectPitch(samples, audioContext.sampleRate)
    const midi = frequency === null ? null : freqToMidi(frequency)
    if (isClickEcho(midi)) return
    tracker.push({ midi, rms })
  }, FRAME_MS)

  console.log('Microphone listening (mic mode)')
  return true
}

export function stop() {
  if (!mediaStream) return
  clearInterval(frameTimer)
  frameTimer = null
  tracker.flush() // release any held note so validation doesn't hang
  tracker = null
  mediaStream.getTracks().forEach((track) => track.stop())
  mediaStream = null
  audioContext.close()
  audioContext = null
  console.log('Microphone stopped')
}

function isClickEcho(midi) {
  return performance.now() - lastClick.at < CLICK_ECHO_MS && midi === freqToMidi(lastClick.frequency)
}
