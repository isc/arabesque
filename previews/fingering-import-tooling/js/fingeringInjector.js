function getElementInt(parent, tagName, defaultValue) {
  const el = parent.querySelector(tagName)
  return el ? parseInt(el.textContent, 10) : defaultValue
}

// The name a fingering is stored under: the measure as the XML numbers it, the
// staff and voice 0-based, and how many pitched notes of that staff and voice
// the measure has already spent. `counters` is one Map per measure, and every
// pitched note has to be offered to this function in document order — the
// index is a running count, so skipping a note shifts every key after it.
//
// Exported because scripts/import-fingerings.mjs walks the same MusicXML as
// text, to write a fingering into a score file rather than over it, and the two
// walks must name the same note: a promoted fingering that lands one note along
// is worse than no fingering at all.
export function nextFingeringKey(counters, measureNumber, staff, voice) {
  const counterKey = `${staff}:${voice}`
  const noteIndex = counters.get(counterKey) || 0
  counters.set(counterKey, noteIndex + 1)
  return `${measureNumber}:${staff}:${voice}:${noteIndex}`
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

  const parser = new DOMParser()
  const doc = parser.parseFromString(xmlString, 'text/xml')

  for (const part of doc.querySelectorAll('part')) {
    for (const measure of part.querySelectorAll('measure')) {
      const measureNumber = parseInt(measure.getAttribute('number'), 10)
      const noteCounters = new Map()

      for (const note of measure.querySelectorAll('note')) {
        if (note.querySelector('rest')) continue

        // Convert 1-based MusicXML indices to 0-based
        const staff = getElementInt(note, 'staff', 1) - 1
        const voice = getElementInt(note, 'voice', 1) - 1

        const fingeringKey = nextFingeringKey(noteCounters, measureNumber, staff, voice)
        if (fingerings[fingeringKey] !== undefined) {
          injectFingeringIntoNote(doc, note, fingerings[fingeringKey])
        }
      }
    }
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
