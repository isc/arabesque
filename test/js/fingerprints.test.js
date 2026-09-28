import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fingerprints, formatFingerprints, openingNotes, OUTPUT_FILE } from '../../scripts/generate-fingerprints.mjs'

// The file is written by hand, after a score is added or changed: a score
// changed without it is found by its old opening, or not at all.
describe('fingerprints.json', () => {
  it('is what the generator makes of the scores as they are', () => {
    expect(readFileSync(OUTPUT_FILE, 'utf8')).toBe(formatFingerprints(fingerprints()))
  })
})

// Notes as a MusicXML measure writes them, voice 1 on the top staff unless
// told otherwise.
const note = (step, { octave = 4, voice = 1, staff = 1, extra = '', attributes = '' } = {}) =>
  `<note${attributes}><pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>1</duration><voice>${voice}</voice><staff>${staff}</staff>${extra}</note>`
const score = (...measures) =>
  `<score-partwise><part-list><score-part id="P1"/></part-list><part id="P1">${measures.map((notes) => `<measure>${notes.join('')}</measure>`).join('')}</part></score-partwise>`

describe('openingNotes', () => {
  it('reads the melody the player starts with', () => {
    expect(openingNotes(score([note('C'), note('E')], [note('G')]))).toEqual([60, 64, 67])
  })

  it('leaves out what is not played at the start of a note: rests, grace notes, chords, ties held on', () => {
    expect(openingNotes(score([
      note('C'),
      note('B', { extra: '<rest/>' }),
      note('D', { extra: '<grace/>' }),
      note('G', { extra: '<chord/>' }),
      note('C', { extra: '<tie type="stop"/>' }),
      note('E'),
    ]))).toEqual([60, 64])
  })

  // As the app does: the player is never asked for them (noteExtraction.js).
  it('leaves out hidden and cue notes', () => {
    expect(openingNotes(score([
      note('C', { attributes: ' print-object="no"' }),
      note('D', { extra: '<cue/>' }),
      note('F', { extra: '<type size="cue">eighth</type>' }),
      note('E'),
    ]))).toEqual([64])
  })

  // As the Hanon files write them, through REXML.
  it('reads attributes in single quotes too', () => {
    expect(openingNotes(score([
      note('C', { attributes: " print-object='no'" }),
      note('D', { extra: "<tie type='stop'/>" }),
      note('E'),
    ]))).toEqual([64])
  })

  it('follows voice 1 onto the topmost staff it occupies in each bar', () => {
    expect(openingNotes(score(
      [note('C', { staff: 2, octave: 3 }), note('E', { voice: 2 })],
      [note('G', { staff: 2, octave: 3 }), note('A', { staff: 1 })],
    ))).toEqual([48, 69])
  })
})

describe('the generator', () => {
  it('refuses to leave a score out', () => {
    expect(() => fingerprints({ scores: [{ title: 'Nowhere', composer: 'Nobody', file: 'nowhere.mxl' }] })).toThrow(/nowhere\.mxl/)
  })
})
