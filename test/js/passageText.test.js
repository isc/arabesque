import { describe, it, expect, vi } from 'vitest'
import { installLocalStorage } from './support/browserGlobals.js'
import { LANG_KEY } from '../../public/js/i18n.js'

// i18n picks its catalog once, while its module body runs, so a language means
// a fresh module graph with the stored choice already in place. Loaded twice
// here and reused: nothing in passageText reads the language again.
async function passageTextIn(lang) {
  vi.resetModules()
  installLocalStorage({ [LANG_KEY]: lang })
  return (await import('../../public/js/utils.js')).passageText
}

const fr = await passageTextIn('fr')
const en = await passageTextIn('en')
// Bar numbers are 1-based on screen, indices 0-based: bars 6 and 7 are 5 and 6.
const bars = (from, to) => ({ start: from - 1, end: to - 1 })

describe('passageText', () => {
  it('names the single bar of a one-bar loop rather than a range', () => {
    expect(fr('score.loopRange', bars(6, 6))).toBe('Boucle de la mesure 6.')
    expect(en('score.loopRange', bars(6, 6))).toBe('Looping bar 6.')
  })

  // Two bars is the other side of the boundary, and the one that catches the
  // bar count being off by one: a passage of two would name a single mesure.
  it('gives both ends of a passage of several bars', () => {
    expect(fr('score.loopRange', bars(6, 7))).toBe('Boucle des mesures 6 à 7.')
    expect(en('score.loopRange', bars(6, 7))).toBe('Looping bars 6 to 7.')
  })

  it('says the training lines the same way, with what else they carry', () => {
    expect(fr('score.trainingPassage', bars(5, 5), { times: 3 })).toBe('Mesure 5 seule : elle doit être jouée 3× sans erreur.')
    expect(en('score.trainingPassageDone', bars(5, 5), { times: 3 })).toBe('You played bar 5 3× without a mistake.')
    expect(fr('score.trainingPassageDone', bars(5, 8), { times: 3 })).toBe('Vous avez enchaîné les mesures 5 à 8 3× sans erreur.')
  })
})
