import { describe, it, expect, beforeEach } from 'vitest'
import { installLocalStorage } from './support/browserGlobals.js'
import { initNoteLog, sessionOfSegment, SEGMENT_EVENTS, PENDING_NOTE_LOG_KEY } from '../../public/js/noteLog.js'

// A storage that keeps what is written, and a session the page can switch.
function aPage(held = new Map()) {
  const page = { sessionId: 's1', held, saved: () => [...held.values()] }
  const storage = {
    saveNoteLog: async (segment) => held.set(segment.id, structuredClone(segment)),
    addNoteLog: async (segment) => {
      if (held.has(segment.id)) throw Object.assign(new Error('held'), { name: 'ConstraintError' })
      held.set(segment.id, segment)
    },
    deleteNoteLogsBefore: async () => {},
  }
  page.log = initNoteLog({ storage, sessionId: () => page.sessionId })
  return page
}

const note = (fingeringKey) => ({ fingeringKey })

describe('the note log', () => {
  let page
  beforeEach(() => {
    installLocalStorage()
    page = aPage()
  })

  it('writes what the score made of each key, in columns', async () => {
    const { log } = page
    log.keyDown(60, 70, { noteData: note('m1:0:0:0'), measureIndex: 0, wrong: false })
    log.keyDown(63, 40, { noteData: note('m1:0:0:1'), measureIndex: 0, wrong: true })
    log.keyUp(60)
    log.keyDown(64, 55)
    log.pedal(127)
    log.keyDown(62, 66, { noteData: note('m1:0:0:1'), measureIndex: 0, wrong: false })
    await log.flush()

    const [segment] = page.saved()
    expect(segment).toMatchObject({
      id: 's1:0',
      sessionId: 's1',
      keys: ['m1:0:0:0', 'm1:0:0:1'],
      e: 'dwuxpd',
      p: [60, 63, 60, 64, 127, 62],
      v: [70, 40, 0, 55, 0, 66],
      n: [0, 1, -1, -1, -1, 1],
      b: [0, 0, -1, -1, -1, 0],
    })
    expect(segment.t).toHaveLength(6)
    expect(Date.parse(segment.startedAt)).not.toBeNaN()
  })

  it('writes nothing while no session is under way', async () => {
    page.sessionId = null
    page.log.keyDown(60, 70)
    await page.log.flush()
    expect(page.saved()).toEqual([])
  })

  it('starts a segment of its own with each session, numbered within it', async () => {
    page.log.keyDown(60, 70)
    page.sessionId = 's2'
    page.log.keyDown(62, 70)
    await page.log.flush()
    page.log.keyDown(64, 70)
    await page.log.flush()
    expect(page.saved().map((s) => [s.id, s.e])).toEqual([['s1:0', 'x'], ['s2:0', 'x'], ['s2:1', 'x']])
    expect(sessionOfSegment('1791987424375-psu0m1s:12')).toBe('1791987424375-psu0m1s')
  })

  it('writes a segment once it is full, and goes on in the next', async () => {
    for (let i = 0; i <= SEGMENT_EVENTS; i++) page.log.keyUp(60)
    await page.log.flush()
    expect(page.saved().map((s) => [s.id, s.e.length])).toEqual([['s1:0', SEGMENT_EVENTS], ['s1:1', 1]])
  })

  // A continuous pedal sends dozens of values a press.
  it('keeps the pedal from one band to the next, and at both ends', async () => {
    for (const value of [0, 3, 9, 20, 25, 70, 126, 127, 127, 60, 1, 0]) page.log.pedal(value)
    await page.log.flush()
    expect(page.saved()[0].p).toEqual([0, 20, 70, 126, 127, 127, 60, 1, 0])
  })

  it('leaves the segment under way for the next page, which writes it unless it was', async () => {
    page.log.keyDown(60, 70)
    // The way out: kept, and its write started.
    page.log.leave()
    expect(JSON.parse(localStorage.getItem(PENDING_NOTE_LOG_KEY)).e).toBe('x')

    // The write got there: the next page's copy is the older one, and loses.
    const next = aPage(page.held)
    expect(localStorage.getItem(PENDING_NOTE_LOG_KEY)).toBeNull()
    await next.log.tidy()
    expect(next.saved().map((s) => s.id)).toEqual(['s1:0'])

    // It did not: the next page writes it.
    page.log.keyDown(62, 70)
    page.log.leave()
    page.held.clear()
    const after = aPage(page.held)
    await after.log.tidy()
    expect(after.saved().map((s) => [s.id, s.e])).toEqual([['s1:1', 'x']])
  })
})
