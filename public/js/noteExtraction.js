import { NOTE_NAMES } from './midi.js'
import { barCounter, fingeringKey, legacyFingeringKey, nextNoteIndex } from './fingeringKeys.js'
import { t } from './i18n.js'
import { withHands } from './utils.js'

// Ornament types from OSMD
const OrnamentEnum = {
  Trill: 0,
  Turn: 1,
  InvertedTurn: 2,
  DelayedTurn: 3,
  DelayedInvertedTurn: 4,
  Mordent: 5,
  InvertedMordent: 6,
}

// Accidental types from OSMD
const AccidentalEnum = {
  SHARP: 0,
  FLAT: 1,
  NONE: 2,
  NATURAL: 3,
  DOUBLESHARP: 4,
  DOUBLEFLAT: 5,
}

// Diatonic note semitone offsets from C (C=0, D=2, E=4, F=5, G=7, A=9, B=11)
// OSMD's fundamentalNote is the semitone offset of the note name (ignoring accidentals)
const DIATONIC_NOTES = [0, 2, 4, 5, 7, 9, 11] // C, D, E, F, G, A, B

// Find the index in DIATONIC_NOTES for a given fundamentalNote value
function getDiatonicIndex(fundamentalNote) {
  return DIATONIC_NOTES.indexOf(fundamentalNote)
}

// The octave numbering everything the player sees goes by: middle C (MIDI 60)
// is C4. OSMD's own Pitch.Octave counts three octaves lower, which is why note
// names here are always built from the MIDI number.
const octaveOfMidi = (midiNumber) => Math.floor(midiNumber / 12) - 1

// The next or previous letter's index in DIATONIC_NOTES (+6 is -1 mod 7).
const adjacentDiatonicIndex = (index, direction) => (index + (direction > 0 ? 1 : 6)) % 7

// Diatonic indices affected by flats/sharps in the circle of fifths
// Flat order:  B(6), E(2), A(5), D(1), G(4), C(0), F(3)
// Sharp order: F(3), C(0), G(4), D(1), A(5), E(2), B(6)
const FLAT_ORDER = [6, 2, 5, 1, 4, 0, 3]
const SHARP_ORDER = [3, 0, 4, 1, 5, 2, 6]

// Calculate diatonic interval to adjacent note based on pitch.fundamentalNote
// This follows the scale rather than using fixed semitone offsets
// fifths: key signature (-3 = Eb major, 0 = C major, 2 = D major, etc.)
function getDiatonicOffset(pitch, direction, fifths = 0) {
  const fundamentalNote = pitch?.fundamentalNote
  if (!pitch || fundamentalNote === undefined) return direction > 0 ? 2 : -2

  const currentHalfTone = pitch.halfTone
  const octave = Math.floor(currentHalfTone / 12)

  // Find current note's position in diatonic scale
  const currentIndex = getDiatonicIndex(fundamentalNote)
  if (currentIndex === -1) return direction > 0 ? 2 : -2 // fallback if not found

  const adjacentIndex = adjacentDiatonicIndex(currentIndex, direction)

  // Calculate halfTone for the adjacent diatonic note
  let adjacentHalfTone = octave * 12 + DIATONIC_NOTES[adjacentIndex]

  // Apply key signature accidental to the adjacent note
  const affectedNotes = fifths < 0
    ? FLAT_ORDER.slice(0, -fifths)
    : SHARP_ORDER.slice(0, fifths)
  if (affectedNotes.includes(adjacentIndex)) {
    adjacentHalfTone += fifths < 0 ? -1 : 1
  }

  // Handle octave wrap (B→C goes up, C→B goes down)
  if (direction > 0 && adjacentHalfTone <= currentHalfTone) {
    adjacentHalfTone += 12
  } else if (direction < 0 && adjacentHalfTone >= currentHalfTone) {
    adjacentHalfTone -= 12
  }

  return adjacentHalfTone - currentHalfTone
}

// The sign that goes with a letter. NONE and NATURAL get none: a ♮ says "not the
// sharp you saw earlier", a question the staff has already answered.
const ACCIDENTAL_SIGNS = {
  [AccidentalEnum.SHARP]: '♯',
  [AccidentalEnum.FLAT]: '♭',
  [AccidentalEnum.DOUBLESHARP]: '𝄪',
  [AccidentalEnum.DOUBLEFLAT]: '𝄫',
}

// Names a note for the player, in their language: "sol♯4", "C4". Unlike the
// noteName each note already carries — a MIDI name, always sharps and always
// ASCII, which the matcher and the logs go by — this is the note as the score
// spells it, so the B flat of an invention stays "si♭" instead of turning into
// the "la♯" the staff never says. The octave is what separates the candidates
// when the doubt is real: a broken chord passing the same letter through two
// registers.
//
// The hand follows, in the vocabulary and with the separator runs are already
// captioned with (utils' withHands). It is the staff the note is written on,
// which is the hand that plays it everywhere but a deliberate cross-hand
// passage — where the staff is what the player reads anyway.
export function noteLabel(noteData) {
  const spelled = spelledNote(noteData)
  return spelled && withHands(spelled, handOfNote(noteData))
}

