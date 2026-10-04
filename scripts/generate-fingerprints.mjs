// Writes public/data/fingerprints.json: the opening notes of every score in
// the catalog, which the library matches against what is played on the MIDI
// keyboard to open a score from its first notes (library.js). Re-run after
// adding or removing a score:
//
//   node scripts/generate-fingerprints.mjs
//
// It stops without writing anything when a score cannot be read, or opens with
// too few notes to be found: the Ruby script this replaces warned, then wrote
// the file anyway and exited 0, so a machine without `unzip` emptied the
// fingerprints of every .mxl with nothing but a warning to show for it. test/js/fingerprints.test.js holds the committed
// file to what this makes of the scores as they are.
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { openScore } from './mxl.mjs'
import { PART, TOKEN, STAFF, VOICE, REST, GRACE, CHORD, TIE_START, TIE_STOP, CUE_OR_HIDDEN, numberOf } from './lib/musicxml.mjs'
import { MIN_MATCH } from '../public/js/fingerprints.js'

const PUBLIC_DIR = join(import.meta.dirname, '..', 'public')
export const OUTPUT_FILE = join(PUBLIC_DIR, 'data', 'fingerprints.json')
const NOTE_COUNT = 20

const STEP_SEMITONES = { C: 0, D: 2, E: 4, F: 5, G: 7, A: 9, B: 11 }

// The <tag>text</tag> of a note's pitch.
const text = (xml, tag) => new RegExp(`<${tag}>\\s*([^<]*)</${tag}>`).exec(xml)?.[1]

// The MIDI number of a note's pitch, or null for a note without one.
function midiOf(note) {
  const pitch = /<pitch>([\s\S]*?)<\/pitch>/.exec(note)?.[1]
  const step = pitch && text(pitch, 'step')?.trim()
  const octave = pitch && text(pitch, 'octave')
  if (!(step in STEP_SEMITONES) || octave === undefined) return null
  return 12 * (parseInt(octave, 10) + 1) + STEP_SEMITONES[step] + (parseInt(text(pitch, 'alter') ?? '0', 10) || 0)
}

// The melody a player starts with: voice 1 of the first part, one note per
// chord and per sounding (no rests, grace notes or tied-on notes), bar by bar,
// on the topmost staff voice 1 occupies in that bar — it can be engraved on the
// lower staff, when both hands play in the bass (Hanon) or the melody dips
// below the treble staff (The Entertainer). Cue and hidden notes are not
// played, and the app does not ask for them either (noteExtraction.js).
export function openingNotes(xml) {
  const part = xml.match(PART)?.[0] ?? ''
  const notes = []
  let byStaff = new Map()
  const endOfBar = () => {
    if (byStaff.size) notes.push(...byStaff.get(Math.min(...byStaff.keys())))
    byStaff = new Map()
  }
  for (const [token] of part.matchAll(TOKEN)) {
    if (token.startsWith('<measure')) {
      endOfBar()
      if (notes.length >= NOTE_COUNT) break
      continue
    }
    if (CUE_OR_HIDDEN.test(token) || REST.test(token) || GRACE.test(token) || CHORD.test(token)) continue
    if (numberOf(token, VOICE) !== 1) continue
    if (TIE_STOP.test(token) && !TIE_START.test(token)) continue
    const midi = midiOf(token)
    if (midi === null) continue
    const staff = numberOf(token, STAFF)
    byStaff.set(staff, [...(byStaff.get(staff) ?? []), midi])
  }
  endOfBar()
  return notes.slice(0, NOTE_COUNT)
}

// One fingerprint per score file, a collection's parts included, so that
// playing the opening of an exercise opens that exercise. Throws, naming every
// score it could not use, rather than leave any out.
export function fingerprints(catalog = JSON.parse(readFileSync(join(PUBLIC_DIR, 'data', 'scores.json'), 'utf8'))) {
  const entries = catalog.scores.flatMap((score) =>
    score.parts
      ? score.parts.map((part) => ({ title: `${score.title} — ${part.title}`, composer: score.composer, file: part.file }))
      : [score],
  )
  const errors = []
  const result = []
  for (const { title, composer, file } of entries) {
    try {
      const notes = openingNotes(openScore(readFileSync(join(PUBLIC_DIR, 'scores', file))).xml)
      if (notes.length < MIN_MATCH) throw new Error(`${notes.length} notes, and the library needs ${MIN_MATCH} to find a score`)
      result.push({ file, title, composer, notes })
    } catch (error) {
      errors.push(`${file}: ${error.message}`)
    }
  }
  if (errors.length) throw new Error(`${errors.length} score(s) left without a fingerprint:\n  ${errors.join('\n  ')}`)
  return result
}

// One fingerprint a line, as the file has always been written.
export function formatFingerprints(list) {
  return `{\n  "fingerprints": [\n    ${list.map((fp) => JSON.stringify(fp)).join(',\n    ')}\n  ]\n}\n`
}

if (process.argv[1] === import.meta.filename) {
  try {
    const list = fingerprints()
    writeFileSync(OUTPUT_FILE, formatFingerprints(list))
    console.log(`${list.length} fingerprints → ${OUTPUT_FILE}`)
  } catch (error) {
    console.error(error.message)
    process.exit(1)
  }
}
