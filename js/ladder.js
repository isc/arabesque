// The ladder a drill takes a passage up (reinforcement, in musicxml.js): one
// hand, the other, the two together, then at the pace of the player's runs,
// and once more, cold. A passage repeated as written until it comes out clean
// is learnt at the pace the hands can find the notes at, which is not the pace
// of a run: the drills of the C minor prelude were played at 400 ms a
// semiquaver and its runs at 280, and went on stalling where the drills had
// been clean (November 2026). And a wrong note that one hand keeps making is
// not unlearnt with the other hand in the way.
//
// A passage has one turn per dot, and a turn has steps, climbed one clean
// repetition each. The first turn builds the passage: each hand alone where it
// takes two, then as the drill was asked for. The turns after it play it at
// `pace` — met at once, or else on the third clean repetition, so that a
// passage the hands cannot play that fast yet is still worked rather than
// stood on for good. Where no pace is known they ask for a clean repetition,
// which is all a drill asked before there was a ladder.
//
// A step failed again and again steps down for one clean repetition: to the
// hand whose notes came out wrong, alone; with no wrong note to point at one,
// to the same hands with nothing asked of the pace; and where there is nothing
// below, the player is told to slow down.
//
// Pure: a turn's steps, where the passage stands on them and a repetition in;
// where it stands next out.
import { TWO_HANDS } from './hands.js?v=068542b71800'

// Repetitions spoiled in a row before a step is stepped down from.
export const STUCK_AFTER = 3
// Clean repetitions that pass a step whatever their pace.
export const CLEAN_ENOUGH = 3

// One hand alone, and the passage as the drill asks for it with nothing asked
// of its pace: 'together' where that is two hands that were taken apart.
const alone = (hand) => ({ kind: hand, hands: hand, pace: null, split: false })
const unhurried = (hands, split) => ({ kind: split ? 'together' : 'whole', hands, pace: null, split })

// The turns of a passage drilled with `hands` (handsKey), `turns` of them: each
// a list of steps, { kind, hands, pace, split }. `twoHanded` says both hands
// have notes in it; `pace` is the one to hold, in ms per whole note, or null.
// A step is `split` when its hands can be told apart, to step down to one.
export function ladderOf({ hands, twoHanded, pace = null, turns }) {
  const split = hands === TWO_HANDS && twoHanded
  const apart = split ? [alone('right'), alone('left')] : []
  return Array.from({ length: turns }, (_, turn) => {
    if (turn === 0) return [...apart, unhurried(hands, split)]
    if (turn === turns - 1) return [{ kind: 'confirm', hands, pace, split }]
    return [{ kind: pace ? 'tempo' : 'again', hands, pace, split }]
  })
}

const UNSTUCK = { fails: 0, wrong: { right: 0, left: 0 } }

// Where a passage stands as a turn begins: on its first step, nothing played.
// `fails` and `wrong` count the repetitions spoiled in a row and the wrong
// notes each hand owed in them, `cleans` the clean ones the step has had;
// `detour` is the step stepped down to, `hint` what the last repetitions call
// for — 'slow', clean but under the pace, `played` being the pace it held, or
// 'steady', spoiled again and again with nowhere to step down to.
export const startOfTurn = () => ({ step: 0, cleans: 0, ...UNSTUCK, detour: null, hint: null, played: null })

// The step being played: the detour while there is one.
export const stepOf = (steps, climb) => climb.detour ?? steps[climb.step]

// Where a spoiled step steps down to, or null.
function detourFrom(step, wrong) {
  if (step.split && wrong.right + wrong.left > 0) return alone(wrong.left > wrong.right ? 'left' : 'right')
  if (step.pace) return unhurried(step.hands, step.split)
  return null
}

function afterSpoiled(step, climb, wrong) {
  const fails = climb.fails + 1
  const owed = { right: climb.wrong.right + wrong.right, left: climb.wrong.left + wrong.left }
  // 'slow' spoke of a clean repetition; 'steady' holds until one comes.
  const hint = climb.hint === 'steady' ? 'steady' : null
  if (fails < STUCK_AFTER) return { ...climb, fails, wrong: owed, hint }
  const detour = climb.detour ? null : detourFrom(step, owed)
  if (detour) return { ...climb, ...UNSTUCK, detour, hint: null }
  return { ...climb, ...UNSTUCK, hint: 'steady' }
}

// A repetition of the step under way, { clean, pace, wrong }: whether it came
// out with no wrong note and no hole, the pace it held (ms per whole note,
// null when it could not be measured) and the wrong notes each hand owed.
// Answers where the passage stands next, and whether the turn's dot is earned.
export function climbOn(steps, climb, { clean, pace = null, wrong = UNSTUCK.wrong }) {
  const step = stepOf(steps, climb)
  if (!clean) return { climb: afterSpoiled(step, climb, wrong), earned: false }
  // Back up from a detour, onto the step it was taken from.
  if (climb.detour) return { climb: { ...climb, ...UNSTUCK, detour: null, hint: null }, earned: false }
  const cleans = climb.cleans + 1
  if (step.pace && pace != null && pace > step.pace && cleans < CLEAN_ENOUGH) {
    return { climb: { ...climb, ...UNSTUCK, cleans, hint: 'slow', played: pace }, earned: false }
  }
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
export const isGuided = (ladder) => ladder.some((steps) => steps.length > 1 || steps.some((step) => step.pace))
