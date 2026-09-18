#!/usr/bin/env node
// scripts/migrate-fingerings-847.mjs — one-off, delete once it has run.
//
// The staff fixes to Bach's Prelude in C minor (BWV 847), bars 25–36, move
// notes between staves and voices. Fingerings are keyed by
// `measure:staff:voice:noteIndex` (0-based staff and voice straight from the
// MusicXML, noteIndex counted per staff+voice over the visible pitched notes,
// chord members included, low to high as written), so every fingering on a
// moved note now points at another note or at none. This rewrites the stored
// keys so each one points at the same physical note again.
//
//   node scripts/migrate-fingerings-847.mjs           # dry run: show what would change
//   node scripts/migrate-fingerings-847.mjs --apply   # write it to Supabase
//
// Run it right after the new score is deployed, not before (the old score
// would read the new keys) and not long after (a device editing this piece on
// the new score writes new-layout keys next to the old ones, and a record
// holding both cannot be told apart). A record is only migrated while it still
// holds a key that exists in the old layout alone, so a second run is a no-op.
//
// Sync is last-write-wins per (profile, score) on updated_at, for the whole
// record: the rewritten row gets a fresh updated_at, and a device holding the
// old record pulls it and replaces its own on the next sync — unless that
// device edits a fingering of this piece before syncing, in which case its
// record is newer and it pushes the old keys back. Run it again then.
import { parseArgs } from 'node:util'
import { die, query } from './lib/supabase.mjs'

const SCORE_FILE = 'Prelude_No._2_BWV_847_in_C_Minor.mxl'

// Old key -> new key. Staff and voice are 0-based: staff 0 upper, 1 lower.
function remap(key) {
  const [m, s, v, i] = key.split(':').map(Number)
  const k = (measure, staff, voice, index) => `${measure}:${staff}:${voice}:${index}`
  switch (m) {
    case 25: // right hand from the lower staff to the upper one
    case 35:
    case 36:
      if (s === 1 && v === 0) return k(m, 0, 0, i)
      break
    case 26: // right hand joined into voice 1 on the upper staff: 5 notes, beat 3 (was voice 5), 4 notes
      if (s === 1 && v === 0) return k(m, 0, 0, i < 5 ? i : i + 4)
      if (s === 0 && v === 4) return k(m, 0, 0, i + 5)
      break
    case 31: // voice 5 (left hand) all on the lower staff; its first note already was
      if (s === 0 && v === 4) return k(m, 1, 4, i + 1)
      break
    case 32: // voice 5 on the lower staff; its last three notes already were
      if (s === 0 && v === 4) return k(m, 1, 4, i)
      if (s === 1 && v === 4) return k(m, 1, 4, i + 13)
      break
    case 34: // three left-hand voices -> one voice of two chords, C–G–B♭ then C–F–A♭
      if (s === 1 && v >= 4 && v <= 6 && i <= 1) return k(m, 1, 4, i * 3 + [2, 0, 1][v - 4])
      break
  }
  return key
}

// Staff+voice pairs with no note left in the new layout: a key there can only
// be an old one, which is what tells a record still to migrate.
const OLD_ONLY = /^(?:(?:25|26|35|36):1:0|26:0:4|31:0:4|32:0:4|34:1:[56]):\d+$/

const quote = (value) => `'${String(value).replace(/'/g, "''")}'`

const { values } = parseArgs({ options: { apply: { type: 'boolean', default: false } } })

const rows = (
  await query(
    `select user_id, profile_id, score_url, fingerings, updated_at from public.user_fingerings where score_url like '%BWV_847%'`,
  )
).filter((r) => r.score_url.endsWith(`/${SCORE_FILE}`) || r.score_url === SCORE_FILE)

if (!rows.length) die(`no stored fingerings for ${SCORE_FILE}`)

const now = Date.now()
let pending = 0
for (const row of rows) {
  const label = `${row.user_id.slice(0, 8)} / ${row.profile_id} / ${row.score_url} (updated ${new Date(Number(row.updated_at)).toISOString()})`
  const keys = Object.keys(row.fingerings)
  if (!keys.some((key) => OLD_ONLY.test(key))) {
    console.log(`${label}: nothing to migrate`)
    continue
  }

  const next = {}
  const moves = []
  for (const key of keys) {
    const to = remap(key)
    if (to in next) die(`${label}: ${key} and another key both map to ${to}`)
    next[to] = row.fingerings[key]
    if (to !== key) moves.push(`  ${key.padEnd(10)} -> ${to.padEnd(10)} finger ${row.fingerings[key]}`)
  }
  console.log(`${label}: ${moves.length} of ${keys.length} keys move`)
  for (const line of moves) console.log(line)
  pending++

  if (!values.apply) continue
  // Guarded on the updated_at just read, so a device that synced in between
  // is not overwritten.
  const updated = await query(
    `update public.user_fingerings set fingerings = ${quote(JSON.stringify(next))}::jsonb, updated_at = ${now} ` +
      `where user_id = ${quote(row.user_id)} and profile_id = ${quote(row.profile_id)} and score_url = ${quote(row.score_url)} ` +
      `and updated_at = ${Number(row.updated_at)} returning score_url`,
  )
  console.log(updated.length ? '  written' : '  NOT written: the row changed since it was read, run again')
}

if (!values.apply && pending) console.log(`\nDry run: ${pending} record(s) to migrate. Re-run with --apply to write them.`)
