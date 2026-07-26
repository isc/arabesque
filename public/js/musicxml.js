import { noteName } from './midi.js'
import { traced, ENABLED as PERF_TRACE } from './perfTrace.js' // TEMP diagnostic
import {
  extractNotesFromScore as extractNotes,
  isNoteActiveForHands as isNoteActiveForHandsShared,
  sourceMeasuresToResetOnEntry,
  svgNoteheadFor,
} from './noteExtraction.js'
import { scrollSystemIntoView } from './utils.js'
import { arrayBufferToXml, isMusicXml } from './mxlLoader.js'
import { t } from './i18n.js'

let osmdInstance = null
let allNotes = []
let noteDataByKey = new Map() // Map<fingeringKey, noteData> for O(1) lookups
let playbackSequence = [] // Ordered list of source measure indices for playback (handles repeats)
let currentMeasureIndex = 0
let trainingMode = false
let targetRepeatCount = 3
let repeatCount = 0
let currentRepetitionIsClean = true
let currentSystemIndex = null
let measureClickRectangles = []
let playedSourceMeasures = new Set() // Track source measures that have been fully played

// Reinforcement mode variables
let reinforcementMode = false
let reinforcementMeasures = [] // List of sourceMeasureIndex to reinforce
let reinforcementIndex = 0 // Current index in reinforcementMeasures

// Set of MIDI note numbers currently held down by the player
let heldMidiNotes = new Set()

// Practice tracking variables
let measureStartTime = null
let measureWrongNotes = 0

// Padding around measure notes for clickable area
const MEASURE_CLICK_PADDING = 15

// Delay in ms before resetting measure progress in training mode
const TRAINING_RESET_DELAY_MS = 200

let callbacks = {
  onScoreCompleted: null,
  onNoteError: null,
  onTrainingComplete: null,
  onMeasureStarted: null,
  onMeasureCompleted: null,
  onWrongNote: null,
  onPlaythroughRestart: null,
  onReinforcementComplete: null,
  // Return true from this callback to bypass the default jumpToMeasure
  // (strict mode uses it to set its start point instead).
  onMeasureClicked: null,
}

// Hand selection: by default both hands are active
let activeHands = { right: true, left: true }

export function initMusicXML() {
  return {
    loadMusicXML,
    renderScore,
    renderMusicXML,
    extractNotesFromScore,
    // TEMP: the wrapper is chosen once, so with the probe off this hottest path
    // (every note on/off) builds no label string and no closure.
    activateNote: PERF_TRACE
      ? (m) => traced(`activateNote(${m}) m${currentMeasureIndex} held=${heldMidiNotes.size}`, () => activateNote(m))
      : activateNote,
    deactivateNote: PERF_TRACE
      ? (m) => traced(`deactivateNote(${m}) held=${heldMidiNotes.size}`, () => deactivateNote(m))
      : deactivateNote,
    resetProgress,
    setCallbacks,
    setActiveHands: (hands) => {
      activeHands = { ...activeHands, ...hands }
    },
    getOsmdInstance: () => osmdInstance,
    getAllNotes: () => allNotes,
    getScoreMetadata: () => ({
      title: osmdInstance?.Sheet?.Title?.text || null,
      composer: osmdInstance?.Sheet?.Composer?.text || null,
      totalMeasures: new Set(allNotes.map((m) => m.sourceMeasureIndex)).size,
    }),
    getTrainingState: () => ({
      trainingMode,
      currentMeasureIndex,
      repeatCount,
      targetRepeatCount,
    }),
    updateRepeatIndicators: () => updateRepeatIndicators(),
    setTrainingMode: (enabled) => {
      trainingMode = enabled
      repeatCount = 0
      currentMeasureIndex = 0
      currentRepetitionIsClean = true
      resetProgress()

      if (enabled) {
        updateMeasureCursor()
      } else {
        measureClickRectangles.forEach((rect) => rect.classList.remove('selected'))
        document.getElementById('repeat-indicators')?.remove()
      }
    },
    jumpToMeasure: (measureIndex) => jumpToMeasure(measureIndex),
    markStrictStartMeasure: (measureIndex) => {
      measureClickRectangles.forEach((rect) => rect.classList.remove('strict-start'))
      if (measureIndex == null) return
      measureClickRectangles[measureIndex]?.classList.add('strict-start')
    },
    setCurrentMeasureIndex: (index) => {
      currentMeasureIndex = index
    },
    getPlayedSourceMeasures: () => new Set(playedSourceMeasures),
    setPlayedSourceMeasures: (measures) => {
      playedSourceMeasures.clear()
      for (const m of measures) playedSourceMeasures.add(m)
    },
    resetMeasureProgress: () => {
      for (const measureData of allNotes) {
        for (const noteData of measureData.notes) {
          noteData.played = false
        }
      }
    },
    getNoteDataByKey: () => noteDataByKey,
    svgNote,
    svgNotehead,
    setReinforcementMode: (measures) => {
      if (!measures || measures.length === 0) return

      reinforcementMode = true
      reinforcementMeasures = measures.map((m) => m.sourceMeasureIndex)
      reinforcementIndex = 0

      // Enable training mode (resets repeatCount and currentRepetitionIsClean)
      trainingMode = true
      repeatCount = 0
      currentRepetitionIsClean = true

      // Jump to the first measure to reinforce
      const firstMeasure = reinforcementMeasures[0]
      const playbackIndex = allNotes.findIndex((m) => m.sourceMeasureIndex === firstMeasure)
      if (playbackIndex >= 0) {
        jumpToMeasure(playbackIndex)
        scrollToMeasure(playbackIndex)
      }
    },
  }
}

