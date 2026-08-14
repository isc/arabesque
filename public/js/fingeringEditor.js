// Restore played/active state captured positionally as savedStates[measureIndex][noteIndex].
// Restoring by playback position (rather than by fingeringKey) keeps the two occurrences of
// a repeated measure independent: they share a fingeringKey, so a key-based restore would
// bleed the first pass's "played" state onto the repeat and make the matcher skip it.
export function applyPositionalNoteStates(allNotes, savedStates) {
  for (let i = 0; i < allNotes.length && i < savedStates.length; i++) {
    const measureStates = savedStates[i]
    if (!measureStates) continue
    allNotes[i].notes.forEach((noteData, j) => {
      if (!measureStates[j]) return
      noteData.played = measureStates[j].played
      noteData.active = measureStates[j].active
    })
  }
}

// Of two occurrences of the same note, which one belongs to the "current pass"? The latest
// occurrence at or before the cursor; or, if neither has been reached yet, the earliest upcoming.
function isCurrentPassOccurrence(index, otherIndex, currentMeasureIndex) {
  const indexReached = index <= currentMeasureIndex
  const otherReached = otherIndex <= currentMeasureIndex
  if (indexReached !== otherReached) return indexReached // a reached occurrence beats an upcoming one
  return indexReached ? index > otherIndex : index < otherIndex
}

// A source note is rendered once but may appear several times in the playback sequence
// (repeats). Its single notehead should reflect the current pass's occurrence.
// Returns Map<fingeringKey, noteData>.
export function chooseCurrentPassOccurrences(allNotes, currentMeasureIndex) {
  const chosen = new Map() // fingeringKey -> { index, noteData }
  allNotes.forEach(({ notes }, i) => {
    for (const noteData of notes) {
      const prev = chosen.get(noteData.fingeringKey)
      if (!prev || isCurrentPassOccurrence(i, prev.index, currentMeasureIndex)) {
        chosen.set(noteData.fingeringKey, { index: i, noteData })
      }
    }
  })
  const result = new Map()
  for (const [key, { noteData }] of chosen) result.set(key, noteData)
  return result
}

