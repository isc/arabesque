import { describe, it, expect, vi, afterEach } from 'vitest'
// screenshot.js only reaches for `document` inside its functions, so it imports
// cleanly in node; each test stubs the globals the call it makes needs.
import {
  captureViewport,
  encode,
  isXmlName,
  outputSize,
  stickyOffsets,
  touchesViewport,
} from '../../public/js/screenshot.js'

afterEach(() => vi.unstubAllGlobals())

describe('outputSize', () => {
  it('sends a picture the size of the screen when the screen is small enough', () => {
    expect(outputSize(1280, 800, { pixelRatio: 1 })).toEqual({ width: 1280, height: 800 })
  })

  it('follows the display density, so a retina screen is not sent blurred', () => {
    expect(outputSize(600, 400, { pixelRatio: 2 })).toEqual({ width: 1200, height: 800 })
  })

  it('caps the long edge, so a phone at 3× does not send a 2532 px picture', () => {
    // 390×844 at DPR 3 would be 1170×2532; the cap lands the long edge on 1400.
    expect(outputSize(390, 844, { pixelRatio: 3 })).toEqual({ width: 647, height: 1400 })
  })

  it('shrinks a window wider than the cap', () => {
    expect(outputSize(2800, 1400, { pixelRatio: 1 })).toEqual({ width: 1400, height: 700 })
  })
})

describe('encode', () => {
  const canvas = (sizeAt) => ({ toDataURL: (type, q) => `data:${type};base64,` + 'x'.repeat(sizeAt(q)) })

  it('takes the best quality that fits', () => {
    const calls = []
    const url = encode(
      { toDataURL: (type, q) => (calls.push(q), `data:${type};base64,` + 'x'.repeat(q > 0.7 ? 500 : 50)) },
      { maxChars: 100, type: 'image/webp' },
    )
    expect(calls).toEqual([0.8, 0.6])
    expect(url.length).toBeLessThanOrEqual(100)
  })

  it('sends nothing rather than something outsized', () => {
    expect(encode(canvas(() => 10_000), { maxChars: 100, type: 'image/webp' })).toBeNull()
  })
})

// Dropping the groups wholly off screen is what keeps a long score from
// serialising megabytes of markup to produce one screenful.
describe('touchesViewport', () => {
  const viewport = { width: 1000, height: 800 }
  const box = (top, height) => ({ top, bottom: top + height, left: 0, right: 500, width: 500, height })

  it('keeps a group on screen', () => {
    expect(touchesViewport(box(100, 200), viewport)).toBe(true)
  })

  it('keeps a group that only straddles the edge', () => {
    expect(touchesViewport(box(-50, 200), viewport)).toBe(true)
    expect(touchesViewport(box(790, 200), viewport)).toBe(true)
  })

  it('drops a group above or below the window', () => {
    expect(touchesViewport(box(-300, 200), viewport)).toBe(false)
    expect(touchesViewport(box(900, 200), viewport)).toBe(false)
  })

  it('keeps anything with no measurable box — <defs> a survivor may reference', () => {
    expect(touchesViewport({ ...box(-5000, 0), width: 0, height: 0 }, viewport)).toBe(true)
  })
})

// An attribute XML cannot name aborts the parse of the whole picture, and every
// Alpine directive on the page is one.
describe('isXmlName', () => {
  it('rejects the shapes Alpine puts in the markup', () => {
    for (const name of ['@click', ':class', 'x-on:submit.prevent', '@keydown.escape.window']) {
      expect(isXmlName(name), name).toBe(false)
    }
  })

  it('keeps the plain ones', () => {
    for (const name of ['class', 'data-theme', 'x-show', 'aria-label', 'stroke-width', 'viewBox']) {
      expect(isXmlName(name), name).toBe(true)
    }
  })
})

// The clone has no scrollport, so a pinned element would land where the flow
// puts it. This is the number that puts it back.
describe('stickyOffsets', () => {
  // A bar pinned at the top of the window: 120px down the document, scrolled
  // 400px, so stickiness holds it at 0 instead of -280.
  const pinned = () => {
    const el = { style: { position: '' } }
    el.getBoundingClientRect = () => (el.style.position === 'static' ? { top: -280, left: 0 } : { top: 0, left: 0 })
    return el
  }

  it('measures how far stickiness has moved the element', () => {
    expect(stickyOffsets([pinned()])).toEqual([{ x: 0, y: 280 }])
  })

  it('is zero for an element stickiness is not currently holding', () => {
    const loose = { style: { position: '' }, getBoundingClientRect: () => ({ top: 300, left: 0 }) }
    expect(stickyOffsets([loose])).toEqual([{ x: 0, y: 0 }])
  })

  it('puts the live page back exactly as it found it', () => {
    const el = pinned()
    el.style.position = 'sticky'
    stickyOffsets([el])
    expect(el.style.position).toBe('sticky')
  })

  it('puts it back even when the measurement throws', () => {
    const el = {
      style: { position: 'sticky' },
      getBoundingClientRect() {
        if (this.style.position === 'static') throw new Error('nope')
        return { top: 0, left: 0 }
      },
    }
    expect(() => stickyOffsets([el])).toThrow()
    expect(el.style.position).toBe('sticky')
  })
})

describe('captureViewport', () => {
  // The capture waits for the dialog to paint before it starts; in node the
  // frames have to be handed to it.
  const framesRunStraightAway = () => vi.stubGlobal('requestAnimationFrame', (cb) => cb())

  it('returns null rather than a picture of nothing when there is no viewport', async () => {
    framesRunStraightAway()
    vi.stubGlobal('document', { documentElement: { clientWidth: 0, clientHeight: 0 } })
    await expect(captureViewport()).resolves.toBeNull()
  })

  it('swallows a capture failure so the report still goes out', async () => {
    // Anything at all going wrong mid-capture — here, a DOM that throws.
    framesRunStraightAway()
    vi.stubGlobal('document', {
      documentElement: { clientWidth: 1000, clientHeight: 800 },
      get body() {
        throw new Error('nope')
      },
    })
    vi.stubGlobal('console', { ...console, warn: vi.fn() })
    await expect(captureViewport()).resolves.toBeNull()
  })
})