function resetReinforcementState() {
  reinforcementMode = false
  reinforcementMeasures = []
  reinforcementIndex = 0
}

function setCallbacks(cbs) {
  callbacks = { ...callbacks, ...cbs }
}

function isNoteActiveForHands(noteData) {
  return isNoteActiveForHandsShared(noteData, activeHands)
}

function resetPlaybackState() {
  currentMeasureIndex = 0
  repeatCount = 0
  currentRepetitionIsClean = true
  currentSystemIndex = null
  heldMidiNotes.clear()
  playedSourceMeasures.clear()
  measureStartTime = null
  measureWrongNotes = 0
  resetReinforcementState()
}

async function loadMusicXML(file) {
  if (!file) return

  try {
    // Handle both plain MusicXML (.xml/.musicxml) and zipped .mxl archives.
    const xmlContent = await arrayBufferToXml(await file.arrayBuffer())

    if (!isMusicXml(xmlContent)) {
      alert(t('errors.invalidMusicXml'))
      return
    }

    await renderMusicXML(xmlContent)
  } catch (error) {
    console.error('Erreur lors du chargement du MusicXML:', error)
    alert(t('errors.musicXmlLoad'))
  }
}

function renderScore() {
  if (!osmdInstance) return
  osmdInstance.render()
  disableInvisibleNoteClicks()
  extractNotesFromScore()
  setupMeasureClickHandlers()
}

// OSMD renders print-object="no" notes (e.g. the realized gruppetto written alongside
// the turn symbol in the Pathétique 2nd movement) with a fully transparent fill rather
// than removing them, to preserve layout. These invisible noteheads still capture clicks:
// OSMD's VexFlow patch tags the note/notehead groups with pointer-events="bounding-box",
// so they intercept clicks over their whole box (fill ignored) and steal them from the
// real note drawn underneath. We skip these notes during extraction, so they have no
// fingering entry and a click on them silently does nothing. Clear the attribute on the
// group and its tagged descendants so the click falls through to the visible note below.
function disableInvisibleNoteClicks() {
  for (const measure of osmdInstance.Sheet.SourceMeasures) {
    for (const container of measure.verticalSourceStaffEntryContainers || []) {
      for (const staffEntry of container.staffEntries || []) {
        for (const voiceEntry of staffEntry?.voiceEntries || []) {
          for (const note of voiceEntry.notes || []) {
            if (note.PrintObject !== false) continue
            const group = osmdInstance.rules.GNote(note)?.getSVGGElement?.()
            if (!group) continue
            group.setAttribute('pointer-events', 'none')
            group.querySelectorAll('[pointer-events]').forEach((el) => el.setAttribute('pointer-events', 'none'))
          }
        }
      }
    }
  }
}

async function renderMusicXML(xmlContent) {
  try {
    const scoreContainer = document.getElementById('score')
    const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(scoreContainer, {
      drawPartNames: false,
    })
    osmd.rules.MetronomeMarkYShift = -2.8;
    await osmd.load(xmlContent)
    osmdInstance = osmd
    window.osmdInstance = osmd
  } catch (error) {
    console.error('Erreur lors du rendu MusicXML avec OSMD:', error)
  }
}

