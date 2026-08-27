// Which hands a run through the score was played with — the vocabulary shared
// by what records a run (practiceTracker), what counts it, and what captions
// it (utils' withHands). Kept in a module of its own, with no imports, so the
// one string that means "the piece played in full" is written once.

// The one hand selection that makes a run "the piece played in full". The
// others are recorded and shown, but counted apart.
export const TWO_HANDS = 'both'

// How a hand selection is stored on a measure attempt.
export function handsKey({ right, left }) {
  if (right && left) return TWO_HANDS
  if (right) return 'right'
  if (left) return 'left'
  return 'none'
}

// The hands a run was played with. Two hands only when both were on for every
// one of its measures: unticking one halfway leaves a run that covered the
// whole score without ever playing all of it two-handed.
export function playthroughHands(attempts) {
  // An attempt recorded before the app tracked hands carries no value at all,
  // which reads as two hands: that is all a run could have been back then.
  const used = new Set(attempts.map((a) => a.hands || TWO_HANDS))
  // A measure with neither hand ticked has nothing to validate, so it can't be
  // part of what was played and says nothing about the hands that played it.
  used.delete('none')
  if (used.size === 0) return TWO_HANDS
  return used.size === 1 ? [...used][0] : 'mixed'
}

// Runs of the score split by the hands that played them, in that order. A
// right-hand run and a two-hand run of the same piece are not the same feat
// and their times don't compare, so nothing ever lists or plots them together.
export function playthroughGroups(playthroughs) {
  return [TWO_HANDS, 'right', 'left', 'mixed']
    .map((hands) => ({ hands, playthroughs: playthroughs.filter((pt) => pt.hands === hands) }))
    .filter((group) => group.playthroughs.length > 0)
}
