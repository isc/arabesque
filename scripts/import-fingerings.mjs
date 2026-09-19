#!/usr/bin/env node
// scripts/import-fingerings.mjs
//
// Promotes fingerings a player wrote on their own copy of a score into the
// score file everybody downloads. A player asked for exactly this: a year of
// fingerings worked out with their teacher, note by note on the tablet, and no
// way to hand them to the next person who opens the same piece. This is the
// road from one player's IndexedDB to `public/scores/`.
//
// It publishes nothing on its own. It takes an export, writes the fingerings
// into the score files, and leaves the result in the working tree for a human
// to look at in a branch preview before any of it reaches a library.
//
//     node scripts/import-fingerings.mjs backup.json --dry-run
//     node scripts/import-fingerings.mjs backup.json --score Canon_in_D
//     node scripts/import-fingerings.mjs backup.json
//
// `--dry-run` reports what each file would gain and writes nothing. `--score`
// narrows to the score files whose path contains the given text, repeatable;
// without it every score in the export is written. Start with `--dry-run` and
// no filter to see what the export holds, then promote what you meant to.
//
// ## Getting the export out of the app
//
// There is already a button for it. On the data page (Mes données →
// "📤 Exporter sauvegarde") the app writes `arabesque-backup-<date>.json`,
// which carries `fingerings` alongside the practice history — one record per
// score, exactly the shape this script reads:
//
//     { "fingerings": [ { "scoreUrl": "scores/Canon_in_D.mxl",
//                         "fingerings": { "3:0:0:1": 2, "3:0:0:2": 3 } } ] }
//
// The button is per profile, and it is the path to ask a player for: they
// already know it, and it needs no console. If you want the fingerings without
// the practice history — smaller, and nothing personal in it — this in the
// browser console on the app writes the same shape with only that key:
//
//     const db = await new Promise((ok) => { const r = indexedDB.open('arabesque'); r.onsuccess = () => ok(r.result) })
//     const rows = await new Promise((ok) => { const r = db.transaction('fingerings').objectStore('fingerings').getAll(); r.onsuccess = () => ok(r.result) })
//     Object.assign(document.createElement('a'), {
//       href: URL.createObjectURL(new Blob([JSON.stringify({ fingerings: rows })], { type: 'application/json' })),
//       download: 'arabesque-fingerings.json',
//     }).click()
//
// (A second profile keeps its own database, named `arabesque@<profile id>`;
// `indexedDB.databases()` lists them. The button knows which profile it is in,
// the snippet does not.)
//
// ## What a fingering is, and where it goes
//
// A player's fingerings live in IndexedDB, one record per `scoreUrl` — the
// catalog path, `scores/<file>` — holding a plain object of
// `measure:staff:voice:noteIndex` → finger. `public/js/fingeringInjector.js`
// applies that object over the MusicXML at load time, walking the same notes in
// the same order; `nextFingeringKey` there is the one definition of that
// walk, and this script imports it rather than restating it. A key that names
// a different note here than it does in the browser would draw the fingering on
// the wrong note, which is worse than not shipping it.
//
// The representation written into the file is the one the injector produces —
// `<notations><technical><fingering>3</fingering></technical></notations>` on
// the note — so a shipped fingering and a personal one are the same thing to
// OSMD, and nothing downstream has to tell them apart. That includes the
// attributes an engraver's fingering may carry: replacing one drops its
// `placement`, exactly as the injector does at load time, so the note is
// engraved the same whether the finger came from the file or from the player.
//
// A collection (Hanon, the Chansons) needs nothing special: each part is its
// own file with its own `scoreUrl`, so it arrives as its own record and is
// written into its own file.
//
// ## Whose fingering wins
//
// The player's own, always. `injectFingerings` clears every `<fingering>` on a
// note before writing the player's, so promoting a fingering into a score file
// cannot overwrite what somebody already wrote on that note — the file's is
// simply replaced at load time by theirs. A note they never touched shows the
// shipped one. There is one wrinkle worth knowing about before publishing: a
// player who deliberately *cleared* a fingering (the × in the pad) has no entry
// for that note, so a fingering shipped there later will appear for them. The
// app has no "no fingering here" to store, and this script is not the place to
// invent one.
//
// ## Editing the file rather than re-serializing it
//
// The score text is spliced by hand, not parsed into a DOM and printed back
// out. A round trip through a serializer reformats a MuseScore export from top
// to bottom, throwing away the engraving the file carries. Splicing touches the
// notes that gain a fingering and leaves every other byte alone.
//
// That gives a readable `git diff` for the fourteen plain `.xml` scores and not
// for the eighty-four `.mxl` ones, whose every entry is re-deflated: the diff
// there is the whole binary however little changed. The way to check what an
// import did to those is to open the score on the branch preview — which is the
// rule for this kind of change anyway.
//
// It is idempotent by construction: the text of an edited note is rebuilt from
// its own indentation, so running twice produces the file the first run wrote,
// byte for byte, and the second run reports nothing to do. `.mxl` archives go
// through scripts/mxl.mjs, which is deterministic for the same reason. Nothing
// is written when the text comes out unchanged, so a no-op run does not even
// touch a timestamp.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { nextFingeringKey } from '../public/js/fingeringInjector.js'
import { openScore } from './mxl.mjs'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')