function extractNotesFromScore() {
  trainingMode = false
  resetPlaybackState()

  const result = extractNotes(osmdInstance)
  allNotes = result.allNotes
  playbackSequence = result.playbackSequence
  // Build fingeringKey -> noteData map for O(1) lookups.
  // Ornament expansions create multiple notes with the same fingeringKey but noteheadIndex=-1.
  // Prefer entries with a valid noteheadIndex so fingering click handlers can match SVG noteheads.
  noteDataByKey.clear()
  for (const { notes } of allNotes) {
    for (const noteData of notes) {
      if (!noteDataByKey.has(noteData.fingeringKey) || noteData.noteheadIndex >= 0) {
        noteDataByKey.set(noteData.fingeringKey, noteData)
      }
    }
  }
}

function resetMeasureProgress(resetRepeatCount = true) {
  if (currentMeasureIndex >= allNotes.length) return

  const measureData = allNotes[currentMeasureIndex]
  if (!measureData) return

  for (const noteData of measureData.notes) {
    const notehead = svgNotehead(noteData)
    notehead?.classList.remove('played-note', 'active-note')
    noteData.played = false
    noteData.active = false
  }

  if (resetRepeatCount) repeatCount = 0
  currentRepetitionIsClean = true

  // Reset practice tracking for new attempt
  measureStartTime = Date.now()
  measureWrongNotes = 0
  callbacks.onMeasureStarted?.(measureData.sourceMeasureIndex)
}

// Reset the visual state (played-note class) for notes of a specific source measure
// This is used when repeating a measure due to repeat endings (voltas)
function resetSourceMeasureVisualState(sourceMeasureIndex) {
  for (const measureData of allNotes) {
    if (measureData.sourceMeasureIndex !== sourceMeasureIndex) continue
    for (const noteData of measureData.notes) {
      svgNotehead(noteData)?.classList.remove('played-note', 'active-note')
    }
  }
}

function updateMeasureCursor() {
  if (!osmdInstance) return

  document.getElementById('repeat-indicators')?.remove()

  if (!trainingMode || currentMeasureIndex >= allNotes.length) return

  measureClickRectangles.forEach((rect) => rect.classList.remove('selected'))

  const currentRect = measureClickRectangles[currentMeasureIndex]
  if (!currentRect) return

  currentRect.classList.add('selected')

  const measureData = allNotes[currentMeasureIndex]
  if (!measureData?.notes?.length) return

  const noteElements = measureData.notes.map((n) => svgNote(n.note))
  const svg = noteElements[0]?.ownerSVGElement
  if (svg) createRepeatIndicators(noteElements, svg)
}

function createRepeatIndicators(noteElements, svg) {
  const boxes = getBoundingBoxesForNotes(noteElements)

  if (boxes.length === 0) return

  const bounds = calculateCombinedBounds(boxes)
  const centerX = (bounds.minX + bounds.maxX) / 2
  const circleY = bounds.minY - 40
  const circleRadius = 6
  const circleSpacing = 18

  const indicatorsGroup = document.createElementNS('http://www.w3.org/2000/svg', 'g')
  indicatorsGroup.id = 'repeat-indicators'

  for (let i = 0; i < targetRepeatCount; i++) {
    const circle = document.createElementNS('http://www.w3.org/2000/svg', 'circle')
    const offsetX = (i - (targetRepeatCount - 1) / 2) * circleSpacing
    circle.setAttribute('cx', centerX + offsetX)
    circle.setAttribute('cy', circleY)
    circle.setAttribute('r', circleRadius)
    circle.className.baseVal = i < repeatCount ? 'repeat-indicator filled' : 'repeat-indicator'
    circle.dataset.index = i
    indicatorsGroup.appendChild(circle)
  }

  svg.appendChild(indicatorsGroup)
}

function updateRepeatIndicators() {
  if (!osmdInstance || !trainingMode) return

  const indicators = document.querySelectorAll('.repeat-indicator')
  indicators.forEach((circle, index) => {
    circle.classList.toggle('filled', index < repeatCount)
  })
}

function getBoundingBoxesForNotes(noteElements) {
  return noteElements
    .filter((el) => el?.getBBox)
    .map((el) => {
      try {
        return el.getBBox()
      } catch {
        return null
      }
    })
    .filter(Boolean)
}

