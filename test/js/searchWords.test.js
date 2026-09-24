import { describe, it, expect } from 'vitest'
import { searchWords, matchesSearch } from '../../public/js/utils.js'

// The library search box, whole: both sides through searchWords, weighed by
// matchesSearch.
const matches = (text, query) => matchesSearch(searchWords(text), searchWords(query))

describe('searchWords', () => {
  it('folds accents away, so a keyboard without an umlaut still finds Burgmüller', () => {
    expect(searchWords('Burgmüller')).toEqual(['burgmuller'])
    expect(matches('L’Harmonie des anges · Burgmüller', 'burgmuller')).toBe(true)
    expect(matches('L’Harmonie des anges · Burgmüller', 'burgmüller')).toBe(true)
  })

  it('splits on punctuation and keeps the numbers', () => {
    expect(searchWords('Nocturne Op. 9 No. 2')).toEqual(['nocturne', 'op', '9', 'no', '2'])
  })

  it('matches a word by its start, in any order', () => {
    expect(matches('Invention No. 4 in D Minor J.S. Bach', 'bach inv')).toBe(true)
    expect(matches('Invention No. 4 in D Minor J.S. Bach', 'inv bach')).toBe(true)
  })

  it('does not match in the middle of a word', () => {
    expect(matches('Moonlight Sonata', 'light')).toBe(false)
  })

  it('takes a query the regexes it replaced would have thrown on', () => {
    expect(matches('Fantaisie-Impromptu (Chopin)', '(chopin)')).toBe(true)
    expect(searchWords('!?')).toEqual([])
    // Nothing searchable typed, so nothing is filtered out.
    expect(matches('Moonlight Sonata', '!?')).toBe(true)
  })
})