// A C key by name, "do4": the landmark the on-screen keyboard labels.
export function cLabel(midiNumber) {
  return `${t('score.noteLetters').split(' ')[0]}${octaveOfMidi(midiNumber)}`
}

// The same without the hand: "sol♯4".
export function spelledNote(noteData) {
  const name = noteName(noteData)
  return name && `${name}${octaveOfMidi(noteData.midiNumber)}`
}

// The letter and its sign alone, "sol♯": what a key of the on-screen keyboard
// carries, where the key's place already says the octave.
export function noteName({ note }) {
  const pitch = note?.pitch
  const letter = t('score.noteLetters').split(' ')[getDiatonicIndex(pitch?.fundamentalNote)]
  return letter ? `${letter}${ACCIDENTAL_SIGNS[pitch.accidental] ?? ''}` : ''
}

// Check if an accidental is explicitly specified (not undefined or NONE)
function hasExplicitAccidental(accidental) {
  return accidental !== undefined && accidental !== AccidentalEnum.NONE
}

// The neighbour an ornament reaches for, as the measure so far has altered it:
// the key's neighbour, unless an earlier note on the same staff wrote that
// letter on the same line or space (same letter within a whole tone) -- an
// accidental holds to the end of the measure. A note tied in from the previous
// measure sets nothing: its accidental was written there.
function neighbourInForce(mainMidi, pitch, direction, fifths, priorNotes) {
  const keyMidi = mainMidi + getDiatonicOffset(pitch, direction, fifths)
  const index = getDiatonicIndex(pitch?.fundamentalNote)
  if (index === -1) return keyMidi
  const letter = DIATONIC_NOTES[adjacentDiatonicIndex(index, direction)]
  const carrier = priorNotes.findLast((n) =>
    !n.isTieContinuation &&
    n.note?.pitch?.fundamentalNote === letter &&
    Math.abs(n.midiNumber - keyMidi) <= 2
  )
  return carrier?.midiNumber ?? keyMidi
}

// Calculate upper/lower MIDI notes for ornaments
// When accidentals are explicitly marked, they modify the note chromatically:
// - FLAT lowers the note (upper: +1, lower: -2)
// - SHARP/NATURAL raises the note (upper: +2, lower: -1)
// Without explicit accidentals, use diatonic intervals (follow the scale),
// altered by any accidental earlier in the measure (neighbourInForce).
function getOrnamentAuxiliaryNotes(mainMidi, ornamentContainer, pitch, fifths, priorNotes) {
  const { AccidentalAbove, AccidentalBelow } = ornamentContainer

  let upperMidi, lowerMidi

  if (hasExplicitAccidental(AccidentalAbove)) {
    upperMidi = AccidentalAbove === AccidentalEnum.FLAT ? mainMidi + 1 : mainMidi + 2
  } else {
    upperMidi = neighbourInForce(mainMidi, pitch, 1, fifths, priorNotes)
  }

  if (hasExplicitAccidental(AccidentalBelow)) {
    lowerMidi = AccidentalBelow === AccidentalEnum.FLAT ? mainMidi - 2 : mainMidi - 1
  } else {
    lowerMidi = neighbourInForce(mainMidi, pitch, -1, fifths, priorNotes)
  }

  return { upperMidi, lowerMidi }
}

// Build the MIDI note sequence for an ornament
// Returns { sequence, flag } where flag is the property name to mark expanded notes
function getOrnamentSequence(mainMidi, ornamentContainer, pitch, fifths, priorNotes) {
  const ornamentType = ornamentContainer.GetOrnament

  const { upperMidi, lowerMidi } = getOrnamentAuxiliaryNotes(mainMidi, ornamentContainer, pitch, fifths, priorNotes)

  // Turn ornaments: 4-5 notes alternating around the main note.
  // Delayed turns sound the principal on the beat, then play the turn proper late
  // (see expandOrnamentNotes), so their sequence leads with the principal note.
  switch (ornamentType) {
    case OrnamentEnum.Turn:
      return { sequence: [upperMidi, mainMidi, lowerMidi, mainMidi], flag: 'isTurnNote' }
    case OrnamentEnum.InvertedTurn:
      return { sequence: [lowerMidi, mainMidi, upperMidi, mainMidi], flag: 'isTurnNote' }
    case OrnamentEnum.DelayedTurn:
      return { sequence: [mainMidi, upperMidi, mainMidi, lowerMidi, mainMidi], flag: 'isTurnNote', delayed: true }
    case OrnamentEnum.DelayedInvertedTurn:
      return { sequence: [mainMidi, lowerMidi, mainMidi, upperMidi, mainMidi], flag: 'isTurnNote', delayed: true }
    // Mordent ornaments: 3 notes with a quick auxiliary note
    case OrnamentEnum.Mordent:
      return { sequence: [mainMidi, lowerMidi, mainMidi], flag: 'isMordentNote' }
    case OrnamentEnum.InvertedMordent:
      return { sequence: [mainMidi, upperMidi, mainMidi], flag: 'isMordentNote' }
    case OrnamentEnum.Trill:
      return { sequence: [mainMidi, upperMidi, mainMidi], flag: 'isTrillNote' }
    default:
      return null
  }
}