// Walk up from each element to the nearest matching ancestor, deduping.
// Used to find the unique vf-measure groups (one per staff) that contain
// a measure's notes.
function uniqueAncestors(elements, selector) {
  const seen = new Set()
  for (const el of elements) {
    const ancestor = el.closest(selector)
    if (ancestor) seen.add(ancestor)
  }
  return [...seen]
}

// Bounding boxes of the 5 horizontal staff lines (per staff) inside each
// vf-measure that contains the given notes. VexFlow renders these as plain
// <path> elements with zero height (horizontal segments). We use them to
// stretch the measure highlight up to the top staff line / down to the
// bottom one, *without* picking up tempo markings, clefs, key signatures
// etc. that also live inside vf-measure but render above the staff.
function getStaffLineBoxes(noteElements) {
  const measureGroups = uniqueAncestors(noteElements, 'g.vf-measure')
  const boxes = []
  for (const m of measureGroups) {
    for (const child of m.children) {
      if (child.tagName !== 'path') continue
      try {
        const box = child.getBBox()
        if (box.height === 0 && box.width > 0) boxes.push(box)
      } catch { /* getBBox may throw on detached elements */ }
    }
  }
  return boxes
}

function calculateCombinedBounds(boxes) {
  return {
    minX: Math.min(...boxes.map((b) => b.x)),
    minY: Math.min(...boxes.map((b) => b.y)),
    maxX: Math.max(...boxes.map((b) => b.x + b.width)),
    maxY: Math.max(...boxes.map((b) => b.y + b.height)),
  }
}

// Vertical breathing room above/below the staff so the repeat-count
// circles (drawn ~40px above the topmost note) sit clearly outside the
// rect, and so ledger-line notes don't sit flush against the rect edge.
const MEASURE_V_PADDING = 12

// Pure geometry for the measure click rect.
// Horizontal padding is intentionally asymmetric (PADDING left, PADDING/2
// right): bar lines sit immediately after the last note, so a wide right
// padding would visually cross into the next measure.
// width/height are clamped to >= 0: during a render/resize, getBBox() can
// briefly return inverted bounds (maxX < minX), which would otherwise produce
// a negative-size <rect> that the browser rejects with a console error (and
// intermittently leaves a measure without a click area).
export function measureClickRectDimensions(bounds) {
  return {
    x: bounds.minX - MEASURE_CLICK_PADDING,
    y: bounds.minY - MEASURE_V_PADDING,
    width: Math.max(0, bounds.maxX - bounds.minX + MEASURE_CLICK_PADDING * 1.5),
    height: Math.max(0, bounds.maxY - bounds.minY + MEASURE_V_PADDING * 2),
  }
}

function createMeasureRectangle(svg, bounds, measureIndex) {
  const rect = document.createElementNS('http://www.w3.org/2000/svg', 'rect')
  rect.classList.add('measure-click-area')
  const { x, y, width, height } = measureClickRectDimensions(bounds)
  rect.setAttribute('x', x)
  rect.setAttribute('y', y)
  rect.setAttribute('width', width)
  rect.setAttribute('height', height)
  rect.dataset.measureIndex = measureIndex

  return rect
}

let measureDelegatedHandlerAttached = false

function setupMeasureClickHandlers() {
  if (!osmdInstance || allNotes.length === 0) return

  removeMeasureClickHandlers()

  if (!measureDelegatedHandlerAttached) {
    measureDelegatedHandlerAttached = true

    const scoreContainer = document.getElementById('score')
    if (scoreContainer) {
      scoreContainer.addEventListener('click', (e) => {
        const rect = e.target.closest('.measure-click-area')
        if (!rect) return

        const measureIndex = parseInt(rect.dataset.measureIndex, 10)
        if (isNaN(measureIndex)) return
        if (callbacks.onMeasureClicked?.(measureIndex)) return
        jumpToMeasure(measureIndex)
      })
    }
  }

  const rectsBySvg = new Map()

  allNotes.forEach((measureData, measureIndex) => {
    if (!measureData?.notes?.length) return

    const noteElements = measureData.notes.map((n) => svgNote(n.note))
    const noteBoxes = getBoundingBoxesForNotes(noteElements)
    if (noteBoxes.length === 0) return

    const svg = noteElements[0].ownerSVGElement
    if (!svg) return

    // Horizontal bounds come from the noteheads (so the rect hugs the
    // notes). Vertical bounds are the union of the noteheads (catches
    // low ledger-line notes below the bass staff) and the actual staff
    // lines (so the top of the rect reaches the top staff line even
    // when no note sits up there).
    const hBounds = calculateCombinedBounds(noteBoxes)
    const staffBoxes = getStaffLineBoxes(noteElements)
    const vBounds = calculateCombinedBounds([...noteBoxes, ...staffBoxes])
    const bounds = { minX: hBounds.minX, maxX: hBounds.maxX, minY: vBounds.minY, maxY: vBounds.maxY }
    const rect = createMeasureRectangle(svg, bounds, measureIndex)

    if (!rectsBySvg.has(svg)) rectsBySvg.set(svg, [])
    rectsBySvg.get(svg).push(rect)
    measureClickRectangles.push(rect)
  })

  for (const [svg, rects] of rectsBySvg) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.classList.add('measure-click-areas')
    rects.forEach((rect) => group.appendChild(rect))
    svg.insertBefore(group, svg.firstChild)
  }
}

