import { traced, ENABLED as PERF_TRACE } from './perfTrace.js' // TEMP diagnostic
import {
  extractNotesFromScore as extractNotes,
  isNoteActiveForHands as isNoteActiveForHandsShared,
  sourceMeasuresToResetOnEntry,
  nextPlayableMeasure,
  firstPassMeasureIndexes,
  firstPassIndexOf,
  svgNoteheadFor,
  carryOverNoteStates,
} from './noteExtraction.js'
import { scrollSystemIntoView } from './utils.js'
import { arrayBufferToXml, isMusicXml } from './mxlLoader.js'
import { stripPlaybackTempoMarks } from './tempoMarks.js'
import { t } from './i18n.js'

let osmdInstance = null
let allNotes = []
// Raised by a sheet coming in and lowered by the note-model rebuild that
// follows it — the one rebuild that starts a session, where every later one
// only redraws a score already up (see extractNotesFromScore).
let sheetJustLoaded = false
let noteDataByKey = new Map() // Map<fingeringKey, noteData> for O(1) lookups
let playbackSequence = [] // Ordered list of source measure indices for playback (handles repeats)
let currentMeasureIndex = 0
let trainingMode = false
let targetRepeatCount = 3
let repeatCount = 0
// Whether the traversal of the passage under way is still flawless — one
// measure's worth of it by default, the whole passage when a range is picked.
let currentRepetitionIsClean = true
// The passage training mode works on, as playback indices. A null end is the
// shape training has always had and is still the default: the passage is the
// single measure under the cursor, and filling its dots moves the work one bar
// down the score. A range picked on the sheet bounds it instead, and a
// repetition is then one traversal of the whole thing — which is what puts the
// joins between its measures, and the slurs across them, inside the work.
let trainingStart = 0
let trainingEnd = null
let currentSystemIndex = null
// One click rectangle per source measure: a repeated measure is drawn once,
// so the passes must share a rect instead of stacking identical ones.
const measureClickRectangles = new Map()
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

// A mistake used to leave no trace at all: the repetition was silently spoiled
// and the player, seeing the dot refuse to fill, had no way to know a stray key
// had counted as an extra note. The notehead they owed lights up for a moment
// instead. The duration lives in the stylesheet, next to the colour, and the
// end of the animation takes the class back off; the reset paths clear it too,
// alongside the played/active classes, in case no animation ever ran.
function flashWrongNote(noteData) {
  const notehead = svgNotehead(noteData)
  if (!notehead || notehead.classList.contains('wrong-note')) return

  notehead.classList.add('wrong-note')
  notehead.addEventListener('animationend', () => notehead.classList.remove('wrong-note'), {
    once: true,
  })
}