export function initFingeringEditor({ getOsmdInstance, getAllNotes, getNoteDataByKey, svgNote, svgNotehead }) {
  let onNoteClick = null
  let delegatedHandlerAttached = false

  // Build a map from SVG group ID to noteData array by iterating through SourceMeasures.
  // Uses OSMD's GNote lookup on fresh SourceNote objects (more reliable than noteData.note from allNotes).
  // Returns Map<svgId, noteData[]> to handle chords (multiple notes per SVG group).
  function buildSvgIdToNoteDataMap() {
    const osmdInstance = getOsmdInstance()
    const noteDataByKeyMap = getNoteDataByKey()
    const svgIdToNoteDatas = new Map()

    for (const measure of osmdInstance.Sheet.SourceMeasures) {
      const measureNumber = measure.MeasureNumberXML
      const noteCounters = new Map()

      for (const container of measure.verticalSourceStaffEntryContainers || []) {
        if (!container.staffEntries) continue

        for (let staffIndex = 0; staffIndex < container.staffEntries.length; staffIndex++) {
          const staffEntry = container.staffEntries[staffIndex]
          if (!staffEntry?.voiceEntries) continue

          for (const voiceEntry of staffEntry.voiceEntries) {
            if (!voiceEntry.notes) continue

            const voiceIndex = (voiceEntry.ParentVoice?.VoiceId ?? 1) - 1

            for (const note of voiceEntry.notes) {
              if (!note.pitch || note.isRest?.()) continue

              const counterKey = `${staffIndex}:${voiceIndex}`
              const seqIdx = noteCounters.get(counterKey) ?? 0
              noteCounters.set(counterKey, seqIdx + 1)

              const fingeringKey = `${measureNumber}:${staffIndex}:${voiceIndex}:${seqIdx}`
              const svgGroup = osmdInstance.rules.GNote(note)?.getSVGGElement?.()
              if (!svgGroup?.id) continue

              const noteData = noteDataByKeyMap.get(fingeringKey)
              if (noteData) {
                if (!svgIdToNoteDatas.has(svgGroup.id)) {
                  svgIdToNoteDatas.set(svgGroup.id, [])
                }
                svgIdToNoteDatas.get(svgGroup.id).push(noteData)
              }
            }
          }
        }
      }
    }

    return svgIdToNoteDatas
  }

  function setupFingeringClickHandlers(cbs) {
    onNoteClick = cbs.onNoteClick

    if (delegatedHandlerAttached) return
    delegatedHandlerAttached = true

    const scoreContainer = document.getElementById('score')
    if (!scoreContainer) return

    scoreContainer.addEventListener('click', (e) => {
      if (!onNoteClick) return

      const notehead = e.target.closest('.vf-notehead')
      if (!notehead) return

      const svgGroup = notehead.closest('g[id]')
      if (!svgGroup) return

      const osmdInstance = getOsmdInstance()
      if (!osmdInstance) return

      const svgIdToNoteDatas = buildSvgIdToNoteDataMap()
      const noteDatas = svgIdToNoteDatas.get(svgGroup.id)
      if (!noteDatas) return

      const noteheads = svgGroup.querySelectorAll('.vf-notehead')
      const noteheadIndex = Array.from(noteheads).indexOf(notehead)

      const noteData = noteDatas.find((nd) => nd.noteheadIndex === noteheadIndex)
      if (noteData) {
        e.stopPropagation()
        onNoteClick(noteData)
      }
    })
  }

  // Restore played/active state captured positionally as savedStates[measureIndex][noteIndex],
  // then update each rendered notehead to reflect the current pass's occurrence.
  // Repaints played/active marks onto a freshly rendered SVG. `savedStates` is the
  // positional snapshot taken around a redraw that rebuilt the note model; pass null
  // when the model survived it and the live flags are already correct.
  function restoreNoteStates(savedStates, currentMeasureIndex) {
    const allNotes = getAllNotes()
    if (savedStates) applyPositionalNoteStates(allNotes, savedStates)
    for (const noteData of chooseCurrentPassOccurrences(allNotes, currentMeasureIndex).values()) {
      // Callers always run this against a just-rendered SVG, so an unmarked note has
      // nothing to clear — skipping it avoids a GNote + querySelectorAll lookup for
      // the vast majority of noteheads.
      if (!noteData.played && !noteData.active) continue
      const notehead = svgNotehead(noteData)
      notehead?.classList.toggle('played-note', noteData.played)
      notehead?.classList.toggle('active-note', noteData.active)
    }
  }

  // Check whether a staff entry contains a given source note
  function staffEntryContainsNote(staffEntry, sourceNote) {
    for (const gve of staffEntry.graphicalVoiceEntries || []) {
      for (const gn of gve.notes || []) {
        if (gn.sourceNote === sourceNote) return true
      }
    }
    return false
  }

  // Semitone height of a source note, undefined for an unpitched one
  const halfToneOf = (sourceNote) => sourceNote?.Pitch?.getHalfTone()

  // Find the highest-pitched source note across all voice entries in a staff entry
  function findTopNoteInStaffEntry(staffEntry) {
    let topNote = null
    for (const gve of staffEntry.graphicalVoiceEntries || []) {
      for (const gn of gve.notes || []) {
        if (!topNote || halfToneOf(gn.sourceNote) > halfToneOf(topNote)) {
          topNote = gn.sourceNote
        }
      }
    }
    return topNote
  }

  // Collect fingering TechnicalInstructions from a staff entry (non-grace voices only)
  function collectFingeringsFromStaffEntry(staffEntry) {
    const fingerings = []
    for (const gve of staffEntry.graphicalVoiceEntries || []) {
      if (gve.parentVoiceEntry?.IsGrace) continue
      for (const ti of gve.parentVoiceEntry?.TechnicalInstructions || []) {
        if (ti.type === 0) fingerings.push(ti)
      }
    }
    return fingerings
  }

  // Determine whether fingerings are placed above or below the staff
  // PlacementEnum: Above=0, Below=1
  function isFingeringsPlacedAbove(graphicalMeasure) {
    const position = getOsmdInstance().rules?.FingeringPosition
    if (position === 0) return true
    if (position === 1) return false
    return graphicalMeasure.isUpperStaffOfInstrument?.() ?? true
  }

  // Order a staff entry's fingerings to match OSMD's FingeringEntries array, so
  // orderedFingeringsForStaffEntry(...)[i] pairs with staffEntry.FingeringEntries[i].
  // Mirrors calculateFingerings() in OSMD's MusicSheetCalculator -- keep in sync
  // when the vendored bundle moves.
  function orderedFingeringsForStaffEntry(staffEntry, graphicalMeasure) {
    const fingerings = collectFingeringsFromStaffEntry(staffEntry)
    if (fingerings.length < 2) return fingerings
    const above = isFingeringsPlacedAbove(graphicalMeasure)

    // When every fingering belongs to a distinct pitched note, OSMD stacks them in
    // the pitch order of their notes, so the stack mirrors the chord. This is the
    // usual case, and the only one where collection order (voice by voice) can
    // disagree with what gets rendered -- e.g. a chord in voice 1 plus a lower note
    // in voice 2 (Pathetique 2nd mvt, m24).
    const distinctPitchedNotes = fingerings.every(
      (fingering, index) =>
        fingering.sourceNote?.Pitch !== undefined &&
        fingerings.findIndex((other) => other.sourceNote === fingering.sourceNote) === index,
    )
    if (distinctPitchedNotes) {
      fingerings.sort((a, b) => halfToneOf(a.sourceNote) - halfToneOf(b.sourceNote))
      if (!above) fingerings.reverse()
    } else if (!above) {
      // Fallback for bulk fingerings (several per note) and unpitched notes: OSMD
      // keeps the collection order and applies these heuristics instead.
      fingerings.reverse()
    } else if (fingerings[0].sourceNote === findTopNoteInStaffEntry(staffEntry)) {
      fingerings.reverse()
    }
    return fingerings
  }

  // Find the FingeringEntry for a note given its fingeringKey and noteData.
  // fingeringKey format: measureNumber:staffIndex:voiceIndex:noteIndex
  function findFingeringEntry(fingeringKey, targetNoteData) {
    const osmdInstance = getOsmdInstance()
    if (!osmdInstance?.graphic?.MeasureList) return null

    const [measureNumber, staffIndex] = fingeringKey.split(':').map(Number)

    const sourceMeasures = osmdInstance.Sheet.SourceMeasures
    const sourceMeasureIndex = sourceMeasures.findIndex((m) => m.MeasureNumberXML === measureNumber)
    if (sourceMeasureIndex < 0) return null

    const graphicalMeasure = osmdInstance.graphic.MeasureList[sourceMeasureIndex]?.[staffIndex]
    if (!graphicalMeasure) return null

    for (const staffEntry of graphicalMeasure.staffEntries || []) {
      if (!staffEntryContainsNote(staffEntry, targetNoteData.note)) continue

      const fingerings = orderedFingeringsForStaffEntry(staffEntry, graphicalMeasure)
      const finalIndex = fingerings.findIndex((f) => f.sourceNote === targetNoteData.note)
      if (finalIndex < 0) return null
      return staffEntry.FingeringEntries?.[finalIndex] || null
    }

    return null
  }

  // OSMD positions each fingering label at its staff entry's x. When a measure has
  // invisible (print-object="no") notes -- e.g. a gruppetto's realized notes written
  // alongside the turn symbol -- OSMD's staff-entry coordinates and VexFlow's actual
  // notehead positions drift apart, so the label renders over the wrong note. Re-center
  // each fingering label on its note's rendered notehead. A no-op where they already
  // agree (the common case), since then the correction is ~0.
  function alignFingeringLabelsToNoteheads() {
    const osmdInstance = getOsmdInstance()
    if (!osmdInstance?.graphic?.MeasureList) return
    const svg = document.getElementById('score')?.querySelector('svg')
    const scaleX = svg?.getScreenCTM?.()?.a || 1

    // Read all positions first, then write -- interleaving getBoundingClientRect with
    // setAttribute would force a layout flush per label.
    const moves = []
    for (const measureRow of osmdInstance.graphic.MeasureList) {
      for (const graphicalMeasure of measureRow || []) {
        for (const staffEntry of graphicalMeasure?.staffEntries || []) {
          const entries = staffEntry.FingeringEntries
          if (!entries?.length) continue

          const fingerings = orderedFingeringsForStaffEntry(staffEntry, graphicalMeasure)
          for (let i = 0; i < entries.length && i < fingerings.length; i++) {
            const textEl = entries[i]?.SVGNode?.querySelector('text')
            const note = fingerings[i]?.sourceNote
            const notehead = note && svgNote(note)?.querySelector('.vf-notehead')
            const x = textEl && parseFloat(textEl.getAttribute('x'))
            if (!notehead || !Number.isFinite(x)) continue

            const textRect = textEl.getBoundingClientRect()
            const headRect = notehead.getBoundingClientRect()
            const dx = headRect.x + headRect.width / 2 - (textRect.x + textRect.width / 2)
            moves.push({ textEl, x: x + dx / scaleX })
          }
        }
      }
    }
    for (const { textEl, x } of moves) textEl.setAttribute('x', x)
  }

  // Create a new SVG <text> element for a grace note fingering, positioned left of the note.
  // Returns true if created, false if the required SVG structure is missing.
  function createGraceNoteFingeringText(svgGroup, fingerText) {
    const modifiers = svgGroup.querySelector('.vf-modifiers')
    const noteEl = svgGroup.querySelector('.vf-note')
    if (!modifiers || !noteEl) return false

    const bbox = noteEl.getBBox()
    const textEl = document.createElementNS('http://www.w3.org/2000/svg', 'text')
    textEl.setAttribute('x', bbox.x - 9)
    textEl.setAttribute('y', bbox.y + bbox.height / 2 + 5)
    textEl.setAttribute('font-size', '9pt')
    textEl.setAttribute('font-family', 'sans-serif')
    textEl.setAttribute('font-weight', 'bold')
    textEl.setAttribute('fill', '#000000')
    textEl.textContent = fingerText
    modifiers.appendChild(textEl)
    return true
  }

  // Update an existing fingering's SVG directly without re-rendering
  // Returns true if successful, false if no existing fingering found
  function updateFingeringSVG(fingeringKey, newFinger) {
    const targetNoteData = getNoteDataByKey().get(fingeringKey)
    if (!targetNoteData) return false

    const fingerText = newFinger.toString()

    // Grace notes don't have FingeringEntries - their fingerings are rendered
    // by VexFlow as <text> inside the <g class="vf-modifiers"> of the stavenote group.
    // OSMD's calculateFingerings skips grace voices, so re-rendering won't create
    // the text — we must handle both update and creation here.
    if (targetNoteData.isGrace) {
      const svgGroup = svgNote(targetNoteData.note)
      if (!svgGroup) return false

      const existingText = svgGroup.querySelector('text')
      if (existingText) {
        existingText.textContent = fingerText
        return true
      }

      return createGraceNoteFingeringText(svgGroup, fingerText)
    }

    const fingeringEntry = findFingeringEntry(fingeringKey, targetNoteData)
    const textEl = fingeringEntry?.SVGNode?.querySelector('text')
    if (!textEl) return false

    textEl.textContent = fingerText

    // Keep OSMD's internal label in sync
    if (fingeringEntry.label) {
      fingeringEntry.label.text = fingerText
    }

    // Keep TechnicalInstruction value in sync so light re-renders stay consistent
    const tis = targetNoteData.voiceEntry?.TechnicalInstructions || []
    const ti = tis.find((t) => t.type === 0 && t.sourceNote === targetNoteData.note)
    if (ti) ti.value = fingerText

    return true
  }

  // Add a fingering to OSMD's internal data model (without re-rendering)
  // This allows a subsequent renderScore() to pick it up via calculateFingerings
  function addFingeringToDataModel(fingeringKey, finger) {
    const noteData = getNoteDataByKey().get(fingeringKey)
    if (!noteData?.voiceEntry?.TechnicalInstructions) return false

    noteData.voiceEntry.TechnicalInstructions.push({
      type: 0, // TechnicalInstructionType.Fingering
      value: finger.toString(),
      sourceNote: noteData.note,
    })
    return true
  }

  // Remove a fingering from OSMD's internal data model
  function removeFingeringFromDataModel(fingeringKey) {
    const noteData = getNoteDataByKey().get(fingeringKey)
    if (!noteData?.voiceEntry?.TechnicalInstructions) return false

    const tis = noteData.voiceEntry.TechnicalInstructions
    const index = tis.findIndex((ti) => ti.type === 0 && ti.sourceNote === noteData.note)
    if (index < 0) return false

    tis.splice(index, 1)
    return true
  }

  return {
    setupFingeringClickHandlers,
    restoreNoteStates,
    updateFingeringSVG,
    addFingeringToDataModel,
    removeFingeringFromDataModel,
    alignFingeringLabelsToNoteheads,
  }
}
