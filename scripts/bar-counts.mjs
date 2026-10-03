#!/usr/bin/env node
// Every score's bar count, as the app counts bars, recorded in
// test/js/bar-counts.json for test/js/barCounts.test.js to hold the scores to.
// Why a count may not change unnoticed: CLAUDE.md, "Library".
//
//   node scripts/bar-counts.mjs                  # record a new score
//   node scripts/bar-counts.mjs --accept <file>  # and a recorded one changed or removed, knowingly
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { parseArgs } from 'node:util'
import { openScore } from './mxl.mjs'
import { PART, MEASURE, measureOf } from './lib/musicxml.mjs'
import { barCounter } from '../public/js/fingeringKeys.js'
import { partsOf } from '../public/js/catalog.js'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')
const RECORD_FILE = join(import.meta.dirname, '..', 'test', 'js', 'bar-counts.json')

// The bars of a score, as fingerings and practice history count them. Every
// part has as many; the first one says.
export function barCount(xml) {
  const [part] = xml.match(PART) ?? []
  if (!part) throw new Error('no <part>')
  const nextBar = barCounter()
  let bars = 0
  for (const [tag] of part.matchAll(MEASURE)) {
    const { number, implicit } = measureOf(tag)
    bars = nextBar(number, implicit).index + 1
  }
  return bars
}

// One count per score file, a collection's parts included, by file name.
export function barCounts() {
  const { scores } = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'scores.json'), 'utf8'))
  const files = scores.flatMap((score) => partsOf(score).map((part) => part.file)).sort()
  return Object.fromEntries(files.map((file) => [file, barCount(openScore(readFileSync(join(PUBLIC_DIR, 'scores', file))).xml)]))
}

export const readRecorded = () => JSON.parse(readFileSync(RECORD_FILE, 'utf8'))

export const WHAT_A_CHANGE_COSTS =
  'Fingerings and practice history name a bar by its position in its file: a bar added or removed ' +
  're-points every bar after it, and a file renamed or removed leaves its history behind, for every ' +
  'player. A bar split for the layout is written <measure number="N" implicit="yes"> and changes ' +
  'nothing. A new score is recorded by node scripts/bar-counts.mjs; a change meant, with --accept <file>.'

if (process.argv[1] === import.meta.filename) {
  const { values } = parseArgs({ options: { accept: { type: 'string', multiple: true, default: [] } } })
  const recorded = readRecorded()
  const current = barCounts()
  const refused = Object.keys(recorded)
    .filter((file) => recorded[file] !== current[file] && !values.accept.includes(file))
    .map((file) => `  ${file}: ${recorded[file]} → ${current[file] ?? 'gone'}`)
  if (refused.length) {
    console.error(`${refused.length} recorded score(s) changed:\n${refused.join('\n')}\n${WHAT_A_CHANGE_COSTS}`)
    process.exit(1)
  }
  writeFileSync(RECORD_FILE, `${JSON.stringify(current, null, 2)}\n`)
  console.log(`${Object.keys(current).length} bar counts → ${RECORD_FILE}`)
}
