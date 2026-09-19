import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { applyFingerings, walkNotes } from '../../scripts/import-fingerings.mjs'
import { openScore, readArchive, writeArchive, scoreEntry } from '../../scripts/mxl.mjs'

const ROOT = join(import.meta.dirname, '..', '..')
const fixture = (name) => readFileSync(join(ROOT, 'test', 'fixtures', name), 'utf8')

const score = (notes) => `<?xml version="1.0" encoding="UTF-8"?>
<score-partwise version="3.1">
  <part id="P1">
    <measure number="1">
${notes}
    </measure>
  </part>
</score-partwise>
`

const note = (body = '', { voice = 1, staff = 1 } = {}) => `      <note>
        <pitch><step>C</step><octave>4</octave></pitch><duration>1</duration><voice>${voice}</voice><type>quarter</type><staff>${staff}</staff>${body}
      </note>`

const REST = `      <note>
        <rest/><duration>1</duration><voice>1</voice><type>quarter</type><staff>1</staff>
      </note>`

// Applying the same fingerings again must be a no-op, so every assertion about
// the output is also an assertion about the second run.
function applyTwice(xml, fingerings) {
  const first = applyFingerings(xml, fingerings)
  const second = applyFingerings(first.xml, fingerings)
  expect(second.xml).toBe(first.xml)
  expect({ added: second.added, changed: second.changed }).toEqual({ added: 0, changed: 0 })
  return first
}

describe('writing a fingering onto a note', () => {
  it('creates the notations block a bare note has none of, after <type>', () => {
    const result = applyTwice(score(note()), { '1:0:0:0': 3 })
    expect(result.xml).toContain('<type>quarter</type>')
    expect(result.xml).toContain('<notations><technical><fingering>3</fingering></technical></notations>')
    expect(result).toMatchObject({ added: 1, changed: 0, unchanged: 0, missing: [] })
  })

  it('replaces a fingering already on the note, keeping its layout', () => {
    const existing = '\n        <notations><technical><fingering>1</fingering></technical></notations>'
    const result = applyTwice(score(note(existing)), { '1:0:0:0': 4 })
    expect(result.xml).toContain('<notations><technical><fingering>4</fingering></technical></notations>')
    expect(result.xml).not.toContain('<fingering>1</fingering>')
    expect(result).toMatchObject({ added: 0, changed: 1 })
  })

  it('replaces every fingering on the note, as the injector does for an ornament', () => {
    const existing =
      '\n        <notations><technical><fingering>1</fingering><fingering>2</fingering></technical></notations>'
    const result = applyTwice(score(note(existing)), { '1:0:0:0': 5 })
    expect(result.xml.match(/<fingering>/g)).toHaveLength(1)
    expect(result.xml).toContain('<fingering>5</fingering>')
  })

  it('keeps the other technical marks on the note', () => {
    const existing = '\n        <notations><technical><up-bow/><fingering>1</fingering></technical></notations>'
    const result = applyTwice(score(note(existing)), { '1:0:0:0': 2 })
    expect(result.xml).toContain('<technical><up-bow/><fingering>2</fingering></technical>')
  })

  it('adds a technical block to notations that carry only an articulation', () => {
    const existing = '\n        <notations><articulations><staccato/></articulations></notations>'
    const result = applyTwice(score(note(existing)), { '1:0:0:0': 2 })
    expect(result.xml).toContain(
      '<articulations><staccato/></articulations><technical><fingering>2</fingering></technical>',
    )
  })

  it('indents a fingering into a pretty-printed technical block the way its siblings are', () => {
    const existing = [
      '',
      '        <notations>',
      '          <technical>',
      '            <fingering>1</fingering>',
      '            </technical>',
      '          </notations>',
    ].join('\n')
    const result = applyTwice(score(note(existing)), { '1:0:0:0': 3 })
    expect(result.xml).toContain('\n            <fingering>3</fingering>\n            </technical>')
  })

  it('reports a fingering that is already exactly right as unchanged, and rewrites nothing', () => {
    const source = score(note('\n        <notations><technical><fingering>3</fingering></technical></notations>'))
    const result = applyFingerings(source, { '1:0:0:0': 3 })
    expect(result.xml).toBe(source)
    expect(result).toMatchObject({ added: 0, changed: 0, unchanged: 1 })
  })
})

describe('naming the note a key stands for', () => {
  it('counts pitched notes only, skipping rests, exactly as the injector does', () => {
    const result = applyTwice(score([note(), REST, note(), note()].join('\n')), { '1:0:0:1': 2 })
    const notes = [...result.xml.matchAll(/<note>[\s\S]*?<\/note>/g)]
    // The third <note> element, which is the second pitched one once the rest is skipped.
    expect(notes.findIndex((match) => match[0].includes('<fingering>'))).toBe(2)
  })

  it('counts each staff and voice on its own, and restarts at every measure', () => {
    const twoMeasures = `<?xml version="1.0"?>
<score-partwise><part id="P1">
  <measure number="1">
${note('', { voice: 2, staff: 2 })}
${note()}
  </measure>
  <measure number="2">
${note()}
  </measure>
</part></score-partwise>`
    const result = applyTwice(twoMeasures, { '1:1:1:0': 1, '1:0:0:0': 2, '2:0:0:0': 3 })
    expect(result.added).toBe(3)
    expect(result.missing).toEqual([])
  })

  it('is not fooled by a <measure-style> element into restarting the count', () => {
    const withMeasureStyle = score(
      [note(), '      <attributes><measure-style><slash type="start"/></measure-style></attributes>', note()].join(
        '\n',
      ),
    )
    expect(applyTwice(withMeasureStyle, { '1:0:0:1': 4 }).added).toBe(1)
  })

  it('reports a key that names no note in this engraving rather than dropping it', () => {
    const result = applyFingerings(score(note()), { '1:0:0:0': 1, '9:0:0:4': 2 })
    expect(result.missing).toEqual(['9:0:0:4'])
  })

  it('leaves a score alone when the export has nothing for it', () => {
    const source = score(note())
    expect(applyFingerings(source, {}).xml).toBe(source)
  })
})

