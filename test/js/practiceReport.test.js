import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { scoreModel, eventsOf, traversals } from '../../scripts/practice-report.mjs'
import { walkNotes } from '../../scripts/import-fingerings.mjs'
import { openScore } from '../../scripts/mxl.mjs'

const SCORES = join(import.meta.dirname, '..', '..', 'public', 'scores')

const note = (step, octave, { duration = 1, voice = 1, staff = 1, extra = '' } = {}) =>
  `<note>${extra}<pitch><step>${step}</step><octave>${octave}</octave></pitch><duration>${duration}</duration><voice>${voice}</voice><staff>${staff}</staff></note>`

// Two bars of four crotchets over two minims, both hands.
const bar = (number) => `<measure number="${number}">
  ${number === 1 ? '<attributes><divisions>1</divisions><staves>2</staves></attributes>' : ''}
  ${note('C', 4)}${note('D', 4)}${note('E', 4)}${note('F', 4)}
  <backup><duration>4</duration></backup>
  ${note('C', 3, { duration: 2, voice: 5, staff: 2 })}${note('G', 3, { duration: 2, voice: 5, staff: 2 })}
</measure>`
const XML = `<score-partwise><part id="P1">${bar(1)}${bar(2)}</part></score-partwise>`

// The keys each attack of a bar is completed by, in score order.
const attackKeys = (b) => [
  [`m${b}:0:0:0`, `m${b}:1:4:0`],
  [`m${b}:0:0:1`],
  [`m${b}:0:0:2`, `m${b}:1:4:1`],
  [`m${b}:0:0:3`],
]

// A note log of one segment, from [at, code, key, bar] events.
function log(events) {
  const keys = [...new Set(events.map(([, , key]) => key))]
  return eventsOf([
    {
      startedMs: 0,
      data: {
        keys,
        t: events.map(([at]) => at),
        e: events.map(([, code]) => code).join(''),
        p: events.map(() => 60),
        v: events.map(() => 64),
        n: events.map(([, , key]) => keys.indexOf(key)),
        b: events.map(([, , , b]) => b),
      },
    },
  ])
}

// The two bars played at one attack every `pace` ms, `late` ms more before the
// attacks listed in `delays` ("bar:attack", 0-based).
function played(pace, delays = {}) {
  const events = []
  let at = 0
  for (const b of [0, 1]) {
    attackKeys(b).forEach((keys, i) => {
      at += pace + (delays[`${b}:${i}`] ?? 0)
      for (const key of keys) events.push([at, 'd', key, b])
    })
  }
  return events
}

describe('scoreModel', () => {
  it('places each note at its position in the bar, both hands on a beat sharing one', () => {
    const { notes, bars } = scoreModel(XML)
    expect(notes.get('m0:0:0:2')).toMatchObject({ bar: 0, staff: 0, position: 0.5, midi: 64 })
    expect(notes.get('m1:1:4:1')).toMatchObject({ bar: 1, staff: 1, position: 0.5, midi: 55 })
    expect(bars[1]).toMatchObject({ duration: 1, positions: [0, 0.25, 0.5, 0.75] })
  })

  it('leaves the tied-on half of a tie and grace notes out of the attacks', () => {
    const xml = `<score-partwise><part id="P1"><measure number="1">
      <attributes><divisions>1</divisions></attributes>
      ${note('C', 4, { duration: 2, extra: '<tie type="start"/>' })}
      ${note('C', 4, { duration: 1, extra: '<tie type="stop"/>' })}
      ${note('B', 3, { duration: 0, extra: '<grace/>' })}${note('D', 4)}
    </measure></part></score-partwise>`
    const { notes, bars } = scoreModel(xml)
    expect(notes.get('m0:0:0:1').sounded).toBe(false)
    expect(notes.get('m0:0:0:2')).toMatchObject({ grace: true, position: 0.75 })
    expect(bars[0].positions).toEqual([0, 0.75])
  })

  // The keys are what the note log names its notes by: a walk that counts
  // differently files every key after the first difference under another note.
  it('names every note of every score the way fingerings and the note log do', () => {
    for (const file of readdirSync(SCORES).filter((f) => /\.(mxl|musicxml|xml)$/.test(f))) {
      const { xml } = openScore(readFileSync(join(SCORES, file)))
      expect([...scoreModel(xml).notes.keys()], file).toEqual([...walkNotes(xml)].map((n) => n.key))
    }
  })
})

describe('traversals', () => {
  const model = scoreModel(XML)

  it('finds a hole where the flow stopped, by the app’s rule', () => {
    const [run] = traversals(log(played(500, { '1:1': 1500 })), model)
    const holes = run.attacks.filter((a) => a.hole)
    expect(holes).toHaveLength(1)
    expect(holes[0]).toMatchObject({ sourceBar: 1, position: 0.25, ms: 2000 })
  })

  it('tells a hole at the bar line, the join, from one inside the bar', () => {
    const [run] = traversals(log(played(500, { '1:0': 1500 })), model)
    expect(run.attacks.find((a) => a.hole)).toMatchObject({ sourceBar: 1, position: 0, entry: true, joined: true })
  })

  it('counts the time a wrong note took as the mistake’s, not a hole', () => {
    const events = played(500, { '1:1': 1500 })
    const owedAt = events.findIndex(([, , key]) => key === 'm1:0:0:1')
    events.splice(owedAt, 0, [events[owedAt][0] - 100, 'w', 'm1:0:0:1', 1])
    const [run] = traversals(log(events), model)
    expect(run.wrong).toHaveLength(1)
    expect(run.attacks.find((a) => a.position === 0.25 && a.bar === 1)).toMatchObject({ faulted: true, hole: false })
  })

  it('starts a new traversal where the player went back to repeat', () => {
    const once = played(500)
    const again = once.filter(([, , , b]) => b === 1).map(([at, ...rest]) => [at + 5000, ...rest])
    const runs = traversals(log([...once, ...again]), model)
    expect(runs.map((r) => new Set(r.attacks.map((a) => a.bar)).size)).toEqual([2, 1])
  })
})
