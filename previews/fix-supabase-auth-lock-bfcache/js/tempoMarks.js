// MuseScore's playback rubato, written onto the page as bare numbers.
//
// Shaping a piece for playback in MuseScore leaves a trail of tempo changes in
// the export: a <direction> pairing an inaudible <sound tempo="…"/> with the
// number itself as <words> — "78", "98", "134". OSMD reads any <words> that
// comes with a sound tempo as a tempo marking and engraves it above the staff,
// so the numbers all end up on the page — 52 of them on the Arabesque, 57 more
// across five other scores in the library — where they say nothing to a
// pianist: the tempo the score asks for is written in words beside them
// ("Andantino con moto", "rit.", "a tempo").
//
// So they are dropped from the sheet between load() and the first render(),
// where OSMD lays the expressions out. Only marks whose text is nothing but a
// number go: one word in it and it is a real marking. The <sound tempo> that
// carried the number is untouched, and OSMD has already read it into
// SourceMeasure.TempoInBPM by this point — so the tempo curve stays available
// to anything that wants to play the piece with it, it just leaves the page.
const BARE_NUMBER = /^\d+(?:\.\d+)?$/

// One MultiTempoExpression is everything written at a single point in a
// measure, so it goes only if every entry in it is a bare number.
function isPlaybackOnly(multiTempoExpression) {
  return multiTempoExpression.EntriesList.every((entry) => BARE_NUMBER.test((entry.label ?? '').trim()))
}

export function stripPlaybackTempoMarks(sourceMeasures) {
  for (const measure of sourceMeasures) {
    // Spliced in place rather than reassigned: the array is OSMD's own.
    const marks = measure.TempoExpressions
    for (let i = marks.length - 1; i >= 0; i--) {
      if (isPlaybackOnly(marks[i])) marks.splice(i, 1)
    }
  }
}