describe('a real MuseScore-shaped fixture', () => {
  it('rewrites only the notes it was given, leaving every other line alone', () => {
    const source = fixture('two-voice-fingerings.xml')
    // The first note of staff 1 / voice 1, and the second of staff 2 / voice 5.
    const result = applyTwice(source, { '1:0:0:0': 2, '1:1:4:1': 4 })
    expect(result).toMatchObject({ added: 0, changed: 2 })

    const before = source.split('\n')
    const after = result.xml.split('\n')
    expect(after).toHaveLength(before.length)
    expect(after.filter((line, i) => line !== before[i]).map((line) => line.trim())).toEqual([
      '<notations><technical><fingering>2</fingering></technical></notations>',
      '<notations><technical><fingering>4</fingering></technical></notations>',
    ])
  })
})

describe('an .mxl archive', () => {
  const archive = (xml) =>
    writeArchive([
      {
        name: 'META-INF/container.xml',
        data: Buffer.from('<container><rootfiles><rootfile full-path="score.xml"/></rootfiles></container>'),
      },
      { name: 'score.xml', data: Buffer.from(xml, 'utf8') },
    ])

  it('round-trips through the score entry the container names', () => {
    const source = score(note())
    const opened = openScore(archive(source))
    expect(opened.xml).toBe(source)

    const written = opened.write(applyFingerings(source, { '1:0:0:0': 3 }).xml)
    expect(openScore(written).xml).toContain('<fingering>3</fingering>')
  })

  it('keeps the other entries of the archive it rewrites', () => {
    const opened = openScore(archive(score(note())))
    const rewritten = readArchive(opened.write('<score-partwise/>'))
    expect(rewritten.map((entry) => entry.name)).toEqual(['META-INF/container.xml', 'score.xml'])
    expect(scoreEntry(rewritten).data.toString('utf8')).toBe('<score-partwise/>')
  })

  it('writes the same bytes for the same contents, so a second import is a no-op on disk', () => {
    const source = score(note())
    const once = openScore(archive(source)).write(applyFingerings(source, { '1:0:0:0': 3 }).xml)
    const reopened = openScore(once)
    expect(reopened.write(applyFingerings(reopened.xml, { '1:0:0:0': 3 }).xml).equals(once)).toBe(true)
  })

  it('reads a plain .xml score without a ZIP in sight', () => {
    const source = score(note())
    const opened = openScore(Buffer.from(source, 'utf8'))
    expect(opened.xml).toBe(source)
    expect(opened.write(source).toString('utf8')).toBe(source)
  })
})

// The bug this exists to prevent, and did not: the walk read `number="1"` only,
// so the twenty Hanon files — written by scripts/split_hanon.rb through REXML,
// which quotes with apostrophes — numbered every measure NaN and matched no
// note at all. Every fixture above is hand-written and double-quoted, so the
// whole suite passed while the script was broken on a fifth of the library.
describe('a measure number in either quote style', () => {
  const singleQuoted = score(note()).replace('<measure number="1">', "<measure number='1'>")

  it('is read the way MuseScore and REXML each write it', () => {
    expect([...walkNotes(score(note()))].map(({ key }) => key)).toEqual(['1:0:0:0'])
    expect([...walkNotes(singleQuoted)].map(({ key }) => key)).toEqual(['1:0:0:0'])
  })
})

// And the same walk over the files the script actually edits, which is where
// that bug lived. It cannot assert the keys themselves without a DOM to run
// fingeringInjector.js's walk against — that differential was run by hand over
// all 98 scores in a browser and comes out identical — but it does pin the half
// that is checkable here: the token pass sees every note the injector's
// querySelectorAll('note') sees.
describe('the shipped scores', () => {
  const dir = join(ROOT, 'public', 'scores')
  const files = readdirSync(dir).sort()

  it('are all there', () => {
    expect(files.length).toBeGreaterThan(50)
  })

  it.each(files)('%s yields a key for every note it can finger', (file) => {
    const { xml } = openScore(readFileSync(join(dir, file)))
    const keys = [...walkNotes(xml)].map(({ key }) => key)
    const notes = xml.match(/<note(?:\s[^>]*)?>[\s\S]*?<\/note>/g) ?? []

    expect(keys.length).toBe(notes.filter((note) => !/<rest(?:[\s/>])/.test(note)).length)
    expect(keys.length).toBeGreaterThan(0)
  })

  // Deliberately not asserted: that the keys are distinct, or that none of them
  // says NaN. Both happen, and the injector agrees note for note — a score whose
  // measures are all `number="0"` (Gnossienne No. 1, which has no barlines) gives
  // every measure the same keys, and a second-ending measure numbered "X1" (The
  // Entertainer) parses to NaN. That is the app's key scheme, and this script's
  // job is to mirror it, not to improve on it: diverging here would land a
  // promoted fingering on a note the player never fingered.
})
