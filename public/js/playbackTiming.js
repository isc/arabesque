// Pure timing math shared by the audio playback engine (playback.js) and the
// strict-mode playthrough (strictPlaythrough.js). Kept free of the browser-only
// audio/DOM dependencies those modules carry, so it can be unit-tested directly.

export function tsToSeconds(ts, bpm) {
  return ts * 4 * 60 / bpm
}

// For each measure in playback order, its start time from the beginning of the
// piece (in whole-note fractions) -- i.e. the running sum of preceding measure
// durations. Each measure's actual duration comes from OSMD, so time signatures
// other than 4/4 work correctly.
export function buildMeasureStartTimes(allNotes, sourceMeasures) {
  const startTimes = []
  let elapsed = 0
  for (const measureData of allNotes) {
    startTimes.push(elapsed)
    elapsed += measureDurationTs(measureData, sourceMeasures)
  }
  return startTimes
}

// How long one measure of the playback order lasts, in whole-note fractions.
// Falls back to a whole note for a measure OSMD gives no duration for.
export function measureDurationTs(measureData, sourceMeasures) {
  return sourceMeasures[measureData.sourceMeasureIndex]?.Duration?.RealValue ?? 1.0
}

// Build the list of cursor advance timestamps (in ms from start) from allNotes
// data. Avoids traversing the OSMD cursor (which corrupts its visual state
// after EndReached+reset).
//
// The OSMD cursor stops once per vertical staff-entry container, so we emit one
// step per container (each measure's `cursorStops` holds those timestamps). This
// includes rest-only containers — a position where one hand rests while the
// other sustains a longer note. Driving the timeline off note onsets instead
// skipped those stops, so the cursor fell one position behind after every such
// container and stayed behind for the rest of the piece. A chord or an ornament
// is a single container, hence a single stop — no extra handling needed.
export function buildCursorTimeline(allNotes, measureStartTimes, bpm, offsetMs = 0) {
  const steps = []

  for (let i = 0; i < allNotes.length; i++) {
    for (const offset of allNotes[i].cursorStops ?? []) {
      steps.push(offsetMs + tsToSeconds(measureStartTimes[i] + offset, bpm) * 1000)
    }
  }

  return steps.sort((a, b) => a - b)
}

// Which bar `ms` falls in, given the bars in playing order and where each of
// them starts: the index of the last one that has begun, or -1 while `ms` is
// still before the first (strict mode's count-in). Both engines ask this of
// their own schedule rather than keeping a timer per bar alive to count them —
// playback of a plain list of start times, strict mode of its measure runs,
// hence `startMs` to read the start off whatever a bar is there.
export function measureIndexAt(bars, ms, startMs = (bar) => bar) {
  let i = -1
  while (i + 1 < bars.length && startMs(bars[i + 1]) <= ms) i++
  return i
}

// Number of cursor advances covered by the measures before startMeasureIndex.
// Both playback engines start their slice at startMeasureIndex and need to
// pre-advance OSMD's cursor by this many steps so it lands on the slice's first
// note (cf. scheduleCursorAdvances' skipSteps). Counts cursor stops, not
// measures or notes — a rest-only container is still a stop. When each stop
// falls is beside the point here, so this counts them rather than timing them.
export function cursorStepsBeforeMeasure(allNotes, startMeasureIndex) {
  let steps = 0
  for (let i = 0; i < Math.min(startMeasureIndex, allNotes.length); i++) {
    steps += allNotes[i].cursorStops?.length ?? 0
  }
  return steps
}
