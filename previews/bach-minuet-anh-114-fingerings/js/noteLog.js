// Every key the player presses and lets go, and what the score made of it: the
// raw material for reading a practice session after the fact — which note of
// bar 33 the run keeps stalling on, which hand comes in late at a join, what
// the wrong notes of bar 31 actually are. The session record only keeps a
// count per measure (practiceTracker.js), which says that something went
// wrong and not what.
//
// Kept per session, in segments of at most SEGMENT_EVENTS events, each its
// own record (storage.js): a segment is written whole once, never rewritten as
// it grows, and a page that goes away mid-session leaves the one under way
// for the next page to write (leave). A segment is columns rather than an
// object per event — ~17 bytes an event, a note being two, down and up:
//
//   t   ms since the segment started (startedAt)
//   e   one character per event:
//         d  a key down the score took: the note `n` of playback bar `b`
//         w  a wrong key: `n` is the note that was owed, in bar `b`
//         x  a key down nothing took or judged — between two bars, under a
//            trill, or in strict mode, whose own engine judges it
//         u  a key up
//         p  the sustain pedal, `p` holding its value
//   p   the MIDI note (or the pedal's value)
//   v   the velocity, 0 for a key up and the pedal
//   n   an index into `keys`, the notes' fingering keys (fingeringKeys.js),
//       or -1
//   b   the playback index of the bar (noteExtraction.js), or -1
//
// The session itself says the score and the mode. A segment's id is its
// session's, then its number in it (`<session id>:<n>`), and a session's id
// opens on the epoch ms it started at (practiceTracker.js): what sync and
// pruning read a segment's session and age from, without reading the segment.
// Segments go up with sync (sync.js), which drops them here once the server
// has them; a player who never signs in keeps the last RETENTION_DAYS.
import { recordError } from './errorLog.js'
import { scopedKey } from './profiles.js'

export const SEGMENT_EVENTS = 500
export const RETENTION_DAYS = 60

// A continuous pedal sends dozens of values a press, where a switch sends
// two: kept from one band of PEDAL_BAND to the next, which still tells a half
// pedal, and always at rest and fully down.
const PEDAL_BAND = 16

// Where the segment under way waits when the page goes, for the next page to
// write: IndexedDB writes started on the way out are not to be counted on,
// which is how sessions came to be stranded (practiceTracker.js). The
// profile's own, like the database the segment belongs in.
export const PENDING_NOTE_LOG_KEY = scopedKey('arabesque:pending-note-log')

// The session a segment id belongs to.
export const sessionOfSegment = (id) => id.slice(0, id.lastIndexOf(':'))

// `sessionId` answers the session under way, or null when there is none (a
// score opened from a file, which has no session to file anything under).
export function initNoteLog({ storage, sessionId }) {
  // What the last page left, taken at once: this page's own replaces it.
  const leftBehind = takeStash()
  // The events not yet written: one segment, of the session under way.
  let segment = null
  // What times the segment's events.
  let origin = 0
  // The last segment opened, which numbers the next one of the same session.
  let last = { sessionId: null, seq: -1 }
  let pedalBand = null

  function open(id) {
    last = { sessionId: id, seq: last.sessionId === id ? last.seq + 1 : 0 }
    origin = performance.now()
    return { id: `${id}:${last.seq}`, sessionId: id, startedAt: new Date().toISOString(), keys: [], t: [], e: '', p: [], v: [], n: [], b: [] }
  }

  function record(code, pitch, velocity = 0, taken = null) {
    const id = sessionId()
    if (!id) return
    if (segment && segment.sessionId !== id) flush()
    segment ??= open(id)

    let index = -1
    const key = taken?.noteData.fingeringKey
    if (key) {
      index = segment.keys.indexOf(key)
      if (index < 0) index = segment.keys.push(key) - 1
    }
    segment.t.push(Math.round(performance.now() - origin))
    segment.e += code
    segment.p.push(pitch)
    segment.v.push(velocity)
    segment.n.push(index)
    segment.b.push(taken?.measureIndex ?? -1)
    if (segment.e.length >= SEGMENT_EVENTS) flush()
  }

  // Writes the segment under way, if anything is in it. Not awaited by
  // anyone who has a key to answer: the write is IndexedDB's business.
  async function flush() {
    if (!segment) return
    const written = segment
    segment = null
    try {
      await storage.saveNoteLog(written)
    } catch (error) {
      recordError(error, 'Note log could not be saved')
    }
  }

  return {
    // `taken` is what the score engine made of the key (activateNote in
    // musicxml.js): null when it took no part in it.
    keyDown: (pitch, velocity, taken = null) => record(!taken ? 'x' : taken.wrong ? 'w' : 'd', pitch, velocity, taken),
    keyUp: (pitch) => record('u', pitch),
    pedal(value) {
      const band = Math.floor(value / PEDAL_BAND)
      if (band === pedalBand && value !== 0 && value !== 127) return
      pedalBand = band
      record('p', value)
    },
    flush,
    // The page going away, or to the background where it may never come back
    // from: the segment under way kept synchronously for the next page, then
    // written — if the write gets there, the next page finds it written.
    leave() {
      if (!segment) return
      try {
        localStorage.setItem(PENDING_NOTE_LOG_KEY, JSON.stringify(segment))
      } catch {
        /* quota or no storage: its fate is the write's */
      }
      flush()
    },
    // The page's housekeeping, nobody waiting on it: what the last page left
    // written, unless its own write got there first, and what this device no
    // longer keeps dropped, synced or not.
    async tidy() {
      try {
        if (leftBehind) await storage.addNoteLog(leftBehind)
      } catch (error) {
        if (error?.name !== 'ConstraintError') recordError(error, 'Stashed note log could not be saved')
      }
      try {
        await storage.deleteNoteLogsBefore(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000)
      } catch (error) {
        recordError(error, 'Old note logs could not be dropped')
      }
    },
  }
}

function takeStash() {
  try {
    const stashed = JSON.parse(localStorage.getItem(PENDING_NOTE_LOG_KEY))
    localStorage.removeItem(PENDING_NOTE_LOG_KEY)
    return stashed?.id ? stashed : null
  } catch {
    return null
  }
}