// A delayed turn sounds its principal note on the beat, then plays the turn proper
// (upper-principal-lower-principal) squeezed into the final sixteenth-note of the
// principal's written value -- the classical realization. For a dotted note this
// fills the dot (e.g. the gruppetti in Beethoven's Pathétique 2nd movement: a turn
// on a dotted eighth lands on the last sixteenth). Holding the principal first lets
// accompaniment notes that fall between it and the turn be expected in between,
// instead of forcing the whole turn before them.
const DELAYED_TURN_FILL_WN = 1 / 16

// The notes written earlier than noteData on its staff in the same measure.
const notesBefore = (noteData, measureNotes) =>
  measureNotes.filter((n) => n.staffIndex === noteData.staffIndex && n.timestamp < noteData.timestamp)

// A trill written on the first note of a tie goes on through every note tied
// on from it (bars 19-22 of Bach's fourth invention: a C trilled for three
// bars while the left hand runs in sixteenths). Each of those notes gets a
// sentinel of its own rather than one span for the whole chain, because a
// timestamp is a measure index plus a position in whole notes: a length does
// not carry across a bar line outside 4/4. This keeps each trill's pitches by
// tie, for the later measures — expanded one at a time, in order — to find.
const trilledTies = new WeakMap()

const ORNAMENT_NOTE_OFFSET = 0.00001

// A trill sentinel: where free play accepts the trill's two pitches, over the
// span the note it stands on sounds in its measure (trillFrom-trillUntil, the
// matcher's isTrillStillSounding). Its own timestamp is offset past the note's
// so it never shares one with another note — the matcher would wait for both
// together, and nothing presses a sentinel.
function trillSentinel(noteData, trillPitches, offsetSteps, noteheadIndex) {
  return {
    ...noteData,
    timestamp: noteData.timestamp + offsetSteps * ORNAMENT_NOTE_OFFSET,
    isTrillEnd: true,
    ...trillPitches,
    trillFrom: noteData.timestamp,
    trillUntil: noteData.timestamp + (noteData.note?.Length?.RealValue ?? 0),
    noteheadIndex,
  }
}

