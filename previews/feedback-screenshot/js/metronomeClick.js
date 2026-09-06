// The strict-mode metronome click: a short WebAudio blip, played wherever the
// page plays — the phone or tablet showing the score.
//
// It lives here rather than in strictPlaythrough.js, which is a note-matching
// engine and has no business owning an AudioContext: the engine decides when
// the beats fall, this decides what they sound like.
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

// Call on the gesture that starts a run: an AudioContext created outside a user
// gesture starts suspended and stays silent.
export function prepareClick() {
  if (!audioContext) {
    audioContext = new (window.AudioContext || window.webkitAudioContext)()
  }
  if (audioContext.state === 'suspended') audioContext.resume()
}

export function playClick({ accent = false } = {}) {
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
