// Which hands a run through the score was played with — the vocabulary shared
// by what records a run (practiceTracker), what counts it, and what captions
// it (utils' withHands). Kept in a module of its own, with no imports, so the
// one string that means "the piece played in full" is written once.

// The one hand selection that makes a run "the piece played in full". The
// others are recorded and shown, but counted apart.
export const TWO_HANDS = 'both'

// Neither hand ticked. A measure played so has nothing to validate, so it
// can't be part of what was played and says nothing about the hands.
export const NO_HANDS = 'none'

// How a hand selection is stored on a measure attempt.
export function handsKey({ right, left }) {
  if (right && left) return TWO_HANDS
  if (right) return 'right'
  if (left) return 'left'
  return NO_HANDS
}

// The hands a measure attempt was played with. One recorded before the app
// tracked hands carries no value at all, which reads as two hands: that is
// all a run could have been back then.
export function attemptHands(attempt) {
  return attempt.hands || TWO_HANDS
}

// The hands a run was played with. Two hands only when both were on for every
// one of its measures: unticking one halfway leaves a run that covered the
// whole score without ever playing all of it two-handed.
export function playthroughHands(attempts) {
  const used = new Set(attempts.map(attemptHands))
  used.delete(NO_HANDS)
  if (used.size === 0) return TWO_HANDS
  return used.size === 1 ? [...used][0] : 'mixed'
}

// Runs of the score split by how they were played: free runs first, then runs
// to the metronome, each by the hands that played them, in that order. A
// right-hand run and a two-hand run of the same piece are not the same feat
// and their times don't compare; a strict run isn't timed by the player at
// all, and is measured by its hit rate. So nothing ever lists or plots two
// groups together. `key` identifies a group where a template needs one.
export function playthroughGroups(playthroughs) {
  return [false, true].flatMap((strict) =>
    [TWO_HANDS, 'right', 'left', 'mixed'].map((hands) => ({
      key: `${strict ? 'strict' : 'free'}-${hands}`,
      hands,
      strict,
      playthroughs: playthroughs.filter((pt) => pt.hands === hands && Boolean(pt.strict) === strict),
    })),
  ).filter((group) => group.playthroughs.length > 0)
}