// Expand ornament notes (turns, mordents, and trills) into their constituent notes
export function expandOrnamentNotes(measureNotes, fifths = 0) {
  const expandedNotes = []

  for (const noteData of measureNotes) {
    // A tied note under a trill is the trill going on, not a key to hold.
    const trillPitches = noteData.isTieContinuation && trilledTies.get(noteData.note?.NoteTie)
    if (trillPitches) {
      expandedNotes.push(trillSentinel(noteData, trillPitches, 1, noteData.noteheadIndex))
      continue
    }

    const ornamentContainer = noteData.voiceEntry?.OrnamentContainer
    const pitch = noteData.note?.pitch
    const ornamentInfo = ornamentContainer
      ? getOrnamentSequence(noteData.midiNumber, ornamentContainer, pitch, fifths, notesBefore(noteData, measureNotes))
      : null

    if (!ornamentInfo) {
      expandedNotes.push(noteData)
      continue
    }

    const { sequence, flag, delayed } = ornamentInfo
    // For a delayed turn, hold the principal (index 0) on the beat and offset the
    // turn proper into the final DELAYED_TURN_FILL_WN of the note's value. When the
    // note is too short to delay, fall back to plain sequential offsets so the
    // expanded notes never collapse onto the same timestamp.
    const parentDurationWN = noteData.note?.Length?.RealValue ?? 0
    const turnDelay = delayed ? Math.max(0, parentDurationWN - DELAYED_TURN_FILL_WN) : 0

    // The note the score actually writes, sounded on the beat: last of the
    // sequence, first of a delayed turn. It carries the notehead, so a delayed
    // turn's head now lights on the held principal rather than at the end of the
    // gruppetto -- the head draws that pitch, and it has been played.
    const principalIndex = delayed ? 0 : sequence.length - 1

    // It also carries what the ornament asks the player for, built here because
    // this is the one scope holding every fact it needs -- the sequence, whether
    // the turn is delayed, the parent's value and its tie. Re-deriving it from
    // the expanded notes later means restating those facts, and a rule like
    // "drop the first pitch of a tied ornament" is only right while
    // principalIndex === 0 exactly when `delayed`, which is not visible from
    // there. See requiredSequence, which now only reads this back.
    //
    // A tie already holds the delayed turn's principal, so it is not struck
    // again; the turn proper still is, and falls due when the held principal
    // gives way to it.
    const tied = delayed && noteData.isTieContinuation
    // The note being decorated ends where its sound does: at the end of the
    // tie it starts, if it starts one.
    const tie = noteData.note?.NoteTie
    const startsTie = tie && !noteData.isTieContinuation
    const ornamentAsk = {
      sequence: tied ? sequence.slice(1) : sequence,
      delayTs: tied ? turnDelay : 0,
      holdTs: startsTie ? tie.Duration.RealValue : parentDurationWN,
      alternating: flag === 'isTrillNote',
    }

    for (let i = 0; i < sequence.length; i++) {
      const midiNumber = sequence[i]
      const noteNameStd = NOTE_NAMES[midiNumber % 12]
      const octaveStd = octaveOfMidi(midiNumber)

      // Delayed turn: the principal (i === 0) stays on the beat (offset 0) and the
      // turn proper is pushed out by turnDelay. Otherwise notes follow immediately.
      const ornamentOffset = turnDelay > 0 && i > 0
        ? turnDelay + (i - 1) * ORNAMENT_NOTE_OFFSET
        : i * ORNAMENT_NOTE_OFFSET

      expandedNotes.push({
        ...noteData,
        midiNumber,
        noteName: `${noteNameStd}${octaveStd}`,
        timestamp: noteData.timestamp + ornamentOffset,
        // An ornament re-articulates, so its notes must NOT inherit the parent's
        // tie-continuation flag -- that would suppress their note-on in audio
        // (playback skips note-ons for tie continuations) and drop them from the
        // matcher, silencing the whole ornament on a tied note. The sole exception
        // is the held principal of a delayed turn (i === 0): when the parent is tied
        // into, that pitch is already sounding and must not be re-struck.
        isTieContinuation: delayed && i === 0 ? noteData.isTieContinuation : false,
        // Shared with audio playback (expandOrnamentTimings): how long the principal
        // is held before the turn proper. 0 for on-beat turns, mordents and trills.
        _turnDelay: turnDelay,
        [flag]: true,
        // What this ornament asks for, on the one note that stands for it.
        ...(i === principalIndex ? { ornamentAsk } : null),
        // Only the principal highlights the original notehead
        noteheadIndex: i === principalIndex ? noteData.noteheadIndex : -1,
      })
    }

    // Trills get a sentinel note that allows free alternation until the next real note
    if (flag === 'isTrillNote') {
      const trillPitches = { trillMidi: sequence[0], trillUpperMidi: sequence[1] }
      expandedNotes.push(trillSentinel(noteData, trillPitches, sequence.length, -1))
      if (startsTie) trilledTies.set(tie, trillPitches)
    }
  }

  return expandedNotes
}

// Repetition instruction types from OSMD
const RepetitionType = {
  StartLine: 0,
  ForwardJump: 1,
  BackJumpLine: 2,
  Ending: 3,
  DaCapo: 4,
  DalSegno: 5,
  Fine: 6,
  ToCoda: 7,
  DalSegnoAlFine: 8,
  DaCapoAlFine: 9,
  DalSegnoAlCoda: 10,
  DaCapoAlCoda: 11,
  Coda: 12,
  Segno: 13,
  None: 14,
}

// The score's bars, in order: the run of OSMD's SourceMeasures each is made of
// -- one, but for a bar the file writes as two (see barCounter) -- with where
// each of them starts in the bar, and how long the whole bar lasts, both in
// whole notes. A measure OSMD gives no duration for lasts a whole note.
//
// MeasureNumberXML is only filled in while OSMD's UseXMLMeasureNumbers rule is
// on, as it is by default. Turn it off and no measure continues another here,
// while fingeringInjector.js, reading the file, still folds them: every
// fingering past a split bar would be injected one bar off.
function barsOf(sourceMeasures) {
  const nextBar = barCounter()
  const bars = []
  for (const measure of sourceMeasures) {
    if (!nextBar(measure.MeasureNumberXML, measure.ImplicitMeasureFromXml).continues) {
      bars.push({ measures: [], duration: 0 })
    }
    const bar = bars.at(-1)
    bar.measures.push({ measure, offset: bar.duration })
    bar.duration += measure.Duration?.RealValue ?? 1.0
  }
  return bars
}

