import { describe, it, expect } from 'vitest'
import { repeatIndicatorClass } from '../../public/js/musicxml.js'

describe('repeatIndicatorClass', () => {
  it('fills the dots already banked', () => {
    expect(repeatIndicatorClass(0, 2, true)).toBe('repeat-indicator filled')
    expect(repeatIndicatorClass(1, 2, true)).toBe('repeat-indicator filled')
  })

  it('leaves the dots still to come empty', () => {
    expect(repeatIndicatorClass(2, 2, true)).toBe('repeat-indicator')
    expect(repeatIndicatorClass(2, 0, false)).toBe('repeat-indicator')
  })

  it('marks the repetition under way once a wrong note spoils it', () => {
    expect(repeatIndicatorClass(0, 0, false)).toBe('repeat-indicator spoiled')
    expect(repeatIndicatorClass(2, 2, false)).toBe('repeat-indicator spoiled')
  })

  it('never spoils a dot that is already filled', () => {
    expect(repeatIndicatorClass(0, 1, false)).toBe('repeat-indicator filled')
  })
})
