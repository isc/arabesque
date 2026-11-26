import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { ICONS, BLOCK } from '../../scripts/icons.mjs'
import { htmlPages, moduleFiles } from '../../scripts/stamp-version.mjs'

// The icons are masks the stylesheet draws for [data-icon] (scripts/icons.mjs).
// An icon named with no glyph behind it is no blank: it is a solid square in
// the text's colour. And a glyph no page names is bytes every page loads.

const PUBLIC_DIR = join(import.meta.dirname, '..', '..', 'public')
const read = (path) => readFileSync(join(PUBLIC_DIR, path), 'utf8')

// Named outright (data-icon="loop"), or as the quoted names an Alpine binding
// picks from (:data-icon="playing ? 'pause' : 'play'") — not the ones it tests
// a value against (opt.value === 'stale').
function namesIn(source) {
  return [...source.matchAll(/(:?)data-icon="([^"]*)"/g)].flatMap(([, bound, value]) =>
    bound ? [...value.replace(/[!=]==?\s*'[^']*'/g, '').matchAll(/'([a-z-]+)'/g)].map((m) => m[1]) : [value]
  )
}

const used = new Set([...htmlPages(), ...moduleFiles()].flatMap((path) => namesIn(read(path))))
const drawn = [...read('styles.css').match(BLOCK)[0].matchAll(/\[data-icon="([a-z-]+)"\] \{ --pt-glyph: url\("data:image\/svg\+xml,/g)].map((m) => m[1])

describe('icons', () => {
  it('lists exactly the icons the app names', () => {
    expect([...used].sort()).toEqual(Object.keys(ICONS).sort())
  })

  it('draws every icon listed, as the script writes them', () => {
    expect(drawn).toEqual(Object.keys(ICONS).sort())
  })
})