function removeMeasureClickHandlers() {
  document.querySelectorAll('g.measure-click-areas').forEach((g) => g.remove())
  measureClickRectangles = []
}

function jumpToMeasure(measureIndex) {
  if (measureIndex < 0 || measureIndex >= allNotes.length) return
  currentMeasureIndex = measureIndex
  // Don't clear playedSourceMeasures - we want to track all measures played across jumps
  resetNotesFromIndex(measureIndex)
  resetMeasureProgress()
  updateMeasureCursor()
  updateRepeatIndicators()
  // Notify tracker that user is restarting from measure 0
  if (measureIndex === 0) {
    callbacks.onPlaythroughRestart?.()
  }
}

function scrollToMeasure(measureIndex) {
  const rect = measureClickRectangles[measureIndex]
  if (!rect) return

  // Anchor on the system's top staff line (matching the playback cursor) rather
  // than the measure rect, whose top tracks the noteheads and can sit well below
  // the staff — that left the top staff clipped under the sticky bars when the
  // repeat jumped back to the top.
  const note = allNotes[measureIndex]?.notes?.[0]?.note
  const referenceTop = systemTopStaffLineY(note) ?? rect.getBoundingClientRect().top
  scrollSystemIntoView(referenceTop, rect.ownerSVGElement)
}

// A held key can't be re-struck. A note is covered by a currently-held key when a tie
// holds that pitch across this timestamp - either the note is itself the tie continuation,
// or it's a unison with a tie continuation in another voice (e.g. a triplet note on the
// same pitch as a tied bass note). In both cases the held key validates it without a fresh press.
export function isHeldByTie(note, notesAtTimestamp, heldMidiNotes) {
  return (
    heldMidiNotes.has(note.midiNumber) &&
    notesAtTimestamp.some((o) => o.isTieContinuation && o.midiNumber === note.midiNumber)
  )
}

