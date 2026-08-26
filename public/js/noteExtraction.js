import { NOTE_NAMES } from './midi.js'

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

  // Calculate next/previous diatonic note index
  const adjacentIndex = direction > 0
    ? (currentIndex + 1) % 7
    : (currentIndex + 6) % 7 // +6 is same as -1 mod 7

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

// Check if an accidental is explicitly specified (not undefined or NONE)
function hasExplicitAccidental(accidental) {
  return accidental !== undefined && accidental !== AccidentalEnum.NONE
}

// Calculate upper/lower MIDI notes for ornaments
// When accidentals are explicitly marked, they modify the note chromatically:
// - FLAT lowers the note (upper: +1, lower: -2)
// - SHARP/NATURAL raises the note (upper: +2, lower: -1)
// Without explicit accidentals, use diatonic intervals (follow the scale)
function getOrnamentAuxiliaryNotes(mainMidi, ornamentContainer, pitch, fifths = 0) {
  const { AccidentalAbove, AccidentalBelow } = ornamentContainer

  let upperMidi, lowerMidi

  if (hasExplicitAccidental(AccidentalAbove)) {
    upperMidi = AccidentalAbove === AccidentalEnum.FLAT ? mainMidi + 1 : mainMidi + 2
  } else {
    upperMidi = mainMidi + getDiatonicOffset(pitch, 1, fifths)
  }

  if (hasExplicitAccidental(AccidentalBelow)) {
    lowerMidi = AccidentalBelow === AccidentalEnum.FLAT ? mainMidi - 2 : mainMidi - 1
  } else {
    lowerMidi = mainMidi + getDiatonicOffset(pitch, -1, fifths)
  }

  return { upperMidi, lowerMidi }
}

