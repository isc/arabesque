// A picture of the score to send with a feedback report.
//
// "The notes are wrong in this bar" is a report nobody can act on without
// knowing which bar. What sits behind the feedback modal on the score page is
// OSMD's SVG, and an SVG can be rasterised with nothing but the platform:
// serialise it, load it as an image, draw it onto a canvas. So no html2canvas
// — no 200 kB dependency to precache for a once-in-a-while feature — and the
// result is sharper than a DOM rasteriser would manage, because the browser
// re-renders the real vector art at the output resolution instead of scaling a
// bitmap of the page.
//
// What that buys is bounded, deliberately: only the score is captured, not the
// app chrome around it. The score page offers this through the feedback modal's
// page-specific seam (see headerMenu.js); pages with no score never load this
// module. It also means the modal can never end up in the picture — the capture
// starts from `#score svg`, and the dialog is not inside it.

const SVG_NS = 'http://www.w3.org/2000/svg'

// The paint that styles.css, rather than OSMD, decides. Copied onto the clone
// because a detached SVG rasterised as an image never sees the page stylesheet:
// without this the played, missed and expected noteheads, the selected measure
// and the training dots all come back in OSMD's default black — losing exactly
// the colours a report about note detection is about.
const PAINT_PROPS = ['fill', 'stroke', 'stroke-width', 'fill-opacity']

// Roughly 300 kB of base64 — the ceiling `screenshot` is checked against in
// supabase/feedback.sql, minus room to spare. Quality is walked down until the
// picture fits; a score page that still will not fit sends no picture at all.
const MAX_CHARS = 300_000
const QUALITIES = [0.8, 0.6, 0.4]

// The long edge of the output, in pixels. A crop of one screen of staves is
// legible well below this; going higher only costs bytes.
const MAX_EDGE = 1000

// The SVG on screen, if there is one. OSMD renders one <svg> per page, so on a
// paginated score this picks the page the player is actually looking at.
function onscreenSvg() {
  for (const svg of document.querySelectorAll('#score svg')) {
    const rect = svg.getBoundingClientRect()
    if (rect.bottom > 0 && rect.top < window.innerHeight && rect.width > 0) return svg
  }
  return null
}

// Which slice of the score is on screen, expressed in the SVG's own coordinate
// system, and how many pixels wide the picture of it should be. Split out as
// plain arithmetic because it is the part with the interesting edge cases —
// scrolled halfway off the top, taller than the window, off screen entirely.
//
// `rect` and `viewport` are in CSS pixels; `viewBox` is [x, y, w, h] in user
// units. Returns null when nothing of the score is visible.
export function visibleCrop({ rect, viewBox, viewport, maxEdge = MAX_EDGE, maxScale = 1 }) {
  const left = Math.max(0, -rect.left)
  const top = Math.max(0, -rect.top)
  const right = Math.min(rect.width, viewport.width - rect.left)
  const bottom = Math.min(rect.height, viewport.height - rect.top)
  const width = right - left
  const height = bottom - top
  if (width < 1 || height < 1) return null

  const [vx, vy, vw, vh] = viewBox
  const unitsPerPxX = vw / rect.width
  const unitsPerPxY = vh / rect.height

  // Never enlarge past the display's own pixel density: past that the extra
  // pixels are invented, and they are not free.
  const scale = Math.min(maxEdge / Math.max(width, height), maxScale)
  return {
    viewBox: [vx + left * unitsPerPxX, vy + top * unitsPerPxY, width * unitsPerPxX, height * unitsPerPxY],
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// Whether a top-level group is worth carrying into the picture. Anything with
// no measurable box — <defs> and friends — is kept: it may be referenced by a
// group that survives.
export function touchesViewport(rect, viewport) {
  if (!rect.width || !rect.height) return true
  return rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width
}

// WebP holds line art at a fraction of JPEG's size, and every browser this app
// runs on makes one; the probe is for the ones that turn out not to.
function imageType() {
  const probe = document.createElement('canvas')
  probe.width = probe.height = 1
  return probe.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
}

// Walk the quality down until the data URL fits, and give up rather than send
// something outsized. `type` is injectable so the test need not own a canvas.
export function encode(canvas, { maxChars = MAX_CHARS, type = imageType() } = {}) {
  for (const quality of QUALITIES) {
    const dataUrl = canvas.toDataURL(type, quality)
    if (dataUrl.length <= maxChars) return dataUrl
  }
  return null
}

// Copy the stylesheet's paint from a live subtree onto its clone.
//
// Every element, rather than the handful of selectors styles.css happens to use
// today: a hand-kept list would rot silently the day a new SVG rule lands, and
// the failure — a picture quietly missing its colours — is invisible in the
// preview, in the tests and in the console. It cannot be narrowed to the
// classed elements either, because the rules that matter reach past them:
// `g.vf-notehead.played-note path` paints a <path> that carries no class, and
// OSMD's own `fill="#000000"` on that path beats anything the styled ancestor
// would pass down. Copying onto elements the stylesheet never touched is
// harmless — the computed value there is what serialisation would have kept.
//
// Pruning first is what makes this affordable: it runs over the screenful that
// survives, not over the tens of thousands of nodes in a long score.
//
// The clone is a deep copy, so the two lists hold the same elements in the same
// order and can be matched by position.
function inlinePaint(live, clone) {
  const from = [live, ...live.querySelectorAll('*')]
  const to = [clone, ...clone.querySelectorAll('*')]
  from.forEach((el, i) => {
    const computed = getComputedStyle(el)
    for (const prop of PAINT_PROPS) to[i].style.setProperty(prop, computed.getPropertyValue(prop))
  })
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('SVG did not load as an image'))
    image.src = src
  })
}