let callbacks = {
  onScoreCompleted: null,
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
    relayoutScore: () => renderScore({ reextract: false }),
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
      // Dropping a hand can leave the cursor on a measure only that hand plays.
      const landing = cursorMeasureFor(currentMeasureIndex)
      if (landing === currentMeasureIndex) return
      currentMeasureIndex = landing
      updateMeasureCursor()
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
    // The training cursor and repeat dots live in the SVG, so a redraw takes
    // them with it. No-op outside training mode.
    updateMeasureCursor: () => updateMeasureCursor(),
    setTrainingMode: (enabled) => {
      trainingMode = enabled
      repeatCount = 0
      currentRepetitionIsClean = true
      resetProgress()

      if (enabled) {
        updateMeasureCursor()
      } else {
        clearMeasureClasses('selected', 'training-range')
        document.getElementById('repeat-indicators')?.remove()
      }
    },
    // The passage to work: from `start` to `end` inclusive, or — with `end`
    // null — the single measure at `start`, the work then moving on down the
    // score bar by bar. Either way it starts from the top of the passage with
    // no dot banked, so picking one is always a fresh count of three.
    setTrainingRange: (start, end = null) => {
      // Normalised against the active hands: a passage whose first bar the one
      // ticked hand rests through starts where that hand actually plays, and
      // never after its own end.
      trainingStart = cursorMeasureFor(start)
      trainingEnd = end == null ? null : Math.max(trainingStart, end)
      // Closing a passage on its second click leaves the cursor where the first
      // one already put it. The dots still start over, but none of
      // jumpToMeasure's score-wide clearing is owed for shading a few bars.
      if (trainingStart === currentMeasureIndex) {
        resetMeasureProgress()
        updateMeasureCursor()
      } else {
        jumpToMeasure(trainingStart)
      }
      // The normalised pair, so the page can show the passage the engine is
      // actually working rather than the raw indices it clicked.
      return { start: trainingStart, end: trainingEnd }
    },
    jumpToMeasure: (measureIndex) => jumpToMeasure(measureIndex),
    // Marks where a strict run starts — or, for a looped passage with an end,
    // shades the measures it covers up to `endIndex` (inclusive), which says
    // where it starts as well. Null clears both.
    markStrictRange: (startIndex, endIndex = null) => {
      clearMeasureClasses('strict-start', 'strict-range')
      if (startIndex == null) return
      if (endIndex == null) {
        measureRect(startIndex)?.classList.add('strict-start')
        return
      }
      paintMeasureRange('strict-range', startIndex, endIndex)
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
      // Reinforcement brings its own list of measures to work, one at a time:
      // any passage the player had picked is not what is being drilled now.
      resetTrainingRange()

      // Enable training mode (resets repeatCount and currentRepetitionIsClean)
      trainingMode = true
      repeatCount = 0
      currentRepetitionIsClean = true

      // Jump to the first measure to reinforce
      const playbackIndex = firstPassIndexOf(allNotes, reinforcementMeasures[0])
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

// Back to the default passage: the single measure under the cursor, the work
// walking on down the score from there.
function resetTrainingRange() {
  trainingStart = 0
  trainingEnd = null
}

// The passage under work: playback indices, inclusive. `bounded` says the
// player picked it, so finishing it leaves it on the stand; unbounded, the
// passage is the measure under the cursor and finishing walks on down the score.
function trainingPassage() {
  if (trainingEnd == null) return { first: currentMeasureIndex, last: currentMeasureIndex, bounded: false }
  return { first: trainingStart, last: trainingEnd, bounded: true }
}

// What finishing the measure under the cursor does in training mode. A
// repetition is one traversal of the passage — `first` to `last`, which are the
// same measure until the player picks a range — and only a flawless traversal
// banks a dot. `next` is the measure the cursor would move to, already resolved
// against the active hands.
//
// Written apart from the engine because this is the whole of the rule: a single
// measure is the passage of length one, so the behaviour training has always
// had falls out of it rather than sitting beside it as a second case.
export function trainingStep({ next, first, last, bounded, banked, target, clean, measureCount }) {
  // Still inside the passage: the traversal carries on into the next measure
  // with the dots — and the wrong note two bars back — untouched. `next` is
  // always past `index`, so a one-measure passage never takes this branch.
  if (next <= last) return { action: 'step', to: next, banked }

  // The traversal is over. `banked` is what the dots should show for it —
  // emptying them is the move's business, a pause later, so that the dot just
  // earned fills where the player can see it.
  const filled = clean ? banked + 1 : banked
  // Short of the target, the passage starts again.
  if (filled < target) return { action: 'restart', to: first, banked: filled }
  // Every dot filled. A picked passage is done and stays on the stand for
  // another go; an unpicked one moves the work one measure down the score, and
  // ends with the score itself.
  if (bounded) return { action: 'passageDone', to: first, banked: filled }
  if (next >= measureCount) return { action: 'scoreDone', banked: filled }
  return { action: 'advance', to: next, banked: filled }
}

function setCallbacks(cbs) {
  callbacks = { ...callbacks, ...cbs }
}

function isNoteActiveForHands(noteData) {
  return isNoteActiveForHandsShared(noteData, activeHands)
}

function nextPlayable(from) {
  return nextPlayableMeasure(allNotes, from, activeHands)
}

// Where the cursor goes when it has to be somewhere: the last measure when the
// rest of the score has nothing for the active hands.
function cursorMeasureFor(from) {
  return Math.min(nextPlayable(from), Math.max(allNotes.length - 1, 0))
}

// True when the cursor sits where a run through the whole score begins. Not
// always its first measure: with one hand unticked, a score can open on a bar
// that hand rests through, and the run starts after it.
function atScoreStart() {
  return currentMeasureIndex === cursorMeasureFor(0)
}

// Callers must have `allNotes` for the current score in place: the cursor is
// placed on the first measure the active hands play, which reads them.
function resetPlaybackState() {
  repeatCount = 0
  currentRepetitionIsClean = true
  currentSystemIndex = null
  heldMidiNotes.clear()
  playedSourceMeasures.clear()
  currentMeasureIndex = cursorMeasureFor(0)
  measureStartTime = null
  measureWrongNotes = 0
  resetReinforcementState()
  resetTrainingRange()
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

// OSMD engraves the title block into the SVG at a size fixed in its own units
// (1 unit = 10px), so it never answers to the viewport: 40px of title is a tenth
// of a 1280px window and a third of a 390px phone, above 148px of header before
// the first staff. Scale the block with the container instead — but per rule,
// with its own floor: at the factor that brings the title down to a sensible 20px,
// the composer and arranger land on 10px, which is not readable.
//
// The font is not ours to change: OSMD 2.1.2 exposes a single DefaultFontFamily,
// which also draws dynamics, tempo marks and directions — all of which want the
// serif they have. Size is the only lever, and it is the one that was wrong.
const TITLE_RULES = {
  // rule:              [full size, floor]
  SheetTitleHeight:     [4.0, 2.0],
  SheetSubtitleHeight:  [2.0, 1.4],
  SheetComposerHeight:  [2.0, 1.4],
  SheetAuthorHeight:    [2.0, 1.4],
  TitleTopDistance:     [5.0, 2.0],
}
// The width at which the title is engraved at its full, OSMD-default size.
const FULL_TITLE_WIDTH = 900

// Called before every render, never only on the way down: the rules are a
// property of the OSMD instance and persist between renders, so a phone turned
// to landscape has to grow the title back as well as shrink it.
function scaleTitleBlock() {
  const width = document.getElementById('score')?.clientWidth || FULL_TITLE_WIDTH
  const scale = Math.min(1, width / FULL_TITLE_WIDTH)
  for (const [rule, [full, floor]] of Object.entries(TITLE_RULES)) {
    osmdInstance.rules[rule] = Math.max(floor, full * scale)
  }
}

// `reextract: false` re-draws at the container's current width without rebuilding
// the note model — nothing about the sheet changed, only the width it is laid out
// to. Either way the session is kept (see extractNotesFromScore) and the SVG
// elements are new, so the caller repaints the marks (app.js does it in
// repaintScore).
// `afterDraw` runs between the draw and the indexing, and is how the initial
// load gets the score on screen sooner: the fresh SVG is in the DOM once
// render() returns, but nothing is painted until the task ends, and indexing is
// a long task of its own — so the loader hands the frame back there. Re-renders
// pass nothing and stay synchronous throughout: they already have a score up,
// and an intermediate paint would only make it flicker. Keeping it a parameter
// rather than exporting the two halves means no caller can leave a score drawn
// but un-indexed (no allNotes, no measure click handlers).
async function renderScore({ reextract = true, afterDraw = null } = {}) {
  if (!osmdInstance) return
  scaleTitleBlock()
  osmdInstance.render()
  fixUpInvisibleNotes()
  if (afterDraw) await afterDraw()
  // Must precede setupMeasureClickHandlers, which reads allNotes.
  if (reextract) extractNotesFromScore()
  setupMeasureClickHandlers()
}

// Two fix-ups for the notes a score hides with print-object="no", both DOM work on the freshly
// drawn SVG: OSMD renders such notes with a fully transparent fill rather than removing them,
// to preserve layout, so their elements are all there to be adjusted.
//
// Clicks: an invisible notehead still captures them. OSMD's VexFlow patch tags the
// note/notehead groups with pointer-events="bounding-box", so they intercept clicks over
// their whole box (fill ignored) and steal them from the real note drawn underneath — e.g.
// the realized gruppetto written alongside the turn symbol in the Pathétique 2nd movement.
// We skip these notes during extraction, so they have no fingering entry and a click on them
// silently does nothing. Clearing the attribute on the group and its tagged descendants lets
// the click fall through to the visible note below.
//
// Ink: a note hidden only because another voice writes the same pitch at the same time — how
// MuseScore asks for one head to serve both voices — still gets its stem and its beam, which
// OSMD draws for it since our sharesNoteheadWithVisibleUnisonNote() fix upstream. Where the
// two heads cannot be merged, that leaves a beam hanging off a bare stem, so the head is
// inked back in — see unisonNoteheadPair() and areSideBySide(). Choosing the fill belongs
// upstream too, in the same routine that already spares the stem; reparenting the head does
// not, since the colouring it buys is ours.
function fixUpInvisibleNotes() {
  const groups = []
  const pairs = []
  for (const measure of osmdInstance.Sheet.SourceMeasures) {
    for (const container of measure.verticalSourceStaffEntryContainers || []) {
      for (const staffEntry of container.staffEntries || []) {
        for (const voiceEntry of staffEntry?.voiceEntries || []) {
          const notes = voiceEntry.notes || []
          for (let noteheadIndex = 0; noteheadIndex < notes.length; noteheadIndex++) {
            const note = notes[noteheadIndex]
            if (note.PrintObject !== false) continue
            const group = osmdInstance.rules.GNote(note)?.getSVGGElement?.()
            if (!group) continue
            groups.push(group)
            const pair = unisonNoteheadPair(note, noteheadIndex)
            if (pair) pairs.push(pair)
          }
        }
      }
    }
  }

  // Measure before touching anything: a getBBox() that follows a DOM write forces a layout
  // flush, and one per hidden note would re-lay the whole score dozens of times over. Same
  // read-then-write split as alignFingeringLabelsToNoteheads().
  const toReveal = pairs.filter(areSideBySide)

  for (const group of groups) {
    group.setAttribute('pointer-events', 'none')
    group.querySelectorAll('[pointer-events]').forEach((el) => el.setAttribute('pointer-events', 'none'))
  }
  // The head moves into the visible note's notehead group so the played/active colouring
  // reaches it: the CSS paints every path inside the group, so both heads light up together
  // under the single keypress that validates the pitch.
  for (const { hiddenPath, visibleHead, visiblePath } of toReveal) {
    hiddenPath.setAttribute('fill', visiblePath.getAttribute('fill'))
    visibleHead.appendChild(hiddenPath)
  }
}

// The head of an invisible note and the head of the visible unison it hides behind, or null
// when the note is not one of those unisons — OSMD's own sharesNoteheadWithVisibleUnisonNote()
// decides that, the predicate our upstream fix added and draws the stem and beam from. Only a
// beamed note has ink to account for: an unbeamed one keeps its stem and flag transparent, and
// a head on its own would be a note nobody plays.
function unisonNoteheadPair(note, noteheadIndex) {
  if (!note.NoteBeam || !note.sharesNoteheadWithVisibleUnisonNote?.()) return null
  const hiddenPath = svgNotehead({ note, noteheadIndex })?.querySelector('path')
  const visibleHead = visibleUnisonNotehead(note)
  const visiblePath = visibleHead?.querySelector('path')
  return hiddenPath && visiblePath ? { hiddenPath, visibleHead, visiblePath } : null
}

// The rendered notehead of the visible note another voice writes at the same pitch in the same
// staff entry — the one MuseScore means to serve both voices.
function visibleUnisonNotehead(note) {
  for (const other of note.ParentStaffEntry?.VoiceEntries ?? []) {
    if (other === note.ParentVoiceEntry || other.IsGrace) continue
    const noteheadIndex = (other.Notes ?? []).findIndex(
      (candidate) =>
        candidate.PrintObject &&
        candidate.Pitch?.FundamentalNote === note.Pitch.FundamentalNote &&
        candidate.Pitch?.Octave === note.Pitch.Octave,
    )
    if (noteheadIndex >= 0) return svgNotehead({ note: other.Notes[noteheadIndex], noteheadIndex })
  }
  return null
}

// Whether VexFlow gave the two heads places of their own rather than merging them into one.
// Merged heads report the exact same x, and the visible one is then all the ink both stems
// need — a second head on top of it would only overprint, a filled one hiding an open one.
function areSideBySide({ hiddenPath, visiblePath }) {
  const boxes = getBoundingBoxesForNotes([hiddenPath, visiblePath])
  // A head that cannot be measured (a detached or hidden SVG) is one we leave hidden.
  return boxes.length === 2 && Math.abs(boxes[0].x - boxes[1].x) >= 1
}

async function renderMusicXML(xmlContent) {
  try {
    const scoreContainer = document.getElementById('score')
    const osmd = new opensheetmusicdisplay.OpenSheetMusicDisplay(scoreContainer, {
      drawPartNames: false,
      // OSMD's autoResize re-renders behind our back, and the fresh SVG carries
      // none of the played/active notehead classes — so any window resize
      // silently wiped the player's progress (and left measureClickRectangles
      // pointing at detached nodes). We drive the re-layout ourselves instead,
      // see handleViewportResize() in app.js.
      autoResize: false,
    })
    osmd.rules.MetronomeMarkYShift = -2.8;
    await osmd.load(xmlContent)
    stripPlaybackTempoMarks(osmd.Sheet.SourceMeasures)
    osmdInstance = osmd
    window.osmdInstance = osmd
    sheetJustLoaded = true
  } catch (error) {
    console.error('Erreur lors du rendu MusicXML avec OSMD:', error)
  }
}

// Rebuilds the note model from the sheet OSMD holds — for a score just loaded,
// and again whenever one already up is redrawn from a sheet that changed under
// it (a fingering added or removed). Only the first starts a session: where the
// player stands in the piece is not a property of the drawing, so the training
// cursor, the repetitions banked, the reinforcement queue and the measures
// already played survive a rebuild. Entering a fingering used to wipe all of
// it, purple overlay and all. The per-note played/active flags are the one
// thing that cannot simply stay put — they live on the noteData objects the
// rebuild throws away — so they are carried over from the outgoing model,
// which extractNotes() leaves untouched.
function extractNotesFromScore() {
  const outgoingNotes = sheetJustLoaded ? null : allNotes
  sheetJustLoaded = false

  const result = extractNotes(osmdInstance)
  allNotes = result.allNotes
  if (outgoingNotes) {
    carryOverNoteStates(outgoingNotes, allNotes)
  } else {
    trainingMode = false
    resetPlaybackState()
  }
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

// Clears the measure under the cursor for another go at it. `keepRepeats` holds
// the dots already banked; `keepRepetition` says the traversal under way runs on
// into this measure — a step inside a passage rather than a fresh pass over it,
// so a wrong note two bars back still counts against it. `notesCleared` is for
// a caller that has just wiped a range reaching this measure: walking its
// noteheads again is a second DOM query per note for no change.
function resetMeasureProgress({ keepRepeats = false, keepRepetition = false, notesCleared = false } = {}) {
  if (currentMeasureIndex >= allNotes.length) return

  const measureData = allNotes[currentMeasureIndex]
  if (!measureData) return

  if (!notesCleared) resetNotesFromIndex(currentMeasureIndex, currentMeasureIndex)

  if (!keepRepeats) repeatCount = 0
  if (!keepRepetition) currentRepetitionIsClean = true

  // Reset practice tracking for new attempt
  measureStartTime = Date.now()
  measureWrongNotes = 0
  callbacks.onMeasureStarted?.(measureData.sourceMeasureIndex, atScoreStart())
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

  clearMeasureClasses('selected', 'training-range')

  // A picked passage is shaded whole, the measure under the cursor more
  // strongly — the same two-tone reading as strict mode's loop, so what is
  // being worked and where the player is in it are both visible at a glance.
  // Nothing to shade when the passage is just the cursor: `selected` says it.
  const { first, last, bounded } = trainingPassage()
  if (bounded) paintMeasureRange('training-range', first, last)

  const currentRect = measureRect(currentMeasureIndex)
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
    circle.className.baseVal = repeatIndicatorClass(i, repeatCount, currentRepetitionIsClean)
    circle.dataset.index = i
    indicatorsGroup.appendChild(circle)
  }

  svg.appendChild(indicatorsGroup)
}

// Classes for the dot at `index`: filled once its repetition is banked, red
// while the repetition under way is spoiled — only a flawless run fills a dot,
// and nothing else on screen says so.
export function repeatIndicatorClass(index, banked, clean) {
  if (index < banked) return 'repeat-indicator filled'
  if (index === banked && !clean) return 'repeat-indicator spoiled'
  return 'repeat-indicator'
}

function updateRepeatIndicators() {
  if (!osmdInstance || !trainingMode) return

  const indicators = document.getElementById('repeat-indicators')?.children ?? []
  for (let i = 0; i < indicators.length; i++) {
    indicators[i].className.baseVal = repeatIndicatorClass(i, repeatCount, currentRepetitionIsClean)
  }
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

// The rect drawn for a playback position, i.e. the one of the source measure
// it plays — the same rect for every pass through a repeated measure.
function measureRect(measureIndex) {
  const sourceMeasureIndex = allNotes[measureIndex]?.sourceMeasureIndex
  if (sourceMeasureIndex == null) return null
  return measureClickRectangles.get(sourceMeasureIndex)
}

// Strips `classes` off every measure rect. The rects are keyed by source
// measure, so a repeated bar is one rect however many times it is played.
function clearMeasureClasses(...classes) {
  measureClickRectangles.forEach((rect) => rect.classList.remove(...classes))
}

// Shades [from, to] inclusive. Strict mode's picked loop and training mode's
// passage are the same two-tone reading, so they are drawn by the same code.
function paintMeasureRange(className, from, to) {
  for (let i = from; i <= to; i++) measureRect(i)?.classList.add(className)
}

function createMeasureRectangle(bounds, measureIndex) {
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

  for (const measureIndex of firstPassMeasureIndexes(allNotes)) {
    const measureData = allNotes[measureIndex]
    const noteElements = measureData.notes.map((n) => svgNote(n.note))
    const noteBoxes = getBoundingBoxesForNotes(noteElements)
    if (noteBoxes.length === 0) continue

    const svg = noteElements[0].ownerSVGElement
    if (!svg) continue

    // Horizontal bounds come from the noteheads (so the rect hugs the
    // notes). Vertical bounds are the union of the noteheads (catches
    // low ledger-line notes below the bass staff) and the actual staff
    // lines (so the top of the rect reaches the top staff line even
    // when no note sits up there).
    const hBounds = calculateCombinedBounds(noteBoxes)
    const staffBoxes = getStaffLineBoxes(noteElements)
    const vBounds = calculateCombinedBounds([...noteBoxes, ...staffBoxes])
    const bounds = { minX: hBounds.minX, maxX: hBounds.maxX, minY: vBounds.minY, maxY: vBounds.maxY }
    const rect = createMeasureRectangle(bounds, measureIndex)

    if (!rectsBySvg.has(svg)) rectsBySvg.set(svg, [])
    rectsBySvg.get(svg).push(rect)
    measureClickRectangles.set(measureData.sourceMeasureIndex, rect)
  }

  for (const [svg, rects] of rectsBySvg) {
    const group = document.createElementNS('http://www.w3.org/2000/svg', 'g')
    group.classList.add('measure-click-areas')
    rects.forEach((rect) => group.appendChild(rect))
    svg.insertBefore(group, svg.firstChild)
  }
}

function removeMeasureClickHandlers() {
  document.querySelectorAll('g.measure-click-areas').forEach((g) => g.remove())
  measureClickRectangles.clear()
}

function jumpToMeasure(measureIndex) {
  if (measureIndex < 0 || measureIndex >= allNotes.length) return
  currentMeasureIndex = cursorMeasureFor(measureIndex)
  resetNotesFromIndex(measureIndex)
  resetMeasureProgress()
  updateMeasureCursor()
  updateRepeatIndicators()
  // A jump inside a run keeps the measures already played to its credit: going
  // back over a passage shouldn't cost the rest of the score. Landing on the
  // measure the run starts from is a new run instead, and the tracker restarts
  // its clock there — so what has been played starts over with it, or a couple
  // of measures could finish a score timed from the restart and top the
  // ranking. Not always measure 1: with one hand unticked the run starts after
  // the bars that hand rests through.
  if (atScoreStart()) {
    playedSourceMeasures.clear()
    callbacks.onPlaythroughRestart?.()
  }
}

function scrollToMeasure(measureIndex) {
  const rect = measureRect(measureIndex)
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
  // Strict mode asks the same musical question through requiredSequence /
  // advanceEvent (noteExtraction.js, strictMatching.js) and answers it more
  // tightly — strict alternation rather than either pitch in any order. The two
  // should become one rule; see the note over requiredSequence.
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
    // Wrong note - mark repetition as dirty in training mode, and redden its dot
    // right away rather than leaving the player to discover at the bar line that
    // it won't fill. Only the first wrong note of a repetition changes anything.
    if (trainingMode && currentRepetitionIsClean) {
      currentRepetitionIsClean = false
      updateRepeatIndicators()
    }

    // Initialize practice tracking on first wrong note if not already set
    if (measureStartTime === null) {
      measureStartTime = Date.now()
      measureWrongNotes = 0
      callbacks.onMeasureStarted?.(measureData.sourceMeasureIndex, atScoreStart())
    }

    measureWrongNotes++
    callbacks.onWrongNote?.()

    const expected = activeNotes.find((n) => !n.played && !n.active)
    if (expected) flashWrongNote(expected)
    return false
  }

  // Mark matching notes as active (highlighted but not validated yet)
  for (const index of matchingIndices) {
    const noteData = measureData.notes[index]
    // Drop any flash still running: the note the player owed has just arrived,
    // and it should read as played rather than stay red until the animation ends.
    const notehead = svgNotehead(noteData)
    notehead?.classList.remove('wrong-note')
    notehead?.classList.add('active-note')
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

// Moves the training cursor onto `to` and opens the measure there. What the
// passage lit is wiped first, from `clearFrom` to wherever the cursor had got
// to — a step further into a passage passes no `clearFrom` and leaves the
// measures behind it lit, the way free mode does. The cursor lands before the
// reset, so the attempt the journal opens is against the measure about to be
// played rather than the one just finished.
function moveTrainingCursorTo(to, { keepRepeats = false, clearFrom = null } = {}) {
  // The range always reaches `to`, so the landing measure is cleared here.
  const cleared = clearFrom != null
  if (cleared) resetNotesFromIndex(clearFrom, Math.max(currentMeasureIndex, to))
  scrollToNextMeasureIfNeeded(to)
  const moved = to !== currentMeasureIndex
  currentMeasureIndex = to
  // Wiping the passage and starting the traversal's verdict over are the same
  // decision: what clears the sheet clears the verdict with it.
  resetMeasureProgress({ keepRepeats, keepRepetition: !cleared, notesCleared: cleared })
  // A repetition in place — the common ending, twice in every three — leaves
  // the cursor and the shading exactly as they are, so only the dots need
  // saying. Rebuilding the cursor there costs a getBBox per notehead to draw
  // the same circles in the same spot.
  if (moved) updateMeasureCursor()
  else updateRepeatIndicators()
}

// A measure of the passage is over: bank it or move on, per trainingStep.
function advanceTraining() {
  const passage = trainingPassage()
  const { action, to, banked } = trainingStep({
    next: nextPlayable(currentMeasureIndex + 1),
    ...passage,
    banked: repeatCount,
    target: targetRepeatCount,
    clean: currentRepetitionIsClean,
    measureCount: allNotes.length,
  })
  // Set before the pause below, so the dot that has just been earned fills
  // where the player can see it rather than after the score has moved on.
  repeatCount = banked
  updateRepeatIndicators()

  if (action === 'scoreDone') {
    callbacks.onTrainingComplete?.()
    setTimeout(() => resetProgress(), TRAINING_RESET_DELAY_MS)
    return
  }
  if (action === 'passageDone') callbacks.onTrainingComplete?.()

  // A step further into the passage leaves the measures behind it lit and the
  // repetition's verdict standing. A finished traversal starts the passage over
  // from a dark sheet; only a passage that is done rather than merely spoiled
  // empties the dots.
  const options = action === 'step'
    ? { keepRepeats: true }
    : { keepRepeats: action === 'restart', clearFrom: passage.first }
  setTimeout(() => moveTrainingCursorTo(to, options), TRAINING_RESET_DELAY_MS)
}

// Reinforcement drills a list of measures, one at a time and three clean
// repetitions each — its own count, not a passage's.
function advanceReinforcement() {
  if (currentRepetitionIsClean) repeatCount++
  updateRepeatIndicators()

  if (repeatCount < targetRepeatCount) {
    setTimeout(() => moveTrainingCursorTo(currentMeasureIndex, { keepRepeats: true, clearFrom: currentMeasureIndex }), TRAINING_RESET_DELAY_MS)
    return
  }

  reinforcementIndex++
  if (reinforcementIndex >= reinforcementMeasures.length) {
    resetReinforcementState()
    callbacks.onReinforcementComplete?.()
    return
  }

  const nextPlaybackIndex = firstPassIndexOf(allNotes, reinforcementMeasures[reinforcementIndex])
  setTimeout(() => {
    resetMeasureProgress()
    jumpToMeasure(nextPlaybackIndex)
    scrollToMeasure(nextPlaybackIndex)
  }, TRAINING_RESET_DELAY_MS)
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
      callbacks.onMeasureStarted?.(measureData.sourceMeasureIndex, atScoreStart())
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
      // This measure's own verdict, not the passage's: a fumble in the third bar
      // of a passage spoils the repetition, but the first two were played clean
      // and the journal — and the measures it suggests reinforcing — must go on
      // saying so.
      clean: measureWrongNotes === 0,
    })

    if (trainingMode) {
      // Reinforcement drills its own list of measures one by one, so it banks a
      // dot per measure and moves down the list rather than over a passage.
      if (reinforcementMode) return advanceReinforcement()
      advanceTraining()
    } else {
      // Mark current source measure as played
      const currentSourceMeasure = measureData.sourceMeasureIndex
      playedSourceMeasures.add(currentSourceMeasure)

      const next = nextPlayable(currentMeasureIndex + 1)
      const toReset = sourceMeasuresToResetOnEntry(allNotes, currentMeasureIndex, next, playedSourceMeasures)

      if (next < allNotes.length) {
        for (const sourceMeasureIndex of toReset) {
          resetSourceMeasureVisualState(sourceMeasureIndex)
        }
        // Scroll to the next measure before moving onto it
        scrollToNextMeasureIfNeeded(next)
        currentMeasureIndex = next
        // Reset practice tracking for next measure in free mode
        measureStartTime = null
        measureWrongNotes = 0
      } else {
        // Complete when every source measure the active hands play has been
        // played. Derived from the hands rather than counted as we go, so a run
        // still adds up after the hand toggles moved mid-way through it.
        const owed = allNotes.filter((m) => m.notes.some(isNoteActiveForHands))
        const allMeasuresPlayed = owed.every((m) => playedSourceMeasures.has(m.sourceMeasureIndex))
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

function resetNotesFromIndex(fromIndex = 0, toIndex = allNotes.length - 1) {
  for (let i = fromIndex; i <= toIndex; i++) {
    const measureData = allNotes[i]
    if (!measureData) continue
    for (const noteData of measureData.notes) {
      const notehead = svgNotehead(noteData)
      if (notehead) {
        notehead.classList.remove('played-note', 'active-note', 'wrong-note')
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
