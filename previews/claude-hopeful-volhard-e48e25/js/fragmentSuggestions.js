// What the score page offers to reinforce, read off the note logs: the
// fragments of fragments.js, from the score's last sessions — the window
// reinforcement reads (noteLogWindow) — and the one under way, recomputed at
// every bar by the rule as it stands. A score whose history has no log at all —
// played before the log existed, or elsewhere and never fetched
// (keepScoreNoteLogs in noteLog.js) — gets the bar-and-join suggestions of
// reinforcement.js, as fragments of whole bars: the page drills one kind.
//
// A past session is read and judged once per note model, and kept: only the
// session under way changes from one bar to the next, and it is read from the
// page's own log (noteLog.liveSegments), not from storage.
import { analysisModel } from './noteExtraction.js'
import { eventsOf, traversals } from './noteLogAnalysis.js'
import { fragmentsToReinforce } from './fragments.js'
import { measuresToReinforce } from './reinforcement.js'
import { noteLogWindow } from './noteLog.js'

export function initFragmentSuggestions({ storage, practiceTracker, noteLog, getAllNotes }) {
  let model = { of: null, value: null }
  // Judged past sessions by id, for `model.value`.
  let judgedSessions = new Map()

  function modelOf(allNotes) {
    if (model.of !== allNotes) {
      model = { of: allNotes, value: analysisModel(allNotes) }
      judgedSessions = new Map()
    }
    return model.value
  }

  // A session's traversals, each saying whether it was a drill.
  const judged = (segments, session, notes) =>
    traversals(eventsOf(segments), notes).map((traversal) => ({ ...traversal, training: session.mode === 'training' }))

  async function pastTraversals(sessions, notes) {
    const window = noteLogWindow(sessions)
    const unread = window.filter((s) => !judgedSessions.has(s.id))
    const logs = await storage.getNoteLogsOfSessions(unread.map((s) => s.id))
    unread.forEach((session, i) => judgedSessions.set(session.id, judged(logs[i], session, notes)))
    return window.flatMap((s) => judgedSessions.get(s.id))
  }

  return {
    // The fragments for `hands` (handsKey), best first: { from, until, hands,
    // faults }, from and until as source bars and positions.
    async suggestions(scoreId, hands) {
      const allNotes = getAllNotes()
      if (!scoreId || !allNotes?.length) return []
      const notes = modelOf(allNotes)
      const sessions = await practiceTracker.getScoreSessions(scoreId)
      const live = sessions.find((s) => !s.endedAt)
      // The page's log can still hold the session it rolled over from.
      const liveSegments = live ? noteLog.liveSegments().filter((s) => s.sessionId === live.id) : []
      const all = [...(await pastTraversals(sessions, notes)), ...(live ? judged(liveSegments, live, notes) : [])]
      if (all.length > 0) return fragmentsToReinforce(all, notes, { hands })
      return measuresToReinforce(sessions, { hands }).map((item) => wholeBars(item, notes))
    },
    // The kept logs changed under the window: read them again.
    forget() {
      judgedSessions = new Map()
    },
  }
}

// A bar to reinforce, or the join into it, as the fragment of whole bars it is
// drilled as: the bar, from the downbeat of the one before for a join.
function wholeBars({ sourceMeasureIndex: bar, join, hands, faults }, { bars }) {
  const from = join && bar > 0 ? bar - 1 : bar
  return { from: { bar: from, position: 0 }, until: { bar, position: bars[bar]?.duration ?? 1 }, hands, faults }
}
