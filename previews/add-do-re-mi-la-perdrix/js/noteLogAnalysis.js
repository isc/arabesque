// A session's note log read back (noteLog.js): the attacks it played, the
// holes in their flow and the wrong keys between them — what the score page
// judged while the notes came, judged again after the fact, by whatever rule
// is current. The log is what is kept; this is computed from it whenever it is
// wanted, so that changing the rule changes what every session already played
// says. scripts/practice-report.mjs reads a player's sessions through it.
//
// The holes are steadiness.js's: the attacks are fed to createSteadiness() as
// registerAttack() (musicxml.js) fed it while they were played. An attack is a
// moment of the score — the notes of one position in one bar, both hands on a
// beat — completed by the last of its keys to come down; a wrong key spoils
// the interval it falls in, as handleWrongNote() does. A traversal, a run or a
// repetition, starts over where the attacks go back in the score or skip
// ahead. That is read off the attacks alone: a bar clicked, which makes the
// page start its count over, leaves nothing in the log. The hands ticked do
// (the `h` events), and a traversal is played with those ticked as it began —
// both, in a log from before they were written. So do block chords (the `c`
// events), which start a traversal of their own: its attacks are its beats,
// each struck as one chord, as the page judged them (stampOf in musicxml.js).
//
// Pure: segments and a note model in, verdicts out. The model is the score's,
// by source bar:
//
//   notes  Map of fingering key (fingeringKeys.js) to { bar, staff, position,
//          midi, grace, fermata }: `bar` the source index, `position` in whole
//          notes from the bar's start
//   bars   per source bar, { duration, tempo, positions, beat }: how long it
//          is in whole notes, the tempo it is judged at, the positions of its
//          attacks in order, which number them, and — for fragments.js — how
//          long a beat of it is
//
// Positions are compared exactly: whoever builds the model rounds them with
// roundPosition, so that both hands on a beat share one.
import { createSteadiness, outOfPace, writtenBetween } from './steadiness.js'
import { TWO_HANDS, handsKey } from './hands.js'

// How finely positions are told apart, in whole notes: far below any note,
// far above the error of summing durations.
export const POSITION_EPSILON = 1e-6
export const roundPosition = (wholeNotes) => Math.round(wholeNotes / POSITION_EPSILON) / (1 / POSITION_EPSILON)

// The beat a position in a bar falls in, `beat` long, counted from 0 — what a
// fragment is cut in (fragments.js) — and where that beat starts, which is
// where block chords strike it (musicxml.js).
export const beatIndex = (position, beat) => Math.floor(position / beat + POSITION_EPSILON)
export const beatStartOf = (position, beat) => roundPosition(beatIndex(position, beat) * beat)

// A session's note log as one list of events in time order: { at (epoch ms),
// code, pitch, key, bar }, `bar` the playback index — the columns of a segment
// as noteLog.js writes them put back together. `startedAt` is anything Date
// takes.
export function eventsOf(segments) {
  const events = []
  for (const { startedAt, keys, t, e, p, n, b } of segments) {
    const origin = new Date(startedAt).getTime()
    for (let i = 0; i < e.length; i++) {
      events.push({ at: origin + t[i], code: e[i], pitch: p[i], key: n[i] >= 0 ? keys[n[i]] : null, bar: b[i] })
    }
  }
  return events.sort((a, b) => a.at - b.at)
}

// Back by more than this share of a bar, the player has started over; a hand
// a note late over a bar line goes back by much less.
const RESTART = 0.25

// The hands ticked, as an `h` event writes them (noteLog.js).
export const handsOfBits = (bits) => handsKey({ right: Boolean(bits & 1), left: Boolean(bits & 2) })

