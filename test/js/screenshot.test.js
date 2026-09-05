import { describe, it, expect, vi, afterEach } from 'vitest'

// screenshot.js reaches for `document` at import time only inside functions, so
// the module imports cleanly in node; each test stubs the globals it needs.
const load = async () => {
  vi.resetModules()
  return import('../../public/js/screenshot.js')
}

afterEach(() => vi.unstubAllGlobals())

describe('visibleCrop', () => {
  // A score laid out 1:1 — 1000 user units across 1000 CSS pixels — so a crop
  // in pixels and the same crop in user units read the same, and the arithmetic
  // being checked is the clipping rather than the scaling.
  const svg = { rect: { left: 0, top: 0, width: 1000, height: 4000 }, viewBox: [0, 0, 1000, 4000] }
  const viewport = { width: 1000, height: 800 }

  it('takes the band on screen, not the whole score', async () => {
    const { visibleCrop } = await load()
    const crop = visibleCrop({ ...svg, viewport, maxEdge: 1000 })
    expect(crop.viewBox).toEqual([0, 0, 1000, 800])
  })

  it('follows the scroll: a score scrolled up crops from further down', async () => {
    const { visibleCrop } = await load()
    const crop = visibleCrop({ ...svg, rect: { ...svg.rect, top: -1500 }, viewport, maxEdge: 1000 })
    expect(crop.viewBox).toEqual([0, 1500, 1000, 800])
  })

  it('stops at the end of the score rather than past it', async () => {
    const { visibleCrop } = await load()
    // 300px of score left below the fold, 800px of window.
    const crop = visibleCrop({ ...svg, rect: { ...svg.rect, top: -3700 }, viewport, maxEdge: 1000 })
    expect(crop.viewBox).toEqual([0, 3700, 1000, 300])
  })

  it('returns null when the score is scrolled out of sight', async () => {
    const { visibleCrop } = await load()
    expect(visibleCrop({ ...svg, rect: { ...svg.rect, top: -4000 }, viewport, maxEdge: 1000 })).toBeNull()
    expect(visibleCrop({ ...svg, rect: { ...svg.rect, top: 800 }, viewport, maxEdge: 1000 })).toBeNull()
  })

  it('translates pixels into user units when the two differ', async () => {
    const { visibleCrop } = await load()
    // Same score, displayed at half size: 400px of window is 800 user units.
    const crop = visibleCrop({
      rect: { left: 0, top: -200, width: 500, height: 2000 },
      viewBox: [0, 0, 1000, 4000],
      viewport: { width: 1000, height: 400 },
      maxEdge: 1000,
    })
    expect(crop.viewBox).toEqual([0, 400, 1000, 800])
  })

  it('caps the output at maxEdge, so a wide window does not mean a big file', async () => {
    const { visibleCrop } = await load()
    const crop = visibleCrop({ ...svg, viewport: { width: 2000, height: 800 }, maxEdge: 1000, maxScale: 2 })
    // The band is 1000×800; the long edge lands exactly on the cap.
    expect([crop.width, crop.height]).toEqual([1000, 800])
  })

  it('never enlarges past the display density', async () => {
    const { visibleCrop } = await load()
    // A phone-sized band would scale 2.5× to reach maxEdge; DPR 1 says no.
    const crop = visibleCrop({
      rect: { left: 0, top: 0, width: 390, height: 4000 },
      viewBox: [0, 0, 390, 4000],
      viewport: { width: 390, height: 400 },
      maxEdge: 1000,
      maxScale: 1,
    })
    expect([crop.width, crop.height]).toEqual([390, 400])
  })
})

describe('encode', () => {
  // A canvas whose encoded size depends on quality, the way a real one's does.
  const canvas = (sizeAt) => ({ toDataURL: (type, q) => `data:${type};base64,` + 'x'.repeat(sizeAt(q)) })

  it('takes the best quality that fits', async () => {
    const { encode } = await load()
    const calls = []
    const url = encode(
      { toDataURL: (type, q) => (calls.push(q), `data:${type};base64,` + 'x'.repeat(q > 0.7 ? 500 : 50)) },
      { maxChars: 100, type: 'image/webp' },
    )
    expect(calls).toEqual([0.8, 0.6])
    expect(url.length).toBeLessThanOrEqual(100)
  })

  it('sends nothing rather than something outsized', async () => {
    const { encode } = await load()
    expect(encode(canvas(() => 10_000), { maxChars: 100, type: 'image/webp' })).toBeNull()
  })
})

// Dropping the groups that are wholly off screen is what keeps a long score
// from serialising megabytes of markup to produce one screenful.
describe('touchesViewport', () => {
  const viewport = { width: 1000, height: 800 }
  const box = (top, height) => ({ top, bottom: top + height, left: 0, right: 500, width: 500, height })

  it('keeps a group on screen', async () => {
    const { touchesViewport } = await load()
    expect(touchesViewport(box(100, 200), viewport)).toBe(true)
  })

  it('keeps a group that only straddles the edge', async () => {
    const { touchesViewport } = await load()
    expect(touchesViewport(box(-50, 200), viewport)).toBe(true)
    expect(touchesViewport(box(790, 200), viewport)).toBe(true)
  })

  it('drops a group above or below the window', async () => {
    const { touchesViewport } = await load()
    expect(touchesViewport(box(-300, 200), viewport)).toBe(false)
    expect(touchesViewport(box(900, 200), viewport)).toBe(false)
  })

  it('keeps anything with no measurable box — <defs> a survivor may reference', async () => {
    const { touchesViewport } = await load()
    expect(touchesViewport({ ...box(-5000, 0), width: 0, height: 0 }, viewport)).toBe(true)
  })
})

describe('captureScore', () => {
  it('returns null instead of throwing when the page has no score', async () => {
    vi.stubGlobal('document', { querySelectorAll: () => [] })
    vi.stubGlobal('window', { innerHeight: 800, innerWidth: 1000 })
    const { captureScore } = await load()
    await expect(captureScore()).resolves.toBeNull()
  })

  it('swallows a capture failure so the report still goes out', async () => {
    // Anything at all going wrong mid-capture — here, a DOM that throws.
    vi.stubGlobal('document', {
      querySelectorAll: () => {
        throw new Error('nope')
      },
    })
    vi.stubGlobal('window', { innerHeight: 800, innerWidth: 1000 })
    vi.stubGlobal('console', { ...console, warn: vi.fn() })
    const { captureScore } = await load()
    await expect(captureScore()).resolves.toBeNull()
  })
})