// Activate a note when pressed (Note ON) - for polyphonic validation
function activateNote(midiNote) {
  // Track all held notes globally (for tie continuation validation)
  heldMidiNotes.add(midiNote)

  if (!osmdInstance || allNotes.length === 0) return false
  if (currentMeasureIndex >= allNotes.length) return false

  const measureData = allNotes[currentMeasureIndex]
  if (!measureData || !measureData.notes || measureData.notes.length === 0) return false

  // Filter notes by active hands
  const activeNotes = measureData.notes.filter((n) => isNoteActiveForHands(n))
  let expectedNote = activeNotes.find((n) => !n.played && !n.active)
  if (!expectedNote) return false

  // Handle trill sentinel: allow free alternation between trillMidi and trillUpperMidi.
  // The sentinel is consumed when the player presses the next real note after the trill.
  if (expectedNote.isTrillEnd) {
    const { trillMidi, trillUpperMidi } = expectedNote
    const isTrillNote = midiNote === trillMidi || midiNote === trillUpperMidi

    // Find the next non-sentinel note to decide whether the trill should end
    const nextAfterTrill = activeNotes.find(
      (n) => n !== expectedNote && !n.played && !n.active,
    )

    if (!nextAfterTrill) {
      // Trill is the last thing in the measure -- any trill note completes it
      if (isTrillNote) {
        expectedNote.played = true
        handleNoteValidated(measureData, expectedNote, 1)
        return true
      }
      // Wrong note: fall through to normal matching (will report error)
    } else {
      // Check if the pressed note matches what comes after the trill
      const endsTrillWithNextNote = activeNotes.some(
        (n) =>
          !n.played &&
          !n.active &&
          !n.isTrillEnd &&
          n.timestamp === nextAfterTrill.timestamp &&
          n.midiNumber === midiNote,
      )

      if (endsTrillWithNextNote) {
        // End trill: skip sentinel, fall through to normal validation
        expectedNote.played = true
        expectedNote = activeNotes.find((n) => !n.played && !n.active)
      } else if (isTrillNote) {
        return true // Trill continuation, no advancement
      }
      // Wrong note: fall through to normal matching (will report error)
    }
  }

  const expectedTimestamp = expectedNote.timestamp

  // Find all notes at the expected timestamp with the matching MIDI number (not yet played or active)
  // Only consider notes from active hands
  const matchingIndices = []
  for (let i = 0; i < measureData.notes.length; i++) {
    const noteData = measureData.notes[i]
    if (
      isNoteActiveForHands(noteData) &&
      !noteData.played &&
      !noteData.active &&
      noteData.timestamp === expectedTimestamp &&
      noteData.midiNumber === midiNote
    ) {
      matchingIndices.push(i)
    }
  }

  if (matchingIndices.length === 0) {
    // Wrong note - mark repetition as dirty in training mode
    if (trainingMode) currentRepetitionIsClean = false

    // Initialize practice tracking on first wrong note if not already set
    if (measureStartTime === null) {
      measureStartTime = Date.now()
      measureWrongNotes = 0
      callbacks.onMeasureStarted?.(measureData.sourceMeasureIndex)
    }

    measureWrongNotes++
    callbacks.onWrongNote?.()

    const expected = activeNotes.find((n) => !n.played && !n.active)
    if (expected) callbacks.onNoteError?.(expected.noteName, noteName(midiNote))
    return false
  }

  // Mark matching notes as active (highlighted but not validated yet)
  for (const index of matchingIndices) {
    const noteData = measureData.notes[index]
    svgNotehead(noteData)?.classList.add('active-note')
    noteData.active = true
  }

  // Check if ALL notes at this timestamp are now active (only for active hands)
  // For tie continuations, check if the MIDI note is currently held instead of requiring activation
  const notesAtTimestamp = measureData.notes.filter(
    (n) => n.timestamp === expectedTimestamp && isNoteActiveForHands(n),
  )
  const allActiveAtTimestamp = notesAtTimestamp.every(
    (n) => n.played || n.active || isHeldByTie(n, notesAtTimestamp, heldMidiNotes),
  )

  if (allActiveAtTimestamp) {
    // All polyphonic notes are held together - validate them all
    markTimestampGroupPlayed(notesAtTimestamp)
    handleNoteValidated(measureData, notesAtTimestamp[0], notesAtTimestamp.length)
    // A held tie can fully cover a *later* timestamp (the tied pitch plus its
    // same-pitch unisons in other voices). No fresh keypress can trigger that
    // group, so cascade those validations here instead of stalling.
    traced('cascadeHeldTieValidations', cascadeHeldTieValidations) // TEMP
  }

  return true
}

// Mark every note in a timestamp group as played (validated), updating noteheads.
function markTimestampGroupPlayed(group) {
  for (const noteData of group) {
    if (noteData.played) continue
    const notehead = svgNotehead(noteData)
    // Turn notes without visual noteheads (noteheadIndex = -1) have no element
    notehead?.classList.remove('active-note')
    notehead?.classList.add('played-note')
    noteData.played = true
    noteData.active = false
  }
}

// After a timestamp validates, a following timestamp may consist entirely of
// notes already covered by currently-held ties - the tied pitch plus its
// same-pitch unisons in other voices (e.g. the final-measure triplet B in unison
// with a tied B). The key is already down for the tie, so no fresh keypress can
// trigger that group; the matcher would stall and force a re-strike. Auto-validate
// any such fully-covered groups, cascading across measure boundaries.
function cascadeHeldTieValidations() {
  for (;;) {
    const measureData = allNotes[currentMeasureIndex]
    if (!measureData?.notes?.length) return

    const pending = measureData.notes.filter((n) => isNoteActiveForHands(n) && !n.played)
    if (pending.length === 0) return

    const nextTimestamp = Math.min(...pending.map((n) => n.timestamp))
    const group = measureData.notes.filter(
      (n) => isNoteActiveForHands(n) && n.timestamp === nextTimestamp,
    )
    // Only auto-advance when every note is already held by a tie - otherwise the
    // player still owes a fresh keypress for this group.
    if (!group.every((n) => n.played || isHeldByTie(n, group, heldMidiNotes))) return

    markTimestampGroupPlayed(group)
    handleNoteValidated(measureData, group[0], group.length)
  }
}

