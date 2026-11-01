#!/usr/bin/env node
// Writes the MusicXML of every song in songs.mjs to public/scores/, one
// file per song, named from the collection prefix and the song's slug.
//
//   node scripts/chansons/generate.mjs
//
// The "Chansons" collection in public/data/scores.json is rewritten from the
// same list, so a song added here is in the library at once. Then re-run
// scripts/generate-fingerprints.mjs: the songs are found by playing their
// first notes like any other score.
import { writeFileSync, mkdirSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { COLLECTION, SONGS } from './songs.mjs'
import { replaceOnce } from '../replace-once.mjs'

const DIVISIONS = 4 // per quarter
const VALUES = { w: 16, h: 8, q: 4, e: 2 }
const TYPES = { w: 'whole', h: 'half', q: 'quarter', e: 'eighth' }
const STEP_ALTER = { '#': 1, b: -1, n: 0 }

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const OUT_DIR = join(ROOT, 'public', 'scores')
const CATALOG = join(ROOT, 'public', 'data', 'scores.json')

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// One event of a staff string: a note, a chord, or a rest.
function parseEvent(token) {
  let fingering = null
  const fingered = token.match(/^(.*)-(\d+)$/)
  if (fingered) [, token, fingering] = fingered
  const staccato = token.endsWith('!')
  if (staccato) token = token.slice(0, -1)
  if (token === 'R') return { kind: 'measure-rest' }
  const value = token.match(/^(.*?)([whqe])(\.?)$/)
  if (!value) throw new Error(`Cannot read "${token}"`)
  const [, heads, letter, dot] = value
  const duration = VALUES[letter] * (dot ? 1.5 : 1)
  const base = { duration, type: TYPES[letter], dot: !!dot }
  if (heads === 'r' || heads === 'S') return { ...base, kind: 'rest', printed: heads === 'S' }
  const pitches = heads.split('+').map((p) => {
    const m = p.match(/^([A-G])([#bn]?)(\d)$/)
    if (!m) throw new Error(`Cannot read the pitch "${p}"`)
    return { step: m[1], alter: STEP_ALTER[m[2]] ?? 0, natural: m[2] === 'n', octave: Number(m[3]) }
  })
  if (fingering?.length > 1 && fingering.length !== pitches.length) {
    throw new Error(`"${token}-${fingering}": ${fingering.length} fingerings for ${pitches.length} notes`)
  }
  return { ...base, kind: 'notes', pitches, fingering, staccato }
}

// `*f` marks the event after it with a dynamic.
function parseMeasure(text) {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  let time = null
  if (tokens[0]?.startsWith('@')) time = tokens.shift().slice(1)
  const events = []
  let dynamic = null
  for (const token of tokens) {
    if (token.startsWith('*')) dynamic = token.slice(1)
    else {
      events.push(dynamic ? { ...parseEvent(token), dynamic } : parseEvent(token))
      dynamic = null
    }
  }
  if (dynamic) throw new Error(`*${dynamic} marks no event: "${text.trim()}"`)
  return { time, events }
}

// A staff's words: measures split by `|` like its notes, syllables by spaces.
// A syllable ending in `-` is hyphenated to the next one, across a barline
// too ("et Mon- | sieur"), so the syllabic type is read off the whole staff
// rather than one measure at a time. A `_` is a space within a syllable.
function parseWords(text) {
  let open = false
  return text.split('|').map((measure) =>
    measure
      .trim()
      .split(/\s+/)
      .filter(Boolean)
      .map((syllable) => {
        const opens = syllable.endsWith('-')
        const syllabic = opens ? (open ? 'middle' : 'begin') : open ? 'end' : 'single'
        open = opens
        return { syllabic, text: syllable.replace(/-$/, '').replace(/_/g, '\u00a0') }
      }),
  )
}

function parseStaff(text, words = '') {
  const sungWords = parseWords(words)
  return text.split('|').map((measure, i) => ({ ...parseMeasure(measure), syllables: sungWords[i] ?? [] }))
}

// A measure's divisions: the 4 in "3/4" is a quarter, and it holds three.
function measureDuration(time) {
  const [beats, beatType] = time.split('/').map(Number)
  return (beats * 4 * DIVISIONS) / beatType
}

// Eighths filling a beat come out beamed, the way the book beams them; a lone
// eighth keeps its flag. OSMD draws no beam the MusicXML does not ask for, hence
// the rule. A beat holds two eighths in a meter that counts in quarters, three
// in 6/8; any other meter is refused rather than guessed at, which would print
// no beam at all and say nothing.
function beamed(events, time) {
  const group = time.endsWith('/4') ? 2 : time === '6/8' ? 3 : null
  if (!group) throw new Error(`No beaming rule for ${time}`)
  const beat = group * VALUES.e
  const beamable = (event) => event.kind === 'notes' && event.type === 'eighth' && !event.dot
  const beamedEvents = [...events]
  let at = 0
  events.forEach((event, k) => {
    const run = events.slice(k, k + group)
    if (at % beat === 0 && run.length === group && run.every(beamable)) {
      run.forEach((inRun, r) => {
        beamedEvents[k + r] = { ...inRun, beam: r === 0 ? 'begin' : r === group - 1 ? 'end' : 'continue' }
      })
    }
    // A measure rest is alone in its measure, so the cursor never passes it.
    at += event.duration ?? 0
  })
  return beamedEvents
}

// The syllables of a measure land on its notes in order — a rest is not sung,
// and a measure may run out of words before it runs out of notes. What is left
// once the notes have theirs sits under a printed rest: the book counts its
// rests out loud, « (1 2 3) ».
function sung(events, syllables) {
  const places = [...events.filter((event) => event.kind === 'notes'), ...events.filter((event) => event.printed)]
  if (syllables.length > places.length) {
    throw new Error(`${syllables.length} syllables for ${places.length} places: "${syllables.map((syllable) => syllable.text).join(' ')}"`)
  }
  return events.map((event) => {
    const lyric = syllables[places.indexOf(event)]
    return lyric ? { ...event, lyric } : event
  })
}

function lyricXml({ syllabic, text }) {
  return `<lyric number="1"><syllabic>${syllabic}</syllabic><text>${esc(text)}</text></lyric>`
}

function noteXml(event, staff, voice, total) {
  if (event.kind === 'measure-rest') {
    return `<note print-object="no"><rest measure="yes"/><duration>${total}</duration><voice>${voice}</voice>${staff ? `<staff>${staff}</staff>` : ''}</note>`
  }
  const dot = event.dot ? '<dot/>' : ''
  if (event.kind === 'rest') {
    return `<note${event.printed ? '' : ' print-object="no"'}><rest/><duration>${event.duration}</duration><voice>${voice}</voice><type>${event.type}</type>${dot}${staff ? `<staff>${staff}</staff>` : ''}${event.lyric ? lyricXml(event.lyric) : ''}</note>`
  }
  return event.pitches
    .map((p, i) => {
      const alter = p.alter ? `<alter>${p.alter}</alter>` : ''
      // Every altered note prints its accidental, under a key signature too:
      // the book writes the sharp of the F it has just taught each time. A
      // natural prints only where the string asks for it (Fn4).
      const accidental =
        p.alter === 1 ? '<accidental>sharp</accidental>' : p.alter === -1 ? '<accidental>flat</accidental>' : p.natural ? '<accidental>natural</accidental>' : ''
      // A beam and a syllable belong to the chord, so to its first head only.
      const beam = event.beam && i === 0 ? `<beam number="1">${event.beam}</beam>` : ''
      const lyric = event.lyric && i === 0 ? lyricXml(event.lyric) : ''
      // A single fingering goes on the last head listed: the book writes it
      // above the chord, which is the top note's. One digit per head fingers
      // each of them, in the order they are listed.
      const finger = event.fingering?.length > 1 ? event.fingering[i] : i === event.pitches.length - 1 ? event.fingering : null
      const technical = finger ? `<technical><fingering>${finger}</fingering></technical>` : ''
      const articulation = event.staccato && i === 0 ? '<articulations><staccato/></articulations>' : ''
      const notated = articulation + technical
      const notations = notated ? `<notations>${notated}</notations>` : ''
      return `<note>${i ? '<chord/>' : ''}<pitch><step>${p.step}</step>${alter}<octave>${p.octave}</octave></pitch><duration>${event.duration}</duration><voice>${voice}</voice><type>${event.type}</type>${dot}${accidental}${staff ? `<staff>${staff}</staff>` : ''}${beam}${notations}${lyric}</note>`
    })
    .join('')
}

function songXml(song) {
  const staves = [parseStaff(song.rh, song.rhWords)]
  if (song.lh) staves.push(parseStaff(song.lh, song.lhWords))
  if (song.lh && staves[0].length !== staves[1].length) {
    throw new Error(`${song.slug}: ${staves[0].length} measures in the right hand, ${staves[1].length} in the left`)
  }
  const twoStaves = staves.length === 2
  const writtenIn = (measure, total) =>
    measure.events.reduce((sum, e) => sum + (e.kind === 'measure-rest' ? total : e.duration), 0)
  // A first measure shorter than the meter is a pickup, numbered 0.
  const firstTotal = measureDuration(staves[0][0].time ?? song.time)
  const pickup = writtenIn(staves[0][0], firstTotal)
  const firstNumber = pickup < firstTotal ? 0 : 1

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
      if (isFirst) attrs.push(`<key><fifths>${song.fifths ?? 0}</fifths></key>`)
      const [beats, beatType] = time.split('/')
      attrs.push(`<time${song.showTime ? '' : ' print-object="no"'}><beats>${beats}</beats><beat-type>${beatType}</beat-type></time>`)
      if (isFirst) {
        if (twoStaves) attrs.push('<staves>2</staves>')
        attrs.push(`<clef${twoStaves ? ' number="1"' : ''}><sign>G</sign><line>2</line></clef>`)
        if (twoStaves) attrs.push('<clef number="2"><sign>F</sign><line>4</line></clef>')
      }
      parts.push(`<attributes>${attrs.join('')}</attributes>`)
    }

    // The last measure may hold only what the pickup left of the meter.
    const last = i === staves[0].length - 1
    const remainder = total - pickup
    const expected = number === 0 ? pickup : firstNumber === 0 && last && writtenIn(rhMeasure, total) === remainder ? remainder : total
    staves.forEach((staff, s) => {
      const measure = staff[i]
      const staffNumber = twoStaves ? s + 1 : 0
      const voice = s + 1
      const written = writtenIn(measure, total)
      if (written !== expected) throw new Error(`${song.slug}, measure ${number}, staff ${s + 1}: ${written} instead of ${expected} divisions`)
      if (s > 0) parts.push(`<backup><duration>${written}</duration></backup>`)
      const events = sung(beamed(measure.events, time), measure.syllables)
      for (const event of events) {
        // The book prints a dynamic under the treble and over the bass, between the staves.
        if (event.dynamic) {
          parts.push(
            `<direction placement="${s === 0 ? 'below' : 'above'}"><direction-type><dynamics><${event.dynamic}/></dynamics></direction-type><voice>${voice}</voice>${staffNumber ? `<staff>${staffNumber}</staff>` : ''}</direction>`,
          )
        }
        parts.push(noteXml(event, staffNumber, voice, total))
      }
    })

    // Fine closes the bar the piece ends in, and a D.C. that leads back to it
    // says so. The book prints « Fin » and « D.C. », but OSMD — whose cursor
    // the app follows, and which works out the playing order (noteExtraction.js)
    // — reads the Italian words only, and only there: « Fin », or « Fine » at
    // the head of the next bar, and the piece ran on past its end.
    const closing = (words, sound) =>
      `<direction placement="above"><direction-type><words font-weight="bold" halign="right">${words}</words></direction-type><sound ${sound}="yes"/></direction>`
    if (song.fine === number) parts.push(closing('Fine', 'fine'))
    if (song.dc === number) parts.push(closing(song.fine != null ? 'D.C. al Fine' : 'D.C.', 'dacapo'))

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
const pattern = new RegExp(`    \\{ "title": ${JSON.stringify(COLLECTION.title)}, "composer": [^\\n]*"parts": \\[\\n(?:      [^\\n]*\\n)*    \\] \\}`)
replaceOnce(CATALOG, pattern, block)
console.log(`${SONGS.length} songs written to ${OUT_DIR}, catalog updated`)
