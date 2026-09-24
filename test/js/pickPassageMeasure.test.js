import { describe, it, expect } from 'vitest'
import { pickPassageMeasure } from '../../public/js/utils.js'

// The gesture strict mode's loop and training mode's passage share: click the
// first bar, then the last.
describe('pickPassageMeasure', () => {
  it('takes the first click as the start, and arms the second when a loop is on', () => {
    expect(pickPassageMeasure({ measureIndex: 4, start: 0, armed: false, loop: true }))
      .toEqual({ start: 4, end: null, armed: true })
  })

  it('leaves nothing armed with the loop off, so every click just moves the start', () => {
    expect(pickPassageMeasure({ measureIndex: 4, start: 0, armed: false, loop: false }))
      .toEqual({ start: 4, end: null, armed: false })
  })

  it('closes the passage on the next click at or after the start', () => {
    expect(pickPassageMeasure({ measureIndex: 7, start: 4, armed: true, loop: true }))
      .toEqual({ start: 4, end: 7, armed: false })
  })

  it('accepts a passage of a single measure', () => {
    expect(pickPassageMeasure({ measureIndex: 4, start: 4, armed: true, loop: true }))
      .toEqual({ start: 4, end: 4, armed: false })
  })

  it('starts the pick over when the second click lands before the first', () => {
    expect(pickPassageMeasure({ measureIndex: 2, start: 4, armed: true, loop: true }))
      .toEqual({ start: 2, end: null, armed: true })
  })
})