// Deactivate a note when released (Note OFF) - for polyphonic validation
function deactivateNote(midiNote) {
  // Remove from held notes set
  heldMidiNotes.delete(midiNote)

  if (!osmdInstance || allNotes.length === 0) return
  if (currentMeasureIndex >= allNotes.length) return

  const measureData = allNotes[currentMeasureIndex]
  if (!measureData || !measureData.notes || measureData.notes.length === 0) return

  // Find active notes with this MIDI number and deactivate them
  for (const noteData of measureData.notes) {
    if (noteData.active && noteData.midiNumber === midiNote) {
      svgNotehead(noteData)?.classList.remove('active-note')
      noteData.active = false
    }
  }
}

// Scroll to next measure if it's on a different system, positioning it near the top
function scrollToNextMeasureIfNeeded(nextIndex) {
  if (nextIndex >= allNotes.length) return

  const nextMeasureData = allNotes[nextIndex]
  if (!nextMeasureData || !nextMeasureData.notes || nextMeasureData.notes.length === 0) return

  const nextMeasureFirstNote = nextMeasureData.notes[0].note
  const nextSystemIndex = getSystemIndexForNote(nextMeasureFirstNote)

  if (currentSystemIndex !== null && nextSystemIndex !== currentSystemIndex) {
    scrollToMeasure(nextIndex)
    currentSystemIndex = nextSystemIndex
  }
}

// Helper function to handle post-validation logic (scroll, measure completion)
function handleNoteValidated(measureData, noteData, validatedCount) {
  // Initialize system tracking on first note of first measure
  const playedCount = measureData.notes.filter((n) => n.played).length
  const isFirstNoteOfMeasure = playedCount === validatedCount

  if (isFirstNoteOfMeasure) {
    // Initialize/update system tracking on first note of each measure
    const noteSystemIndex = getSystemIndexForNote(noteData.note)
    currentSystemIndex = noteSystemIndex

    // Initialize practice tracking if not already set
    if (measureStartTime === null) {
      measureStartTime = Date.now()
      measureWrongNotes = 0
      callbacks.onMeasureStarted?.(measureData.sourceMeasureIndex)
    }
  }

  // Only consider notes from active hands when checking if measure is complete
  const activeNotesInMeasure = measureData.notes.filter((n) => isNoteActiveForHands(n))
  const allNotesPlayed = activeNotesInMeasure.every((note) => note.played)

  if (allNotesPlayed) {
    // Notify practice tracking that measure is completed
    const attemptDuration = measureStartTime ? Date.now() - measureStartTime : 0
    callbacks.onMeasureCompleted?.({
      sourceMeasureIndex: measureData.sourceMeasureIndex,
      durationMs: attemptDuration,
      wrongNotes: measureWrongNotes,
      clean: currentRepetitionIsClean,
    })

    if (trainingMode) {
      if (currentRepetitionIsClean) {
        repeatCount++
      }
      updateRepeatIndicators()

      if (repeatCount >= targetRepeatCount) {
        if (reinforcementMode) {
          reinforcementIndex++
          if (reinforcementIndex >= reinforcementMeasures.length) {
            // All reinforcement measures completed
            resetReinforcementState()
            callbacks.onReinforcementComplete?.()
          } else {
            // Go to the next measure to reinforce
            const nextSourceMeasure = reinforcementMeasures[reinforcementIndex]
            const nextPlaybackIndex = allNotes.findIndex((m) => m.sourceMeasureIndex === nextSourceMeasure)
            setTimeout(() => {
              resetMeasureProgress()
              jumpToMeasure(nextPlaybackIndex)
              scrollToMeasure(nextPlaybackIndex)
            }, TRAINING_RESET_DELAY_MS)
          }
        } else if (currentMeasureIndex + 1 >= allNotes.length) {
          callbacks.onTrainingComplete?.()
          setTimeout(() => {
            resetProgress()
          }, TRAINING_RESET_DELAY_MS)
        } else {
          setTimeout(() => {
            resetMeasureProgress()
            // Scroll to next measure before incrementing
            scrollToNextMeasureIfNeeded(currentMeasureIndex + 1)
            currentMeasureIndex++
            updateMeasureCursor()
            updateRepeatIndicators()
          }, TRAINING_RESET_DELAY_MS)
        }
      } else {
        setTimeout(() => {
          resetMeasureProgress(false)
          updateRepeatIndicators()
        }, TRAINING_RESET_DELAY_MS)
      }
    } else {
      // Mark current source measure as played
      const currentSourceMeasure = measureData.sourceMeasureIndex
      playedSourceMeasures.add(currentSourceMeasure)

      if (currentMeasureIndex + 1 < allNotes.length) {
        const toReset = sourceMeasuresToResetOnEntry(
          allNotes,
          currentMeasureIndex,
          playedSourceMeasures,
        )
        for (const sourceMeasureIndex of toReset) {
          resetSourceMeasureVisualState(sourceMeasureIndex)
        }
        // Scroll to next measure before incrementing
        scrollToNextMeasureIfNeeded(currentMeasureIndex + 1)
        currentMeasureIndex++
        // Reset practice tracking for next measure in free mode
        measureStartTime = null
        measureWrongNotes = 0
      } else {
        // Only trigger completion if all unique source measures were played
        const allSourceMeasures = new Set(allNotes.map((m) => m.sourceMeasureIndex))
        const allMeasuresPlayed = [...allSourceMeasures].every((sm) => playedSourceMeasures.has(sm))
        if (allMeasuresPlayed) {
          callbacks.onScoreCompleted?.(currentMeasureIndex)
        }
        setTimeout(() => {
          resetProgress()
        }, TRAINING_RESET_DELAY_MS)
      }
    }
  }
}

