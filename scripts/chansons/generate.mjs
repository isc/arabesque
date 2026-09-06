#!/usr/bin/env node
// Writes the MusicXML of every song in songs.mjs to public/scores/, one
// file per song, named from the collection prefix and the song's slug.
//
//   node scripts/chansons/generate.mjs
//
// The "Chansons" collection in public/data/scores.json is rewritten from the
// same list, so a song added here is in the library at once. Then re-run
// scripts/generate_fingerprints.rb: the songs are found by playing their
// first notes like any other score.
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { COLLECTION, SONGS } from './songs.mjs'

const DIVISIONS = 4 // per quarter
const VALUES = { w: 16, h: 8, q: 4, e: 2 }
const TYPES = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth' }
const STEP_ALTER = { '#': 1, b: -1 }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = join(ROOT, 'public', 'scores')
const CATALOG = join(ROOT, 'public', 'data', 'scores.json')

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// One event of a staff string: a note, a chord, or a rest.
function parseEvent(token) {
  let fingering = null
  const fingered = token.match(/^(.*)-(\d)$/)
  if (fingered) [, token, fingering] = fingered
  if (token === 'R') return { kind: 'measure-rest' }
  const value = token.match(/^(.*?)([whqe])(\.?)$/)
  if (!value) throw new Error(`Cannot read "${token}"`)
  const [, heads, letter, dot] = value
  const duration = VALUES[letter] * (dot ? 1.5 : 1)
  const base = { duration, type: TYPES[letter], dot: !!dot }
  if (heads === 'r') return { ...base, kind: 'rest' }
  const pitches = heads.split('+').map((p) => {
    const m = p.match(/^([A-G])([#b]?)(\d)$/)
    if (!m) throw new Error(`Cannot read the pitch "${p}"`)
    return { step: m[1], alter: STEP_ALTER[m[2]] ?? 0, octave: Number(m[3]) }
  })
  return { ...base, kind: 'notes', pitches, fingering }
}

function parseMeasure(text) {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  let time = null
  if (tokens[0]?.startsWith('@')) time = tokens.shift().slice(1)
  return { time, events: tokens.map(parseEvent) }
}

function parseStaff(text) {
  return text.split('|').map(parseMeasure)
}

function measureDuration(time) {
  const [beats, unit] = time.split('/').map(Number)
  return (beats * 4 * DIVISIONS) / unit
}

function noteXml(event, staff, voice, total) {
  if (event.kind === 'measure-rest') {
    return `<note print-object="no"><rest measure="yes"/><duration>${total}</duration><voice>${voice}</voice>${staff ? `<staff>${staff}</staff>` : ''}</note>`
  }
  const dot = event.dot ? '<dot/>' : ''
  if (event.kind === 'rest') {
    return `<note print-object="no"><rest/><duration>${event.duration}</duration><voice>${voice}</voice><type>${event.type}</type>${dot}${staff ? `<staff>${staff}</staff>` : ''}</note>`
  }
  return event.pitches
    .map((p, i) => {
      const alter = p.alter ? `<alter>${p.alter}</alter>` : ''
      const accidental = p.alter === 1 ? '<accidental>sharp</accidental>' : p.alter === -1 ? '<accidental>flat</accidental>' : ''
      // The fingering goes on the last head listed: the book writes it above
      // the chord, which is the top note's.
      const fingering =
        event.fingering && i === event.pitches.length - 1
          ? `<notations><technical><fingering>${event.fingering}</fingering></technical></notations>`
          : ''
      return `<note>${i ? '<chord/>' : ''}<pitch><step>${p.step}</step>${alter}<octave>${p.octave}</octave></pitch><duration>${event.duration}</duration><voice>${voice}</voice><type>${event.type}</type>${dot}${accidental}${staff ? `<staff>${staff}</staff>` : ''}${fingering}</note>`
    })
    .join('')
}

function songXml(song) {
  const staves = [parseStaff(song.rh)]
  if (song.lh) staves.push(parseStaff(song.lh))
  if (song.lh && staves[0].length !== staves[1].length) {
    throw new Error(`${song.slug}: ${staves[0].length} measures in the right hand, ${staves[1].length} in the left`)
  }
  const twoStaves = staves.length === 2
  const writtenIn = (measure, total) =>
    measure.events.reduce((sum, e) => sum + (e.kind === 'measure-rest' ? total : e.duration), 0)
  // A first measure shorter than the meter is a pickup, numbered 0.
  const firstNumber = writtenIn(staves[0][0], measureDuration(staves[0][0].time ?? song.time)) < measureDuration(staves[0][0].time ?? song.time) ? 0 : 1

  let time = song.time
  const measures = staves[0].map((rhMeasure, i) => {
    const number = firstNumber + i
    const isFirst = i === 0
    const timeChanged = rhMeasure.time && rhMeasure.time !== time
    if (rhMeasure.time) time = rhMeasure.time
    const total = measureDuration(time)
    const parts = []

    if (song.repeatStart === number) {
      parts.push('<barline location="left"><bar-style>heavy-light</bar-style><repeat direction="forward"/></barline>')
    }
    if (isFirst || timeChanged) {
      const attrs = [`<divisions>${DIVISIONS}</divisions>`]
      if (isFirst) attrs.push('<key><fifths>0</fifths></key>')
      const [beats, beatType] = time.split('/')
      attrs.push(`<time${song.showTime ? '' : ' print-object="no"'}><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`)
      if (isFirst) {
        if (twoStaves) attrs.push('<staves>2</staves>')
        attrs.push(`<clef${twoStaves ? ' number="1"' : ''}><sign>G</sign><line>2</line></clef>`)
        if (twoStaves) attrs.push('<clef number="2"><sign>F</sign><line>4</line></clef>')
      }
      parts.push(`<attributes>${attrs.join('')}</attributes>`)
    }
    if (song.fine != null && number === song.fine + 1) {
      parts.push('<direction placement="above"><direction-type><words font-weight="bold">Fin</words></direction-type><sound fine="yes"/></direction>')
    }
    if (song.dc === number) {
      parts.push('<direction placement="above"><direction-type><words font-weight="bold" halign="right">D.C.</words></direction-type><sound dacapo="yes"/></direction>')
    }

    const expected = number === 0 ? writtenIn(staves[0][0], total) : total
    staves.forEach((staff, s) => {
      const measure = staff[i]
      const staffNumber = twoStaves ? s + 1 : 0
      const voice = s + 1
      const written = writtenIn(measure, total)
      if (written !== expected) throw new Error(`${song.slug}, measure ${number}, staff ${s + 1}: ${written} instead of ${expected} divisions`)
      if (s > 0) parts.push(`<backup><duration>${written}</duration></backup>`)
      for (const event of measure.events) parts.push(noteXml(event, staffNumber, voice, total))
    })

    const last = i === staves[0].length - 1
    // The book closes the measure marked Fin with a double bar, unless the
    // next one opens with a repeat sign that already draws one.
    const closesFine = song.fine === number && song.repeatStart !== number + 1
    if (song.repeatEnd === number) {
      parts.push('<barline location="right"><bar-style>light-heavy</bar-style><repeat direction="backward"/></barline>')
    } else if (last || closesFine) {
      parts.push('<barline location="right"><bar-style>light-heavy</bar-style></barline>')
    }
    return `<measure number="${number}"${number === 0 ? ' implicit="yes"' : ''}>${parts.join('')}</measure>`
  })

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE score-partwise PUBLIC "-//Recordare//DTD MusicXML 4.0 Partwise//EN" "http://www.musicxml.org/dtds/partwise.dtd">
<score-partwise version="4.0">
  <work><work-title>${esc(song.title)}</work-title></work>
  <identification>
    <creator type="composer">${esc(COLLECTION.composer)}</creator>
    <encoding><software>scripts/chansons/generate.mjs</software></encoding>
  </identification>
  <part-list><score-part id="P1"><part-name>Piano</part-name></score-part></part-list>
  <part id="P1">
${measures.map((m) => '    ' + m).join('\n')}
  </part>
</score-partwise>
`
}

function fileNameOf(song, index) {
  return `${COLLECTION.filePrefix}_${String(index + 1).padStart(2, '0')}_${song.slug}.musicxml`
}

mkdirSync(OUT_DIR, { recursive: true })
SONGS.forEach((song, index) => {
  writeFileSync(join(OUT_DIR, fileNameOf(song, index)), songXml(song))
})

// The catalog keeps its hand layout: only the collection's own lines move.
const parts = SONGS.map((song, i) => `      { "title": ${JSON.stringify(song.title)}, "file": ${JSON.stringify(fileNameOf(song, i))} }`)
const block = `    { "title": ${JSON.stringify(COLLECTION.title)}, "composer": ${JSON.stringify(COLLECTION.composer)}, "parts": [\n${parts.join(',\n')}\n    ] }`
const catalog = readFileSync(CATALOG, 'utf8')
const pattern = new RegExp(`    \\{ "title": ${JSON.stringify(COLLECTION.title)}, "composer": [^\\n]*"parts": \\[\\n(?:      [^\\n]*\\n)*    \\] \\}`)
if (!pattern.test(catalog)) throw new Error(`No "${COLLECTION.title}" collection in ${CATALOG} to rewrite`)
writeFileSync(CATALOG, catalog.replace(pattern, block))
console.log(`${SONGS.length} songs written to ${OUT_DIR}, catalog updated`)
