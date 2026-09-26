// The name a fingering is stored under, and the one rule every walk over a
// score has to obey for two of them to mean the same note.
//
// A key is `m<measure>:<staff>:<voice>:<note>`:
//
//   measure  0-based position of the bar in the score: the nth <measure> of a
//            <part>, and OSMD's SourceMeasures index -- except that a bar the
//            file writes as two <measure>s counts once (see barCounter).
//   staff    0-based and counted across the whole sheet, not within a part: a
//            score written as two one-staff parts (the two-part Entertainer)
//            has staves 0 and 1, not 0 and 0.
//   voice    the MusicXML <voice> number minus one. Per part, which is enough:
//            a sheet-wide staff already tells the parts apart.
//   note     how many notes of that bar, staff and voice came before it.
//
// It used to be the measure's `number` attribute rather than its position, and
// that attribute is a label, not an identity. Satie's Gnossienne No. 1 has no
// barlines, so all eleven of its measures are exported `number="0"` and its
// 872 notes shared 86 keys -- a fingering written on one measure was drawn on
// every measure. The 1902 Entertainer numbers a second ending "X1", which
// parseInt reads as NaN while OSMD leaves it undefined, so those fingerings were
// stored under one name and looked for under another and never appeared at all.
//
// `note` counts every <note> that is not a rest -- cue notes, notes the score
// hides (print-object="no") and grace notes included. Each walk has its own
// reasons to leave a note out of what it builds (playback skips cue and hidden
// notes; the click map does not), and none of those reasons may reach the
// counter: an index is a running total, so one walk skipping a note shifts
// every key after it in the measure and hands the next note's fingering to the
// wrong head.

// Old keys have a digit, `N` (NaN) or `u` (undefined) where new ones have `m`, so
// the two can share a record without ever being mistaken for one another --
// which they have to, because a record syncs whole and last-write-wins, and a
// device still running the old build must show nothing rather than something
// wrong.
const KEY_PREFIX = 'm'

export function fingeringKey(measureIndex, staff, voice, noteIndex) {
  return `${KEY_PREFIX}${measureIndex}:${staff}:${voice}:${noteIndex}`
}

// Numbers the bars of a score as its <measure>s go by: call it once per
// measure, in order, with the measure's `number` attribute as parseInt reads it
// and whether it is marked implicit="yes". Returns the bar's index and whether
// the measure `continues` the one before it.
//
// A bar is one <measure>, but for one written in two so a system can break
// inside it (bar 32 of Chopin's Op. 9 No. 2, sixty-four grace notes long): the
// second half is marked implicit -- MusicXML's word for a measure not counted,
// "such as [...] the last half of mid-measure repeats" -- and carries the
// number of the bar it completes. Both halves are then that bar: one index, one
// note count running through them, so no fingering and no practice history
// moves when a bar is split, and the practice cursor takes it whole.
//
// Implicit alone is not enough: Satie's barless Gnossienne marks all eleven of
// its measures implicit and numbers them all "0", and none of them completes a
// counted bar. Nor is OSMD's ImplicitMeasure, worked out from durations, which
// grace notes throw off.
export function barCounter() {
  let index = -1
  // The number of the counted bar the next measure could still complete.
  let open = null
  return (number, implicit) => {
    const continues = implicit && Number.isInteger(number) && number === open
    if (!continues) {
      index++
      open = implicit ? null : number
    }
    return { index, continues }
  }
}

// The numbering a walk over the file itself obeys: fingeringInjector.js over a
// parsed document, scripts/import-fingerings.mjs over the text, which has to
// edit it in place. Both read the same things in the same order -- each <part>
// with the <staves> it declares, each <measure> with its number and implicit
// flag, each <note> that is not a rest with its 1-based <staff> and <voice> --
// and hand them here, so the rules a key obeys are written once:
//
//   part(declared)            at each <part>: the staves it declares, all of them
//   measure(number, implicit) at each <measure>: the bar, as barCounter says
//   note(staff, voice)        at each note: its key, and its staff and voice as
//                             the key counts them (0-based, staff sheet-wide)
export function fileNumbering() {
  let firstStaff = 0
  let staves = 0
  let nextBar
  let bar
  let counters
  return {
    part(declared) {
      firstStaff += staves
      // The most the part declares: one that grows a staff mid-score keeps
      // the room it ended up needing.
      staves = Math.max(1, ...declared.filter(Number.isFinite))
      nextBar = barCounter()
    },
    measure(number, implicit) {
      bar = nextBar(number, implicit)
      if (!bar.continues) counters = new Map()
      return bar
    },
    note(staff, voice) {
      const s = firstStaff + staff - 1
      const v = voice - 1
      return { key: fingeringKey(bar.index, s, v, nextNoteIndex(counters, s, v)), staff: s, voice: v }
    },
  }
}

// The scheme this one replaced, kept only so a stored key can be recognised and
// translated. Delete it, and the migration with it, once no record still holds
// one -- see migrateLegacyFingerings.
export function legacyFingeringKey(measureNumber, staff, voice, noteIndex) {
  return `${measureNumber}:${staff}:${voice}:${noteIndex}`
}

export function isLegacyFingeringKey(key) {
  return !key.startsWith(KEY_PREFIX)
}

// How many notes of this staff and voice the bar has already spent, and one
// more from now on. `counters` is a Map per bar; every non-rest note must be
// offered to it, in document order, whatever the caller then does with the
// note.
export function nextNoteIndex(counters, staff, voice) {
  const counterKey = `${staff}:${voice}`
  const noteIndex = counters.get(counterKey) ?? 0
  counters.set(counterKey, noteIndex + 1)
  return noteIndex
}

// Rewrite a stored record's legacy keys into the current scheme, given
// Map<legacy key, current key[]> over the notes the score actually has.
// Returns null when there was nothing to do, which is every load after the
// first; otherwise the new fingerings and `added`, the keys the rewrite
// introduced. `added` is what the score has to be told to draw -- the rest were
// injected into the MusicXML before it was loaded -- and can be empty on a
// record that still changed, when the only legacy key was one no note answers
// to.
//
// A legacy key several notes answer to is copied onto all of them. That is the
// Gnossienne case, and copying is what leaves the score looking exactly as it
// did: the player sees the same fingerings in the same places, and can now
// delete the ten they never wrote. Choosing one note instead would move their
// fingering to a measure they never touched, which is worse than leaving it.
//
// A legacy key no note answers to is dropped. Those are the keys that could
// never be drawn in the first place -- a NaN measure, or a note removed from
// the score since -- so nothing that was visible is lost.
export function migrateLegacyFingerings(fingerings, legacyToCurrent) {
  const legacyKeys = Object.keys(fingerings).filter(isLegacyFingeringKey)
  if (legacyKeys.length === 0) return null

  const migrated = { ...fingerings }
  const added = []
  for (const legacyKey of legacyKeys) {
    const finger = migrated[legacyKey]
    delete migrated[legacyKey]
    for (const key of legacyToCurrent.get(legacyKey) ?? []) {
      // A fingering the player has already written under the current scheme
      // wins: it is the more recent of the two, and the one they can see.
      if (migrated[key] !== undefined) continue
      migrated[key] = finger
      added.push(key)
    }
  }
  return { fingerings: migrated, added }
}
