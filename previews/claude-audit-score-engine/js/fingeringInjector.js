import { fileNumbering } from './fingeringKeys.js'

function getElementInt(parent, tagName, defaultValue) {
  const el = parent.querySelector(tagName)
  return el ? parseInt(el.textContent, 10) : defaultValue
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
// library (test/fingering_key_scheme_test.rb). scripts/import-fingerings.mjs
// walks the file as text and numbers it with the same fileNumbering().
export function* fingeringNotesInDocument(doc) {
  const numbering = fileNumbering()
  for (const part of doc.querySelectorAll('part')) {
    numbering.part([...part.querySelectorAll('staves')].map((el) => parseInt(el.textContent, 10)))
    for (const measure of part.querySelectorAll('measure')) {
      numbering.measure(parseInt(measure.getAttribute('number'), 10), measure.getAttribute('implicit') === 'yes')
      for (const note of measure.querySelectorAll('note')) {
        if (note.querySelector('rest')) continue
        yield { note, key: numbering.note(getElementInt(note, 'staff', 1), getElementInt(note, 'voice', 1)).key }
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