// A `<measure …>` opening tag, or a whole `<note>…</note>`. One pass over the
// document in order, which is all the injector's walk needs: measures reset the
// counters, notes consume them. `(?=[\s>])` so `<measure-style>` is not a
// measure; `<note` cannot collide with `<notations>` for the same reason.
const TOKEN = /<measure(?=[\s>])[^>]*>|<note(?:\s[^>]*)?>[\s\S]*?<\/note>/g

// An attribute value in either quote style. MuseScore writes double quotes;
// the Hanon files come from scripts/split_hanon.rb through REXML, which writes
// single ones — and a walk that only reads one of the two numbers every measure
// of those twenty files NaN and silently matches nothing.
const MEASURE_NUMBER = /\bnumber=["']([^"']*)["']/
// The two the walk needs off a note. Built once: the alternative is a fresh
// RegExp per note, over every note of every score in an export.
const STAFF = /<staff>\s*([^<]*)<\/staff>/
const VOICE = /<voice>\s*([^<]*)<\/voice>/

// One-based in the file, zero-based in a key; absent means the first.
const indexOf = (xml, pattern) => {
  const match = pattern.exec(xml)
  return (match ? parseInt(match[1], 10) : 1) - 1
}

// The first <tag>…</tag> in `xml`: where its content starts and ends. None of
// the elements asked for here nest, so the first closing tag is the right one.
const OPENING = { notations: /<notations(?:\s[^>]*)?>/, technical: /<technical(?:\s[^>]*)?>/ }

function firstElement(xml, tag) {
  const open = OPENING[tag].exec(xml)
  if (!open) return null
  const close = xml.indexOf(`</${tag}>`, open.index)
  return close < 0 ? null : { start: open.index + open[0].length, end: close }
}

const replaceInner = (xml, element, inner) => xml.slice(0, element.start) + inner + xml.slice(element.end)

// `element` added to `inner` as its last child, laid out the way the children
// of `layout` are: on its own line at their indentation when they have one,
// inline when the whole thing sits on a single line. `layout` is the text
// before the old fingerings were stripped out of it, which may have been the
// only line showing what the indentation is.
//
// Both shapes reproduce themselves, which is where idempotency comes from: the
// second run rebuilds the very text the first run wrote.
const indentOf = (text) => /\n([ \t]*)\S/.exec(text)?.[1]

function appendChild(inner, element, layout = inner) {
  const indent = indentOf(layout)
  if (indent === undefined) return inner + element
  const tail = /\n[ \t]*$/.exec(inner)?.[0] ?? ''
  return inner.slice(0, inner.length - tail.length) + `\n${indent}${element}` + tail
}

// Mirrors injectFingeringIntoNote() in public/js/fingeringInjector.js: the
// player's finger replaces every fingering already on the note (an ornament can
// carry several), inside the first <notations><technical> — creating either if
// the note has none, and putting a new <notations> after <type> where the
// MusicXML element order wants it.
function noteWithFingering(noteXml, finger) {
  const element = `<fingering>${finger}</fingering>`

  const notations = firstElement(noteXml, 'notations')
  if (!notations) {
    const block = `<notations><technical>${element}</technical></notations>`
    const afterType = noteXml.indexOf('</type>')
    const at = afterType >= 0 ? afterType + '</type>'.length : /\s*<\/note>$/.exec(noteXml).index
    const indent = indentOf(noteXml)
    const laidOut = indent === undefined ? block : `\n${indent}${block}`
    return noteXml.slice(0, at) + laidOut + noteXml.slice(at)
  }

  const notationsInner = noteXml.slice(notations.start, notations.end)
  const technical = firstElement(notationsInner, 'technical')
  if (!technical) {
    return replaceInner(noteXml, notations, appendChild(notationsInner, `<technical>${element}</technical>`))
  }

  const technicalInner = notationsInner.slice(technical.start, technical.end)
  const stripped = technicalInner.replace(/\s*<fingering(?:\s[^>]*)?>[\s\S]*?<\/fingering>/g, '')
  const rebuilt = appendChild(stripped, element, technicalInner)
  return replaceInner(noteXml, notations, replaceInner(notationsInner, technical, rebuilt))
}

// Every note of `xml` that can carry a fingering, in order, with the key that
// names it — the same key, on the same note, that fingeringInjector.js derives
// walking the rendered score. Exported so a test can hold the two walks to that,
// which is the whole contract: a key naming a different note here than it does
// in the browser would draw the fingering on the wrong note.
export function* walkNotes(xml) {
  let measureNumber = NaN
  let counters = new Map()

  for (const match of xml.matchAll(TOKEN)) {
    if (match[0].startsWith('<measure')) {
      measureNumber = parseInt(MEASURE_NUMBER.exec(match[0])?.[1], 10)
      counters = new Map()
      continue
    }

    const noteXml = match[0]
    if (/<rest(?:[\s/>])/.test(noteXml)) continue
    yield {
      key: nextFingeringKey(counters, measureNumber, indexOf(noteXml, STAFF), indexOf(noteXml, VOICE)),
      noteXml,
      index: match.index,
    }
  }
}

