// Whether the app makes the sound itself instead of leaving it to the
// instrument — the player's own notes as well as ▶ Écouter.
//
// Normally the app stays out of the way: the piano sounds the keys under the
// player's fingers, and playback is sent to it over MIDI, so everything comes
// out of the same instrument. That falls apart for the metronome, which has no
// instrument to come out of and plays through the device showing the score. A
// player wearing headphones plugged into the piano then hears everything except
// the click they were counting on.
//
// Turning this on moves the other half to the device instead: notes played are
// echoed through the app's sampler and playback stops being sent over MIDI, so
// the piece, the playing and the click all arrive in the same headphones, in
// phase. It only works with the instrument's Local Control switched off —
// otherwise the piano sounds its own keys too and every note is heard twice.
//
// The key is read at each call rather than cached: unlike a run's metronome,
// there is no moment during which changing it would be disorienting, and the
// menu can be opened at any time.
import { KEY_PREFIX } from './legacyKeys.js'

const SETTING_KEY = `${KEY_PREFIX}app-sound`

export function appSoundEnabled() {
  try {
    return localStorage.getItem(SETTING_KEY) === 'true'
  } catch {
    return false
  }
}

export function setAppSoundEnabled(enabled) {
  try {
    localStorage.setItem(SETTING_KEY, String(enabled))
  } catch {
    /* localStorage unavailable */
  }
}
