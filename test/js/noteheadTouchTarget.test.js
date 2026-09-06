import { describe, it, expect } from 'vitest'
import { boxesByProximity } from '../../public/js/fingeringEditor.js'

// Noteheads as the browser measures them: about 12 x 10 CSS px each. `at`
// places one by its centre, the way a score engraves them.
const head = (cx, cy) => ({ left: cx - 6, right: cx + 6, top: cy - 5, bottom: cy + 5 })
const SLOP = 12

describe('boxesByProximity', () => {
  it('takes a tap on the head itself', () => {
    expect(boxesByProximity({ x: 100, y: 100 }, [head(100, 100)], SLOP)).toEqual([0])
  })

  it('takes a tap that landed beside the head, within the slop', () => {
    expect(boxesByProximity({ x: 114, y: 106 }, [head(100, 100)], SLOP)).toEqual([0])
  })

  it('leaves a tap further out than the slop alone', () => {
    // The measure rectangle underneath is what such a tap is for.
    expect(boxesByProximity({ x: 100, y: 130 }, [head(100, 100)], SLOP)).toEqual([])
  })

  it('gives a fat finger between two heads of a chord the nearer one', () => {
    // Two heads a third apart in the same chord, the finger closer to the lower.
    const chord = [head(100, 90), head(100, 110)]
    expect(boxesByProximity({ x: 100, y: 106 }, chord, SLOP)[0]).toBe(1)
    expect(boxesByProximity({ x: 100, y: 94 }, chord, SLOP)[0]).toBe(0)
  })

  it('orders the rest of the chord behind the nearest, as fallbacks', () => {
    // The finger sits between the middle head and the top one; the bottom head
    // is out of reach and drops out entirely.
    const chord = [head(100, 130), head(100, 90), head(100, 110)]
    expect(boxesByProximity({ x: 100, y: 118 }, chord, SLOP)).toEqual([2, 0])
  })
})
