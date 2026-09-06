// A picture of the screen to send with a feedback report.
//
// "The notes are wrong in this bar" needs a "this bar", and "it does not react
// when I play" needs to show which mode was on, what the bands said and what
// the page was doing. So what travels with a report is the **viewport** — the
// app exactly as the reporter saw it, minus the modal in front of it — not one
// part of it. That is why this module knows nothing about scores: it captures
// whatever page it is called from, the library included.
//
// It uses no rasteriser dependency, because the platform is one. An SVG image
// paints the HTML inside a <foreignObject>, and a canvas rasterises the SVG:
//
//   clone the page → wrap it in <foreignObject> → <img src="data:image/svg+xml">
//   → drawImage → toDataURL
//
// The decisive part is that the clone is real DOM under a real <style>: the
// page's own stylesheet is inlined whole, so every rule applies as it does on
// screen. `g.vf-notehead.played-note path` colours the played noteheads here
// exactly as it colours them on the page — no list of properties to copy by
// hand, and nothing to forget the day a rule is added. That is what settled the
// dependency question: html2canvas is ~200 kB to precache and paints inline SVG
// by serialising it detached, the very thing the first version of this change
// had to hand-copy paint properties around; and html-to-image, which builds the
// same foreignObject, gets its fidelity by copying the computed style of every
// node — affordable for a widget, not for the 58 000 of Chopin's Ballade.
//
// What a static clone cannot inherit is the browser's scrolling state, and
// three things depend on it. Each is put back below, from measurements of the
// live page: the window's scroll offset, the scroll offset of any inner
// scroller (the library's list is one), and the offset stickiness gives a
// pinned element (the score page's whole header/mode/playback stack is sticky,
// and it is the most diagnostic thing on the page).

const XHTML_NS = 'http://www.w3.org/1999/xhtml'
const SVG_NS = 'http://www.w3.org/2000/svg'

// Roughly 300 kB of base64 — the ceiling `screenshot` is checked against in
// supabase/feedback.sql, with room to spare for the rest of the row. Quality is
// walked down until the picture fits; one that still will not fit is dropped.
const MAX_CHARS = 300_000
const QUALITIES = [0.8, 0.6, 0.4]

// The long edge of the output. A phone at 3× would otherwise send a 1170×2532
// picture of a 390 px screen: past this the extra pixels are invented as far as
// legibility goes, and they are not free.
const MAX_EDGE = 1400

// Nodes that carry no paint and would only bulk up the markup, plus <dialog>.
// A dialog is what stands in front of the screen rather than part of it, which
// is why one is never in the picture it is itself asking for — the backdrop
// goes with it, since `html:has(dialog[open])::before` is what draws that.
const DROPPED = 'dialog, script, template, link, meta, noscript'

// XML has no room for Alpine's attribute names — `@click`, `:class`,
// `x-on:submit.prevent`. They would each abort the parse of the SVG image, and
// they describe behaviour, which a picture has none of.
const XML_NAME = /^[A-Za-z_][A-Za-z0-9_.-]*$/

export function isXmlName(name) {
  return XML_NAME.test(name)
}

// Whether a child of an <svg> is worth carrying into the picture. Anything with
// no measurable box — <defs> and friends — is kept: it may be referenced by
// something that survives.
export function touchesViewport(rect, viewport) {
  if (!rect.width || !rect.height) return true
  return rect.bottom > 0 && rect.top < viewport.height && rect.right > 0 && rect.left < viewport.width
}

// How many pixels the picture of a `width × height` viewport should be. Capped
// on the long edge, and never sharper than the screen it is a picture of.
export function outputSize(width, height, { pixelRatio = 1 } = {}) {
  const scale = Math.min(pixelRatio || 1, MAX_EDGE / Math.max(width, height))
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  }
}

