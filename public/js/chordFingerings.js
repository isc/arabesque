// OSMD puts a staff's fingerings on one side of it -- above the upper staff of
// an instrument, below the others -- and stacks a chord's in the order of its
// notes. With the note on that side of the chord left without one, the
// fingering of another note stands alone where that note's would be, and reads
// as its: the 2 of the E of an E-G in the right hand, drawn over the G. So until
// that outer note has a fingering too, the others go to the other side of the
// staff, next to the notes they belong to.
//
// Only the fingerings the file leaves unplaced, which includes every one the
// player entered: a placement the engraver wrote stands. Run before every
// render, as a fingering entered or cleared changes what its chord needs.

// OSMD's PlacementEnum, copied rather than read off the bundle (which exports
// it since 3.0): test/js runs this module without OSMD loaded.
export const PLACEMENT = { ABOVE: 0, BELOW: 1, NOT_YET_DEFINED: 4 }
const { ABOVE, BELOW, NOT_YET_DEFINED } = PLACEMENT
const FINGERING = 0 // TechnicalInstructionType.Fingering

// The fingerings this ever moved, so that the next pass can tell them from those
// the file placed.
const moved = new WeakSet()

export function placeChordFingerings(sourceMeasures) {
  for (const measure of sourceMeasures) {
    for (const container of measure.VerticalSourceStaffEntryContainers) {
      for (const staffEntry of container.StaffEntries) {
        if (staffEntry) placeStaffEntry(staffEntry)
      }
    }
  }
}

// One staff entry: the notes of every voice on that staff at that moment, which
// OSMD stacks fingerings over together. Grace notes have theirs drawn beside them.
function placeStaffEntry(staffEntry) {
  const voiceEntries = staffEntry.VoiceEntries.filter((voiceEntry) => !voiceEntry.IsGrace)
  const fingerings = voiceEntries.flatMap((voiceEntry) =>
    voiceEntry.TechnicalInstructions.filter((instruction) => instruction.type === FINGERING),
  )
  if (!fingerings.length) return

  const staves = staffEntry.ParentStaff.ParentInstrument.Staves
  const above = staves.length === 1 || staffEntry.ParentStaff === staves[0]
  const notes = voiceEntries.flatMap((voiceEntry) => voiceEntry.Notes).filter((note) => note.Pitch)
  if (!notes.length) return
  const pitch = (note) => note.Pitch.getHalfTone()
  const outer = notes.reduce((a, b) => (above ? pitch(b) > pitch(a) : pitch(b) < pitch(a)) ? b : a)
  // The whole chord's fingering written on one of its notes, as several
  // fingerings or as one of several lines (1, 2, 3 and 5 under each other in
  // the Pathétique's third movement), stands as it is.
  const wholeChord =
    new Set(fingerings.map((fingering) => fingering.sourceNote)).size < fingerings.length ||
    fingerings.some((fingering) => String(fingering.value).includes('\n'))
  const toTheOtherSide = !wholeChord && !fingerings.some((fingering) => fingering.sourceNote === outer)

  for (const fingering of fingerings) {
    if (!moved.has(fingering) && (fingering.placement === ABOVE || fingering.placement === BELOW)) continue
    const move = toTheOtherSide && fingering.sourceNote !== outer
    fingering.placement = move ? (above ? BELOW : ABOVE) : NOT_YET_DEFINED
    if (move) moved.add(fingering)
  }
}
