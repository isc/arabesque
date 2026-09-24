import { fingeringKey, nextNoteIndex } from './fingeringKeys.js'

function getElementInt(parent, tagName, defaultValue) {
  const el = parent.querySelector(tagName)
  return el ? parseInt(el.textContent, 10) : defaultValue
}

// How many staves each <part> brings, so a note's staff can be numbered across
// the whole sheet rather than within its part -- which is how OSMD numbers it,
// and the two have to agree or a fingering written on the second part's staff
// is drawn on the first part's. The max of what the part declares, because a
// part that grows a staff mid-score keeps the room it ended up needing; parts
// declare it once and never change it in practice.
function staffOffsetsByPart(parts) {
  const offsets = []
  let total = 0
  for (const part of parts) {
    offsets.push(total)
    const declared = [...part.querySelectorAll('staves')].map((el) => parseInt(el.textContent, 10))
    total += Math.max(1, ...declared.filter(Number.isFinite))
  }
  return offsets
}

// Every note of a parsed MusicXML document that can carry a fingering, in
// document order, each with the key it is filed under: { note, key }.
//
// This is the one walk that reads the score as the file writes it, and it has
// to name the same notes as the walk over OSMD's sheet in noteExtraction.js --
// the browser stores a fingering under the name that walk gives, and finds it
// again under the name this one gives. Injection has to happen before
// osmd.load(), so the two walks cannot be merged; separated from the injection
// itself, this one can at least be held against the other on every score in the
// library (test/fingering_key_scheme_test.rb).
export function* fingeringNotesInDocument(doc) {
  const parts = [...doc.querySelectorAll('part')]
  const staffOffsets = staffOffsetsByPart(parts)

  for (const [partIndex, part] of parts.entries()) {
    // The measure's position, not its number attribute: see fingeringKeys.js.
    // Counted per part, because every part runs the same measures.
    for (const [measureIndex, measure] of [...part.querySelectorAll('measure')].entries()) {
      const noteCounters = new Map()

      for (const note of measure.querySelectorAll('note')) {
        if (note.querySelector('rest')) continue

        // Convert 1-based MusicXML indices to 0-based
        const staff = staffOffsets[partIndex] + getElementInt(note, 'staff', 1) - 1
        const voice = getElementInt(note, 'voice', 1) - 1

        yield { note, key: fingeringKey(measureIndex, staff, voice, nextNoteIndex(noteCounters, staff, voice)) }
      }
    }
  }
}

// Returns whatever costs least to hand to osmd.load(), which accepts either a
// MusicXML string or an already-parsed Document: the untouched string when
// there is nothing to inject, and otherwise the Document this function had to
// parse anyway. Serializing it back only to have OSMD re-parse it was a full
// serialize plus a full parse of a several-hundred-KB document, on the load
// path, for every score carrying fingerings.
export function injectFingerings(xmlString, fingerings) {
  if (!fingerings || Object.keys(fingerings).length === 0) {
    return xmlString
  }

  const doc = new DOMParser().parseFromString(xmlString, 'text/xml')
  for (const { note, key } of fingeringNotesInDocument(doc)) {
    if (fingerings[key] !== undefined) injectFingeringIntoNote(doc, note, fingerings[key])
  }
  return doc
}

function getOrCreateChild(doc, parent, tagName) {
  let child = parent.querySelector(tagName)
  if (!child) {
    child = doc.createElement(tagName)
    parent.appendChild(child)
  }
  return child
}

function injectFingeringIntoNote(doc, note, finger) {
  // Find or create <notations> (insert after <type> per MusicXML element order)
  let notations = note.querySelector('notations')
  if (!notations) {
    notations = doc.createElement('notations')
    const typeEl = note.querySelector('type')
    if (typeEl?.nextSibling) {
      note.insertBefore(notations, typeEl.nextSibling)
    } else {
      note.appendChild(notations)
    }
  }

  const technical = getOrCreateChild(doc, notations, 'technical')
  // Remove all existing fingerings (e.g. turn ornaments can have multiple)
  for (const f of [...technical.querySelectorAll('fingering')]) f.remove()
  const fingering = doc.createElement('fingering')
  fingering.textContent = finger.toString()
  technical.appendChild(fingering)
}
