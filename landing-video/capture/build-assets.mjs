// Seed the app with a practice-data backup, then capture every screenshot the
// landing hero video needs, writing them into ../composition/assets/.
//
//   node capture/build-assets.mjs     # the backup `npm run backup` fetched
//   PT_BACKUP=~/Downloads/arabesque-backup-YYYY-MM-DD.json \
//     node capture/build-assets.mjs   # or an export from the app
//
// Requires the app running locally (default http://localhost:4567). See README.
import fs from 'fs'
import path from 'path'
import { launch, openScore, sleep, ASSETS, BACKUP_PATH, BASE, ROOT, WORKDIR } from './lib.mjs'

const BACKUP = process.env.PT_BACKUP || BACKUP_PATH
if (!fs.existsSync(BACKUP)) {
  console.error(`No backup at ${BACKUP}. Run \`npm run backup\` (from Supabase), or set PT_BACKUP to an export.`)
  process.exit(1)
}
fs.mkdirSync(ASSETS, { recursive: true })
const out = (name) => path.join(ASSETS, name)

// The practice journal is relative to *now*: seed a backup from three weeks ago
// and the video opens on a column of "Aucune pratique". So the page's clock is
// pinned just after the backup's most recent session, which puts that session
// under "aujourd'hui" and keeps the days above it filled. Derived from the file
// rather than hardcoded, so any backup gives a journal that looks current.
const backupData = JSON.parse(fs.readFileSync(BACKUP, 'utf8'))
const lastSessionMs = Math.max(
  ...(backupData.sessions || [])
    .map((s) => Date.parse(s.endedAt || s.startedAt))
    .filter(Number.isFinite)
)
const NOW = Number.isFinite(lastSessionMs)
  ? new Date(lastSessionMs + 30 * 60 * 1000)
  : new Date(backupData.exportDate)
console.log(`clock pinned to ${NOW.toISOString()} (last session in the backup)`)

// Static brand asset used by the closing scene (not a screenshot).
fs.copyFileSync(path.resolve(ROOT, '../../public/favicon.svg'), out('favicon.svg'))

// A fresh profile every run: the captures below play the app, and what they
// play is filed in the practice journal like anything else — a second run
// would open on the first one's training and strict runs under "aujourd'hui".
fs.rmSync(path.join(WORKDIR, 'userdata'), { recursive: true, force: true })
const { ctx, page } = await launch({ now: NOW })

// 1. Seed the library from the backup export (idempotent: keyed puts). The
// import control moved to the data page (⚙️ menu → Gestion des données) when
// the header was consolidated; it used to sit on the library page. The import
// finishes on an alert(), which doubles as a precise completion signal —
// awaited, not accepted: Playwright dismisses dialogs on its own.
await page.goto(`${BASE}/data.html`, { waitUntil: 'networkidle' })
const imported = page.waitForEvent('dialog')
await page.setInputFiles('#backup-import', BACKUP)
await imported
// An export carries its aggregates, a Supabase fetch has none: rebuild them from
// the sessions either way, as sync does, so the statuses match today's rules.
await page.evaluate(async () => {
  const { initStorage } = await import('/js/storage.js')
  const { initPracticeTracker } = await import('/js/practiceTracker.js')
  const { fetchCatalogMeta } = await import('/js/sync.js')
  const storage = initStorage()
  await storage.init()
  const meta = await fetchCatalogMeta()
  await initPracticeTracker(storage).rebuildAggregates((scoreId) => meta[scoreId] ?? null)
})
await page.goto(`${BASE}/library.html`, { waitUntil: 'networkidle' })
await page.waitForFunction(() => document.querySelectorAll('tbody tr').length > 10)
await sleep(700)
await page.screenshot({ path: out('library.png') })
await page.locator('.pt-library__sidebar').screenshot({ path: out('journal.png') })
console.log('captured library + journal')

// 2. Plain score view.
await openScore(page, 'scores/Arabesque_L._66_No._1_in_E_Major.mxl')
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: out('score.png') })

// 3. Real-time feedback: drive REAL input MIDI for the opening notes (pitches
//    from the OSMD cursor; the app's matching engine colours them green).
await page.evaluate(async (steps) => {
  const cursor = document.documentElement._x_dataStack[0].osmdInstance.cursor
  cursor.reset()
  for (let i = 0; i < steps; i++) {
    const pitches = cursor.NotesUnderCursor().filter((n) => n.Pitch).map((n) => n.Pitch.halfTone + 12)
    await window.__ptMidi.play(pitches)
    cursor.next()
    await window.__ptMidi.sleep(170)
  }
}, 17)
await sleep(300)
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: out('score-feedback.png') })
console.log('captured score + score-feedback')

