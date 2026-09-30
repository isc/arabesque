import { describe, it, expect } from 'vitest'
import { measuresToReinforce, hasHotSpots } from '../../public/js/reinforcement.js'

describe('measures to reinforce', () => {
  // Sessions as the ranking takes them: oldest first, one entry per measure.
  const session = (measures, mode = 'free') => ({
    mode,
    measures: Object.entries(measures).map(([index, attempts]) => ({
      sourceMeasureIndex: Number(index),
      attempts: attempts.map(([wrongNotes, durationMs = 100]) => ({
        wrongNotes,
        durationMs,
        clean: wrongNotes === 0,
      })),
    })),
  })

  it('returns nothing without sessions', () => {
    expect(measuresToReinforce([])).toEqual([])
  })

  it('excludes measures played without a fumble', () => {
    const result = measuresToReinforce([session({ 0: [[0]], 1: [[2]] })])
    expect(result.map((m) => m.sourceMeasureIndex)).toEqual([1])
  })

  it('drops a measure once it has been played cleanly three times in a row', () => {
    const fumbled = [session({ 0: [[2]] })]
    expect(measuresToReinforce([...fumbled, session({ 0: [[0], [0]] })])).toHaveLength(1)
    expect(measuresToReinforce([...fumbled, session({ 0: [[0], [0], [0]] })])).toEqual([])
  })

  // The drill keeps the dots already filled through a spoiled repetition, and
  // says the measure is done at the third clean one: the suggestions agree
  // with it rather than offer the measure again at once. Reinforcement is
  // filed as training.
  describe('after a drill', () => {
    const fumbled = session({ 0: [[2]] })
    const drill = session({ 0: [[0], [1], [0], [0]] }, 'training')

    it('drops a measure the drill filled, a spoiled repetition among its clean ones', () => {
      expect(measuresToReinforce([fumbled, drill])).toEqual([])
    })

    it('offers it again once fumbled since', () => {
      expect(measuresToReinforce([fumbled, drill, session({ 0: [[0], [2]] })])).toHaveLength(1)
    })

    it('still asks for them in a row outside a drill', () => {
      expect(measuresToReinforce([fumbled, session({ 0: [[0], [1], [0], [0]] })])).toHaveLength(1)
    })

    it('leaves a drill given up before its last clean repetition', () => {
      expect(measuresToReinforce([fumbled, session({ 0: [[0], [1], [0]] }, 'training')])).toHaveLength(1)
    })
  })

  it('sorts by wrong notes, then by duration', () => {
    const result = measuresToReinforce([
      session({ 0: [[2, 100]], 1: [[3, 100]], 2: [[2, 300]] }),
    ])
    expect(result.map((m) => m.sourceMeasureIndex)).toEqual([1, 2, 0])
  })

  it('sums wrong notes across sessions and keeps the last duration', () => {
    const result = measuresToReinforce([
      session({ 0: [[1, 100]] }),
      session({ 0: [[2, 300]] }),
    ])
    expect(result[0]).toMatchObject({ wrongNotes: 3, durationMs: 300 })
  })

  it('respects the limit', () => {
    const result = measuresToReinforce([session({ 0: [[3]], 1: [[2]], 2: [[1]] })], { limit: 2 })
    expect(result.map((m) => m.sourceMeasureIndex)).toEqual([0, 1])
  })

  describe('per hand selection', () => {
    // One measure's attempts, each [wrongNotes, hands].
    const played = (attempts) => ({
      measures: [{
        sourceMeasureIndex: 0,
        attempts: attempts.map(([wrongNotes, hands]) => ({ wrongNotes, clean: wrongNotes === 0, hands })),
      }],
    })

    it('offers a bar fumbled with one hand only for that hand', () => {
      const sessions = [played([[2, 'left']])]
      expect(measuresToReinforce(sessions, { hands: 'left' })).toHaveLength(1)
      expect(measuresToReinforce(sessions, { hands: 'right' })).toEqual([])
      expect(measuresToReinforce(sessions, { hands: 'both' })).toEqual([])
    })

    it('reads an attempt recorded before hands were tracked as two-handed', () => {
      const sessions = [played([[2, undefined]])]
      expect(measuresToReinforce(sessions, { hands: 'both' })).toHaveLength(1)
      expect(measuresToReinforce(sessions, { hands: 'right' })).toEqual([])
    })

    it('does not retire a two-hand fumble on clean one-hand passes', () => {
      const sessions = [played([[2, 'both'], [0, 'right'], [0, 'right'], [0, 'right']])]
      expect(measuresToReinforce(sessions, { hands: 'both' })).toHaveLength(1)
      expect(measuresToReinforce(sessions, { hands: 'right' })).toEqual([])
    })

    it('ignores bars played with neither hand ticked', () => {
      expect(measuresToReinforce([played([[2, 'none']])])).toEqual([])
    })

    it('answers for every selection when none is asked about', () => {
      const sessions = [played([[2, 'left'], [0, 'both'], [0, 'both'], [0, 'both']])]
      expect(measuresToReinforce(sessions, { hands: 'both' })).toEqual([])
      expect(measuresToReinforce(sessions).map((m) => m.hands)).toEqual(['left'])
    })
  })

  it('flags a measure whose error rate stops falling, and ranks it first', () => {
    const stagnating = { 0: [[1]] } // fumbled in every session
    const improving = { 1: [[4]] } // heavier, but on the mend below
    const result = measuresToReinforce([
      session({ ...stagnating, ...improving }),
      session({ ...stagnating, 1: [[1], [0]] }),
      session({ ...stagnating, 1: [[0]] }),
    ])
    expect(result.map((m) => m.sourceMeasureIndex)).toEqual([0, 1])
    expect(result.map((m) => m.stagnant)).toEqual([true, false])
  })

  it('needs three sessions before calling a measure stagnant', () => {
    const twoSessions = [session({ 0: [[1]] }), session({ 0: [[1]] })]
    expect(measuresToReinforce(twoSessions)[0].stagnant).toBe(false)
  })

  // The library's 🎯 chip: a bar reinforcement would offer that also stands
  // out from the rest of the piece.
  describe('hot spots', () => {
    const clean = [[0], [0], [0]]

    it('finds a bar fumbled far more often than the rest of the piece', () => {
      expect(hasHotSpots([session({ 0: clean, 1: clean, 2: [[1], [1], [0]] })])).toBe(true)
    })

    it('finds none in a piece fumbled evenly, though reinforcement has bars to offer', () => {
      const even = [session({ 0: [[1], [0], [1]], 1: [[1], [1], [0]], 2: [[0], [1], [1]] })]
      expect(measuresToReinforce(even)).not.toEqual([])
      expect(hasHotSpots(even)).toBe(false)
    })

    it('needs more than one unlucky attempt', () => {
      expect(hasHotSpots([session({ 0: [[0]], 1: [[0]], 2: [[1]] })])).toBe(false)
      expect(hasHotSpots([session({ 0: clean, 1: clean, 2: [[1], [1], [1]] })])).toBe(true)
    })

    it('lets a bar go once it has been played cleanly three times in a row', () => {
      const steady = [[0], [0], [0], [0], [0], [0]]
      expect(hasHotSpots([session({ 0: steady, 1: [[1], [1], [0], [0]] })])).toBe(true)
      expect(hasHotSpots([session({ 0: steady, 1: [[1], [1], [0], [0], [0]] })])).toBe(false)
    })

    it('finds none without sessions or without a fumble', () => {
      expect(hasHotSpots([])).toBe(false)
      expect(hasHotSpots([session({ 0: clean })])).toBe(false)
    })

    it('asks of both hands unless told otherwise', () => {
      const attempts = (wrongNotes, hands) => wrongNotes.map((w) => ({ wrongNotes: w, clean: w === 0, hands }))
      const sessions = [{
        measures: [
          { sourceMeasureIndex: 0, attempts: [...attempts([0, 0, 0], 'both'), ...attempts([0, 0, 0], 'left')] },
          { sourceMeasureIndex: 1, attempts: [...attempts([0, 0, 0], 'both'), ...attempts([1, 1, 1], 'left')] },
        ],
      }]
      expect(hasHotSpots(sessions)).toBe(false)
      expect(hasHotSpots(sessions, 'left')).toBe(true)
    })
  })
})
