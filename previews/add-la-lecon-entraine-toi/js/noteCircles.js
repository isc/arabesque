// The notes a player circled on the score (fingeringPad.js): a ring around the
// notehead and, beside its staff, the few words of a reminder, when it has
// one — the spot a teacher marks with a pencil ("fa, pas fa♯").
//
// A circle is kept as the note it stands on, by fingering key, never as a
// drawing: the sheet reflows with the width of the screen and is redrawn whole
// by a fingering entered, and anything kept in pixels would land on another
// note. So it is drawn from the rendered notehead each time the score is
// (repaintScore in app.js), the way a fragment's shading is (musicxml.js).
import { svgNoteheadFor } from './noteExtraction.js'

const SVG_NS = 'http://www.w3.org/2000/svg'

// In staff spaces, OSMD's unit, so the marks scale with the engraving.
const RING_PADDING = 0.45 // around the notehead's box
const TEXT_SIZE = 1.5
const TEXT_GAP = 0.4 // between a reminder and whatever it clears

// Which side of a staff a reminder goes, as the sign of a step down the page.
const ABOVE = -1
const BELOW = 1

function svgElement(name, attributes) {
  const element = document.createElementNS(SVG_NS, name)
  for (const [attribute, value] of Object.entries(attributes)) element.setAttribute(attribute, value)
  return element
}

const overlaps = (a, b) => a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom

// How far out from `line` what is drawn on it reaches on `side`, over
// [left, right], in SVG units: OSMD's sky line above and bottom line below,
// which it keeps of everything it placed there — notes, stems, beams,
// fingerings — to place the next thing clear of them, as this does.
function reach(line, left, right, side, space) {
  const { x, y } = line.PositionAndShape.AbsolutePosition
  const skyBottom = line.SkyBottomLineCalculator
  const [from, to] = [left / space - x, right / space - x]
  const edge = side === ABOVE ? skyBottom.getSkyLineMinInRange(from, to) : skyBottom.getBottomLineMaxInRange(from, to)
  // A range off the line's ends answers nothing, or Number.MAX_VALUE.
  const staffEdge = side === ABOVE ? 0 : line.StaffHeight
  return (y + (Math.abs(edge) < 1e3 ? edge : staffEdge)) * space
}

// The box a reminder of `size` ({ width, height }) takes at `left`, beside
// `line`, the staff of the note `ring` is drawn around. On the side of the
// staff the note sits on — a low note's reminder under it, where the eye
// already is — unless that side is the gap to the next staff and the reminder
// does not fit there; then on the other. Clear of what is drawn on the staff
// and of the reminders already placed (`placed`).
function reminderBox({ line, lines, space }, ring, left, size, placed) {
  const right = left + size.width
  const gap = TEXT_GAP * space
  const middle = (line.PositionAndShape.AbsolutePosition.y + line.StaffHeight / 2) * space
  const sides = ring.cy <= middle ? [ABOVE, BELOW] : [BELOW, ABOVE]

  const near = (side) =>
    side === ABOVE
      ? Math.min(reach(line, left, right, ABOVE, space), ring.cy - ring.ry)
      : Math.max(reach(line, left, right, BELOW, space), ring.cy + ring.ry)
  const fits = (side) => {
    const across = lines[lines.indexOf(line) + side]
    return !across || Math.abs(reach(across, left, right, -side, space) - near(side)) >= size.height + 2 * gap
  }
  const side = sides.find(fits) ?? sides[0]

  // Out from `edge`, away from the staff; then past any reminder it would cover.
  const outFrom = (edge) => {
    const top = side === ABOVE ? edge - gap - size.height : edge + gap
    return { left, right, top, bottom: top + size.height }
  }
  let box = outFrom(near(side))
  for (let other; (other = placed.find((p) => overlaps(p, box))); ) box = outFrom(side === ABOVE ? other.top : other.bottom)
  return box
}