// Build the MIDI note sequence for an ornament
// Returns { sequence, flag } where flag is the property name to mark expanded notes
function getOrnamentSequence(mainMidi, ornamentContainer, pitch, fifths = 0) {
  const ornamentType = ornamentContainer.GetOrnament

  const { upperMidi, lowerMidi } = getOrnamentAuxiliaryNotes(mainMidi, ornamentContainer, pitch, fifths)

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

// Expand ornament notes (turns, mordents, and trills) into their constituent notes
export function expandOrnamentNotes(measureNotes, fifths = 0) {
  const ORNAMENT_NOTE_OFFSET = 0.00001
  const expandedNotes = []

  for (const noteData of measureNotes) {
    const ornamentContainer = noteData.voiceEntry?.OrnamentContainer
    const pitch = noteData.note?.pitch
    const ornamentInfo = ornamentContainer ? getOrnamentSequence(noteData.midiNumber, ornamentContainer, pitch, fifths) : null

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

    for (let i = 0; i < sequence.length; i++) {
      const midiNumber = sequence[i]
      const noteNameStd = NOTE_NAMES[midiNumber % 12]
      const octaveStd = Math.floor(midiNumber / 12) - 1

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
        // Only the last note should highlight the original notehead
        noteheadIndex: i === sequence.length - 1 ? noteData.noteheadIndex : -1,
      })
    }

    // Trills get a sentinel note that allows free alternation until the next real note
    if (flag === 'isTrillNote') {
      expandedNotes.push({
        ...noteData,
        timestamp: noteData.timestamp + sequence.length * ORNAMENT_NOTE_OFFSET,
        isTrillEnd: true,
        trillMidi: sequence[0],
        trillUpperMidi: sequence[1],
        noteheadIndex: -1,
      })
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

// Build the playback sequence considering repeats and endings (voltas)
// Returns an array of { sourceMeasureIndex, playbackIndex } objects
function buildPlaybackSequence(sourceMeasures) {
  const sequence = []
  let currentPass = 1 // Track which repetition pass we're on (1 = first, 2 = second, etc.)
  let repeatStartIndex = 0 // Where to jump back to on BackJumpLine
  let i = 0

  while (i < sourceMeasures.length) {
    const measure = sourceMeasures[i]
    const firstInstructions = measure.FirstRepetitionInstructions || []
    const lastInstructions = measure.LastRepetitionInstructions || []

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

    if (shouldIncludeMeasure) {
      sequence.push({
        sourceMeasureIndex: i,
        playbackIndex: sequence.length,
      })
    }

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
  const octaveStd = Math.floor(midiNote / 12) - 1
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

// Extract notes from source measures into a Map (sourceMeasureIndex -> notes array)
// This is the raw extraction without considering playback order
function extractNotesFromSourceMeasures(sourceMeasures) {
  const notesByMeasure = new Map()
  const pedalEventsByMeasure = new Map()
  const cursorStopsByMeasure = new Map()
  let currentFifths = 0

  sourceMeasures.forEach((measure, measureIndex) => {
    const measureNotes = []
    // Use MeasureNumberXML to match the XML's measure number attribute
    // (MeasureNumber is OSMD's internal numbering which starts from 0 for pickups)
    const measureNumber = measure.MeasureNumberXML
    // Track sequential note index for each (staff, voice) combination
    const noteCounters = new Map()

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
    cursorStopsByMeasure.set(
      measureIndex,
      measure.verticalSourceStaffEntryContainers
        .filter(containerHasCursorStop)
        .map((c) => c.Timestamp?.RealValue ?? 0),
    )

    measure.verticalSourceStaffEntryContainers.forEach((container) => {
      if (container.staffEntries) {
        for (let staffIndex = 0; staffIndex < container.staffEntries.length; staffIndex++) {
          const staffEntry = container.staffEntries[staffIndex]
          if (!staffEntry?.voiceEntries) continue
          for (const voiceEntry of staffEntry.voiceEntries) {
            if (!voiceEntry.notes) continue
            // Get voice ID from OSMD (1-based in MusicXML), convert to 0-indexed
            const voiceId = voiceEntry.ParentVoice?.VoiceId ?? 1
            const voiceIndex = voiceId - 1
            for (let noteIndex = 0; noteIndex < voiceEntry.notes.length; noteIndex++) {
              const note = voiceEntry.notes[noteIndex]
              // Skip notes without pitch, rests, or cue notes (editorial guide notes not meant to be played).
              // Also skip invisible notes (print-object="no"): some publishers write an ornament's realized
              // notes as hidden notes in a separate voice *in addition* to the ornament symbol (e.g. the turns
              // in Beethoven's Pathétique). The symbol already expands into playable notes, so honoring the
              // hidden copy would double the ornament -- the player would have to play it twice, and the hidden
              // noteheads would only appear once validated. The player plays what they see, never hidden notes.
              if (!note.pitch || note.isRest() || note.IsCueNote || note.PrintObject === false) continue
              const noteInfo = pitchToMidiFromSourceNote(note.pitch)
              // Check if this note is a tie continuation (not the start of the tie)
              const isTieContinuation = note.NoteTie && note.NoteTie.StartNote !== note
              // Get sequential note index for this (staff, voice) combination
              const counterKey = `${staffIndex}:${voiceIndex}`
              if (!noteCounters.has(counterKey)) {
                noteCounters.set(counterKey, 0)
              }
              const sequentialNoteIndex = noteCounters.get(counterKey)
              noteCounters.set(counterKey, sequentialNoteIndex + 1)
              // Fingering key format: measureNumber:staffIndex:voiceIndex:sequentialNoteIndex
              const fingeringKey = `${measureNumber}:${staffIndex}:${voiceIndex}:${sequentialNoteIndex}`
              measureNotes.push({
                note,
                voiceEntry,
                midiNumber: noteInfo.midiNote,
                noteName: noteInfo.noteName,
                timestamp: measureIndex + voiceEntry.timestamp.realValue,
                measureIndex,
                active: false,
                played: false,
                isTieContinuation,
                isGrace: voiceEntry.isGrace === true,
                // Index of the notehead within the chord (for targeting individual noteheads in SVG)
                noteheadIndex: noteIndex,
                noteheadCount: voiceEntry.notes.filter((n) => n.pitch).length,
                // Staff 0 = right hand (treble clef), Staff 1 = left hand (bass clef)
                staffIndex,
                // Key for fingering storage
                fingeringKey,
                voiceIndex,
              })
            }
          }
        }
      }
    })

    // Adjust grace note timestamps so they are played sequentially before main notes
    adjustGraceNoteTimestamps(measureNotes)

    // Update key signature when a new one is declared (persists until changed)
    const keyInstruction = measure.getKeyInstruction(0)
    if (keyInstruction) currentFifths = keyInstruction.Key

    // Expand ornaments (turns, mordents, and trills) into their constituent notes
    const expandedNotes = expandOrnamentNotes(measureNotes, currentFifths)

    // Ensure notes are ordered by (possibly adjusted) timestamp for sequential validation
    expandedNotes.sort((a, b) => a.timestamp - b.timestamp)

    if (expandedNotes.length > 0) {
      notesByMeasure.set(measureIndex, expandedNotes)
    }

    // Extract pedal events from StaffLinkedExpressions
    const pedalEvents = []
    const staffLinkedExpressions = measure.StaffLinkedExpressions
    if (staffLinkedExpressions) {
      for (const staffExpressions of staffLinkedExpressions) {
        if (!staffExpressions) continue
        for (const multiExpr of staffExpressions) {
          const ts = measureIndex + (multiExpr.Timestamp?.RealValue ?? 0)
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
    if (pedalEvents.length > 0) {
      pedalEventsByMeasure.set(measureIndex, pedalEvents)
    }
  })

  return { notesByMeasure, pedalEventsByMeasure, cursorStopsByMeasure }
}

// Extract notes from the score and build the playback sequence
export function isOrnamentOrGrace(noteData) {
  return Boolean(
    noteData.isGrace ||
    noteData.isTrillNote ||
    noteData.isTurnNote ||
    noteData.isMordentNote ||
    noteData.isTrillEnd
  )
}

// Staff 0 = right hand, Staff 1+ = left hand.
export function isNoteActiveForHands(noteData, activeHands) {
  return noteData.staffIndex === 0 ? activeHands.right : activeHands.left
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

export function extractNotesFromScore(osmdInstance) {
  if (!osmdInstance) {
    return { allNotes: [], playbackSequence: [] }
  }

  const sheet = osmdInstance.Sheet
  const sourceMeasures = sheet.SourceMeasures

  // Build the playback sequence (handles repeats and endings)
  const playbackSequence = buildPlaybackSequence(sourceMeasures)

  const { notesByMeasure, pedalEventsByMeasure, cursorStopsByMeasure } = extractNotesFromSourceMeasures(sourceMeasures)

  // Build allNotes array following the playback sequence
  const allNotes = []
  playbackSequence.forEach((seqItem, playbackIndex) => {
    const sourceNotes = notesByMeasure.get(seqItem.sourceMeasureIndex)
    if (!sourceNotes || sourceNotes.length === 0) return

    // Create a copy of the notes for this playback position
    // Each occurrence in the sequence needs independent played/active state
    const measureNotes = sourceNotes.map((noteData) => ({
      ...noteData,
      // Update timestamp to use playback index, preserving grace note adjustments
      // The offset within measure includes grace note timing adjustments
      timestamp: playbackIndex + (noteData.timestamp - noteData.measureIndex),
      // Keep reference to source measure for SVG highlighting
      sourceMeasureIndex: seqItem.sourceMeasureIndex,
      // Reset state for this occurrence
      active: false,
      played: false,
    }))

    const sourcePedalEvents = pedalEventsByMeasure.get(seqItem.sourceMeasureIndex)
    const pedalEvents = sourcePedalEvents?.map((event) => ({
      type: event.type,
      timestamp: playbackIndex + (event.timestamp - seqItem.sourceMeasureIndex),
    }))

    allNotes.push({
      measureIndex: playbackIndex,
      sourceMeasureIndex: seqItem.sourceMeasureIndex,
      notes: measureNotes,
      pedalEvents,
      cursorStops: cursorStopsByMeasure.get(seqItem.sourceMeasureIndex) ?? [],
    })
  })

  return { allNotes, playbackSequence }
}