// The log cut into traversals, each judged: per traversal, its attacks in
// score order — { bar (playback), sourceBar, position, at, ms, ratio, pace,
// hole, entry, joined, faulted, written, lost } — the wrong keys played during
// it, { at, bar, key, pitch }, `key` the note that was owed, the hands ticked
// as it began (handsKey), and `blockChords` when it was played in block chords.
export function traversals(events, model) {
  const runs = []
  let run = null
  let last = -Infinity
  let lastBar = -Infinity
  let hands = TWO_HANDS
  let blockChords = false
  for (const event of events) {
    if (event.code === 'h') hands = handsOfBits(event.pitch)
    if (event.code === 'c') blockChords = event.pitch === 1
    const note = event.key && model.notes.get(event.key)
    if (!note || event.bar < 0) continue
    if (event.code === 'w') {
      run?.wrong.push(event)
      continue
    }
    if (event.code !== 'd') continue
    const { duration, beat } = model.bars[note.bar]
    // In block chords, a note is struck with its beat.
    const position = blockChords ? beatStartOf(note.position, beat) : note.position
    const where = event.bar + position / (duration || 1)
    if (!run || where < last - RESTART || event.bar > lastBar + 1 || run.blockChords !== blockChords) {
      runs.push((run = { attacks: new Map(), wrong: [], hands, blockChords }))
    }
    last = where
    lastBar = event.bar
    const id = `${event.bar}@${position}${note.grace ? 'g' : ''}`
    let attack = run.attacks.get(id)
    if (!attack) {
      attack = {
        bar: event.bar,
        sourceBar: note.bar,
        position,
        grace: note.grace,
        fermata: note.fermata,
        hole: false,
        at: 0,
      }
      run.attacks.set(id, attack)
    }
    // Completed by the last of its keys to come down — the last time, when
    // the engine took one again after a wrong note: the run went on from there.
    attack.at = Math.max(attack.at, event.at)
    attack.fermata ||= note.fermata
  }
  return runs.map((r) => judge(r, model))
}

function judge({ attacks, wrong, hands, blockChords }, model) {
  const ordered = [...attacks.values()].sort((a, b) => a.bar - b.bar || a.position - b.position || a.grace - b.grace)
  const steadiness = createSteadiness()
  const apply = (verdicts) => {
    for (const { ref, ratio, hole, entry, joined, pace } of verdicts) {
      ref.ratio = ratio
      ref.pace = pace
      ref.hole ||= hole
      ref.entry ||= entry
      ref.joined ||= joined
    }
  }
  let previous = null
  for (const attack of ordered) {
    const bar = model.bars[attack.sourceBar]
    const point = {
      at: attack.at,
      measure: attack.bar,
      position: attack.position,
      measureDuration: bar.duration,
      tempo: bar.tempo,
      decorative: attack.grace,
      fermata: attack.fermata,
      ref: attack,
    }
    if (previous) {
      attack.ms = attack.at - previous.at
      if (wrong.some((w) => w.at > previous.at && w.at <= attack.at)) {
        steadiness.fault()
        attack.faulted = true
        // What the score writes over the interval the mistake took, where the
        // pace would have judged it but for the mistake (weighLosses).
        if (previous.tempo === point.tempo && !outOfPace(previous, point)) {
          attack.written = writtenBetween(previous, point)
        }
      }
    }
    apply(steadiness.attack(point))
    previous = point
  }
  apply(steadiness.close())
  weighLosses(ordered)
  return { attacks: ordered, wrong, hands, blockChords }
}

// What each fault held the traversal up, in ms, as `lost`: a hole, its excess
// over the pace; an interval a wrong key fell in — which the pace never judges,
// the time being the mistake's — how much longer it took than the pace of the
// judged interval nearest before it, or after it, early in a traversal. What
// reinforcement ranks its spots by (fragments.js). Nothing for an attack that
// was no fault.
function weighLosses(attacks) {
  let pace = attacks.find((a) => a.pace)?.pace
  for (const attack of attacks) {
    pace = attack.pace ?? pace
    if (attack.hole) attack.lost = excess(attack)
    else if (attack.written != null && pace) attack.lost = Math.max(0, attack.ms - attack.written * pace)
    else attack.lost = 0
  }
}

// The attack at `position` in source bar `bar`, numbered from 1: the downbeat
// is #1, and the interval ending on it is the join from the bar before.
export const attackNumber = (model, bar, position) => model.bars[bar].positions.indexOf(position) + 1

// How much longer than the pace an interval took, in ms: what it would have
// lasted at the reference the verdict weighed it against, subtracted. Nothing
// for an interval never judged.
export const excess = ({ ms, ratio }) => (ratio > 1 ? ms - ms / ratio : 0)
