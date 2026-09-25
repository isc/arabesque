import { describe, it, expect, vi } from 'vitest'

// i18n picks its catalog once, while its module body runs, so a language means
// a fresh module graph with the stored choice already in place. Loaded twice
// here and reused: nothing in loopRangeText reads the language again.
async function loopRangeTextIn(lang) {
  vi.resetModules()
  vi.stubGlobal('localStorage', { getItem: () => lang, removeItem: () => {}, length: 0 })
  return (await import('../../public/js/utils.js')).loopRangeText
}

const fr = await loopRangeTextIn('fr')
const en = await loopRangeTextIn('en')
vi.unstubAllGlobals()

describe('loopRangeText', () => {
  it('names the single bar of a one-bar loop rather than a range', () => {
    expect(fr(6, 6)).toBe('Boucle de la mesure 6.')
    expect(en(6, 6)).toBe('Looping bar 6.')
  })

  // Two bars is the other side of the boundary, and the one that catches the
  // bar count being off by one: a passage of two would name a single mesure.
  it('gives both ends of a passage of several bars', () => {
    expect(fr(6, 7)).toBe('Boucle des mesures 6 à 7.')
    expect(en(6, 7)).toBe('Looping bars 6 to 7.')
  })
})