// WebP holds a screenful of text and notation at a fraction of JPEG's size, and
// every browser this app runs on makes one; the probe is for the ones that turn
// out not to.
function imageType() {
  const probe = document.createElement('canvas')
  probe.width = probe.height = 1
  return probe.toDataURL('image/webp').startsWith('data:image/webp') ? 'image/webp' : 'image/jpeg'
}

// Walk the quality down until the data URL fits, and give up rather than send
// something outsized. `type` is injectable so a test need not own a canvas.
export function encode(canvas, { maxChars = MAX_CHARS, type = imageType() } = {}) {
  for (const quality of QUALITIES) {
    const dataUrl = canvas.toDataURL(type, quality)
    if (dataUrl.length <= maxChars) return dataUrl
  }
  return null
}

// Every stylesheet the page loaded, as text, to go into the clone's <style>.
// Same-origin, so the rules are readable; a sheet that is not is skipped rather
// than losing the whole capture.
function pageCss() {
  return [...document.styleSheets]
    .flatMap((sheet) => {
      try {
        return [...sheet.cssRules].map((rule) => rule.cssText)
      } catch {
        return []
      }
    })
    .join('\n')
}

// How far stickiness has moved each pinned element from where it would sit in
// the flow — the number the clone needs, since nothing in it is scrolled.
//
// Measured by asking the live page: `position: static` for the length of one
// synchronous block, two reflows, no paint in between, restored in a `finally`.
// Going static removes the sticky offset and nothing else — a sticky element
// occupies its flow space either way — so no other element moves, and the page
// the reporter is looking at is unchanged by the time the browser paints again.
export function stickyOffsets(elements) {
  const stuck = elements.map((el) => el.getBoundingClientRect())
  const saved = elements.map((el) => el.style.position)
  try {
    elements.forEach((el) => {
      el.style.position = 'static'
    })
    return elements.map((el, i) => {
      const flow = el.getBoundingClientRect()
      return { x: stuck[i].left - flow.left, y: stuck[i].top - flow.top }
    })
  } finally {
    elements.forEach((el, i) => {
      el.style.position = saved[i]
    })
  }
}

// A cloned <input>/<select>/<textarea> renders empty: what the user typed or
// ticked lives in the property, and only the attribute is serialised. Copying
// it over is what keeps a half-filled form — the state a bug report is often
// about — visible in the picture.
function reflectFormState(live, copy) {
  const tag = live.tagName
  if (tag === 'INPUT') {
    if (live.type === 'checkbox' || live.type === 'radio') copy.toggleAttribute('checked', live.checked)
    else copy.setAttribute('value', live.value)
  } else if (tag === 'TEXTAREA') {
    copy.textContent = live.value
  } else if (tag === 'OPTION') {
    copy.toggleAttribute('selected', live.selected)
  }
}

// The chrome around the score: every element outside an <svg>. The walks that
// need getComputedStyle run over this rather than over the document, because a
// page of notation is tens of thousands of SVG nodes and not one of them is
// sticky, scrolled, or a form control. A TreeWalker that turns back at each
// <svg> visits the few hundred that matter; `*:not(svg *)` would look at all
// 58 000 of the Ballade's to throw them away, which measures 13 ms a call.
function chromeElements(root) {
  const found = [root]
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT, (node) =>
    node.namespaceURI === SVG_NS ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT,
  )
  while (walker.nextNode()) found.push(walker.currentNode)
  return found
}

function scrubForXml(root) {
  for (const el of [root, ...root.querySelectorAll('*')]) {
    for (const { name, namespaceURI } of [...el.attributes]) {
      if (namespaceURI === null && !isXmlName(name)) el.removeAttribute(name)
    }
  }
}

function loadImage(src) {
  return new Promise((resolve, reject) => {
    const image = new Image()
    image.onload = () => resolve(image)
    image.onerror = () => reject(new Error('The page did not load back as an image'))
    image.src = src
  })
}

