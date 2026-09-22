import { describe, it, expect } from 'vitest'
import { journalEntryHelpers } from '../../public/js/journalEntries.js'

const { entryLabel } = journalEntryHelpers

// One line of the practice journal names the piece it is about. Either half of
// that name can be missing: an aggregate rebuilt from a catalog that had never
// heard of the score carries neither.
describe('entryLabel', () => {
  it('names the piece and its composer', () => {
    expect(entryLabel({ scoreTitle: "L'Harmonie des anges", composer: 'Burgmüller' }))
      .toBe("L'Harmonie des anges · Burgmüller")
  })

  it('drops the separator with the composer rather than printing "null"', () => {
    expect(entryLabel({ scoreTitle: "L'Harmonie des anges", composer: null }))
      .toBe("L'Harmonie des anges")
  })

  // The locale under node is the fallback one, so this is the English string.
  it('falls back to "untitled" for a score with no name at all', () => {
    expect(entryLabel({ scoreTitle: null, composer: null })).toBe('Untitled')
  })
})
