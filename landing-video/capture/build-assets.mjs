// Seed the app with a practice-data backup, then capture every screenshot the
// landing hero video needs, writing them into ../composition/assets/.
//
//   PT_BACKUP=~/Downloads/arabesque-backup-YYYY-MM-DD.json \
//     node capture/build-assets.mjs
//
// Requires the app running locally (default http://localhost:4567). See README.
import fs from 'fs'
import path from 'path'
import { launch, openScore, sleep, ASSETS, BASE, ROOT } from './lib.mjs'

const BACKUP = process.env.PT_BACKUP
if (!BACKUP || !fs.existsSync(BACKUP)) {
  console.error('Set PT_BACKUP to an Arabesque backup export (Library → Exporter sauvegarde).')
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

// 5. History modal (rich chart — a heavily-practised score).
await openScore(page, 'scores/Bach_Invention_No_14_in_B_Flat_Major.mxl')
await page.evaluate(() => document.documentElement._x_dataStack[0].openScoreHistory())
await sleep(900)
await page.locator('#scoreHistoryModal').screenshot({ path: out('history.png') })
console.log('captured history')

await ctx.close()
console.log(`done → ${ASSETS}`)
