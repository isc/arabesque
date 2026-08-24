// Practice history for the App Store screenshots. Injected into a throwaway
// copy of public/ by capture.sh — never served to real users.
//
// Only sessions are written; the app then recomputes its own aggregates from
// them, so the statuses on screen are whatever the real rules make of this
// history rather than values written by hand. The rules live in
// practiceTracker.js (computeScoreStatus) and are, at the time of writing:
//
//   repertoire        every measure at >= 10 clean attempts, >= 3 practice
//                     days, >= 10 completed playthroughs
//   perfectionnement  >= half the measures at >= 3 clean attempts, and at
//                     least one completed playthrough
//   dechiffrage       anything else
//
// If a screenshot comes out with every piece in "Déchiffrage", those rules
// have moved and the profiles below need matching to them again.
import { initStorage } from './js/storage.js'
import { initPracticeTracker } from './js/practiceTracker.js'
import { fetchCatalogMeta } from './js/sync.js'

const FLAG = 'arabesque:demo-seeded'

const PIECES = [
  // Long history, played end to end and cleanly by now.
  { file: 'Arabesque_L._66_No._1_in_E_Major.mxl', measures: 36, days: 132, every: 3, dailyTail: 11, aim: 'repertoire' },
  // Coming together: complete run-throughs, still a few stumbles.
  { file: 'schumann-melodie.xml', measures: 24, days: 74, every: 3, dailyTail: 6, aim: 'refining' },
  { file: 'J._S._Bach_-_Air_on_the_G_String_Piano_arrangement.mxl', measures: 32, days: 51, every: 4, aim: 'refining' },
  // Being sight-read: partial passes, no complete playthrough yet.
  { file: 'Ave_Maria_D839_-_Schubert_-_Solo_Piano_Arrg..mxl', measures: 30, days: 23, every: 4, aim: 'reading' },
  { file: 'Chopin_-_Ballade_no._1_in_G_minor_Op._23.mxl', measures: 60, days: 9, every: 3, aim: 'reading' },
]

// Deterministic: the same run produces the same screenshots, so a diff between
// two captures is a real UI change rather than reshuffled fixture data.
let rngState = 20260824
function rand() {
  rngState = (rngState * 1103515245 + 12345) % 2147483648
  return rngState / 2147483648
}
const pick = (lo, hi) => lo + Math.floor(rand() * (hi - lo + 1))

// One session. Attempts run back to back so the normalised playing time the app
// computes lands near the wall-clock length instead of deducting long gaps.
function buildSession(piece, daysBack, { measuresPlayed, cleanChance, completed }) {
  const started = new Date()
  started.setHours(pick(17, 20), pick(0, 55), 0, 0)
  started.setDate(started.getDate() - daysBack)

  let cursor = started.getTime()
  const measures = []
  for (let m = 0; m < measuresPlayed; m++) {
    const attempts = []
    const tries = rand() < cleanChance ? 1 : 2
    for (let a = 0; a < tries; a++) {
      const clean = a === tries - 1
      const durationMs = pick(1400, 3200)
      attempts.push({
        startedAt: new Date(cursor).toISOString(),
        durationMs,
        wrongNotes: clean ? 0 : pick(1, 3),
        clean,
      })
      cursor += durationMs + pick(150, 500)
    }
    measures.push({ sourceMeasureIndex: m, attempts })
  }

  const session = {
    id: `demo-${piece.file}-${daysBack}`,
    scoreId: `scores/${piece.file}`,
    mode: 'free',
    startedAt: started.toISOString(),
    endedAt: new Date(cursor).toISOString(),
    measures,
  }
  if (completed) session.completedAt = new Date(cursor).toISOString()
  return session
}

function buildSessions() {
  const sessions = []
  for (const piece of PIECES) {
    // Every `every` days across the whole history, then daily over the last
    // stretch — that recent run is what the streak counters read.
    const days = new Set()
    for (let back = piece.days; back >= 0; back -= piece.every) days.add(back)
    if (piece.dailyTail) {
      for (let back = Math.min(piece.dailyTail, piece.days); back >= 0; back--) days.add(back)
    }

    for (const back of [...days].sort((a, b) => b - a)) {
      // A real month has holes in it, and the calendar exists to show them.
      if (rand() < 0.18 && back > (piece.dailyTail || 0)) continue
      const age = back / piece.days // 1 = the first session, 0 = today

      if (piece.aim === 'repertoire') {
        sessions.push(
          buildSession(piece, back, {
            measuresPlayed: piece.measures,
            cleanChance: 0.45 + 0.5 * (1 - age),
            completed: age < 0.75,
          })
        )
      } else if (piece.aim === 'refining') {
        sessions.push(
          buildSession(piece, back, {
            measuresPlayed: age > 0.6 ? Math.ceil(piece.measures * 0.7) : piece.measures,
            cleanChance: 0.4 + 0.35 * (1 - age),
            completed: age < 0.4 && rand() < 0.6,
          })
        )
      } else {
        // Sight-reading: the opening gets worked long before the end exists.
        sessions.push(
          buildSession(piece, back, {
            measuresPlayed: Math.max(4, Math.ceil(piece.measures * (0.3 + 0.4 * (1 - age)))),
            cleanChance: 0.3 + 0.2 * (1 - age),
            completed: false,
          })
        )
      }
    }
  }
  return sessions
}

async function seedPracticeHistory() {
  const storage = initStorage()
  await storage.init()
  await storage.importBackup({
    exportDate: new Date().toISOString(),
    sessions: buildSessions(),
    aggregates: [],
    fingerings: [],
  })
  const tracker = initPracticeTracker(storage)
  const meta = await fetchCatalogMeta()
  await tracker.rebuildAggregates((scoreId) => meta[scoreId] ?? null)
  localStorage.setItem(FLAG, '1')
  localStorage.setItem('arabesque:returning', '1')
}

// The listing's primary locale is fr-FR, so the screenshots are too. Set before
// anything reads it, and reload once if the app already picked another.
if (localStorage.getItem('arabesque:lang') !== 'fr') {
  localStorage.setItem('arabesque:lang', 'fr')
  location.reload()
}

if (!localStorage.getItem(FLAG)) {
  await seedPracticeHistory()
  location.reload()
}

// The year grid opens on January; a screenshot wants the weeks just lived
// through, with today's square at the right edge. Scrolling to the very end
// would land on months that have not happened yet.
if (location.pathname.endsWith('practice.html')) {
  setTimeout(() => {
    document.querySelector('[data-today="true"]')?.scrollIntoView({ inline: 'end', block: 'nearest' })
  }, 1500)
}
