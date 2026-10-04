import { describe, it, expect } from 'vitest'
import { getPeriodForComposer } from '../../public/js/musicalPeriods.js'

describe('musicalPeriods', () => {
  it('returns the canonical period for each known composer', () => {
    expect(getPeriodForComposer('J.S. Bach')).toBe('baroque')
    expect(getPeriodForComposer('Mozart')).toBe('classique')
    expect(getPeriodForComposer('Chopin')).toBe('romantique')
    expect(getPeriodForComposer('Debussy')).toBe('moderne')
    expect(getPeriodForComposer('Luo Ni')).toBe('contemporain')
    expect(getPeriodForComposer('Traditionnel')).toBe('traditionnel')
  })

  it('returns null for unknown composers (caller falls back to no period)', () => {
    expect(getPeriodForComposer('Unknown Composer')).toBeNull()
    expect(getPeriodForComposer('')).toBeNull()
    expect(getPeriodForComposer(undefined)).toBeNull()
  })
})