// Build the playback sequence considering repeats and endings (voltas):
// the index of each bar played, in playing order.
//
// A bar is entered through its first measure and left through its last, so a
// repeat sign or an ending written between the two halves of a split bar is
// not honoured: the halves are one bar, played through.
function buildPlaybackSequence(bars) {
  const sequence = []
  let currentPass = 1 // Track which repetition pass we're on (1 = first, 2 = second, etc.)
  let repeatStartIndex = 0 // Where to jump back to on BackJumpLine
  let i = 0

  while (i < bars.length) {
    const { measures } = bars[i]
    const firstInstructions = measures[0].measure.FirstRepetitionInstructions || []
    const lastInstructions = measures.at(-1).measure.LastRepetitionInstructions || []

    // Check for StartLine at the beginning of this measure
    const hasStartLine = firstInstructions.some((ri) => ri.type === RepetitionType.StartLine)
    if (hasStartLine) {
      // Check before updating repeatStartIndex: are we returning from a backward jump?
      const isReturningToRepeatStart = currentPass === 2 && i === repeatStartIndex
      repeatStartIndex = i
      // Only reset pass if we're starting a new repeat section (not coming back from a jump)
      if (!isReturningToRepeatStart) {
        currentPass = 1
      }
    }

    // Check if this measure is an ending (volta)
    const endingInstruction = firstInstructions.find((ri) => ri.type === RepetitionType.Ending)
    const endingIndices = endingInstruction?.endingIndices || []

    // Only include this measure if:
    // 1. It's not an ending (no volta bracket), OR
    // 2. It's an ending that matches the current pass
    const shouldIncludeMeasure = endingIndices.length === 0 || endingIndices.includes(currentPass)

    if (shouldIncludeMeasure) sequence.push(i)

    // Check for BackJumpLine at the end of this measure
    const hasBackJump = lastInstructions.some((ri) => ri.type === RepetitionType.BackJumpLine)

    if (hasBackJump && currentPass === 1) {
      // Jump back to repeat start for second pass
      currentPass = 2
      i = repeatStartIndex
      continue
    }

    // After completing pass 2 of a section, reset for next potential repeat section
    if (currentPass === 2 && endingIndices.includes(2)) {
      currentPass = 1
      repeatStartIndex = i + 1
    }

    i++
  }

  return sequence
}

function pitchToMidiFromSourceNote(pitch) {
  const midiNote = pitch.halfTone + 12
  const noteNameStd = NOTE_NAMES[midiNote % 12]
  const octaveStd = octaveOfMidi(midiNote)
  return { noteName: `${noteNameStd}${octaveStd}`, midiNote: midiNote }
}

// Grace notes should be played before the main note, not held together with it.
// This function adjusts their timestamps to be slightly earlier than the main note.
function adjustGraceNoteTimestamps(measureNotes) {
  const GRACE_NOTE_OFFSET = 0.0001

  // Group grace notes by their original timestamp
  const graceNotesByTimestamp = new Map()
  for (const noteData of measureNotes) {
    if (noteData.isGrace) {
      const ts = noteData.timestamp
      if (!graceNotesByTimestamp.has(ts)) {
        graceNotesByTimestamp.set(ts, [])
      }
      graceNotesByTimestamp.get(ts).push(noteData)
    }
  }

  // Adjust timestamps: each grace note gets an earlier timestamp
  for (const [timestamp, graceNotes] of graceNotesByTimestamp) {
    // Grace notes are ordered, first one should be played first (earliest timestamp)
    for (let i = 0; i < graceNotes.length; i++) {
      // Subtract offset so grace notes come before main note
      // Earlier grace notes get larger offset (played first)
      graceNotes[i].timestamp = timestamp - (graceNotes.length - i) * GRACE_NOTE_OFFSET
    }
  }
}

// Whether the OSMD cursor stops on a vertical container. The cursor visits a
// container only if it holds at least one note that is actually drawn; a
// container whose notes are all invisible (print-object="no") is skipped. Rests
// are drawn, so a rest-only container still counts as a stop.
export function containerHasCursorStop(container) {
  for (const staffEntry of container.staffEntries ?? []) {
    for (const voiceEntry of staffEntry?.voiceEntries ?? []) {
      for (const note of voiceEntry.notes ?? []) {
        if (note.PrintObject !== false) return true
      }
    }
  }
  return false
}