// Where a score's circles are drawn: the rings and reminders over everything,
// and the tints inside the rings under the staves and the notes, so that the
// head stays as black as it was printed. Under them, only the bars' click
// rectangles, whose own shading (a training passage) the tint goes over.
function circleLayers(svg) {
  const under = svgElement('g', { class: 'pt-circle-tints' })
  svg.insertBefore(under, svg.querySelector(':scope > g.measure-click-areas')?.nextSibling ?? svg.firstChild)
  return { under, over: svg.appendChild(svgElement('g', { class: 'pt-circles' })) }
}

// `keepClear` is handed, at each paint, the box of every circle drawn and the
// system it is on (OSMD's MusicSystem), for the training dots to clear.
export function initNoteCircles({ getOsmdInstance, getNoteDataByKey, graphicalMeasureForNote, keepClear }) {
  // The score's circles, by note key: their reminders ('' for none).
  let circles = {}

  // A ring around the note's head and its reminder, if any, in `layers.over`,
  // and the tint inside the ring in `layers.under`; its box, ring and reminder
  // together, in SVG units.
  function drawCircle(layers, key, text, noteData, notehead, placed) {
    const measure = graphicalMeasureForNote(noteData.note)
    const staff = { line: measure.ParentStaffLine, lines: measure.parentMusicSystem.StaffLines, space: measure.stave.getSpacingBetweenLines() }
    const head = notehead.getBBox()
    const pad = RING_PADDING * staff.space
    const ring = { cx: head.x + head.width / 2, cy: head.y + head.height / 2, rx: head.width / 2 + pad, ry: head.height / 2 + pad }

    layers.under.append(svgElement('ellipse', ring))
    const mark = svgElement('g', { class: 'pt-circle', 'data-key': key })
    mark.append(svgElement('ellipse', ring))
    layers.over.append(mark)
    const box = { system: measure.parentMusicSystem, left: ring.cx - ring.rx, right: ring.cx + ring.rx, top: ring.cy - ring.ry, bottom: ring.cy + ring.ry }
    if (!text) return box

    // Measured where it stands, its baseline at 0: the box says how far the
    // glyphs reach above and below it.
    const label = svgElement('text', { x: 0, y: 0, 'font-size': TEXT_SIZE * staff.space })
    label.textContent = text
    mark.append(label)
    const glyphs = label.getBBox()

    // From the ring's left edge, kept within the staff's length.
    const { PositionAndShape: shape } = staff.line
    const lineLeft = shape.AbsolutePosition.x * staff.space
    const left = Math.max(lineLeft, Math.min(box.left, lineLeft + shape.Size.width * staff.space - glyphs.width))

    const reminder = reminderBox(staff, ring, left, glyphs, placed)
    placed.push(reminder)
    label.setAttribute('x', left)
    label.setAttribute('y', reminder.top - glyphs.y)
    return {
      ...box,
      left: Math.min(box.left, reminder.left),
      right: Math.max(box.right, reminder.right),
      top: Math.min(box.top, reminder.top),
      bottom: Math.max(box.bottom, reminder.bottom),
    }
  }

  // Draws the circles over the score as it stands, in place of those drawn
  // before. A key no note of the score answers to draws nothing.
  function repaint() {
    for (const group of document.querySelectorAll('#score g.pt-circles, #score g.pt-circle-tints')) group.remove()
    const osmd = getOsmdInstance()
    const noteDataByKey = getNoteDataByKey()
    const layers = new Map()
    const placed = []
    const boxes = []
    for (const [key, text] of Object.entries(osmd ? circles : {})) {
      const noteData = noteDataByKey.get(key)
      const notehead = noteData && svgNoteheadFor(osmd, noteData)
      const svg = notehead?.ownerSVGElement
      if (!svg) continue
      if (!layers.has(svg)) layers.set(svg, circleLayers(svg))
      boxes.push(drawCircle(layers.get(svg), key, text, noteData, notehead, placed))
    }
    keepClear(boxes)
  }

  return {
    // The circles of the score just opened, as storage keeps them.
    load: (stored) => {
      circles = { ...stored }
    },
    get: (key) => circles[key] ?? null,
    set: (key, text) => {
      circles[key] = text
    },
    remove: (key) => {
      delete circles[key]
    },
    repaint,
  }
}