// The picture of the viewport, as a data URL, or null when anything at all goes
// wrong. Never throws: a report must go out with or without one.
export async function captureViewport() {
  try {
    // Let the dialog paint first. Everything below is a hundred milliseconds of
    // synchronous work on a long score, and none of it is worth a dialog that
    // opens late; two frames is "after the next paint", not "before it".
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)))

    const root = document.documentElement
    const viewport = { width: root.clientWidth, height: root.clientHeight }
    if (viewport.width < 1 || viewport.height < 1) return null

    // Pair the live tree with its copy by position: a deep clone holds the same
    // elements in the same order, so the same query over both lines them up.
    const body = document.body
    const clone = body.cloneNode(true)
    const liveChrome = chromeElements(body)
    const cloneChrome = chromeElements(clone)
    const liveSvgs = [...body.querySelectorAll('svg')]
    const cloneSvgs = [...clone.querySelectorAll('svg')]

    // Only the part of a score that is on screen. Without this, one screenful of
    // Chopin's first Ballade means serialising, and re-parsing, ~20 MB of markup.
    liveSvgs.forEach((svg, i) => {
      const copies = [...cloneSvgs[i].children]
      ;[...svg.children].forEach((child, j) => {
        if (!touchesViewport(child.getBoundingClientRect(), viewport)) copies[j].remove()
      })
    })

    // Put the browser's scrolling state back, from the live page's numbers.
    const sticky = []
    liveChrome.forEach((live, i) => {
      const copy = cloneChrome[i]
      reflectFormState(live, copy)
      if (live.scrollTop || live.scrollLeft) {
        // An inner scroller (the library's list). Its content is shifted rather
        // than the box, so the box keeps its size and place in the flow.
        copy.style.overflow = 'hidden'
        for (const child of copy.children) {
          child.style.transform = `translate(${-live.scrollLeft}px, ${-live.scrollTop}px)`
        }
      }
      if (getComputedStyle(live).position === 'sticky') sticky.push({ live, copy })
    })
    // `translate` rather than `transform`, so an element that is both sticky and
    // the child of a scroller keeps both offsets.
    stickyOffsets(sticky.map((pair) => pair.live)).forEach((offset, i) => {
      sticky[i].copy.style.translate = `${offset.x}px ${offset.y}px`
    })

    // The window's own scroll, and then everything DROPPED covers.
    clone.style.transform = `translate(${-window.scrollX}px, ${-window.scrollY}px)`
    for (const node of clone.querySelectorAll(DROPPED)) node.remove()
    scrubForXml(clone)

    const page = document.createElementNS(XHTML_NS, 'html')
    const style = document.createElementNS(XHTML_NS, 'style')
    style.textContent = pageCss()
    page.append(style, clone)

    const { width, height } = outputSize(viewport.width, viewport.height, {
      pixelRatio: window.devicePixelRatio,
    })
    const markup =
      `<svg xmlns="${SVG_NS}" width="${viewport.width}" height="${viewport.height}" ` +
      `viewBox="0 0 ${viewport.width} ${viewport.height}">` +
      `<foreignObject x="0" y="0" width="${viewport.width}" height="${viewport.height}">` +
      new XMLSerializer().serializeToString(page) +
      `</foreignObject></svg>`

    // A data: URL, not a blob: one — Chrome taints the canvas when an SVG image
    // holding a <foreignObject> came from a blob URL, and a tainted canvas
    // cannot be read back.
    const image = await loadImage(`data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`)

    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const ctx = canvas.getContext('2d')
    // The page is drawn on nothing; without a ground it comes out on black.
    ctx.fillStyle = getComputedStyle(root).backgroundColor || '#ffffff'
    ctx.fillRect(0, 0, width, height)
    ctx.drawImage(image, 0, 0, width, height)
    return encode(canvas)
  } catch (error) {
    console.warn('Screen capture failed, sending the report without a picture:', error)
    return null
  }
}
