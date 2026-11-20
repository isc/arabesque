// The strict-mode metronome: how often it clicks, and what a click sounds like
// — a short WebAudio blip, played wherever the page plays — the phone or tablet
// showing the score.
//
// It lives here rather than in strictPlaythrough.js, which is a note-matching
// engine and has no business owning an AudioContext: the engine hands over the
// bars of the run, this decides where they are clicked and how it sounds.
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
import { barLength } from './noteExtraction.js?v=57e5543f5bf1'
import { POSITION_EPSILON } from './noteLogAnalysis.js?v=57e5543f5bf1'
import { tsToSeconds } from './playbackTiming.js?v=57e5543f5bf1'

let audioContext = null

// A pulse is not held across more than a second of silence: the player's own
// count drifts in the gap, and the click that comes back finds them early or
// late without saying which. Feedback 0dee8c99 met it on the C minor prelude at
// ♩ = 30 — two seconds between clicks, eight sixteenths in each. So a slow beat
// is split, as a teacher counts "1 and 2 and": in eighths below ♩ = 60, in
// sixteenths below ♩ = 30. Deduced from the tempo rather than chosen, since the
// gap is what decides whether a click helps.
const MAX_CLICK_GAP_MS = 1000

// For a beat `beatMs` long, split first in `firstSplit` — the three eighths of
// a dotted beat, the two halves of any other — then in halves again. A beat
// that is no length at all (a tempo of 0) is left whole rather than split
// forever.
export function clicksPerBeat(beatMs, firstSplit = 2) {
  if (!Number.isFinite(beatMs) || beatMs <= MAX_CLICK_GAP_MS) return 1
  let perBeat = firstSplit
  while (beatMs / perBeat > MAX_CLICK_GAP_MS) perBeat *= 2
  return perBeat
}

// How a bar is counted at `wholeMs` a whole note: its beat, in whole notes, and
// the clicks each beat is split into.
//
// The tempo is in quarter notes everywhere — the field, the journal, the
// trainer — but the beat is the bar's own. 6/8, 9/8 and 12/8 beat in dotted
// quarters, split in their three eighths: clicked in quarters, a 6/8 bar sounded
// its eighths 1, 3 and 5 instead of 1 and 4. Two metres are counted otherwise
// than beatLength (noteExtraction.js) cuts them: 3/8, a bar of one dotted beat,
// is counted in one while the bar takes at most the gap, and in its eighths
// past that; a half note is counted in quarters, as 2/2 always was here.
export function barPulse(timeSignature, wholeMs) {
  const { numerator = 4, denominator = 4 } = timeSignature ?? {}
  const dottedBeat = 3 / denominator
  const compound = numerator % 3 === 0 && denominator >= 8
  if (compound && (numerator > 3 || dottedBeat * wholeMs <= MAX_CLICK_GAP_MS)) {
    return { beat: dottedBeat, perBeat: clicksPerBeat(dottedBeat * wholeMs, 3) }
  }
  const beat = 1 / Math.max(denominator, 4)
  return { beat, perBeat: clicksPerBeat(beat * wholeMs) }
}

// The clicks over `bars` played back to back from 0, at `wholeMs` a whole note:
// when each falls, the bar it falls in, which beat of it, and its kind, the
// CLICK_SOUNDS it is played with — the accent on each downbeat, a beat on each
// other beat, and between them the subdivisions the tempo asks for.
//
// Every bar is counted from its own place in its bar (`barOffset`, barOffsets
// in noteExtraction.js), so nothing before it can put the click off its beats:
// a quarter-note grid run from the start of the music drifted across 3/8 bars,
// and left Für Elise's two-sixteenth pickup between every click and its beat.
function barClicks(bars, wholeMs) {
  const clicks = []
  let barStart = 0
  bars.forEach(({ duration, timeSignature, barOffset = 0 }, index) => {
    const { beat, perBeat } = barPulse(timeSignature, wholeMs)
    const step = beat / perBeat
    const first = Math.ceil(barOffset / step - POSITION_EPSILON)
    for (let k = first; k * step < barOffset + duration - POSITION_EPSILON; k++) {
      clicks.push({
        atMs: (barStart + k * step - barOffset) * wholeMs,
        bar: index,
        beat: Math.floor(k / perBeat),
        kind: k === 0 ? 'accent' : k % perBeat ? 'subdivision' : 'beat',
      })
    }
    barStart += duration
  })
  return clicks
}

// The click of a strict run at ♩ = bpm over `bars`, the note model's bars of
// the run in playing order, with a bar of count-in ahead of them: how long the
// count-in lasts, how many beats it counts to the bar, and every click dated
// from its start, `countIn` for those before the music.
//
// A run opening on a pickup is counted a bar, then on into the bar the pickup
// ends, which comes in on its own beat — "1 2 3 4 | 1 2 3" and in on 4. It used
// to come in straight after the one bar, on what the click had counted as a
// downbeat.
export function clickTrack(bars, bpm) {
  const wholeMs = tsToSeconds(1, bpm) * 1000
  const { timeSignature, barOffset = 0 } = bars[0]
  const full = barLength(timeSignature)
  const countIn = [{ duration: full, timeSignature }]
  if (barOffset > 0) countIn.push({ duration: barOffset, timeSignature })
  return {
    countInMs: (full + barOffset) * wholeMs,
    countInBeats: Math.round(full / barPulse(timeSignature, wholeMs).beat),
    clicks: barClicks([...countIn, ...bars], wholeMs)
      .map(({ bar, ...click }) => ({ ...click, countIn: bar < countIn.length })),
  }
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