// 4. Training mode: replay the first measures so the 3x repeat tracker shows.
await openScore(page, 'scores/Minuet_in_G_Major_Bach.mxl')
await page.evaluate(async () => {
  const d = document.documentElement._x_dataStack[0]
  const cursor = d.osmdInstance.cursor
  cursor.reset()
  const measures = {}
  for (let i = 0; i < 60; i++) {
    const mi = cursor.iterator?.CurrentMeasureIndex ?? 0
    if (mi > 2) break
    const ns = cursor.NotesUnderCursor().filter((n) => n.Pitch).map((n) => n.Pitch.halfTone + 12)
    ;(measures[mi] = measures[mi] || []).push(...ns)
    cursor.next()
  }
  cursor.reset()
  try { cursor.hide() } catch {}
  d.setMode('training')
  await window.__ptMidi.sleep(450)
  const playMeasure = async (mi) => {
    await window.__ptMidi.play(measures[mi] || [])
    await window.__ptMidi.sleep(220)
  }
  for (let r = 0; r < 3; r++) await playMeasure(0)
  for (let r = 0; r < 2; r++) await playMeasure(1)
})
await sleep(400)
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: out('training.png') })
console.log('captured training')

// 5. Strict mode: a four-bar passage looped to the metronome. Each notehead is
//    struck the moment the engine lights it, from the pitches the cursor reads
//    under its group, so the engine judges every note itself. Two clean runs,
//    then a third with one note let go, caught near its end: the band counts
//    "2 sur 3 propres" and the missed note shows red among the green.
await openScore(page, 'scores/Bach_Invention_No_8_in_F_Major.mxl')
await page.evaluate(async () => {
  const d = document.documentElement._x_dataStack[0]
  const osmd = d.osmdInstance
  const cursor = osmd.cursor
  cursor.reset()
  const groups = new Map()
  while (!cursor.iterator.EndReached) {
    for (const n of cursor.NotesUnderCursor()) {
      const g = n.Pitch && osmd.rules.GNote(n)?.getSVGGElement()
      if (!g) continue
      if (!groups.has(g)) groups.set(g, new Set())
      groups.get(g).add(n.Pitch.halfTone + 12)
    }
    cursor.next()
  }
  cursor.reset()
  d.setMode('strict')
  await window.__ptMidi.sleep(300)
  d.strictBpm = 72
  d.toggleLoop()
  d.pickStrictMeasure(0)
  d.pickStrictMeasure(3)
  // Groups lit per run, read by the capture to know how far the run has got.
  const lit = (window.__strictLit = {})
  const struck = new Set()
  const send = (status, pitches) => {
    for (const p of pitches) window.dispatchEvent(new CustomEvent('mock-midi-input', { detail: { data: [status, p, 90] } }))
  }
  new MutationObserver((records) => {
    for (const { target } of records) {
      if (!target.classList.contains('expected-note')) continue
      const g = [...groups.keys()].find((k) => k.contains(target))
      // A chord lights one notehead per note: strike it once.
      if (!g || struck.has(g)) continue
      struck.add(g)
      setTimeout(() => struck.delete(g), 120)
      const run = d.trainerStatus?.run ?? 0
      lit[run] = (lit[run] ?? 0) + 1
      if (run === 3 && lit[run] === 10) continue
      const pitches = [...groups.get(g)]
      send(0x90, pitches)
      setTimeout(() => send(0x80, pitches), 90)
    }
  }).observe(document.querySelector('#score'), { subtree: true, attributes: true, attributeFilter: ['class'] })
  d.toggleStrictPlaythrough()
})
await page.waitForFunction(() => window.__strictLit[3] >= window.__strictLit[1] - 3, null, { timeout: 90000, polling: 20 })
await page.evaluate(() => window.scrollTo(0, 0))
await page.screenshot({ path: out('strict.png') })
await page.evaluate(() => document.documentElement._x_dataStack[0].toggleStrictPlaythrough())
console.log('captured strict')

// 6. History modal (rich chart — a heavily-practised score).
await openScore(page, 'scores/Bach_Invention_No_14_in_B_Flat_Major.mxl')
await page.evaluate(() => document.documentElement._x_dataStack[0].openScoreHistory())
await sleep(900)
await page.locator('#scoreHistoryModal').screenshot({ path: out('history.png') })
console.log('captured history')

await ctx.close()
console.log(`done → ${ASSETS}`)