// Extract notes from the bars into a Map (sourceMeasureIndex -> notes array)
// This is the raw extraction without considering playback order
function extractNotesFromBars(bars) {
  const notesByMeasure = new Map()
  const pedalEventsByMeasure = new Map()
  const cursorStopsByMeasure = new Map()
  // Map<the key a note used to be filed under, the keys it is filed under now>,
  // for the one load per score that rewrites a record still holding the old
  // names -- see migrateLegacyFingerings. Several notes to one old key is the
  // whole point: that ambiguity is what the current scheme fixes. Built here
  // because this is the only walk that knows the old rule, and the old rule was
  // "count the notes this walk keeps" rather than "count the notes the measure
  // has". Delete it, and legacyNoteCounters below, when no stored record can
  // hold one any more.
  const legacyKeyMap = new Map()
  let currentFifths = 0

  bars.forEach((bar, barIndex) => {
    const measureNotes = []
    const cursorStops = []
    const pedalEvents = []
    // Track sequential note index for each (staff, voice) combination -- per
    // bar, so through both halves of a split one.
    const noteCounters = new Map()
    const legacyNoteCounters = new Map()

    for (const { measure, offset } of bar.measures) {
      const legacyMeasureNumber = measure.MeasureNumberXML
      // Where this measure starts in the note model's time: a bar's index,
      // plus how far into the bar the measure begins.
      const start = barIndex + offset

      // The OSMD cursor stops once per vertical container -- including containers
      // that hold only rests (e.g. one hand pausing while the other sustains a
      // longer note). Record every container's timestamp so the playback cursor
      // timeline can stop where the cursor actually stops, not only on note onsets.
      // Exclude containers whose notes are ALL invisible (print-object="no"): the
      // cursor skips those. Some publishers write an ornament's realized notes as
      // such hidden notes in their own containers (e.g. the gruppetti in Beethoven's
      // Pathétique). Counting them scheduled extra cursor.next() advances with no
      // matching cursor position, so the cursor ran one step ahead per hidden
      // container and stayed ahead for the rest of the piece.
      cursorStops.push(
        ...measure.verticalSourceStaffEntryContainers
          .filter(containerHasCursorStop)
          .map((c) => offset + (c.Timestamp?.RealValue ?? 0)),
      )

      for (const container of measure.verticalSourceStaffEntryContainers) {
        for (const [staffIndex, staffEntry] of (container.staffEntries ?? []).entries()) {
          if (!staffEntry?.voiceEntries) continue
          for (const voiceEntry of staffEntry.voiceEntries) {
            if (!voiceEntry.notes) continue
            // Get voice ID from OSMD (1-based in MusicXML), convert to 0-indexed
            const voiceId = voiceEntry.ParentVoice?.VoiceId ?? 1
            const voiceIndex = voiceId - 1
            for (let noteheadIndex = 0; noteheadIndex < voiceEntry.notes.length; noteheadIndex++) {
              const note = voiceEntry.notes[noteheadIndex]
              if (note.isRest()) continue
              // Counted here rather than after the skips below: a fingering key
              // is a running index, so a note this walk drops still has to
              // spend its place, or every key after it in the measure moves and
              // the injector -- which counts what the measure has -- hands each
              // fingering to the note next door. See fingeringKeys.js.
              const noteIndex = nextNoteIndex(noteCounters, staffIndex, voiceIndex)
              // Skip notes without pitch or cue notes (editorial guide notes not meant to be played).
              // Also skip invisible notes (print-object="no"): some publishers write an ornament's realized
              // notes as hidden notes in a separate voice *in addition* to the ornament symbol (e.g. the turns
              // in Beethoven's Pathétique). The symbol already expands into playable notes, so honoring the
              // hidden copy would double the ornament -- the player would have to play it twice, and the hidden
              // noteheads would only appear once validated. The player plays what they see, never hidden notes.
              if (!note.pitch || note.IsCueNote || note.PrintObject === false) continue
              const noteInfo = pitchToMidiFromSourceNote(note.pitch)
              // Check if this note is a tie continuation (not the start of the tie)
              const isTieContinuation = note.NoteTie && note.NoteTie.StartNote !== note
              const key = fingeringKey(barIndex, staffIndex, voiceIndex, noteIndex)
              const legacyKey = legacyFingeringKey(
                legacyMeasureNumber,
                staffIndex,
                voiceIndex,
                nextNoteIndex(legacyNoteCounters, staffIndex, voiceIndex),
              )
              if (legacyKeyMap.has(legacyKey)) legacyKeyMap.get(legacyKey).push(key)
              else legacyKeyMap.set(legacyKey, [key])
              measureNotes.push({
                note,
                voiceEntry,
                midiNumber: noteInfo.midiNote,
                noteName: noteInfo.noteName,
                timestamp: start + voiceEntry.timestamp.realValue,
                measureIndex: barIndex,
                active: false,
                played: false,
                isTieContinuation,
                isGrace: voiceEntry.isGrace === true,
                // Index of the notehead within the chord (for targeting individual noteheads in SVG)
                noteheadIndex,
                noteheadCount: voiceEntry.notes.filter((n) => n.pitch).length,
                // Staff 0 = right hand (treble clef), Staff 1 = left hand (bass clef)
                staffIndex,
                // Key for fingering storage
                fingeringKey: key,
                voiceIndex,
              })
            }
          }
        }
      }

      // Update key signature when a new one is declared (persists until changed)
      const keyInstruction = measure.getKeyInstruction(0)
      if (keyInstruction) currentFifths = keyInstruction.Key

      // Extract pedal events from StaffLinkedExpressions
      const staffLinkedExpressions = measure.StaffLinkedExpressions
      if (staffLinkedExpressions) {
        for (const staffExpressions of staffLinkedExpressions) {
          if (!staffExpressions) continue
          for (const multiExpr of staffExpressions) {
            const ts = start + (multiExpr.Timestamp?.RealValue ?? 0)
            if (multiExpr.PedalStart) {
              pedalEvents.push({ type: 'pedalDown', timestamp: ts })
            }
            if (multiExpr.PedalEnd) {
              pedalEvents.push({ type: 'pedalUp', timestamp: ts })
              if (multiExpr.PedalEnd.ChangeEnd) {
                pedalEvents.push({ type: 'pedalDown', timestamp: ts })
              }
            }
          }
        }
      }
    }

    cursorStopsByMeasure.set(barIndex, cursorStops)

    // Adjust grace note timestamps so they are played sequentially before main notes
    adjustGraceNoteTimestamps(measureNotes)

    // Expand ornaments (turns, mordents, and trills) into their constituent notes
    const expandedNotes = expandOrnamentNotes(measureNotes, currentFifths)

    // Ensure notes are ordered by (possibly adjusted) timestamp for sequential validation
    expandedNotes.sort((a, b) => a.timestamp - b.timestamp)

    if (expandedNotes.length > 0) {
      notesByMeasure.set(barIndex, expandedNotes)
    }

    if (pedalEvents.length > 0) {
      pedalEventsByMeasure.set(barIndex, pedalEvents)
    }
  })

  return { notesByMeasure, pedalEventsByMeasure, cursorStopsByMeasure, legacyKeyMap }
}

