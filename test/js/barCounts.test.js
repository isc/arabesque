import { describe, it, expect } from 'vitest'
import { barCount, barCounts, readRecorded, WHAT_A_CHANGE_COSTS } from '../../scripts/bar-counts.mjs'

describe('bar-counts.json', () => {
  it('holds every score to the bar count recorded for it', () => {
    expect(barCounts(), WHAT_A_CHANGE_COSTS).toEqual(readRecorded())
  })
})

const measure = (attributes, inner = '') => `<measure${attributes}>${inner}</measure>`
const score = (...measures) => `<score-partwise><part id="P1">${measures.join('')}</part></score-partwise>`

// The rules a bar is counted by are barCounter's (fingeringKeys.test.js); these
// hold the reading of the file to them.
describe('barCount', () => {
  it('counts a bar split across two measures once', () => {
    expect(barCount(score(measure(' number="1"'), measure(' number="2"'), measure(' number="2" implicit="yes"'), measure(' number="3"')))).toBe(3)
  })

  // MuseScore writes double quotes, REXML (the Hanon files) single ones.
  it('reads attributes in single quotes too', () => {
    expect(barCount(score(measure(" number='1'"), measure(" number='1' implicit='yes'")))).toBe(1)
  })

  it('takes no <measure-style> for a measure', () => {
    const multiRest = '<attributes><measure-style><multiple-rest>2</multiple-rest></measure-style></attributes>'
    expect(barCount(score(measure(' number="1"', multiRest)))).toBe(1)
  })
})
