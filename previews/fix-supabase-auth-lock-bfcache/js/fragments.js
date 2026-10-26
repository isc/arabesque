// What reinforcement drills, read off the note log: the spots where the flow
// stopped or a wrong key came, each worked as a fragment — the beat it
// happened in and the beat before. Drilling the whole bar for a stall on its
// second semiquaver plays fourteen notes already known for each go at the one
// that is not, and never plays the way in from the bar before, which is where
// a hand changes shape (feedback 534a800b). Drilling the beat before with it
// plays exactly that.
//
// Pure: judged traversals in (noteLogAnalysis.js), fragments out. Recomputed
// from the log whenever asked, by the rule as it stands, so nothing of it is
// filed with a session. The bar-and-join suggestions (reinforcement.js) are
// for sessions with no log.
import { REINFORCEMENT_CLEAN_PASSES } from './reinforcement.js'
import { POSITION_EPSILON } from './noteLogAnalysis.js'

// Fragments are compared and merged as (bar, position) pairs, source bars
// and whole notes.
const before = (a, b) => a.bar < b.bar || (a.bar === b.bar && a.position < b.position)

// A beat of a bar: its index, where it starts and where it ends.
const beatOf = (bar, position) => Math.floor(position / bar.beat + POSITION_EPSILON)
const beatStart = (bar, beat) => beat * bar.beat
const beatEnd = (bar, beat) => Math.min((beat + 1) * bar.beat, bar.duration)

// The spot a moment of the score belongs to: its source bar and beat.
const spotAt = (model, sourceBar, position) => ({ bar: sourceBar, beat: beatOf(model.bars[sourceBar], position) })
const spotId = ({ bar, beat }) => `${bar}:${beat}`
const attackId = (bar, position) => `${bar}@${position}`

// The fragment a spot is worked as: from the start of the beat of the last
// attack before the spot's beat — the beat before, unless it holds no note,
// over a long one — to the end of the spot's beat. A spot on the first beat
// reaches back into the bar before.
export function fragmentOf(model, { bar, beat }) {
  const here = model.bars[bar]
  const start = beatStart(here, beat)
  const until = { bar, position: beatEnd(here, beat) }
  const earlier = here.positions.filter((p) => p < start - POSITION_EPSILON)
  const [fromBar, positions] = earlier.length > 0 ? [bar, earlier] : [bar - 1, model.bars[bar - 1]?.positions ?? []]
  if (positions.length === 0) return { from: { bar, position: start }, until }
  const previous = model.bars[fromBar]
  return { from: { bar: fromBar, position: beatStart(previous, beatOf(previous, positions.at(-1))) }, until }
}

// The first and the last attack of a fragment, which a traversal has to play
// both of to have played it all.
function endsOf(model, { from, until }) {
  const first = model.bars[from.bar].positions.find((p) => p >= from.position - POSITION_EPSILON)
  const last = model.bars[until.bar].positions.filter((p) => p < until.position - POSITION_EPSILON).at(-1)
  return first == null || last == null ? null : [attackId(from.bar, first), attackId(until.bar, last)]
}

// What a traversal played and stumbled on, worked out once per traversal: a
// page asks again at every bar, over the same past ones.
const readings = new WeakMap()
function readingOf(traversal, model) {
  let reading = readings.get(traversal)
  if (reading) return reading
  // The spots it stumbled on, with how many times: a hole on the note it came
  // late on, a wrong key on the note that was owed.
  const faults = new Map()
  const add = (spot) => {
    const id = spotId(spot)
    faults.set(id, { spot, count: (faults.get(id)?.count ?? 0) + 1 })
  }
  for (const attack of traversal.attacks) if (attack.hole) add(spotAt(model, attack.sourceBar, attack.position))
  for (const { key } of traversal.wrong) {
    const note = model.notes.get(key)
    if (note) add(spotAt(model, note.bar, note.position))
  }
  reading = { faults, played: new Set(traversal.attacks.map((a) => attackId(a.sourceBar, a.position))) }
  readings.set(traversal, reading)
  return reading
}

// What reinforcement offers, best first: the fragments of the spots fumbled in
// these traversals and not played cleanly since, for one hand selection.
// `traversals` are the window's (REINFORCEMENT_WINDOW_SESSIONS), in the order
// they were played, each with `training` saying whether it was a drill and
// `hands` the selection it was played with (handsKey).
//
// A spot is settled by REINFORCEMENT_CLEAN_PASSES clean traversals of its
// whole fragment since it was last fumbled — counted the drill's way in
// training, where a spoiled repetition leaves the dots already filled
// (musicxml.js): a fumble there adds to the spot's faults without starting
// its count over. Spots are ranked by faults, then by how recently they came;
// the fragments of the `limit` best that overlap or touch are drilled as one.
export function fragmentsToReinforce(traversals, model, { hands, limit = 5 } = {}) {
  const spots = new Map()
  traversals.forEach((traversal, order) => {
    if (traversal.hands !== hands) return
    const { faults, played } = readingOf(traversal, model)
    for (const [id, { spot, count }] of faults) {
      let entry = spots.get(id)
      if (!entry) {
        const fragment = fragmentOf(model, spot)
        spots.set(id, (entry = { fragment, ends: endsOf(model, fragment), faults: 0, clean: 0, last: 0 }))
      }
      entry.faults += count
      entry.last = order
      if (!traversal.training) entry.clean = 0
    }
    for (const [id, entry] of spots) {
      if (!faults.has(id) && entry.ends?.every((end) => played.has(end))) entry.clean++
    }
  })

  const chosen = [...spots.values()]
    .filter((entry) => entry.clean < REINFORCEMENT_CLEAN_PASSES)
    .sort((a, b) => b.faults - a.faults || b.last - a.last)
    .slice(0, limit)
    .sort((a, b) => (before(a.fragment.from, b.fragment.from) ? -1 : 1))

  const merged = []
  for (const { fragment, faults } of chosen) {
    const open = merged.at(-1)
    if (open && !before(open.until, fragment.from)) {
      if (before(open.until, fragment.until)) open.until = fragment.until
      open.faults += faults
    } else {
      merged.push({ from: { ...fragment.from }, until: { ...fragment.until }, hands, faults })
    }
  }
  return merged.sort((a, b) => b.faults - a.faults)
}