// Every note that decorates another rather than being written as one: grace
// notes, the notes an ornament expands into, and the trill sentinel.
function isOrnamentOrGrace(noteData) {
  return Boolean(
    noteData.isGrace ||
    noteData.isTrillNote ||
    noteData.isTurnNote ||
    noteData.isMordentNote ||
    noteData.isTrillEnd
  )
}

// What this note asks the player for, in whole-note fractions throughout: the
// pitches in order, how long after its own timestamp the first of them is due,
// how long the whole of it has to be played in, and whether it may go on
// alternating past the end of the sequence.
//
// A written note asks for itself, on its beat. An ornament is written as one
// note and realized as several, and the notation determines that realization
// down to the pitch and the order, so the whole of it is asked for -- once, on
// the note that carries the sign, the others being its spelling out. It has the
// written value of that note to be played in, and a trill may alternate between
// its two pitches for as long: that count is the one thing notation leaves
// free. Nothing is asked of a grace note, which is struck ahead of the beat and
// let through instead (see strictPlaythrough).
//
// What a tie already holds is dropped from the head of the sequence: on a
// delayed turn tied into, the principal is sounding and must not be re-struck,
// but the turn proper is still to play -- and it falls due when the held
// principal gives way to it.
// Free mode answers this same question its own way, and differently: musicxml.js
// walks the expanded notes with played/active flags and a trill sentinel that
// accepts either of the trill's two pitches in any order and any number, where
// the cursor here requires strict alternation. The two also count a bar's notes
// differently — free mode counts the expansion, strict mode the written note.
// Worth folding into one rule, but that changes free-mode behaviour and wants
// its own change; until then the divergence is deliberate, not overlooked.
export function requiredSequence(noteData) {
  if (noteData.ornamentAsk) return noteData.ornamentAsk
  const held = isOrnamentOrGrace(noteData) || noteData.isTieContinuation
  return { sequence: held ? [] : [noteData.midiNumber], delayTs: 0, holdTs: 0, alternating: false }
}

// Staff 0 = right hand, Staff 1+ = left hand. The one place that rule is
// written: what a hand selection plays reads it, and so does what names a note.
export function handOfNote({ staffIndex }) {
  return staffIndex === 0 ? 'right' : 'left'
}

export function isNoteActiveForHands(noteData, activeHands) {
  return activeHands[handOfNote(noteData)]
}

// The first measure at or after `from` that the active hands actually play,
// or allNotes.length when the rest of the score is the other hand's alone.
//
// The measure cursor only ever moves when a note is validated, so a bar one
// hand rests through — bar 25 of Bach's BWV 847 prelude is a whole rest in the
// right hand — is a dead end for anyone working that hand by itself.
export function nextPlayableMeasure(allNotes, from, activeHands) {
  let index = from
  while (
    index < allNotes.length &&
    !allNotes[index].notes.some((noteData) => isNoteActiveForHands(noteData, activeHands))
  ) {
    index++
  }
  return index
}

// The playback positions that get a click rectangle: the first pass through
// each source measure. A repeated measure is engraved once, so later passes
// would only stack identical rects on top of it — and the click would land on
// the last pass, skipping the repeat.
export function firstPassMeasureIndexes(allNotes) {
  const seen = new Set()
  const indexes = []
  allNotes.forEach((measureData, measureIndex) => {
    if (!measureData?.notes?.length) return
    if (seen.has(measureData.sourceMeasureIndex)) return
    seen.add(measureData.sourceMeasureIndex)
    indexes.push(measureIndex)
  })
  return indexes
}

