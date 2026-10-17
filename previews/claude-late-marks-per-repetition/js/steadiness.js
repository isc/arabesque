// Whether the notes come on at an even pace, read off the moments the player
// completes each of the score's attacks — what free play and training ask of
// a passage besides the right notes. A run can be clean and still stop dead
// at every bar line: three seconds lost between bars 18 and 19 of Bach's
// second prelude, run after run, with both bars clean, is what this exists to
// see.
//
// An attack is the score's: a chord, or both hands on one beat, is one, made
// when its last key comes down (activateNote in musicxml.js). An interval runs
// from one attack to the next, and is weighed against what the score writes
// between them — a quaver is twice a semiquaver — so that what is compared is
// the pace, in milliseconds per whole note. A hole is an interval that pace
// stretches well past the player's own: HOLE_FACTOR times the median of the
// intervals before it in the traversal, and at least HOLE_MIN_EXCESS_MS over,
// below which a stretched note is unevenness — which this does not judge yet —
// rather than the flow stopping. A traversal is what the engine says it is: a
// repetition in training, a run in free play.
//
// The reference is the player's own pace, never a tempo: a bar drilled slower
// on purpose is not a bar full of holes. It is only trusted once the traversal
// holds LIVE_MIN intervals; until then nothing is judged as it happens, and the
// first ones are judged together once there are enough. A traversal too short
// for that is judged when it ends, from VERDICT_MIN intervals up — a median of
// three is still right with one hole among them, and lets two through rather
// than calling a hole what isn't one. Shorter still, a bar of three attacks,
// there is nothing to compare, and across repetitions the comparison would be
// with the tempo of another one.
//
// Pure: attacks in, verdicts out, so the rule can be tested without a score.
import { median } from './practiceTime.js'

export const HOLE_FACTOR = 1.8
export const HOLE_MIN_EXCESS_MS = 250
export const LIVE_MIN = 8
export const VERDICT_MIN = 3
// The intervals the median is taken over, the last ones of the traversal: a
// run through a whole piece slows and speeds up on its way.
export const WINDOW = 32
// Closer than this in the score, in whole notes, two attacks are one gesture:
// a grace note and its main note, the notes an ornament is spelled out into.
const MIN_WRITTEN = 1 / 128

// What the score writes between two attacks, in whole notes: within a bar, or
// across the line into the bar played next. Null for any other pair — a bar
// skipped by the hands ticked, or one with nothing to play — whose distance
// the note model does not hold.
export function writtenBetween(from, to) {
  if (to.measure === from.measure) return to.position - from.position
  if (to.measure === from.measure + 1) return from.measureDuration - from.position + to.position
  return null
}

// An attack is { at, measure, position, measureDuration, tempo, decorative,
// fermata, ref }: when it was completed (ms), the playback index of its bar,
// where in the bar it is written and how long the bar is (whole notes), the
// tempo the score marks there, whether it decorates another note (a grace
// note, an ornament, a trill) and whether it is held under a fermata. `ref` is
// the caller's, handed back with the verdict on the interval that ends on it.
//
// Every call returns the verdicts it reached, as { ref, ratio, hole, entry }:
// the interval as a multiple of the reference, whether that is a hole, and
// whether it crosses a bar line — the join into the bar `ref` is in.
export function createSteadiness() {
  // The last attack, which the next interval starts from.
  let previous = null
  // The traversal's last WINDOW intervals since its last change of tempo.
  // Short of LIVE_MIN, none of them is judged yet; from there on, all are.
  let intervals = []

  function judge(interval, reference, verdicts) {
    const expected = reference * interval.written
    verdicts.push({
      ref: interval.ref,
      ratio: reference > 0 ? interval.value / reference : null,
      hole: interval.ms > HOLE_FACTOR * expected && interval.ms - expected > HOLE_MIN_EXCESS_MS,
      entry: interval.entry,
    })
  }

  const reference = () => median(intervals.map((i) => i.value))

  // The intervals held so far, all of them unjudged, against their own median.
  function judgeAll(verdicts) {
    const pace = reference()
    for (const interval of intervals) judge(interval, pace, verdicts)
  }

  // The end of a stretch of one pace: one too short ever to have been judged
  // is judged now if it can be, and the count starts over.
  function settle(verdicts) {
    if (intervals.length >= VERDICT_MIN && intervals.length < LIVE_MIN) judgeAll(verdicts)
    intervals = []
  }

  function attack(next) {
    const verdicts = []
    const from = previous
    previous = next
    if (!from) return verdicts
    // A new tempo marked in the score is a new pace to measure against: the
    // Presto of the C minor prelude, or the ritardando MuseScore writes into a
    // bar as a run of tempi.
    if (next.tempo !== from.tempo) {
      settle(verdicts)
      return verdicts
    }
    // Where the score itself lets go of the pace — an ornament's notes, a
    // fermata — there is nothing to hold the player to.
    if (from.decorative || next.decorative || from.fermata) return verdicts
    const written = writtenBetween(from, next)
    if (written == null || written < MIN_WRITTEN) return verdicts

    const ms = next.at - from.at
    const interval = { ms, written, value: ms / written, ref: next.ref, entry: next.measure !== from.measure }
    if (intervals.length >= LIVE_MIN) judge(interval, reference(), verdicts)
    intervals.push(interval)
    if (intervals.length > WINDOW) intervals.shift()
    if (intervals.length === LIVE_MIN) judgeAll(verdicts)
    return verdicts
  }

  return {
    attack,
    // Whether a traversal is under way: false until its first attack.
    get underway() {
      return previous !== null
    },
    // The traversal is over: what it left pending is judged, and the next
    // attack starts a new one.
    close() {
      const verdicts = []
      settle(verdicts)
      previous = null
      return verdicts
    },
    // The traversal was broken off — a bar clicked, a hand toggled, a mode
    // left: nothing is judged, and the next attack starts afresh.
    discard() {
      previous = null
      intervals = []
    },
  }
}
