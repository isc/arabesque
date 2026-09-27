import { describe, it, expect } from 'vitest'
import fr from '../../public/js/locales/fr.js'
import en from '../../public/js/locales/en.js'

// The two catalogs hold the same keys. Nothing else would say so when they
// drift: t() falls back to the other language, then to the key itself, so a
// French player is simply shown English — or "score.something".
const flatten = (tree, prefix = '') =>
  Object.entries(tree).flatMap(([key, value]) =>
    typeof value === 'string' ? [[prefix + key, value]] : flatten(value, `${prefix}${key}.`))
const FR = new Map(flatten(fr))
const EN = new Map(flatten(en))
const placeholders = (text) => (text.match(/\{\w+\}/g) ?? []).sort().join()

describe('the locale catalogs', () => {
  it('hold the same keys', () => {
    expect([...FR.keys()].sort()).toEqual([...EN.keys()].sort())
  })

  // A placeholder one language leaves out drops the value there, and a
  // misspelt one is printed as it stands.
  it('give a string the same placeholders in both languages', () => {
    const mismatched = [...FR.keys()].filter((key) => EN.has(key) && placeholders(FR.get(key)) !== placeholders(EN.get(key)))
    expect(mismatched).toEqual([])
  })
})