// `xml` with `fingerings` written onto the notes they name, and a count of what
// that took. `missing` are the keys that matched no note: a stale key from an
// older engraving of the score, and a sign the export and the file disagree.
export function applyFingerings(xml, fingerings) {
  let out = ''
  let copied = 0
  const applied = new Set()
  const stats = { added: 0, changed: 0, unchanged: 0 }

  for (const { key, noteXml, index } of walkNotes(xml)) {
    const finger = fingerings[key]
    if (finger === undefined) continue
    applied.add(key)

    const rewritten = noteWithFingering(noteXml, finger)
    if (rewritten === noteXml) {
      stats.unchanged++
      continue
    }
    stats[/<fingering[\s>]/.test(noteXml) ? 'changed' : 'added']++
    out += xml.slice(copied, index) + rewritten
    copied = index + noteXml.length
  }

  return { xml: out + xml.slice(copied), ...stats, missing: Object.keys(fingerings).filter((key) => !applied.has(key)) }
}

// The fingering records an export holds, whatever it is: the app's whole
// backup, the fingerings-only snippet, or the bare array either of them wraps.
function readExport(path) {
  const parsed = JSON.parse(readFileSync(path, 'utf8'))
  const records = Array.isArray(parsed) ? parsed : parsed.fingerings
  if (!Array.isArray(records)) throw new Error(`${path}: no "fingerings" array — is this an Arabesque export?`)
  return records.filter((record) => record?.scoreUrl && Object.keys(record.fingerings ?? {}).length > 0)
}

// How the catalog names a file, so the report reads like the library rather
// than like a directory listing. A file the catalog does not list gets none:
// worth seeing, since a fingering for it would ship to nobody.
function catalogTitles() {
  const catalog = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'scores.json'), 'utf8'))
  const titles = new Map()
  for (const score of catalog.scores) {
    if (score.file) titles.set(score.file, `${score.title} — ${score.composer}`)
    for (const part of score.parts ?? []) titles.set(part.file, `${score.title} — ${part.title}`)
  }
  return titles
}

// A stored `scoreUrl` is the catalog path, `scores/<file>`. Read from a branch
// preview it can carry a prefix (`previews/some-branch/scores/<file>`), which
// names the same file in `public/`.
function scoreFile(scoreUrl) {
  const at = scoreUrl.lastIndexOf('scores/')
  return at < 0 ? null : scoreUrl.slice(at + 'scores/'.length)
}

const USAGE = 'usage: node scripts/import-fingerings.mjs <export.json> [--dry-run] [--score <text>]…'

function main(argv) {
  // Same parser as scripts/feedback.mjs, and for the same reason: it refuses an
  // unknown flag and a --score with nothing after it, both of which a hand-rolled
  // scan lets through as a silent no-op.
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      'dry-run': { type: 'boolean' },
      score: { type: 'string', multiple: true },
      help: { type: 'boolean' },
    },
  })

  if (values.help) {
    console.log(USAGE)
    return
  }
  const [exportPath] = positionals
  if (!exportPath) {
    console.error(USAGE)
    process.exit(1)
  }
  const dryRun = values['dry-run'] ?? false
  const filters = values.score ?? []

  const titles = catalogTitles()
  const totals = { added: 0, changed: 0, unchanged: 0, files: 0 }

  for (const record of readExport(exportPath)) {
    const file = scoreFile(record.scoreUrl)
    if (!file || (filters.length > 0 && !filters.some((text) => file.includes(text)))) continue

    const path = join(PUBLIC_DIR, 'scores', file)
    let score
    try {
      score = openScore(readFileSync(path))
    } catch (error) {
      console.log(`${file}\n  ! skipped: ${error.message}`)
      continue
    }

    const result = applyFingerings(score.xml, record.fingerings)
    const touched = result.added + result.changed
    console.log(`${titles.get(file) ?? `${file} (not in the catalog)`}`)
    console.log(
      `  ${file}: ${result.added} added, ${result.changed} changed, ${result.unchanged} already there` +
        (dryRun && touched > 0 ? ' — not written (--dry-run)' : ''),
    )
    if (result.missing.length > 0) {
      console.log(`  ! ${result.missing.length} key(s) match no note here: ${result.missing.slice(0, 8).join(', ')}`)
    }

    totals.added += result.added
    totals.changed += result.changed
    totals.unchanged += result.unchanged
    if (touched === 0) continue
    totals.files++
    if (!dryRun) writeFileSync(path, score.write(result.xml))
  }

  const verb = dryRun ? 'would change' : 'changed'
  console.log(
    `\n${totals.added} added, ${totals.changed} changed, ${totals.unchanged} already there — ${verb} ${totals.files} file(s)`,
  )
}

if (process.argv[1] === import.meta.filename) main(process.argv.slice(2))
