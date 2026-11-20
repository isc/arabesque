// The strict-mode metronome: how often it clicks, and what a click sounds like
// — a short WebAudio blip, played wherever the page plays — the phone or tablet
// showing the score.
//
// It lives here rather than in strictPlaythrough.js, which is a note-matching
// engine and has no business owning an AudioContext: the engine decides where
// the beats fall, this decides how they are split and what they sound like.
//
// It was briefly sent to the player's instrument instead, as a General MIDI
// percussion note on channel 10, so it would reach headphones plugged into the
// piano. Removed: Kawai digital pianos — and they are not alone — document that
// channel 10 is never played, and carry no drum kit at all, their percussion
// being melodic GM2 programs. Nothing in Web MIDI can tell you that in advance,
// so the feature could only ever have been a switch the player tried by ear.
// See the AURES notes on feedback 15ae51f5 if it is ever revisited. Moving the
// other half the other way — the app sounding the player's own keys too, so
// that everything arrives in the same headphones — was tried and withdrawn as
// well; playback.js says why.
let audioContext = null

// A pulse is not held across more than a second of silence: the player's own
// count drifts in the gap, and the click that comes back finds them early or
// late without saying which. Feedback 0dee8c99 met it on the C minor prelude at
// ♩ = 30 — two seconds between clicks, eight sixteenths in each. So a slow beat
// is split, as a teacher counts "1 and 2 and": in eighths below ♩ = 60, in
// sixteenths below ♩ = 30. Deduced from the tempo rather than chosen, since the
// gap is what decides whether a click helps.
const MAX_CLICK_GAP_MS = 1000

// For a beat `beatMs` long. A beat that is no length at all (a tempo of 0) is
// left whole rather than halved forever.
export function clicksPerBeat(beatMs) {
  if (!Number.isFinite(beatMs)) return 1
  let perBeat = 1
  while (beatMs / perBeat > MAX_CLICK_GAP_MS) perBeat *= 2
  return perBeat
}

// Every click from the first beat (0) to `lastBeat`, dated from the first: the
// beats, and between them the subdivisions their length asks for. `beat` is the
// beat each falls in, `kind` the CLICK_SOUNDS it is played with.
export function metronomeTicks({ beatMs, lastBeat }) {
  const perBeat = clicksPerBeat(beatMs)
  return Array.from({ length: lastBeat * perBeat + 1 }, (_, tick) => {
    const beat = Math.floor(tick / perBeat)
    const kind = tick % perBeat ? 'subdivision' : beat === 0 ? 'accent' : 'beat'
    return { atMs: (tick * beatMs) / perBeat, beat, kind }
  })
}

// Pitched where the ear is keenest and a piano has least to cover it with, and
// played near full scale: the click these replaced, a 1 kHz tone at a third of
// that, went unheard over an acoustic piano with the tablet at full volume
// (feedback 0dee8c99). A subdivision is the beat's click, quieter, so that the
// beat still stands out of the count.
const CLICK_SOUNDS = {
  accent: { frequency: 3200, peak: 0.9 },
  beat: { frequency: 2400, peak: 0.9 },
  subdivision: { frequency: 2400, peak: 0.35 },
}

// Call on the gesture that starts a run: an AudioContext created outside a user
// gesture starts suspended and stays silent.
export function prepareClick() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (audioContext.state === 'suspended') audioContext.resume()
}

// `kind` is one of CLICK_SOUNDS: the accented first beat, a beat, or a
// subdivision.
export function playClick(kind) {
  if (!audioContext) return
  const { frequency, peak } = CLICK_SOUNDS[kind]
  const t0 = audioContext.currentTime
  const osc = audioContext.createOscillator()
  const gain = audioContext.createGain()
  osc.frequency.value = frequency
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(peak, t0 + 0.002)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.06)
  osc.connect(gain).connect(audioContext.destination)
  osc.start(t0)
  osc.stop(t0 + 0.07)
}
