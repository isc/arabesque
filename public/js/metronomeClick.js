// The strict-mode metronome click, and where it comes out.
//
// By default it is a short WebAudio blip, so it plays wherever the page plays:
// the phone or tablet showing the score. A player with headphones plugged into
// the piano hears their own playing and not the click, which is the one thing
// the click is there for.
//
// So it can be sent to the instrument instead, as a General MIDI percussion
// note on channel 10 — the wood block every GM device answers with. Whether a
// given instrument answers on channel 10 at all is not something Web MIDI can
// be asked: it only ever exposes a port's name. So this is a setting the player
// turns on and judges by ear, off by default, falling back to the blip whenever
// no MIDI output is connected.
import { KEY_PREFIX } from './legacyKeys.js'

const SETTING_KEY = `${KEY_PREFIX}metronome-midi`

// Channel 10 (1-based), the General MIDI percussion channel.
const NOTE_ON_CH10 = 0x99
const NOTE_OFF_CH10 = 0x89
// 76 and 77 are the high and low wood blocks; the accent gets the higher one,
// the way a metronome marks the first beat of the bar.
const ACCENT_NOTE = 76
const BEAT_NOTE = 77
const ACCENT_VELOCITY = 100
const BEAT_VELOCITY = 80
// GM percussion voices are one-shot and the spec says their note-off is
// ignored, but an instrument mapping channel 10 to a pitched part would be left
// ringing. Sent with send()'s timestamp rather than through a timer of our own,
// so a run stopped between the two still releases. The iOS wrapper's Web MIDI
// shim drops that second argument and releases immediately instead, which
// changes nothing for a one-shot voice.
const RELEASE_MS = 50

let midiState = null
let audioContext = null
// Where the clicks of the run under way go. Read once when the run starts, so
// that flipping the switch cannot move the click out from under a player
// mid-piece.
let sendToMidi = false

export function initMetronomeClick(externalMidiState = null) {
  midiState = externalMidiState
}

export function midiClickEnabled() {
  try {
    return localStorage.getItem(SETTING_KEY) === 'true'
  } catch {
    return false
  }
}

export function setMidiClickEnabled(enabled) {
  try {
    localStorage.setItem(SETTING_KEY, String(enabled))
  } catch {
    /* localStorage unavailable */
  }
}

// Call on the gesture that starts a run: an AudioContext created outside a user
// gesture starts suspended and stays silent. The context is prepared even when
// the click is going to the piano, so unplugging it mid-run falls back to the
// blip instead of going quiet.
export function prepareClick() {
  sendToMidi = midiClickEnabled()
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (audioContext.state === 'suspended') audioContext.resume()
}

export function playClick({ accent = false } = {}) {
  if (sendToMidi && midiState?.midiOutput) {
    const note = accent ? ACCENT_NOTE : BEAT_NOTE
    const velocity = accent ? ACCENT_VELOCITY : BEAT_VELOCITY
    midiState.midiOutput.send([NOTE_ON_CH10, note, velocity])
    midiState.midiOutput.send([NOTE_OFF_CH10, note, 0], performance.now() + RELEASE_MS)
    return
  }
  blip(accent)
}

function blip(accent) {
  if (!audioContext) return
  const t0 = audioContext.currentTime
  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()
  osc.frequency.value = accent ? 1500 : 1000
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(0.3, t0 + 0.005)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.05)
  osc.connect(gain).connect(audioContext.destination)
  osc.start(t0)
  osc.stop(t0 + 0.06)
}