// Where a source measure is first played, or -1 when the active score never
// plays it. Jumping to a measure always lands on that first pass, so what
// follows is played whole, repeat included.
export function firstPassIndexOf(allNotes, sourceMeasureIndex) {
  return allNotes.findIndex((m) => m.sourceMeasureIndex === sourceMeasureIndex)
}

export function svgNoteheadFor(osmdInstance, noteData) {
  if (!osmdInstance) return null
  const svgGroup = osmdInstance.rules.GNote(noteData.note)?.getSVGGElement()
  if (!svgGroup) return null
  const noteheads = svgGroup.querySelectorAll('.vf-notehead')
  return noteheads[noteData.noteheadIndex] ?? null
}

// Returns the set of source measures whose visual state should be reset when
// the cursor moves from `allNotes[fromIdx]` to `allNotes[toIdx]`.
//
// A reset is needed when the next measure's source has already been played
// (i.e., we're entering a repeat). The section to clear is every previously
// played source whose index is >= the repeat target AND that lies before the
// current measure — plus the current measure itself when it will be replayed
// later in the playback sequence (simple repeat, not a volta-1 ending).
export function sourceMeasuresToResetOnEntry(allNotes, fromIdx, toIdx, playedSources) {
  if (toIdx >= allNotes.length) return new Set()

  const nextSource = allNotes[toIdx].sourceMeasureIndex
  if (!playedSources.has(nextSource)) return new Set()

  const currentSource = allNotes[fromIdx].sourceMeasureIndex
  const currentWillReplay = allNotes
    .slice(toIdx)
    .some((m) => m.sourceMeasureIndex === currentSource)

  const result = new Set()
  for (const s of playedSources) {
    if (
      s >= nextSource &&
      (s < currentSource || (s === currentSource && currentWillReplay))
    ) {
      result.add(s)
    }
  }
  return result
}

// The note model, one entry per bar in playing order: `sourceMeasureIndex` is
// the bar's index, which fingerings and the practice journal are filed under --
// not OSMD's SourceMeasures index, which counts both halves of a split bar
// (see barCounter). A note's own `note.SourceMeasure` is where to go for that.
export function extractNotesFromScore(osmdInstance) {
  if (!osmdInstance) {
    return { allNotes: [], legacyKeyMap: new Map() }
  }

  const bars = barsOf(osmdInstance.Sheet.SourceMeasures)

  // Build the playback sequence (handles repeats and endings)
  const playbackSequence = buildPlaybackSequence(bars)

  const { notesByMeasure, pedalEventsByMeasure, cursorStopsByMeasure, legacyKeyMap } = extractNotesFromBars(bars)

  // Build allNotes array following the playback sequence
  const allNotes = []
  playbackSequence.forEach((barIndex, playbackIndex) => {
    const sourceNotes = notesByMeasure.get(barIndex)
    if (!sourceNotes || sourceNotes.length === 0) return

    // Create a copy of the notes for this playback position
    // Each occurrence in the sequence needs independent played/active state
    const measureNotes = sourceNotes.map((noteData) => ({
      ...noteData,
      // Update timestamp to use playback index, preserving grace note adjustments
      // The offset within measure includes grace note timing adjustments
      timestamp: playbackIndex + (noteData.timestamp - noteData.measureIndex),
      // Keep reference to source measure for SVG highlighting
      sourceMeasureIndex: barIndex,
      // Reset state for this occurrence
      active: false,
      played: false,
    }))

    const sourcePedalEvents = pedalEventsByMeasure.get(barIndex)
    const pedalEvents = sourcePedalEvents?.map((event) => ({
      type: event.type,
      timestamp: playbackIndex + (event.timestamp - barIndex),
    }))

    allNotes.push({
      measureIndex: playbackIndex,
      sourceMeasureIndex: barIndex,
      notes: measureNotes,
      pedalEvents,
      cursorStops: cursorStopsByMeasure.get(barIndex) ?? [],
      // In whole notes, as the bar's timestamps are.
      duration: bars[barIndex].duration,
    })
  })

  return { allNotes, legacyKeyMap }
}

// Carry played/active over from a note model onto its rebuild, note by note in playback
// position. By position rather than by fingeringKey: the two occurrences of a repeated
// measure share a key, so a key-based carry-over would bleed the first pass's "played"
// state onto the repeat and make the matcher skip it. Both models come from the same
// sheet, so they have the same shape.
export function carryOverNoteStates(from, to) {
  for (let i = 0; i < to.length && i < from.length; i++) {
    const fromNotes = from[i].notes
    to[i].notes.forEach((noteData, j) => {
      if (!fromNotes[j]) return
      noteData.played = fromNotes[j].played
      noteData.active = fromNotes[j].active
    })
  }
}