function svgNote(note) {
  return osmdInstance.rules.GNote(note).getSVGGElement()
}

function svgNotehead(noteData) {
  return svgNoteheadFor(osmdInstance, noteData)
}

// Navigate up the OSMD hierarchy: note → parentVoiceEntry → parentStaffEntry → parentMeasure.
function graphicalMeasureForNote(note) {
  return osmdInstance.rules.GNote(note).parentVoiceEntry.parentStaffEntry.parentMeasure
}

// Viewport-space Y of the top staff line of the system that contains `note`.
// The playback cursor's top sits exactly on this line, so anchoring measure-mode
// autoscroll here makes free MIDI mode and free playback (écoute) scroll
// identically — the measure rect's own top tracks the noteheads and can sit well
// below the staff, which left the top staff clipped under the sticky bars when
// jumping back to the top on a repeat. Returns null if the OSMD lookup fails.
function systemTopStaffLineY(note) {
  try {
    const system = graphicalMeasureForNote(note).parentMusicSystem
    const svgY = system.graphicalMeasures[0][0].stave.getYForLine(0)
    const svg = svgNote(note).ownerSVGElement
    const point = svg.createSVGPoint()
    point.y = svgY
    return point.matrixTransform(svg.getScreenCTM()).y
  } catch {
    return null
  }
}

function getSystemIndexForNote(note) {
  try {
    const parentMeasure = graphicalMeasureForNote(note)

    // Find which MusicSystem contains this measure (MusicSystems are in the first music page)
    const musicSystems = osmdInstance.graphic.musicPages[0].MusicSystems

    // Search for the measure in all systems
    for (let i = 0; i < musicSystems.length; i++) {
      const system = musicSystems[i]
      if (!system.graphicalMeasures) continue

      // graphicalMeasures is a 2D array: [staffIndex][measureIndex]
      for (const measureList of system.graphicalMeasures) {
        if (measureList?.includes(parentMeasure)) {
          return i
        }
      }
    }

    return 0
  } catch (error) {
    console.warn('Failed to get system index for note:', error)
    return 0
  }
}

function resetNotesFromIndex(fromIndex = 0) {
  for (let i = fromIndex; i < allNotes.length; i++) {
    const measureData = allNotes[i]
    if (!measureData) continue
    for (const noteData of measureData.notes) {
      const notehead = svgNotehead(noteData)
      if (notehead) {
        notehead.classList.remove('played-note', 'active-note')
      }
      noteData.played = false
      noteData.active = false
    }
  }
}

function resetProgress() {
  if (!osmdInstance) return
  resetNotesFromIndex()
  resetPlaybackState()
}
