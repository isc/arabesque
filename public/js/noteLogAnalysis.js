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
// ahead. That is read off the attacks alone: a bar clicked or a hand toggled,
// which make the page start its count over, leave nothing in the log.
//
// Pure: segments and a note model in, verdicts out. The model is the score's,
// by source bar:
//
//   notes  Map of fingering key (fingeringKeys.js) to { bar, staff, position,
//          midi, grace, fermata }: `bar` the source index, `position` in whole
//          notes from the bar's start
//   bars   per source bar, { duration, tempo, positions }: how long it is in
//          whole notes, the tempo it is judged at, and the positions of its
//          attacks in order, which number them
//
// Positions are compared exactly: whoever builds the model rounds them, so
// that both hands on a beat share one.
import { createSteadiness } from './steadiness.js'

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

// The log cut into traversals, each judged: per traversal, its attacks in
// score order — { bar (playback), sourceBar, position, at, ms, ratio, hole,
// entry, joined, faulted } — and the wrong keys played during it, { at, bar,
// key, pitch }, `key` the note that was owed.
export function traversals(events, model) {
  const runs = []
  let run = null
  let last = -Infinity
  let lastBar = -Infinity
  for (const event of events) {
    const note = event.key && model.notes.get(event.key)
    if (!note || event.bar < 0) continue
    if (event.code === 'w') {
      run?.wrong.push(event)
      continue
    }
    if (event.code !== 'd') continue
    const where = event.bar + note.position / (model.bars[note.bar].duration || 1)
    if (!run || where < last - RESTART || event.bar > lastBar + 1) runs.push((run = { attacks: new Map(), wrong: [] }))
    last = where
    lastBar = event.bar
    const id = `${event.bar}@${note.position}${note.grace ? 'g' : ''}`
    let attack = run.attacks.get(id)
    if (!attack) {
      attack = {
        bar: event.bar,
        sourceBar: note.bar,
        position: note.position,
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

function judge({ attacks, wrong }, model) {
  const ordered = [...attacks.values()].sort((a, b) => a.bar - b.bar || a.position - b.position || a.grace - b.grace)
  const steadiness = createSteadiness()
  const apply = (verdicts) => {
    for (const { ref, ratio, hole, entry, joined } of verdicts) {
      ref.ratio = ratio
      ref.hole ||= hole
      ref.entry ||= entry
      ref.joined ||= joined
    }
  }
  let previous = null
  for (const attack of ordered) {
    if (previous) {
      attack.ms = attack.at - previous.at
      if (wrong.some((w) => w.at > previous.at && w.at <= attack.at)) {
        steadiness.fault()
        attack.faulted = true
      }
    }
    const bar = model.bars[attack.sourceBar]
    apply(
      steadiness.attack({
        at: attack.at,
        measure: attack.bar,
        position: attack.position,
        measureDuration: bar.duration,
        tempo: bar.tempo,
        decorative: attack.grace,
        fermata: attack.fermata,
        ref: attack,
      }),
    )
    previous = attack
  }
  apply(steadiness.close())
  return { attacks: ordered, wrong }
}

// The attack at `position` in source bar `bar`, numbered from 1: the downbeat
// is #1, and the interval ending on it is the join from the bar before.
export const attackNumber = (model, bar, position) => model.bars[bar].positions.indexOf(position) + 1

// How much longer than the pace an interval took, in ms: what it would have
// lasted at the reference the verdict weighed it against, subtracted. Nothing
// for an interval never judged.
export const excess = ({ ms, ratio }) => (ratio > 1 ? ms - ms / ratio : 0)
