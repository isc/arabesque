// The ladder a drill takes a passage up (reinforcement, in musicxml.js): one
// hand, the other, the two together, then to the click, slow and then at the
// tempo the piece is worked at. A passage repeated as written until it comes
// out clean is learnt at the pace the hands can find the notes at, which is
// not the pace of a run: the drills of the C minor prelude were played at
// 400 ms a semiquaver and its runs at 280, and went on stalling where the
// drills had been clean (November 2026). And a wrong note that one hand keeps
// making is not unlearnt with the other hand in the way.
//
// The pace used to be asked for in words and judged after the repetition, a
// pace the player could not hear. The click says it as the passage goes: the
// turns after the first are played to it, by strict mode's engine
// (strictPlaythrough.js), whose verdict passes them — SLOW_CLICK of the tempo
// first, then the tempo itself, cold, the passage coming back to it after the
// others' turns.
//
// A passage has one turn per dot, and a turn has steps, climbed one clean go
// each. The first turn builds the passage: each hand alone where it takes
// two, then as the drill was asked for. Where there is no tempo to click at,
// the turns after it ask for a clean repetition, which is all a drill asked
// before there was a ladder.
//
// A step failed again and again steps down for one clean go: to the hand whose
// notes came out wrong or missing, alone — to the same click, on a step that
// has one; with no note pointing at a hand, to a slower click; and where there
// is nothing below, the player is told to slow down.
//
// Pure: a turn's steps, where the passage stands on them and a go in; where it
// stands next out.
import { TWO_HANDS } from './hands.js?v=46e82bdb6096'

// Goes spoiled in a row before a step is stepped down from.
export const STUCK_AFTER = 3
// The share of the tempo a passage is first clicked at, and the one a click
// slows to when the timing, not a hand, is what keeps spoiling it.
export const SLOW_CLICK = 0.7

const slower = (bpm) => Math.round(bpm * SLOW_CLICK)

// One hand alone, to `click` if any, and the passage as the drill asks for it
// with no click: 'together' where that is two hands that were taken apart.
const alone = (hand, click = null) => ({ kind: hand, hands: hand, click, split: false })
const unhurried = (hands, split) => ({ kind: split ? 'together' : 'whole', hands, click: null, split })

// The turns of a passage drilled with `hands` (handsKey), `turns` of them: each
// a list of steps, { kind, hands, click, split }. `twoHanded` says both hands
// have notes in it; `bpm` is the tempo to click at, or null. A step's `click`
// is the tempo it is played to, null for one played without; it is `split`
// when its hands can be told apart, to step down to one.
export function ladderOf({ hands, twoHanded, bpm = null, turns }) {
  const split = hands === TWO_HANDS && twoHanded
  const apart = split ? [alone('right'), alone('left')] : []
  return Array.from({ length: turns }, (_, turn) => {
    if (turn === 0) return [...apart, unhurried(hands, split)]
    const last = turn === turns - 1
    if (bpm) return [{ kind: last ? 'click' : 'slowClick', hands, click: last ? bpm : slower(bpm), split }]
    return [{ kind: last ? 'confirm' : 'again', hands, click: null, split }]
  })
}

const UNSTUCK = { fails: 0, wrong: { right: 0, left: 0 } }

// Where a passage stands as a turn begins: on its first step, nothing played.
// `fails` and `wrong` count the goes spoiled in a row and the notes each hand
// got wrong or missed in them; `detour` is the step stepped down to, `hint`
// 'steady' once spoiled again and again with nowhere to step down to.
export const startOfTurn = () => ({ step: 0, ...UNSTUCK, detour: null, hint: null })

// The step being played: the detour while there is one.
export const stepOf = (steps, climb) => climb.detour ?? steps[climb.step]

// Where a spoiled step steps down to, or null.
function detourFrom(step, wrong) {
  if (step.split && wrong.right + wrong.left > 0) return alone(wrong.left > wrong.right ? 'left' : 'right', step.click)
  if (step.click) return { ...step, kind: 'slower', click: slower(step.click) }
  return null
}

function afterSpoiled(step, climb, wrong) {
  const fails = climb.fails + 1
  const owed = { right: climb.wrong.right + wrong.right, left: climb.wrong.left + wrong.left }
  if (fails < STUCK_AFTER) return { ...climb, fails, wrong: owed }
  const detour = climb.detour ? null : detourFrom(step, owed)
  if (detour) return { ...climb, ...UNSTUCK, detour, hint: null }
  return { ...climb, ...UNSTUCK, hint: 'steady' }
}

// A go at the step under way, { clean, wrong }: whether it came out clean, and
// the notes each hand got wrong or missed in it. Answers where the passage
// stands next, and whether the turn's dot is earned.
export function climbOn(steps, climb, { clean, wrong = UNSTUCK.wrong }) {
  if (!clean) return { climb: afterSpoiled(stepOf(steps, climb), climb, wrong), earned: false }
  // Back up from a detour, onto the step it was taken from.
  if (climb.detour) return { climb: { ...climb, ...UNSTUCK, detour: null, hint: null }, earned: false }
  if (climb.step + 1 < steps.length) return { climb: { ...startOfTurn(), step: climb.step + 1 }, earned: false }
  return { climb: startOfTurn(), earned: true }
}

// The ladder as the page shows it: every step of every turn in order, each
// { kind, done, now }, for a passage with `banked` turns behind it.
export function rungs(ladder, banked, climb) {
  return ladder.flatMap((steps, turn) =>
    steps.map(({ kind }, index) => ({
      kind,
      done: turn < banked || (turn === banked && index < climb.step),
      now: turn === banked && index === climb.step,
    })),
  )
}

// Whether a ladder asks for more than a clean repetition a turn: only then is
// there anything to show of it.
export const isGuided = (ladder) => ladder.some((steps) => steps.length > 1 || steps.some((step) => step.click))