function parseViewBox(svg) {
  const parts = (svg.getAttribute('viewBox') ?? '').split(/[\s,]+/).map(Number)
  if (parts.length === 4 && parts.every(Number.isFinite)) return parts
  // OSMD always writes one, but a score rendered by some other path might not.
  return [0, 0, Number(svg.getAttribute('width')) || 1, Number(svg.getAttribute('height')) || 1]
}

// The colour the score is read against, so the picture matches the page in
// either theme. `#score` carries it; a fully transparent one means white.
function paperColour(svg) {
  const background = getComputedStyle(svg.parentElement ?? svg).backgroundColor
  return !background || background.endsWith(', 0)') ? '#ffffff' : background
}

// The picture, as a data URL, or null when there is nothing to show or anything
// at all goes wrong. Never throws: a report must go out with or without it.
export async function captureScore() {
  try {
    const svg = onscreenSvg()
    if (!svg) return null

    // Everything that depends on layout is read here, in the synchronous half,
    // before the caller puts the modal up — so the picture is of the scroll
    // position the reporter was looking at. Measured at well under a
    // millisecond even on the longest score in the library.
    const viewport = { width: window.innerWidth, height: window.innerHeight }
    const crop = visibleCrop({
      rect: svg.getBoundingClientRect(),
      viewBox: parseViewBox(svg),
      viewport,
      maxScale: window.devicePixelRatio || 1,
    })
    if (!crop) return null
    const groups = [...svg.children]
    const onScreen = groups.map((group) => touchesViewport(group.getBoundingClientRect(), viewport))
    const paper = paperColour(svg)

    // Let the modal paint before the expensive half: cloning and serialising a
    // score is tens of milliseconds, and the dialog should not wait on it.
    await new Promise(requestAnimationFrame)

    const clone = svg.cloneNode(true)
    // Absent on the live element — the HTML parser supplies the namespace
    // there, a standalone SVG document has to say so itself.
    clone.setAttribute('xmlns', SVG_NS)
    clone.setAttribute('viewBox', crop.viewBox.join(' '))
    clone.setAttribute('width', crop.width)
    clone.setAttribute('height', crop.height)

    // The crop narrows what gets *drawn*, not what gets processed. Dropping the
    // groups wholly off screen is what stops a long score from serialising 20 MB
    // of markup, and re-parsing it, to produce one screenful: on Chopin's first
    // Ballade it takes the capture from ~900 ms to ~120 ms. Painting only what
    // survives is the other half of that saving.
    const copies = [...clone.children]
    groups.forEach((group, i) => {
      if (onScreen[i]) inlinePaint(group, copies[i])
      else copies[i].remove()
    })

    const markup = new XMLSerializer().serializeToString(clone)
    const url = URL.createObjectURL(new Blob([markup], { type: 'image/svg+xml' }))
    try {
      const image = await loadImage(url)
      const canvas = document.createElement('canvas')
      canvas.width = crop.width
      canvas.height = crop.height
      const ctx = canvas.getContext('2d')
      // Staves are drawn on nothing; without a ground they come out on black.
      ctx.fillStyle = paper
      ctx.fillRect(0, 0, crop.width, crop.height)
      ctx.drawImage(image, 0, 0, crop.width, crop.height)
      return encode(canvas)
    } finally {
      URL.revokeObjectURL(url)
    }
  } catch (error) {
    console.warn('Score capture failed, sending the report without a picture:', error)
    return null
  }
}
